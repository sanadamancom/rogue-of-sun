# Phase 24.4b: 敵通常ドロップの決定的実装

## Precheck

- base branch: `phase-24-4a-equipment-loot-supply`（origin HEAD `615bc4f1d05d0b28712065e44bd6e411c11f18f3`）と一致確認
- origin/main、既存Phase branch未変更
- working tree clean、同名local/remote work branch衝突なし
- Phase 24.4a baseline: 専用31テスト全通過、full suite 118ファイル/2970テスト全通過

## Stage 0 監査結果

### 最終撃破の単一責務境界

`turn.ts`の`defeatEnemyIfNeeded`が、経験値付与・撃破イベント発火を含む唯一の終端撃破処理境界であることを確認した。呼び出し箇所は5か所（近接/reach攻撃`applyPlayerAttackToEnemy`、正義/devil/tower room-wideカード、spike_mail反射`resolveEnemyAttackHit`）だが、いずれも同一関数へ委譲しており、撃破処理そのものを複製している箇所は存在しない。太陽銃も`applyPlayerAttackToEnemy`を経由するため別経路は不要。

### スケルトン等の特殊撃破契約

`defeatEnemyIfNeeded`内のスケルトンbody/head状態機械は、`target.alive=false`を設定して経験値・`enemy_defeated`イベントを発火する「本当の終端撃破」パス（関数末尾、`return true`）と、head化（`return false`、経験値もドロップも発生しない）を明確に分岐している。ドロップ処理をこの`return true`の直前に1箇所だけ追加することで、body→head遷移では自動的にドロップ判定自体が走らず、複製実装なしにスケルトン契約を満たせることを確認した。

### 敵IDの安定性

`EnemyActor.id`は`state.ts`の`buildEnemies`で生成時に一度だけ設定される、その敵の生成時点でのフロア内配列indexであり（`types.ts`のdoc comment「Stable per-floor identifier」）、生存中に再割当てされない。全5つの`defeatEnemyIfNeeded`呼び出し箇所は例外なく`target.id ?? 0`を`targetId`として使っており、本Phaseの決定的seed導出にそのまま利用できると判断した。

### 通常戦利品候補のうち敵ドロップ対象にする分類

`item-def.ts`の`getGroundItemPoolForFloor(floor)`（Phase 15.4b以来無変更）は、カード・black_armorを一切含まない非カード通常アイテム集合そのものであることを確認した（`getWeightedGroundItemPoolForFloor`がこれにカード候補を別途追加する構造であり、素の`getGroundItemPoolForFloor`は常にカードを含まない）。これをそのまま敵ドロップ候補として再利用し、新しい候補表を作らなかった。

### 配置可否ヘルパーの再利用可否

既存の`mapgen.ts`の`chooseGroundItemPosition`はRNG消費・例外throwを前提とした設計であり、本Phaseが要求する「RNG非消費・例外なし・固定順探索」の契約とは適合しなかった（stop_and_reportの「既存GroundItem構造では安全な配置・identity維持が不可能」には該当しない — 単に既存関数の再利用ではなく、`isWalkable`（`map.ts`、既存・無変更）という一段低いプリミティブを再利用する形で新規に決定的探索関数を実装した）。

以上より、監査の結果、致命的矛盾は見つからず実装を続行した。

## provisional drop率

`enemy-drop.ts`の`ENEMY_DROP_CHANCE_PROVISIONAL = 0.1`（10%）。単一箇所に中央集約し、Phase 24.6での再調整対象であることをコードコメントに明記した。敵種別・階層・攻撃方法による補正は本Phaseでは一切追加していない。

## drop候補と除外対象

- 通常アイテム候補: `getGroundItemPoolForFloor(floor)`をそのまま再利用（新規ItemId追加なし、カード・black_armorを含まない）
- 装備カテゴリが選ばれた場合（`sword`/`spear`/`hammer`/`armor`/`solar_gun`のいずれかが引かれた場合）は、Phase 24.4aの`equipment-loot.ts`の`floorProgressRatio`/`selectNormalEquipmentDefinition`をそのまま呼び出し、C/B/Aのみを対象とする同一の階層比率規則に従う
- S/R/black_armorは`equipment-loot.ts`側の構造的除外（Phase 24.4aで確立済み）により、敵ドロップからも一切出現しない
- 敵専用ドロップテーブル・敵種別固有アイテムは追加していない

## 決定的seed導出方式とsalt

`enemy-drop.ts`の`deriveEnemyDropSeed(floorSeed, enemyId, salt)`が、`state.seed`（このフロアのマップ生成seed、run seed+floorから導出済み）と`EnemyActor.id`と用途別saltを合成し、単一のuint32 seedを生成する。用途別に4つの独立saltを用意した：

```
SALT_DROP_OCCURS         = 0x5e2f8b41  （ドロップ発生判定）
SALT_ITEM_SELECTION      = 0x8b1c4f6d  （通常アイテムカテゴリ抽選）
SALT_EQUIPMENT_DEFINITION= 0xa47d2c19  （装備definition選択、Phase24.4a関数経由）
SALT_EQUIPMENT_CURSE     = 0xd1e9736c  （装備の呪い判定）
```

