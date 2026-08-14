# Phase 24.4c: カード17種のproductionランダム供給接続

## Precheck

- baseline branch: `phase-24-4b-enemy-drops`（origin HEAD `5c10a4809dae464bb301846d9661d84eed0ad9ee`）と一致確認
- origin/main、Phase 24.4a branch未変更
- working tree clean、同名local/remote work branch衝突なし
- baseline: Phase 24.4a専用31テスト・Phase 24.4b専用26テスト・full suite 119ファイル/2996テスト全通過確認済み

## Phase 24.4a・24.4bから引き継いだ生成境界

- `state.ts`のbuildFloorStateが通常床生成・monsterHouse報酬生成の両方を担う単一関数であること
- `turn.ts`の`defeatEnemyIfNeeded`終端撃破境界に接続された`spawnEnemyDropIfAny`（Phase 24.4b）が敵ドロップの唯一の呼び出し境界であること
- `equipment-loot.ts`のfloorProgressRatio/selectNormalEquipmentDefinitionがC/B/A装備の階層比率選択の単一情報源であること
- これらの契約はいずれも本Phaseで変更していない

## Stage 0 監査結果

### CardDefinition・鑑定・封印・審判の既存実装確認

- `CardDefinition`（card-def.ts）にrarityフィールドは存在しなかった。lootWeight/floorDropEnabled/enemyDropEnabledはPhase 20.0aのneutral placeholderのまま（floorDropEnabled/enemyDropEnabledは全17種false）
- カード鑑定状態（`GameState.identifiedCardIds`）、`isCardIdentified`/`markCardIdentified`（turn.ts）、未鑑定表示（`unidentifiedDisplayName`、message-log.tsのitem_picked_upケース）、封印（`isCardUseSealed`）、審判の自動鑑定（judgement成立時の`markCardIdentified`呼び出し）はすべてPhase 20で完成しており、生成経路に一切依存しない設計であることを確認した。取得・生成だけでは`markCardIdentified`が呼ばれないことをコード上で確認した（呼び出し箇所は2か所のみ：使用成立時とjudgement自動発動時）

### 現状、カード17種がproduction供給から除外されていることの確認

`item-def.ts`の`getWeightedGroundItemPoolForFloor`は、Phase 20.0e由来の既存カード混入機構（`getCardGroundPoolForFloor`が9種のみを階層別に段階登録し、`CardDefinition.floorDropEnabled && lootWeight > 0`でフィルタ）を持つが、floorDropEnabledが全17種falseのため、このカード候補は常に空配列になり、実質的に無効（デッドコード）であることを確認した。この既存機構は「1階から全17種を候補にする」「カード固有の解禁階層を作らない」という本Phaseの要件と根本的に相容れない設計（9種限定・階層別段階登録）だったため、**変更・流用せず、そのまま無効な状態で放置**し、別の新規経路を実装する方針とした（floorDropEnabled/enemyDropEnabledの値そのものも本Phaseでは変更していない）。

### 通常床、monsterHouse報酬、敵ドロップの現在の生成境界とRNG責務

- `state.ts`のbuildFloorStateにおいて、通常床アイテムは`itemCountRng`→`itemSelectionRng`（`getWeightedGroundItemPoolForFloor`+`drawWeightedGroundItemSelection`で一括N件抽選）→`itemPlacementRng`（配置）の順で処理される
- monsterHouse報酬は同じ`getWeightedGroundItemPoolForFloor`+`drawWeightedGroundItemSelection`パターンを、報酬専用の`rewardSelectionRng`で再利用する
- Phase 24.4bの敵ドロップは`enemy-drop.ts`の`selectEnemyDropItemId`が`getGroundItemPoolForFloor`（非weighted、カードを含まない生プール）から一様抽選する

## 17種のprovisional rarity分類

`card-def.ts`に`CardRarity`型（`'C'|'B'|'A'|'S'`）と`CardDefinition.rarity`フィールドを新規追加し、指示された分類表どおりに全17種へ設定した：

```
C (6): emperor, lovers, justice, hanged_man, devil, tower
B (5): high_priestess, empress, chariot, strength, temperance
A (5): wheel_of_fortune, death, star, moon, sun
S (1): judgement
```

foolは追加していない（CardIdとして未定義のまま）。

## route別card weightとcard rarity weight

新規モジュール`card-loot.ts`に中央集約：

```
CARD_ROUTE_WEIGHT_PROVISIONAL = { card: 10, nonCard: 90 }  // 3ルート共通・合計100
CARD_RARITY_WEIGHT_PROVISIONAL = { C: 60, B: 30, A: 8, S: 2 }  // 全階層・全route共通
```

