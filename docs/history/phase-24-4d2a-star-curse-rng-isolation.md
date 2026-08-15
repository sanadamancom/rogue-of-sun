# Phase 24.4d2a: 星カード変換の呪いRNGをcombatRngStateから分離

## 開始時の完全なHEAD

`3d4dc824541a5eeff05f73df465a29b8e7a201f1`（`phase-24-4d2-star-transformation-alignment`）

## Phase 24.4d2でcombatRngState使用が残った経緯

Phase 24.4d2の最終報告後、`resolveStarEffect`内の変換結果equipmentの呪い抽選が`state.combatRngState`を消費していることが契約違反として指摘された。

実装前監査でこの機能修正に着手したところ、**呪い抽選だけでなく、変換先アイテムの候補選択ロール（候補2件以上の場合）自体も同じ`workingState.combatRngState`を消費していた**ことが判明した。これはPhase 20.5a由来の既存コードで、`wheel_of_fortune`と同じ「card-effectはcombatRngStateを共有ストリームとして使う」という設計パターンを踏襲したものであり、Phase 24.4d2では「RNG決定性」の観点でのみ確認し、「combat本流streamとの共有」という観点では見落とされていた。

この`workingState`は成功時に`Object.assign(state, transaction.nextState)`（`applyTargetedCardUse`）で実stateへcommitされるため、候補選択・呪い抽選のどちらも**実際の`combatRngState`を進めてしまう**——つまり、星カードを使うたびにその後の戦闘乱数列が変化するという実害があった。

この論点は工程のstop_conditions「星の候補選択自体もcombatRngStateを使っており、分離方法に複数の設計案がある」に該当したため、一旦停止して両方の乱数経路を報告した。続く指示で、候補選択・呪い抽選の両方を分離する設計判断が確定し、本工程（Phase 24.4d2a）として実装した。

## 修正前後の乱数経路

### 修正前（Phase 24.4d2時点）

- 候補選択（2件以上）: `rollPercent(workingState.combatRngState)` → `workingState.combatRngState`へ書き戻し
- 呪い抽選（equipment変換成立時）: `rollPercent(workingState.combatRngState)` → `workingState.combatRngState`へ書き戻し
- 成功時、両方の書き戻し結果を含む`workingState`全体が実`state`へcommitされ、以後のcombat RNG列が変化する

### 修正後（本工程）

- 候補選択（2件以上）: `createStarTransformRng(state, targetIdentity, STAR_TRANSFORM_SELECTION_SALT)`から生成した使い捨てstreamを1回消費
- 呪い抽選（equipment変換成立時）: `createStarTransformRng(state, targetIdentity + ':' + chosen, STAR_TRANSFORM_CURSE_SALT)`から生成した使い捨てstreamを1回消費
- どちらも`GameState`へ新規の永続フィールドを追加せず、呼び出しごとに使い捨てで生成——`enemy-drop.ts`の`createEnemyDropRng`/`deriveEnemyDropSeed`と同型のパターン
- `state.combatRngState`は一切読み書きされない

## 専用streamの導出入力とsalt

`deriveStarTransformSeed(state, targetIdentity, salt)`:

```
base = (state.seed XOR (state.floor+1)*0x9e3779b1 XOR (state.turn+1)*0x85ebca6b) >>> 0
seed = (base XOR hashStarTargetIdentity(targetIdentity) XOR salt) >>> 0
```

- `state.seed`: 現在floorのfloorSeed（`floor.ts`の`deriveFloorSeed(runSeed, floor)`で導出済みの値。既にfloor別に一意）
- `state.floor` / `state.turn`: 安定した既存フィールドをそのまま使用。新規フィールド追加なし
- `targetIdentity`: 候補選択roll — equipment_instanceならinstanceId、inventory_itemならItemId。呪いroll — `${targetIdentity}:${chosen}`（変換先ItemIdも含めて識別を分離）
- `hashStarTargetIdentity`: 文字列識別子をFNV-1a 32bitハッシュへ変換する新規追加の純粋関数（既存に同等のヘルパーがなかったため最小限追加）

salt定数:

