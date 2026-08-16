# Phase 24.6b2a: Item availability foundation and progress-based staging

全78 ItemIdのavailability metadata基盤（`item-availability.ts`）を新設し、`item-def.ts`の固定floor2/3 stagingをprogress割合ベースへ置換した。通常floor生成・monsterHouse報酬・enemy dropの3生成routeとStar変換候補を共通eligibility helperへ接続した。default 3Fでは既存結果・RNG・生成snapshotを完全維持している。

## 1. precheck

- base branch: `phase-24-6b1a-run-config-single-source`
- base HEAD: `04391a9b8335c297b1238deee538671959582df4`（一致確認済み）
- work branch: `phase-24-6b2a-item-availability`（local/remoteとも重複なし、新規作成）
- baseline: `npx tsc --noEmit`（0 error）→ `npx vitest run`（128 files / 3242 tests、全pass）→ `npx vite build`（成功）
- 確認事項: `GameState.totalFloors`が最大階層の唯一の正本、`GameState.runDepthTier`が独立field、`GameState.runConfig`が存在しない（いずれも確認済み）、`ITEM_DEFINITIONS`が78件（確認済み）
- pre-edit snapshot: seed `[1, 2, 4, 42, 999, 4294967295]`のfloor1〜3を一時script（`/tmp/audit-24-6b2a/`、作業完了後削除）でJSON化し保存

## 2. availability型・registry構造

新規モジュール`src/game/item-availability.ts`:

```ts
export interface ItemAvailability {
  minimumRunDepth: RunDepthTier;
  unlockProgress: number; // [0, 1]
  economyClass: 'power' | 'sustain' | 'structural' | 'not_applicable';
}

export const ITEM_AVAILABILITY: Readonly<Record<ItemId, ItemAvailability>> = { /* 78 entries */ };

export function getItemAvailability(itemId: ItemId): ItemAvailability;
export function isRunDepthEligible(runDepthTier: RunDepthTier, minimumRunDepth: RunDepthTier): boolean;
export function isItemEligibleAtProgress(itemId: ItemId, runDepthTier: RunDepthTier, progress: number): boolean;
export function filterEligibleItemIds(ids: ReadonlyArray<ItemId>, runDepthTier: RunDepthTier, progress: number): ItemId[];
```

`ITEM_AVAILABILITY`は`Record<ItemId, ItemAvailability>`型で宣言しているため、78件の網羅性（欠落・重複・余剰なし）は**TypeScriptの型検査自体が保証**する — 欠落キーは`Property '...' is missing`、重複キーは`An object literal cannot have multiple properties with the same name`、`ItemId`union外の余剰キーは`Object literal may only specify known properties`として、いずれも`npx tsc --noEmit`実行時にコンパイルエラーになる。加えてモジュールロード時に`unlockProgress`のfinite/[0,1]検証と`minimumRunDepth`の既知tier検証をランタイムでも実施している（将来の非リテラル/動的エントリに対する防御的バックストップ）。

`item-def.ts`は`item-availability.ts`から`filterEligibleItemIds`を、`item-availability.ts`は`item-def.ts`の何も参照しない（78件の網羅性チェックは型レベルのみで完結させ、循環importを避けた）。

## 3. 78件網羅結果

`registry`要件（78 ItemIdを各1回網羅、missing/extra/duplicateなし、全unlockProgressがfinite かつ[0,1]、全minimumRunDepthがshort、economyClass分類が全件存在）を一時scriptで検証し、全PASS。

`ITEM_DEFINITIONS`のキー数（78）と`ITEM_AVAILABILITY`のキー数（78）が完全一致し、双方向の包含関係（`ITEM_DEFINITIONS`の全キーが`ITEM_AVAILABILITY`に存在し、その逆も成立）を確認した。

## 4. minimumRunDepth/unlockProgress実値

全78件`minimumRunDepth: 'short'`（24.6b0の方式Aを踏襲、本Phaseでは既存itemをshortから除外しない）。

`unlockProgress`は5件のみ0以外:

| ItemId | unlockProgress | 旧staging |
|---|---|---|
| spear | 2/3 | floor2〜（GROUND_ITEM_POOL_FLOOR_2_ADDITIONS） |
| hammer | 2/3 | floor2〜（同上） |
| frost_enchantment | 2/3 | floor2〜（同上） |
| cloud_enchantment | 2/3 | floor2〜（同上） |
| earth_enchantment | 1 | floor3〜（GROUND_ITEM_POOL_FLOOR_3_ADDITIONS） |