各purposeごとに`createRng(deriveEnemyDropSeed(...))`で新規RNGストリームを生成し、1回だけ消費して即座に破棄する（GameStateへ一切保存しない）。既存の`state.combatRngState`・マップ生成RNG・アイテム生成RNG・monsterHouse用RNGのいずれとも独立しており、敵ドロップ処理が走っても既存ストリームの消費順序・消費回数は一切変化しない。撃破順序が変わっても各敵個体の結果は(seed, enemyId, salt)のみで決まるため不変。

## 配置規則

`enemy-drop.ts`の`findNearestValidDropCell(map, origin, exclusions)`：

- 撃破座標（`origin`）が有効（`isWalkable`かつ`exclusions`に含まれない）ならそこへ即決定
- 無効な場合、`origin`から`ALL_DIRECTIONS`の固定順（既存`types.ts`の定義順）でBFS探索し、最初に見つかった有効セルを返す。壁は探索フロンティアとして展開されない（実質的な到達可能性を保った探索）
- RNGを一切消費しない
- 呼び出し元（`turn.ts`の`spawnEnemyDropIfAny`）が、マップ出口・生存中の移動阻害Actor（プレイヤー含む）・既存GroundItem位置を`exclusions`として渡す
- 有効セルが存在しない場合は`null`を返し、呼び出し元はドロップを静かに破棄する（例外なし、進行を止めない）

## EquipmentInstance identity契約

- 装備カテゴリが選ばれ、かつ配置可能セルが見つかった場合のみ、`equipment-instance.ts`に新規追加した`createEquipmentInstanceWithCurse(state, definitionId, cursed)`で1個だけmintする（既存の`createEquipmentInstance`と同じ`state.nextEquipmentInstanceId`カウンタ・配列push契約を流用し、cursed引数のみ追加）
- 配置不能でドロップ破棄となった場合、`createEquipmentInstanceWithCurse`自体を呼ばないため、孤立したEquipmentInstanceが`state.equipmentInstances`へ残ることはない
- `GroundItem.equipmentInstanceId`とmintされたinstanceの`definitionId`/`rank`は常に一致する
- cursed個体でも`curseRevealed`は常にfalse（`mintEquipmentInstance`の既存契約を継承）

## RNG非干渉の実測結果

新規テストで、`state.combatRngState`が攻撃ロール1回分（`rollPercent`の期待される`nextState`）としか変化しないことを直接比較検証した。マップ生成・アイテム生成・monsterHouse RNGはPhase 24.4bのコードパスから一切呼ばれない（`enemy-drop.ts`は`createRng`を独自seedで都度呼ぶのみで、他モジュールのRNG関数を一切呼ばない）。

## 新規・更新テスト数

- `phase-24-4b-enemy-drops.test.ts`: 26件（新規）。enemy-drop.tsの純関数（発生率・候補列挙・呪い率・配置探索）の直接テストと、`processTurn`経由の統合テスト（近接撃破、二重撃破防止、スケルトンbody/head/head撃破、room-wideカード撃破、配置衝突回避、決定性、RNG非干渉）の両方を含む
- 既存テストの修正: なし（Phase 24.4aと異なり、既存テストの前提を壊す変更は発生しなかった）

## full suite/typecheck/build/diff-check

- 新規専用テスト: 26件全通過
- full suite: `npx vitest run` — 119ファイル / 2996テスト全通過
- typecheck: `npx tsc --noEmit` — エラーなし
- build: `npx vite build` — 成功（dist は検証後削除）
- diff-check: `git diff --check` — 問題なし

## production sanity（一時スクリプト、検証後削除）

- 固定seed(123, enemyId=55)でdrop/no-dropが2回の呼び出しで完全再現することを確認
- enemyId 0〜999の1000件監査で、例外0件・違法候補（black_armor/S/R）0件を確認
- `createInitialState`/`advanceToNextFloor`による本番floor生成が引き続き正常動作することを確認
- seed=3, floor=2で実際にmonsterHouse敵8体が生成されることを確認し、その8体全員分の撃破座標から`findNearestValidDropCell`を順次呼び出した結果、8件のドロップ位置が一切重複しないことを確認

## 24.4c/24.4d/24.6への引き継ぎ

- 24.4c（未鑑定・鑑定）: 本Phaseは鑑定状態に一切触れていない。敵ドロップの通常アイテム・装備とも、鑑定関連フィールドは追加していない
- 24.4d（呪い・解呪・カード床供給・統合監査）: 敵ドロップへのカード追加は本Phaseでは行っていない（`getGroundItemPoolForFloor`はカードを含まないため、24.4dで敵ドロップへカードを追加する場合は`enemy-drop.ts`の`selectEnemyDropItemId`の候補源変更が必要になる点に留意）
- Phase 24.6: `ENEMY_DROP_CHANCE_PROVISIONAL`（`enemy-drop.ts`）の1行のみを対象に再調整可能。Phase 24.4aの`RANK_WEIGHT_PROVISIONAL`とあわせて、Phase 24.6の調整対象定数はこの2箇所に完全集約されている

## 指示逸脱の有無

- なし。既存テストの修正も発生しなかった
