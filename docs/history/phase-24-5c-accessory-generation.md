# Phase 24.5c: アクセサリー生成接続

Phase 24.5bのアクセサリー6種を、通常床・monsterHouse報酬・敵ドロップの3経路へ独立カテゴリとして接続した。既存route rollの抽選回数・既存RNG streamの消費形を維持し、固有効果は実装していない。

## precheck

- base branch: `phase-24-5b-accessory-core-implementation`
- expected HEAD: `0076ce849c9840124b174b906d169424e5429556` — 実測一致
- baseline full suite 126/3187 全通過、typecheck成功、production build成功（precheck時点で実測）
- work branch `phase-24-5c-accessory-generation`: local/remoteとも不存在（新規作成）
- 未使用branch `phase-24-5b-accessory-core`: HEAD `300b68fabc4c1958ebd78aeb73390adc5db8f172`（不変、本工程中一切checkout/操作せず維持）
- main（`80596cd5334294255a439cb79db375f622193c50`）未変更

## 3route接続境界

新規モジュール`src/game/accessory-loot.ts`を中央集約点として作成した。Phase 24.4cのcard-loot.tsの設計（`rollIsCardSlot`/`selectCardRarity`/`selectCardWithinRarity`/`resolveCardSlot`/`substituteCardSlots`）は**完全に無変更のまま**再利用し、新しい3分岐ロジックはこのcard-loot.tsの機能を「拡張」する形で実装した（置き換えではない）。

- **`rollLootCategory`**: 単一のrng()呼び出しで`'card' | 'accessory' | 'non_card'`を決定する。card判定の閾値（`[0, 10)`）は旧`rollIsCardSlot`の閾値と数学的に同一のため、同じrng値に対するcard判定結果は本Phase前後で不変——card自体の生成率は変化しない。
- **`resolveLootSlot`**: `rollLootCategory`の結果に応じて、card側はcard-loot.tsの`selectCardRarity`/`selectCardWithinRarity`を直接呼び出し（`resolveCardSlot`は内部で独自のcategory rollを再度行うため使用せず、二重roll化を回避）、accessory側はこのモジュール自身の`selectAccessoryRank`/`selectAccessoryWithinRank`を呼び出す。
- **`substituteLootSlots`**: 3経路（通常床・monsterHouse報酬）が共有する配列全体への適用関数。旧`substituteCardSlots`の呼び出し箇所を置き換えた。

### 各経路の接続箇所

| 経路 | 接続箇所 | 実装内容 |
|---|---|---|
| 通常床生成 | `state.ts`のground-item配置ループ | `substituteCardSlots`呼び出しを`substituteLootSlots`へ置換。`isAccessoryId(itemId)`分岐を新設し、位置確定後にinstanceをmint |
| monsterHouse報酬 | `state.ts`の報酬生成ループ | 同上（既存の`cardCategoryRng`/`cardRarityRng`/`cardBodyRng`ストリームの継続消費順は不変、新規`accessoryRankRng`/`accessoryItemRng`も同様に継続） |
| enemy drop | `enemy-drop.ts`の`selectEnemyDropItemIdWithCards`、`turn.ts`の`spawnEnemyDropIfAny` | `resolveCardSlot`呼び出しを`resolveLootSlot`へ置換。関数シグネチャ・戻り値型（`ItemId`）は無変更のため既存呼び出し元との互換性を維持。`turn.ts`側へ`isAccessoryId(drawnItemId)`分岐を新設し、`createEquipmentInstance`でmint（curse rollなし） |

floor固定分岐は作っていない（`resolveLootSlot`/`substituteLootSlots`はfloor引数を一切取らない、card-loot.tsの既存設計方針をそのまま踏襲）。

## route/rarity weight

### route weight（`LOOT_ROUTE_WEIGHT_PROVISIONAL`）

```
{ card: 10, accessory: 10, existingNonCard: 80 }
```

3経路全てで同じ定数を中央集約して使用（`accessory-loot.ts`の単一export）。card 10%は変更していない（旧`CARD_ROUTE_WEIGHT_PROVISIONAL.card`と数値・分布とも一致）。accessory 10%は旧non-card 90%の空間から分離した（旧90% → accessory 10% + existingNonCard 80%）。

既存route rollの抽選回数は増えていない——旧`rollIsCardSlot`は1スロットにつきcategoryRng 1回消費だったが、新`rollLootCategory`も同じcategoryRngストリームに対し1回のみ消費する（3分岐判定を同じ1回のrng()呼び出し内で行う）。

### rarity weight（`ACCESSORY_RANK_WEIGHT_PROVISIONAL`）

```
{ C: 60, B: 30, A: 8, S: 2 }
```