残り73件は`unlockProgress: 0`（floor1から候補、旧GROUND_ITEM_POOL_FLOOR_1相当の12件、および元々floor stagingの対象外だった個別武器種・防具種・カード・アクセサリー61件）。

`spear`/`hammer`はground-item-pool**スロット**id（`equipment-loot.ts`の`NormalEquipmentSlot`）であり、スロット抽選後にrank重み抽選で解決される個別種（`short_sword`/`glaive`/`basic_hammer`/`flamberge`等23種）自体には追加のprogress gateを付けていない（`initial_policy`の「spear/hammerの上位definitionは既存rank抽選を維持し、追加progress gateを付けない」を踏襲）。card/accessoryは全件`unlockProgress: 0`を維持し、rarity/rank weightは変更していない。

## 5. 旧floor staging置換結果

`item-def.ts`の`GROUND_ITEM_POOL_FLOOR_1`/`GROUND_ITEM_POOL_FLOOR_2_ADDITIONS`/`GROUND_ITEM_POOL_FLOOR_3_ADDITIONS`と`getGroundItemPoolForFloor`のfloor===2/>=3分岐を削除し、以下へ置換した:

```ts
const GROUND_ITEM_POOL_ALL: ReadonlyArray<ItemId> = [
  'apple', 'sword', 'armor', 'sun_fruit', 'solar_gun', 'sol_enchantment',
  'chocolate', 'banana', 'flame_enchantment', 'antidote', 'panacea', 'clairvoyance_fruit',
  'spear', 'hammer', 'frost_enchantment', 'cloud_enchantment', // 旧floor2_additions
  'earth_enchantment', // 旧floor3_additions
];

export function getGroundItemPoolForFloor(floor: number, totalFloors: number = 3, runDepthTier: RunDepthTier = 'short'): ItemId[] {
  const progress = floorProgressRatio(floor, totalFloors);
  return filterEligibleItemIds(GROUND_ITEM_POOL_ALL, runDepthTier, progress);
}
```

旧配列の相対順序（floor1の12件→floor2追加4件→floor3追加1件の順）をそのまま1つの配列へ連結しているため、`totalFloors=3`のとき`floorProgressRatio(2,3)=2/3`・`floorProgressRatio(3,3)=1`が旧`floor===2`/`floor>=3`の閾値と完全に一致し、floor1/2/3の候補配列・順序は旧実装とbyte-for-byte一致する（6節で検証）。

`getWeightedGroundItemPoolForFloor`にも`totalFloors`/`runDepthTier`引数（デフォルト3/'short'）を追加し、内部で`getGroundItemPoolForFloor`へ伝播するのみで、card候補側（`getCardGroundPoolForFloor`、Phase 20.0eの未使用legacy）は本Phaseで一切変更していない（`legacy_cleanup.card_legacy`の指示通り）。

## 6. 3route/Star/forge接続結果

| route | 接続方法 |
|---|---|
| 通常floor生成 | `state.ts`の`getWeightedGroundItemPoolForFloor`呼び出し2箇所（通常生成・後述MH）に`runConfig.totalFloors`/`runConfig.runDepthTier`を追加 |
| monsterHouse報酬 | 通常floor生成と同じ`getWeightedGroundItemPoolForFloor`（同一関数、同一helper）を使用 — 呼び出しごとに異なるavailabilityを持たない |
| enemy drop | `enemy-drop.ts`の`selectEnemyDropItemId`/`selectEnemyDropItemIdWithCards`に`totalFloors`/`runDepthTier`引数（デフォルト3/'short'）を追加し、内部で同じ`getGroundItemPoolForFloor`を使用。`turn.ts`の呼び出し元は`state.totalFloors`/`state.runDepthTier`を渡す |
| card | `accessory-loot.ts`の`resolveLootSlot`/`substituteLootSlots`に`runDepthTier`/`progress`optional引数（デフォルト'deep'/1 = 無フィルタ）を追加し、解決したcard idが`isItemEligibleAtProgress`で不適格な場合は`non_card`へフォールバック。全17カードが`short`/`0`のため現行production呼び出し（`state.ts`2箇所、`enemy-drop.ts`1箇所、いずれも実際の`runConfig.runDepthTier`/`floorProgressRatio(floor, totalFloors)`を渡す）では**このフォールバックは発生しない** |
| accessory | 同上（card/accessoryは`resolveLootSlot`内の同一3-way rollを共有） |
| equipment_definition | `equipment-loot.ts`の`selectNormalEquipmentDefinition`（rank重み抽選）自体は変更していない — 5節の通り、スロット解決後の個別種選択には`initial_policy`により追加progress gateを付けない方針のため、signature整理は不要と判断した |
| Star変換 | `card-target-selection.ts`の`getTransformCandidatesForItem`/`hasAlternateTransformCategory`に`runDepthTier`/`progress`optional引数（デフォルト'deep'/1 = 無フィルタ、既存呼び出しの挙動を完全維持）を追加し、候補フィルタへ`isItemEligibleAtProgress`を追加。`getStarCandidates(state)`（`card-target-selection.ts`）と`resolveStarEffect`（`turn.ts`）の呼び出し箇所を、実際の`state.runDepthTier`/`floorProgressRatio(state.floor, state.totalFloors)`を渡すよう更新 |
| solar forge | 変更なし（`solar-forge.ts`/`solar-forge-recipes.ts`は`item-availability`を一切参照しない — 除外route） |
| 固定報酬・event | 現行production未実装のため対象なし |