選択フロー：
1. `rollIsCardSlot(rng)` — card/nonCard二者択一（1回のrng呼び出し）。falseならレアリティ・本体ロールを一切消費しない
2. `selectCardRarity(rng)` — 候補が存在するレアリティのみを対象に重み付き抽選（1回）。空レアリティを引いて再抽選する方式は採用していない（現状全レアリティに候補が存在するため、このフィルタは今のところno-opだが、将来の分類変更に対する防御として機能する）
3. `selectCardWithinRarity(rarity, rng)` — 選ばれたレアリティ内で均等抽選（1回）

## productionへ接続した3route

### 1. 通常床生成（state.ts）

既存の`drawWeightedGroundItemSelection`によるN件の非カード抽選（`itemCountRng`/`itemSelectionRng`は完全無変更）の直後、新規3ストリーム（`cardCategoryRng`/`cardRarityRng`/`cardBodyRng`、独自XOR定数）による`substituteCardSlots`で、各スロットを事後的に10%の確率でカードへ置換する。floor 1のchocolate保証ロジック（既存・本Phase対象外）は、このカード置換の**後**に実行されるため、既存の食料保証契約を変更していない。

### 2. monsterHouse報酬（state.ts）

通常床生成と全く同じ`substituteCardSlots`呼び出しを、報酬専用の非カード抽選（`rewardSelectionRng`、既存無変更）の直後に適用する。**通常床生成と同じ3ストリーム（cardCategoryRng/cardRarityRng/cardBodyRng）を継続消費**しており、Phase 24.4aのequipmentDefinitionRng/equipmentCurseRngが両ループで継続消費される既存パターンと同じ設計とした。

### 3. 敵ドロップ（enemy-drop.ts）

新規関数`selectEnemyDropItemIdWithCards(floor, floorSeed, enemyId)`を追加し、`turn.ts`の`spawnEnemyDropIfAny`から`selectEnemyDropItemId`の代わりに呼ぶよう変更した。ドロップ成立（既存の10%判定、無変更）後の候補選択段階でのみ、専用3ストリーム（`SALT_CARD_CATEGORY`/`SALT_CARD_RARITY`/`SALT_CARD_BODY`、敵ID・用途別salt方式は既存パターンを継承）でカード判定を行い、非カードの場合のみ既存の`selectEnemyDropItemId`（無変更）へフォールバックする。

## 鑑定基盤を再実装せず再利用したこと

Phase 20の`identifiedCardIds`/`isCardIdentified`/`markCardIdentified`/未鑑定表示ロジックは一切変更していない。生成・配置・取得のいずれの段階でも`markCardIdentified`を呼んでいないため、「取得だけでは鑑定しない」契約は自動的に満たされる。

副次的な修正として、Phase 24.4bで追加した`enemy_drop_spawned`イベント・ログ表示（`turn.ts`/`message-log.ts`）が未鑑定名を尊重していなかった箇所を発見し、`item_picked_up`の既存パターン（`unidentifiedCard`フラグをイベントへ焼き込み、message-log.tsが分岐表示）に倣って修正した。これはPhase 24.4bの時点ではカード自体が到達不能だったため露見していなかった潜在バグであり、本Phaseでカードが実際に敵ドロップへ到達可能になったことで顕在化・修正が必要になったものである。

## RNG identityと非干渉方針

- 通常床・monsterHouse報酬：新規3ストリーム（`floorSeed ^ 0x2f7b91d4`/`0x6c1e83fa`/`0x94b2d1c7`）を追加。既存の`itemCountRng`/`itemSelectionRng`/`itemPlacementRng`/`equipmentCurseRng`/`equipmentDefinitionRng`の消費順序・消費回数は完全に無変更（カード置換は既存抽選結果の配列に対する事後変換のため）
- 敵ドロップ：新規3ストリーム（`SALT_CARD_CATEGORY`/`SALT_CARD_RARITY`/`SALT_CARD_BODY`）を追加。ドロップ不成立時はこれらのストリームを一切生成・消費しない
- combatRngState、マップ生成、敵配置、敵行動、monsterHouse発生判定用RNGは本Phaseのコード変更が一切触れていないモジュール（combat.ts、mapgen.ts、monster-house.tsの発生判定部分）にあり、影響なし

## カードへ装備状態が付かないことの確認

カードは常に非equipment分岐（`isWeaponOrArmorId`がfalse）を通るため、`EquipmentInstance`のmint・呪い抽選・refineLevel等の状態抽選は一切実行されない。新規テストで、production生成された全カードGroundItemの`equipmentInstanceId`が`undefined`であることを直接検証した。

## focused tests件数と結果

`phase-24-4c-card-supply.test.ts`: 29件全通過。rarity分類、route/rarity weight、純関数（rollIsCardSlot/selectCardRarity/selectCardWithinRarity/resolveCardSlot/substituteCardSlots）の直接テスト、3route統合テスト（到達可能性・非equipment構造・アイテム総数分布不変・S/R/black_armor除外維持）、鑑定基盤の再利用確認を含む。