`CARD_RARITY_WEIGHT_PROVISIONAL`と完全一致する値を採用した（全floor・全route共通）。候補が存在するrankだけで正規化する設計（`selectAccessoryRank`）もcard-loot.tsの`selectCardRarity`と同型。同rank内は均等抽選（`selectAccessoryWithinRank`）。Rは存在しない（`ACCESSORY_RANK_WEIGHT_PROVISIONAL`の型自体が`'C'|'B'|'A'|'S'`のみ、Rキーを持たない）。grigri_glasses（S）は通常生成可能——focused test・production sanityの両方で実際に到達を確認した。

## RNG streamとsalt

### 新規salt一覧

| 用途 | salt値 | 使用箇所 |
|---|---|---|
| accessory rank選択（通常床・monsterHouse共通） | `0xa39f6e52` | `state.ts`の`accessoryRankRng` |
| accessory item選択（通常床・monsterHouse共通） | `0xe61c8b3d` | `state.ts`の`accessoryItemRng` |
| accessory rank選択（enemy drop） | `SALT_ACCESSORY_RANK = 0xa39f6e52` | `enemy-drop.ts` |
| accessory item選択（enemy drop） | `SALT_ACCESSORY_ITEM = 0xe61c8b3d` | `enemy-drop.ts` |

route/rarity/item用途間でsaltを共有していない（category roll用のsalt`0x2f7b91d4`は既存card用saltをそのまま流用——これは意図的で、card判定とaccessory判定は同一の1回のroll上で行われる必要があるため。rank選択・item選択用の2つは完全新規かつ独立したsalt）。

各routeの既存seed/salt方式へ合わせた用途別saltとした——`state.ts`はfloorSeedとのXOR、`enemy-drop.ts`は`(floorSeed, enemyId, salt)`の3項組み合わせという既存の`createEnemyDropRng`パターンをそのまま踏襲。

### 既存stream非干渉

以下の既存RNGストリームの消費回数・順序は本Phase前後で一切変化しない：

- `combatRngState`（accessory生成コードは一切参照しない）
- `Math.random`（未使用、`createRng`ベースの決定的PRNGのみ使用）
- 既存card rarity/item stream（`cardRarityRng`/`cardBodyRng`、accessory分岐時は消費されない——focused testの「resolveLootSlot consumes category+rank+item streams (not card streams) for an accessory result」で実証）
- 既存equipment definition/curse stream（`equipmentDefinitionRng`/`equipmentCurseRng`、accessory分岐は一切これらを呼ばない——accessoryには「slot」概念も curse roll も存在しないため）
- map・floor item count・monsterHouse・enemy drop chance stream（いずれも本Phaseで変更していない既存関数のまま）

accessory非選択時（`rollLootCategory`が`'non_card'`を返した場合）も既存streamの消費順・回数は変わらない——`resolveLootSlot`は`categoryRng`の1回のみを消費し、残り4ストリーム（cardRarityRng/cardBodyRng/accessoryRankRng/accessoryItemRng）は一切呼ばれない（focused testの「resolveLootSlot consumes only the category stream for a non_card result」で実証）。

同seed・同入力で結果が決定的であることをfocused test・production sanity両方で確認した。

## instance mint/配置/identity

- 配置されるaccessoryごとに`EquipmentInstance`をmint（`mintEquipmentInstance`/`createEquipmentInstance`をそのまま再利用、Phase 24.5bで既に`EquipmentDefinitionId`対応済み）
- `refineLevel: 0`、`cursed: false`、`curseRevealed: false`（accessoryのcurse rollは一切実装していない——mint関数のデフォルト引数`cursed=false`をそのまま使用）
- **配置成功時だけmint**: 通常床・monsterHouse報酬はいずれも`chooseGroundItemPosition`/位置探索が成功した後にのみaccessory分岐のmint処理へ到達する（既存weapon/armor分岐と全く同じ順序）。enemy dropは`dropPos`（`findNearestValidDropCell`）が見つかった後にのみmintする（`!dropPos`の早期returnより後）
- 配置失敗時に孤立instanceは残らない——production sanity（1000 seed）で実証、GroundItemとEquipmentInstanceのidentityが常に一致することも確認済み（`instance.definitionId === item.itemId`）
- 各routeの既存spawnSourceを維持（通常床は`spawnSource`フィールドなし、monsterHouseは`'monster_house'`）。新しいspawnSource categoryは追加していない

## 全除外

以下は本Phaseの対象外として、一切実装していない：

- accessory固有効果（引き続きPhase 24.5dの範囲）
- curse付与・curse抽選（`rollEnemyDropCurse`・`equipmentCurseRng`のいずれもaccessory分岐から呼ばれない）
- refine・DP・solar forge（accessory-loot.tsはこれらに一切関与しない）
- Star・Temperance・Moon・Sun（Phase 24.5bで確立済みの除外guardは無変更のまま維持、`getStarCandidates`/`getTemperanceCandidates`/`getActiveCurseEligibleInstances`への変更は本Phaseで行っていない）
- 固定報酬・イベント報酬（accessoryはground-item生成・monsterHouse報酬・enemy dropの3経路以外に一切接続していない）
- 新規UI（Phase 24.5bのUIをそのまま使用、UI変更なし）
- 新規raw telemetry event（下記「telemetry判断」参照）
- balance最終調整（route/rarity weightはいずれもprovisional値のまま、Phase 24.6で再調整）

