# Phase 24.6b2a1: Availability candidate filtering correction

24.6b2aが持っていた2つの構造的問題（unsafe default・抽選後棄却）を補正した。全78件metadata・全item`minimumRunDepth=short`・5件のunlockProgress override・economyClass集計・3F生成結果はいずれも維持している。

## 1. precheck

- base branch: `phase-24-6b2a-item-availability`
- base HEAD: `d3fdc5c33e38473ef05ccfdbf0b4952687c60bca`（一致確認済み）
- work branch: `phase-24-6b2a1-availability-filter-correction`
- baseline: `npx tsc --noEmit`（0 error）→ `npx vitest run`（128 files / 3242 tests、全pass）→ `npx vite build`（成功）

## 2. 発見した2問題

### 問題1: unsafe defaults

`getGroundItemPoolForFloor(... totalFloors=3, runDepthTier='short')`・`resolveLootSlot(... runDepthTier='deep', progress=1)`・Star系helper（`getTransformCandidatesForItem`/`hasAlternateTransformCategory`、`... runDepthTier='deep', progress=1`）がいずれも黙示defaultを持っていた。production呼び出し漏れがあっても型エラーにならず、黙って別のrun条件（例えば実際は10Fの深いrunなのに`totalFloors=3`扱いになる、あるいは実際は短いrunなのに`progress=1`=完全解禁扱いになる）として動いてしまうリスクがあった。

### 問題2: 抽選後棄却（post-selection rejection）

24.6b2aの`resolveLootSlot`は「まず既存の抽選ロジック（`selectCardRarity`→`selectCardWithinRarity`または`resolveAccessorySlot`）でcard/accessoryを決定し、その結果が`isItemEligibleAtProgress`で不適格なら`non_card`へ変換する」という**抽選後棄却**方式だった。これには以下のリスクがあった:

- tier解禁後（standard/deepへ将来一部card/accessoryが割り当てられた場合）にcard/accessory route率自体が低下する（棄却された分がnon_cardへ流れるため、card10%/accessory10%という既存route weightの実効値が下がる）
- 棄却時、同じrarity/rank内のeligibleな他candidate species へ再抽選されず、単にroute全体が失敗扱いになる
- `equipment-loot.ts`の`getNormalEquipmentCandidates`/`selectNormalEquipmentDefinition`（weapon/armorの具体的definition候補）にはavailabilityが一切接続されておらず、将来B/A装備definitionをstandard/deep専用へ変更しても、抽選ロジック自体は変わらず生成され続けてしまう欠落があった

## 3. 補正前後の抽選順序

### 補正前（24.6b2a）

```
1. rollLootCategory(categoryRng) -> 'card' | 'accessory' | 'non_card'
2. 'card'の場合: selectCardRarity(rarityRng) -> rarity (全17カード対象、フィルタなし)
3.               selectCardWithinRarity(rarity, bodyRng) -> cardId (同上)
4.               isItemEligibleAtProgress(cardId, ...) が false なら { category: 'non_card' } へ変換 (抽選後棄却)
```

### 補正後（24.6b2a1）

```
1. rollLootCategory(categoryRng) -> 'card' | 'accessory' | 'non_card'
2. 'card'の場合: selectCardRarity(rarityRng, context)
                  -> eligibleCardIdsOfRarity(rarity, context).length > 0 な rarity だけを対象に、
                     既存C60/B30/A8/S2の重みをeligible rarityの範囲だけで再正規化してから抽選 (事前filter)
3.               selectCardWithinRarity(rarity, bodyRng, context)
                  -> eligibleCardIdsOfRarity(rarity, context) の中だけから均等抽選 (事前filter)
4. 抽選後の棄却は一切行わない — 常にeligibleなcardIdが返る
```

weapon/armor/accessoryも同型の事前filter方式へ統一した（4節）。

## 4. required context化したAPI一覧

`ItemAvailabilityContext { runDepthTier: RunDepthTier; progress: number }`を`item-availability.ts`に新設し、以下のAPIすべてで黙示defaultを削除して`context`（または`totalFloors`/`runDepthTier`個別引数）を必須化した:

| API | ファイル | 変更内容 |
|---|---|---|
| `getGroundItemPoolForFloor` | item-def.ts | `totalFloors`/`runDepthTier`をrequired化 |
| `getWeightedGroundItemPoolForFloor` | item-def.ts | 同上 |
| `getNormalEquipmentCandidates` | equipment-loot.ts | `context: ItemAvailabilityContext`を新規required引数として追加（24.6b2aでは未接続だった箇所） |
| `selectNormalEquipmentDefinition` | equipment-loot.ts | 同上 |
| `selectCardRarity` | card-loot.ts | `context`をrequired化（24.6b2aでは引数自体なし） |
| `selectCardWithinRarity` | card-loot.ts | 同上 |
| `resolveCardSlot` | card-loot.ts | `context`をrequired引数として追加 |
| `selectAccessoryRank` | accessory-loot.ts | `context`をrequired化 |
| `selectAccessoryWithinRank` | accessory-loot.ts | 同上 |
| `resolveLootSlot` | accessory-loot.ts | `runDepthTier`/`progress`の2引数（デフォルト'deep'/1）を`context`1引数（required、デフォルトなし）へ置換 |
| `substituteLootSlots` | accessory-loot.ts | 同上 |
| `selectEnemyDropItemId` | enemy-drop.ts | `totalFloors`/`runDepthTier`のデフォルト値（3/'short'）を削除、required化 |
| `selectEnemyDropItemIdWithCards` | enemy-drop.ts | 同上 |
| `resolveEnemyDropEquipmentDefinition` | enemy-drop.ts | `runDepthTier`引数を新規required追加（24.6b2aでは未接続だった箇所） |
| `getTransformCandidatesForItem` | card-target-selection.ts | `runDepthTier`/`progress`のデフォルト値（'deep'/1）を削除、required化 |
| `hasAlternateTransformCategory` | card-target-selection.ts | 同上 |

全ての本番呼び出し元（`state.ts`の通常floor生成・MH報酬、`turn.ts`のenemy drop・Star transform）を、実際の`state.runDepthTier`/`floorProgressRatio(state.floor, state.totalFloors)`または`runConfig`由来の値を明示的に渡すよう更新した。省略時にコンパイルエラーになることを`npx tsc --noEmit`で確認済み。

## 5. equipment/card/accessory/Star各経路の事前filter結果

### equipment（新規接続、24.6b2aでは未接続だった）

`equipment-loot.ts`の`weightedWeaponCandidates`/`weightedArmorCandidates`が、rank(C/B/A)フィルタと同時に`isItemEligibleInContext(id, context)`を適用するようになった。`flattenByRank`（rank内でのweight均等配分）より**前**でfilterするため、不適格種は最初からrank内のspecies数にカウントされず、その分の重みは残存eligible種へ自動的に再配分される（`weight_redistribution_occurs_not_just_drop`テストで確認、8節）。`getNormalEquipmentCandidates`/`selectNormalEquipmentDefinition`双方に`context`を必須化し、通常床・MH報酬・enemy drop（`resolveEnemyDropEquipmentDefinition`経由）の全呼び出しを更新した。solar_gun/black_armor/S/R除外契約は変更していない。

候補が0件（metadata不整合）の場合、`selectNormalEquipmentDefinition`は乱数消費前に明示的な`Error`をthrowするよう変更した（従来の「defensiveなslot自身へのfallback」を削除 — task's `empty_candidate`契約「metadata不整合時だけ明示的invariant error」に対応）。

### card

`card-loot.ts`に`eligibleCardIdsOfRarity(rarity, context)`を新設し、`selectCardRarity`は「eligible cardが1件以上存在するrarityだけ」を対象に既存C60/B30/A8/S2重みを再正規化してから抽選するよう変更した。`selectCardWithinRarity`も同じeligible集合内で均等抽選する。呼び出し側が`selectCardRarity`の返した`rarity`と異なる`rarity`を`selectCardWithinRarity`へ渡した場合（本来発生しない契約違反）のみ、候補0件で明示的`Error`をthrowする。

### accessory

`accessory-loot.ts`に`eligibleAccessoryIdsOfRank`を新設し、card同様の事前filter・再正規化を`selectAccessoryRank`/`selectAccessoryWithinRank`に適用した。

### Star

`getTransformCandidatesForItem`/`hasAlternateTransformCategory`のデフォルト引数を削除し、`getStarCandidates(state)`・`resolveStarEffect`（`turn.ts`）の呼び出し元は既に24.6b2aの時点で実state値を渡していたため、この点の実質的な変更はrequired化のみ（コンパイル時強制）。

### resolveLootSlot（card/accessory共通route）

抽選後の`isItemEligibleAtProgress`チェック・`non_card`変換を完全に削除した。`selectCardRarity`/`selectCardWithinRarity`/`resolveAccessorySlot`が内部で事前filterを適用するため、`resolveLootSlot`が返す`cardId`/`accessoryId`は常にeligibleであることが保証される。`resolveLootSlot_card_never_falls_back_to_non_card`テスト（8節、category roll が'card'を引いた100サンプル全てで実際に`category: 'card'`が返ることを確認）でこの契約を検証した。

## 6. route weight・RNG維持結果

- `rollLootCategory`のcard10%/accessory10%/nonCard80%重みは一切変更していない（`resolveLootSlot`内、category roll自体は変更なし）
- 選択されたcategory内では、常にeligible候補からの均等/重み付き抽選が行われ、抽選後に無効化されることはない（5節）
- 既存RNG stream・salt（`itemCountRng`・`itemSelectionRng`・`itemPlacementRng`・`equipmentCurseRng`・`equipmentDefinitionRng`・card 3ストリーム・accessory 2ストリーム・enemy-dropの5 salt・Star transformの2 salt）は一切追加・変更していない
- `category`/`rarity`/`body`（card）・`category`/`rank`/`body`（accessory）のRNG呼出回数は従来通り各1回のまま（事前filterはRNG消費前のcandidate配列を絞るだけで、rng()呼び出し自体の回数・順序には影響しない）