既存テストの修正5件（理由明記の上、期待値を意図した差分に合わせて更新）：
- `phase-20-1-persistent-growth.test.ts`
- `phase-20-2-healing-conversion.test.ts`
- `phase-20-4-room-card-effects.test.ts`
- `phase-20-5a-targeted-card-effects.test.ts`
- `phase-21-5-monster-house-reward-placement.test.ts`

いずれも「カードが production 生成に一切出現しない」という Phase 24.4c 以前の前提を検証していたテストであり、本Phaseの目的そのものによって意図的に無効化される前提だった。各テストの意図（カードが装備個体状態を持たない、fool が出現しない等）は維持しつつ、アサーションを「出現しうるが、出現した場合は正しい構造を持つ」という新しい契約へ更新した。

## full suite/typecheck/build/diff-check

- focused tests: 29件全通過
- full suite: `npx vitest run` — 120ファイル / 3025テスト全通過
- typecheck: `npx tsc --noEmit` — エラーなし
- build: `npx vite build` — 成功（dist は検証後削除）
- diff-check: `git diff --check` — 問題なし

## production sanity（一時スクリプト、検証後削除）

- 固定seedで通常床生成が完全再現すること、敵ドロップのカード選択が決定的であることを確認
- card-loot.tsが階層引数を取らない設計のため、10F/100F相当のratio非依存性は「floor引数が存在しない」という設計そのものによって保証されることを確認
- 3000seed探索+5000 enemyId探索で、17種全カードが到達可能であることを確認（実測: 全17種到達）
- production生成されたカードが取得時点で未鑑定表示のままであることを確認
- 1000 enemyIdにわたる`selectEnemyDropItemIdWithCards`呼び出しで例外0件を確認

## provisional値がPhase 24.6またはPhase 27の調整対象であること

`card-loot.ts`の`CARD_ROUTE_WEIGHT_PROVISIONAL`と`CARD_RARITY_WEIGHT_PROVISIONAL`、および`card-def.ts`の各カードの`rarity`割当はすべてprovisional値であり、Phase 24.6またはPhase 27での再調整対象であることをコードコメントに明記した。

## Phase 24.4dへ残す一般アイテム未鑑定化

本Phaseはカード以外の一般アイテムの未鑑定化を一切行っていない。既存の一般アイテム共通鑑定データ構造の実装もPhase 24.4dへ残す。

## Phase 24.4eへ残す呪い付与経路・DP・ランク接続

カードへの呪い、強化値（DP）、装備ランクの付与は本Phaseの対象外のまま維持した。カード生成時に一切の状態抽選（呪い判定を含む）を行わないことをテストで確認済み。

## development-plan.md更新可否

リポジトリ内（`/home/claude/repo`）を検索したが、`rogue-of-sun-development-plan.md`という同名ファイルは存在しなかった（`docs/rogue-of-sun-game-concept.md`のみ存在）。方針に従い新規作成は行わず、最終報告に更新不能と記載する。

## 変更ファイル一覧

- 新規: `src/game/card-loot.ts`
- 新規: `src/game/__tests__/phase-24-4c-card-supply.test.ts`
- 新規: `docs/history/phase-24-4c-card-supply.md`（本ファイル）
- 変更: `src/game/card-def.ts`（CardRarity型・rarityフィールド追加）
- 変更: `src/game/state.ts`（通常床・monsterHouse報酬へのカード置換接続）
- 変更: `src/game/enemy-drop.ts`（selectEnemyDropItemIdWithCards追加）
- 変更: `src/game/turn.ts`（enemy-drop呼び出し切り替え、unidentifiedCardフラグ算出追加）
- 変更: `src/game/events.ts`（enemy_drop_spawnedへunidentifiedCardフィールド追加）
- 変更: `src/game/message-log.ts`（enemy_drop_spawnedの未鑑定表示対応）
- 変更（既存テスト期待値更新、理由明記済み）: `phase-20-1-persistent-growth.test.ts`、`phase-20-2-healing-conversion.test.ts`、`phase-20-4-room-card-effects.test.ts`、`phase-20-5a-targeted-card-effects.test.ts`、`phase-21-5-monster-house-reward-placement.test.ts`

## 指示逸脱の有無

- 既存テスト5件の期待値を書き換えた。いずれも「カードがproduction生成に一切出現しない」という、本Phaseの目的そのものによって意図的に無効化される前提を検証していたテストであり、理由を明記の上で意図した差分に合わせて更新した（指示の「失敗した既存テストの期待値を理由なく書き換えない」を遵守：理由は明記済み）
- Phase 24.4bで発見した`enemy_drop_spawned`ログ表示の未鑑定名漏れバグを本Phaseの範囲内で修正した。これはカード供給の接続によって初めて到達可能になったコードパスであり、本Phaseの目的（未鑑定中に真名を漏らさない）に直接該当するための修正であって、対象外の再設計ではない
- それ以外の逸脱なし