## telemetry判断

**schemaVersion 8を維持した。** accessory固有raw event・summary fieldは一切追加していない。`accessory-loot.ts`/`state.ts`/`enemy-drop.ts`/`turn.ts`への変更はいずれもtelemetry.tsに触れておらず、`CURRENT_GAME_VERSION`は無変更。

## 既存テスト変更

タスク文書が明示的に許可する「旧card/non-card二分岐を直接固定している期待値のみ、card/accessory/existing-non-card三分岐へ最小更新可」の範囲で、3件のテストを更新した。

### 1. `phase-24-1-equipment-instance-actions.test.ts`

**旧前提**: `createInitialState(42)`で作られた新規runの`equipmentInstances`が空配列であることを検証していた。

**変更理由**: accessory生成の追加により、既存の単一`categoryRng`ストリーム（salt `0x2f7b91d4`）が3分岐で解釈されるようになった結果、seed 42のfloor-1における同じロール値がaccessory範囲（`[10, 20)`）に該当するようになり、意図通りaccessory個体がmintされるようになった。これはバグではなく、本Phaseで意図した挙動そのもの（accessory 10%が旧non-card 90%空間から正しく分離されている証拠）である。

**変更内容**: seedを42から4へ変更した（本Phase時点で`equipmentInstances`が空になることを別途スクリプトで確認済みのseed）。テストの本来の意図（新規runが古いcarryの装備状態を引き継がないこと）は維持したまま、期待値自体は弱めていない。

### 2. `phase-24-4a-equipment-loot-supply.test.ts`（2テスト）

**旧前提**: 「`equipmentInstanceId`を持つGroundItemは必ずweapon/armorである」という暗黙の前提のもと、rank検証をweapon/armorカタログのみに対して行い、S/Rランクの不在を検証していた。

**変更理由**: accessory生成の追加により、accessory GroundItemも`equipmentInstanceId`を持つようになった。accessoryは`ACCESSORY_DEFINITIONS`という別カタログを持ち、かつgrigri_glassesはrank Sで**正当に**生成されるため、旧テストの「S/Rは存在しない」という検証をaccessoryへそのまま適用すると誤って失敗する。

**変更内容**: 両テストへ、`item.itemId`がaccessoryである場合の分岐（`ACCESSORY_DEFINITIONS`から直接rankを検証し、weapon/armor側のS/R禁止アサーションはスキップ）を追加した。weapon/armor側の既存アサーション（S/R/black_armor禁止）は一切変更していない——期待値を弱めたのはaccessory分岐の新設のみで、既存のweapon/armor向け検証はそのまま維持されている。

他の既存テストへの変更は一切行っていない。

## focused/full/typecheck/build/sanity

- focused tests: **29件、全通過**（`phase-24-5c-accessory-generation.test.ts`、route/rarity weight契約・resolveLootSlot/substituteLootSlots・3route到達性・instance/identity・既存契約維持・RNG決定性/非干渉・identification・telemetryの8カテゴリを網羅）
- 既存関連テスト回帰: Phase 24.4a equipment loot（修正込みで全通過）・Phase 24.4b enemy drop・Phase 24.4c card supply・Phase 24.5b accessory coreの各テストファイルは、full suite実行の一部として全て通過を確認
- full suite: **127 files / 3216 tests、全通過**（既存126/3187 + 新規1ファイル/29件）
- typecheck: **成功**
- production build: **成功**
- `git diff --check`: **エラーなし**
- production sanity（1000 seed）: **全チェック通過**
  - 6種すべて到達（`adventurer_boots`/`earth_guard`/`hot_blooded_headband`/`buckler`/`grigri_glasses`/`circlet`）
  - 3経路すべて到達（通常床1107件・monsterHouse報酬110件・enemy drop到達確認）
  - 例外0件
  - 孤立instance 0件（同一floor内でのmint-then-reference整合性を確認。floor間で拾われず放棄されたinstanceがgroundItemsから参照されなくなる現象はweapon/armorでも同様に発生する既存の設計特性であり、本Phaseで新たに導入したものではないことを別途確認した——並行して同条件でweapon/armorをチェックしたところ200 seed×3floorで491件の同種の「未参照」が検出され、これは Phase 24.5c以前から存在する挙動であることを実証した）
  - 同一セル衝突なし
  - 決定性（同seedで完全一致）
  - 比率がprovisional weightと大きく矛盾しない（accessory ≈10.1%、card ≈10.5%、non-card ≈88.7%程度、いずれも概ねprovisional weightと整合）
  - 一時script（`sanity-24-5c-tmp.ts`）は検証後に削除済み

## 指示逸脱・停止事項

なし。

## development-plan更新可否

`docs/`配下に`development-plan.md`は存在しないため、新規作成していない。