## 7. 3F/10F/30F/99F結果

24.6b2a（base HEAD `d3fdc5c`）時点のスナップショットと、本補正適用後のスナップショットを同一script（seed `[1, 2, 4, 42, 999, 4294967295]`、floor1〜3、map/enemies/groundItems/equipmentInstances/combatRngState等）で比較し、**完全一致（差分0）**を確認した。現行78件metadataでは全itemが`minimumRunDepth: 'short'`であり、5件のunlockProgress overrideは事前filter方式でも同じ閾値で同じ結果を生むため、抽選後棄却→事前filterの方式変更は既存の生成結果に一切影響しなかった。

10F/30F/99Fの5件解禁floor（24.6b2aで検証済みのfloor7/10、floor20/30、floor66/99）は、`getGroundItemPoolForFloor`のロジック自体（`filterEligibleItemIds`ベース）を変更していないため維持されている。

## 8. focused tests

一時scriptで以下を検証、全PASS:

- `spear_excluded_from_slot_at_progress0` / `spear_included_from_slot_at_progress1`: weaponの事前filterがprogress閾値通りに機能
- `weight_redistribution_occurs_not_just_drop`: フィルタ後もtotalWeightが正しく再計算される（単なる候補減少でなく重み再配分）
- `card_route_never_throws_at_progress0` / `accessory_route_never_throws_at_progress0`: 現行metadataでは候補0件が発生しない
- `resolveLootSlot_card_never_falls_back_to_non_card`: category roll が'card'を引いた場合、常に`category: 'card'`が返る（抽選後棄却が発生しない）
- `star_excludes_spear_at_progress0` / `star_includes_spear_at_progress1`: Star変換候補も同じprogress閾値で一貫

## 9. 既存test変更

25ファイル（137 insertions, 130 deletions）。全て以下2種類のいずれか:

1. **required context引数の機械的追加**（24ファイル）: `getGroundItemPoolForFloor`・`selectEnemyDropItemId`・`selectEnemyDropItemIdWithCards`・`resolveEnemyDropEquipmentDefinition`・`getNormalEquipmentCandidates`・`selectCardRarity`・`resolveLootSlot`・`substituteLootSlots`・`selectAccessoryRank`・`selectAccessoryWithinRank`の直接呼び出しに、対応する`totalFloors`/`runDepthTier`/`context`引数を追加しただけで、既存assertionの期待値は一切変更していない
2. **behavior-scope明確化のための1ファイル修正**（`phase-24-4a-equipment-loot-supply.test.ts`）: 「sword/spear/hammer slotがそのfamilyの全C/B/A speciesを返す」ことを検証するテストが、`progress: 0.5`（`spear`/`hammer`のunlockProgress=2/3未満）で書かれていたため、24.6b2aの正しいeligibility gate適用によりテストが失敗した。テストの意図（rank/family filterの検証、eligibility gateの検証ではない）を保ちながら`progress: 1`（完全解禁）に変更し、テストタイトルへ「at full progress」を明記した — assertionの削除・緩和ではなく、テストが検証すべき対象（rank/familyフィルタ）とeligibility gateという別の関心事を正しく分離するための最小限の入力値変更

機械的変更以外は上記1ファイルのみ。gameplay/RNG期待値の変更・assertion削除は行っていない。

## 10. development_plan

リポジトリ内（`sanadamancom/rogue-of-sun`）を検索したが、`development-plan`という名前のファイルは存在しなかった。新規作成は行わない。

## 11. 全検証結果

| gate | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| focused tests（8節） | 全PASS |
| `npx vitest run` | 128 files / 3242 tests、全pass |
| `npx vite build` | 成功 |
| `git diff --cached --check` | OK |
| production sanity（7節、3F snapshot diff 0） | PASS |
| 一時ファイル削除 | 完了（`/tmp/audit-24-6b2a1/`） |

## 12. 指示逸脱・停止事項

なし。stop_conditionsのいずれにも該当しなかった（候補事前filterで既存RNG回数は完全維持できた、category route weight維持に新規RNGは不要だった、現在metadataで候補0件は発生しなかった、3F snapshotは変化なし、production変更はbudget領域へ拡大しなかった、baseline/dirty tree/branch衝突のいずれも発生しなかった）。`prohibited`に列挙されたavailability実値変更・standard/deep専用品設定・power/sustain budget実装・route/rank/rarity weight変更・RNG stream/salt追加・telemetry schema変更・gameplay期待値変更のいずれにも着手していない。