**invariant確認**: 同じitemが route ごとに異なるavailabilityを持たない（全routeが`item-availability.ts`の同一`isItemEligibleAtProgress`/`filterEligibleItemIds`を参照）。空候補時の例外・孤立instance・余分なRNG消費は発生しない（`filterEligibleItemIds`はRNG非消費の純粋関数であり、候補0件になりうる状況は本Phaseのmetadataでは発生しない — 全item`unlockProgress<=1`で`progress`は`totalFloors>=1`なら必ず`[0,1]`に収まるため、`progress=1`時点で全item eligible）。

## 7. 3F snapshot互換

pre-edit snapshot（1節）と実装完了後の同一script実行結果を`diff`し、**完全一致（差分0）**を確認した。検証対象は24.6b1/24.6b1a時と同一（seed 6件 × floor1〜3の map/enemies/groundItems/equipmentInstances/combatRngState等）。

加えて、`getGroundItemPoolForFloor(floor, 3, 'short')`が返す配列を旧`GROUND_ITEM_POOL_FLOOR_1/2/3`の連結結果と直接比較し、floor1/2/3それぞれで完全一致（要素・順序とも）することを確認した。

## 8. 10/30/99F解禁floor

一時scriptで以下を確認（全PASS）:

- 10F: `spear`/`hammer`/`frost_enchantment`/`cloud_enchantment`はfloor7で解禁（floor6以前は未解禁）、`earth_enchantment`はfloor10で解禁（floor9以前は未解禁）
- 30F: 同4種はfloor20で解禁（floor19以前は未解禁）、`earth_enchantment`はfloor30で解禁（floor29以前は未解禁）
- 99F: 同4種はfloor66で解禁（floor65以前は未解禁）、`earth_enchantment`はfloor99で解禁（floor98以前は未解禁）
- 同一progress（2/3、1）であれば`totalFloors`が異なっても候補集合が完全一致することを確認（3F floor2/floor3、10F floor7/floor10、30F floor20/floor30、99F floor66/floor99の4通りで相互比較）
- `runDepthTier`のみを変えても（`short`/`standard`/`deep`、同一totalFloors・同一seed）生成結果（groundItems・combatRngState・equipmentInstances）が完全一致することを確認 — 全78 itemが`minimumRunDepth: 'short'`のため、24.6b2aの時点ではrunDepthTierを変えても候補集合は不変

## 9. RNG非干渉

- `filterEligibleItemIds`・`isItemEligibleAtProgress`・`isRunDepthEligible`はいずれも比較演算のみで**RNG非消費**
- 3Fでは`getGroundItemPoolForFloor`のfilter前後で候補配列が完全一致（7節）
- 既存stream/salt（`itemCountRng`・`itemSelectionRng`・`itemPlacementRng`・`equipmentCurseRng`・`equipmentDefinitionRng`・cardCategoryRng等5ストリーム・enemy-drop.tsの5 salt・Star transformの`STAR_TRANSFORM_SELECTION_SALT`/`STAR_TRANSFORM_CURSE_SALT`）は一切変更していない
- 既存`rng()`の呼出回数・順序は変更していない（`resolveLootSlot`のeligibilityチェックは、既にRNGで確定した`cardId`/`accessoryId`を事後的にフィルタするだけで、追加のRNG消費は発生しない）
- `combatRngState`への非干渉を7節のsnapshot diff（差分0）で確認
- 候補0件時に代替routeをrandom選択する処理は追加していない（8節参照）