- `STAR_TRANSFORM_SELECTION_SALT = 0xb3d8f27a`
- `STAR_TRANSFORM_CURSE_SALT = 0xe15c4930`

既存の`enemy-drop.ts`（`SALT_DROP_OCCURS`等7個）・`monster-house.ts`（8個）・`state.ts`の各floorSeed-XORとも非衝突であることを確認済み。

生成された数値seedは`mapgen.ts`の既存`createRng`（PRNG本体、新規実装なし）へそのまま渡す。

## 無関係RNG非干渉の実測結果

- `combatRngState`（GameStateの唯一の永続RNGフィールド）が候補2件以上の消費/equipment変換成立時の呪い抽選のいずれでもバイト単位で不変であることをfocused test・production sanity双方で直接比較
- 変換後に`combatRngState`から複数回`rollPercent`を進めた列が、星未使用のcontrol stateから同じ初期値で進めた列と完全一致することを確認（10ロール分）
- `state.seed`・`state.floor`は星変換によって一切変更されない
- map/floor-item/monsterHouse/enemy-drop/card-supplyの各RNGはfloor生成時に`state.seed`から使い捨てで導出されるだけで、GameState上に永続フィールドを持たない（`combatRngState`以外に持続的なRNGフィールドが存在しないことをtypes.ts上で確認済み）ため、これらのstreamへの影響は構造的に発生しえない

## 星だけを分離しwheel_of_fortuneを対象外とした判断

`wheel_of_fortune`の`applyWheelOfFortuneUse`は変更していない。引き続き`state.combatRngState`+`rollPercent`をそのまま使用する。production sanityで、wheel_of_fortune使用後に`combatRngState`が変化することを確認し、既存動作が保たれていることを実証した。

Phase 20カード効果全体のRNG設計を再設計する範囲拡張は行っていない。

## 呪い生成helper再利用結果

`createEquipmentInstanceWithCurse`（equipment-instance.ts）と`FLOOR_EQUIPMENT_CURSE_CHANCE`しきい値はPhase 24.4d2からそのまま再利用し、呪い生成ロジックの複製は行っていない。乱数源だけを専用streamの`rng()`（0〜1の一様乱数、`createRng`が返す関数）に差し替えた。

## 既存テスト期待値を変更した場合は対象と理由

**変更なし。** 既存の`phase-20-5a-targeted-card-effects.test.ts`（30件）、`phase-20-0d-card-target-selection.test.ts`（74件）、`phase-24-4d2-star-transformation-alignment.test.ts`（15件）は無変更で全通過した——旧テストが星の変換先ItemIdを固定値検証していた箇所は存在しなかった（多くがseed走査や候補集合の性質検証のため、乱数経路の変更に対して頑健だった）。

## 全検証結果

- **focused tests（新規）**: `phase-24-4d2a-star-curse-rng-isolation.test.ts` 13件全通過
- **Phase 24.4d2 focused tests**（無変更）: 15件全通過
- **Phase 20 star/temperance回帰**: 104件全通過（無変更）
- **wheel_of_fortune回帰**（`phase-20-1-persistent-growth.test.ts`）: 36件全通過（無変更）
- **full suite**: 123ファイル・3094テスト全通過（baseline 122/3081 + 新規1/13）
- **typecheck**（`npx tsc --noEmit`）: 成功
- **production build**（`npx vite build`）: 成功
- **diff-check**: `turn.ts`のみ変更、新規テストファイル1件追加。unrelated差分なし
- **production sanity**: 10項目全通過（combatRngState不変・後続戦闘ロール列一致・決定性維持・cursed/uncursed両到達・0候補時RNG非消費・orphanなし・wheel_of_fortune無変更）。一時スクリプト（`tmp-star-rng-sanity.ts`）は検証後削除済み

## 指示逸脱の有無

なし。監査で候補選択側もcombatRngState依存と判明した時点で独断修正せず一旦停止・報告し、続く設計確定指示を受けてから実装した。GameStateへの新規永続RNGフィールド追加なし。Math.random不使用。wheel_of_fortune・星以外のカード処理は無変更。既存テストの期待値変更なし。