## 10. economyClass分類集計

`economyClass`はPhase 24.6b2bのbudget設計用metadataのみで、本Phaseでは一切のランタイム効果を持たない（読み取り箇所は登録のみ、出現抑制・budget counter・floorごとのquotaはいずれも未実装）。

| economyClass | 件数 | 内訳 |
|---|---|---|
| power | 71 | 武器28 + 防具15 + アクセサリー6 + カード17 + enchantment5（sol/flame/frost/cloud/earth） |
| sustain | 6 | apple・sun_fruit・chocolate・banana・antidote・panacea |
| structural | 1 | clairvoyance_fruit |
| not_applicable | 0 | audit matrixでNOT_APPLICABLEに該当するroute専用品は現時点で存在しない |

（71 + 6 + 1 + 0 = 78、`ITEM_DEFINITIONS`件数と一致）

## 11. 24.6b2bへ延期したbudget項目

`scope.exclude`の通り、以下は本Phaseで一切実装していない:

- powerBudget/sustainBudgetのcounter・制限
- 供給数・drop率・route weight・rank weight変更
- card/accessoryのprogress連動化（`unlockProgress`は全件0のまま、`rollLootCategory`/`CARD_RARITY_WEIGHT_PROVISIONAL`/`ACCESSORY_RANK_WEIGHT_PROVISIONAL`は変更なし）
- standard/deep専用itemの本採用（`minimumRunDepth`は全件`short`のまま）
- S/R armor到達route・black_armor生成route新設
- map生成方式変更・enemy/event availability・difficulty multiplier・telemetry schema変更

## 12. 既存test変更

**0件**。全ての新規/変更した関数signature（`getGroundItemPoolForFloor`・`getWeightedGroundItemPoolForFloor`・`selectEnemyDropItemId`・`selectEnemyDropItemIdWithCards`・`resolveLootSlot`・`substituteLootSlots`・`getTransformCandidatesForItem`・`hasAlternateTransformCategory`）に追加した新規引数（`totalFloors`・`runDepthTier`・`progress`）はいずれもデフォルト値付きoptional引数とし、省略時は「フィルタなし」（`totalFloors=3, runDepthTier='short'`または`runDepthTier='deep', progress=1`）という、既存呼び出しの挙動を完全に再現する値にした。これにより既存test（direct呼び出し・GameStateリテラル問わず）は一切変更せずに`npx tsc --noEmit`・`npx vitest run`とも無修正でPASSした（12節時点で`git status --porcelain`に`__tests__`配下の変更が0件であることを確認済み）。

## 13. development_plan

リポジトリ内（`sanadamancom/rogue-of-sun`）を検索したが、`development-plan`という名前のファイルは存在しなかった。task指示の「repository内に存在する場合のみ更新」に従い、新規作成は行わず**更新不能**として報告する。

## 14. 全検証結果

| gate | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| focused tests（registry/tier/progress/compatibility/routes/long_run、上記3〜9節） | 全PASS |
| `npx vitest run` | 128 files / 3242 tests、全pass（baseline維持） |
| `npx vite build` | 成功 |
| `git diff --cached --check` | OK |
| production sanity（3F/10F/30F/99F、上記7〜8節） | 差分0・全PASS |
| 一時スクリプト削除 | 完了（`/tmp/audit-24-6b2a/`） |

## 15. 指示逸脱・停止事項

なし。stop_conditionsのいずれにも該当しなかった（3F候補配列・生成snapshotは完全一致で変化なし、既存RNG消費順・回数は不変、routeごとに異なるavailabilityは不要だった、Star接続は既存identity/curse契約を一切変更せず候補フィルタを追加しただけ、空候補処理に新しいrandom fallbackは不要だった、save/loadまたはtelemetry schema変更は不要だった、power/sustain budget実装は不要のまま完結した、baseline/dirty tree/branch衝突のいずれも発生しなかった）。`scope.exclude`に列挙された項目には一切着手していない。
