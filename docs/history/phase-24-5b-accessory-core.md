# Phase 24.5b: アクセサリー基本装備基盤

正式採用6種（Phase 24.5a2a確定）について、型・EquipmentInstance統合・装備1枠・基本操作・一般アイテム鑑定・最小UIを実装した。ランダム生成（Phase 24.5c）と固有効果（Phase 24.5d）はこの工程では実装していない。

## precheck

- base branch: `phase-24-5a2a-accessory-selection-finalization`
- expected HEAD: `75c1b0b522a782d56058627917c3632f537e1430` — 実測一致
- baseline full suite 125/3152 全通過、typecheck成功、production build成功（precheck時点で実測）
- work branch `phase-24-5b-accessory-core-implementation`: local/remoteとも不存在（新規作成）
- 未使用branch `phase-24-5b-accessory-core`: HEAD `300b68fabc4c1958ebd78aeb73390adc5db8f172`（baseと同一）、本工程中一切checkout/操作せず維持
- main（`80596cd5334294255a439cb79db375f622193c50`）未変更
- remote URLにPAT残存なし

## 型・definition・GameState・instance契約

### 型設計（`src/game/types.ts`）

- `AccessoryId`: `'hot_blooded_headband' | 'earth_guard' | 'buckler' | 'adventurer_boots' | 'circlet' | 'grigri_glasses'`（6種、Phase 24.5a2a確定の正式採用案と完全一致）
- `EquipmentSlot = 'weapon' | 'armor' | 'accessory'`
- `EquipmentDefinitionId = WeaponId | ArmorId | AccessoryId`
- `ItemId`へ`AccessoryId`をunion展開（`ITEM_DEFINITIONS: Record<ItemId, ItemDefinition>`が単一の網羅的マップであり続けるため）
- `EquipmentInstance.definitionId`を`WeaponId | ArmorId`から`EquipmentDefinitionId`へ拡張
- `PlayerAction`へ`equip_accessory`/`unequip_accessory`を追加（`equip_weapon`/`equip_armor`/`unequip_weapon`/`unequip_armor`と同形）

### GameState

- `equippedAccessoryId?: AccessoryId | null`
- `equippedAccessoryInstanceId?: string | null`

**設計判断（instructions非明示部分の補足）**: `equippedWeaponId`/`equippedArmorId`自体は必須フィールド（`WeaponId | null`、optionalでない）だが、`equippedAccessoryId`は**optionalとして実装した**。理由: 必須にすると、プロジェクト全体で数十件存在する既存test fixture（`GameState`をオブジェクトリテラルで直接構築するテスト）が軒並みtypecheckエラーになり、「既存テストの期待値変更は原則禁止」（許可されるのは3枠表示・完全列挙への6種追加・Action/GameEvent型fixture補完のみ）という制約に抵触する規模の変更が必要になる。既存の`equippedWeaponInstanceId`/`equippedArmorInstanceId`（instance側）が同じ理由で既にoptionalになっている前例（レガシーfixtureが未設定のケースを許容する設計）を踏襲し、`equippedAccessoryId`もこの optional/null 規約に合わせた。読み取り側は全て`?? null`で未設定をnull相当として扱う。

### item definition（`src/game/item-def.ts`）

- `ItemDefinition.category`へ`'accessory'`を追加
- 6種を正式なItemIdとして登録（`consumable: false`, `stackable: false`）
- weapon/armorのattack/defense/effect fieldは一切追加していない（`AccessoryDefinition`/`ItemDefinition`のどちらにも存在しない）
- `ITEM_IDS_IN_ORDER`へ重複なく追加（既存weapon/armorカタログの直後、`'chocolate'`の直前）

### AccessoryDefinition（`src/game/accessory-def.ts`、新規）

`WeaponDefinition`/`ArmorDefinition`と同型で、`id`/`displayName`/`rank`のみを持つ。`ACCESSORY_DEFINITIONS: Record<AccessoryId, AccessoryDefinition>`と`ACCESSORY_IDS_IN_ORDER: AccessoryId[]`を単一の情報源として提供。

| AccessoryId | 表示名 | rank |
|---|---|---:|
| `hot_blooded_headband` | 熱血ハチマキ | C |
| `earth_guard` | 大地の守り | C |
| `buckler` | バックラー | C |
| `adventurer_boots` | 冒険者のブーツ | B |
| `circlet` | サークレット | A |
| `grigri_glasses` | グリグリメガネ | S |

### EquipmentInstance統合（`src/game/equipment-instance.ts`）

既存`EquipmentInstance`をそのまま再利用し、新規`AccessoryInstance`型は作成していない。

- `isAccessoryId`/`isEquipmentDefinitionId`を新規追加（`isWeaponOrArmorId`は無変更、weapon/armor専用処理はこちらを使い続ける）
- `definitionRankFor`をaccessory分岐対応へ拡張
- `mintEquipmentInstance`/`createEquipmentInstance`/`createEquipmentInstanceWithCurse`/`findHeldInstanceById`/`findHeldUnequippedInstanceById`/`ensureAvailableInstanceForEquip`/`findUnequippedInstanceId`/`removeUnequippedInstance`の`definitionId`パラメータ型を`WeaponId | ArmorId`から`EquipmentDefinitionId`へ拡張
- `getHeldEquipmentInstances`をweapon/armorの2分岐からweapon/armor/accessoryの3分岐へ拡張（`equippedAccessoryId`/`equippedAccessoryInstanceId`を参照する第3分岐を追加）
- `normalizeEquipmentInstances`の`isWeaponOrArmorId`ガードを`isEquipmentDefinitionId`へ拡張し、accessory用の`equippedAccessoryInstanceId`バックフィルブロックを追加（weapon/armorと同型）

### instance identity契約

- instance IDは一意（既存の`nextEquipmentInstanceId`カウンタをそのまま共有）
- pickup/place/discard/equip/unequip/swapで同一identityを維持（focused testsで実証済み — 下記参照）
- 同一AccessoryIdの複数instanceを区別（`heldOf`ヘルパーで2instance生成・区別を確認）
- 孤立instanceを作らない（`normalizeEquipmentInstances`のaccessory対応拡張により保証）
- 装備中instanceは所持instance集合にも存在する（`getHeldEquipmentInstances`の3分岐拡張により、accessory equipped個体も他のheld個体と同じ集合から取得される）

### curse状態

初期accessoryはcurse対象外。production生成時は常に`cursed: false`、`curseRevealed: false`（`mintEquipmentInstance`のデフォルト値`cursed = false`をそのまま継承、accessory専用のcurse rollは一切実装していない）。既存のcurse確率抽選helper（`rollEnemyDropCurse`等）へaccessoryを渡す経路は存在しない（Phase 24.5cで生成を実装するまでaccessoryはfixture配置のみ）。将来用の別curse fieldは追加していない。

## 基本操作・鑑定・UI

### 基本操作（`src/game/turn.ts`）

`applyAccessoryEquip`/`applyAccessoryUnequip`を新規実装。`applyWeaponEquip`/`applyArmorEquip`/`applyWeaponUnequip`/`applyArmorUnequip`と同型の契約：

- 所持中の対象instanceだけ装備可能（`findHeldInstanceById`で検証、不成立時は`accessory_equip_blocked`イベント）
- 成功時のみターン消費（`consumed: true`）
- 成功時に`equippedAccessoryId`/`equippedAccessoryInstanceId`を同期
- 別accessory装備は1操作でswap（既存の`equip_weapon`/`equip_armor`と同じく、equipアクション自体がswapを兼ねる設計）
- 同じinstanceを再装備する操作は不成立（`accessory_already_equipped`イベント）
- weapon/armor装備状態へ影響しない（3つの独立したslotフィールド）
- 装備成立時に`markGeneralItemIdentified`を呼び既存の一般アイテム鑑定規則を再利用

**curse-lock判定は実装していない** — accessoryは初期版でcurse対象外のため、`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`に相当するaccessory版チェックは不要と判断した（不要な分岐を追加しない、というPhase 24.5a2a確定契約の「大規模な新規構築を避ける」原則に沿う）。

`place_item`/`discard_item`は`resolveEquipmentTargetForRemoval`のガードを`isWeaponOrArmorId`から`isEquipmentDefinitionId`へ拡張し、`equippedInstanceIdForDefinition`の判定にaccessory分岐（第3分岐）を追加することで対応した。既存weapon/armorの契約（装備中instanceは対象外、instance IDを失わない）をそのまま踏襲する。

`isLastEquippedCopy`（place/discardの装備済み保護判定）へ`state.equippedAccessoryId === itemId`の条件を追加。

### `inventory.ts`のaction fallback経路の再確認

Phase 24.5a1で指摘された、accessory操作が誤って`use_item`としてdispatchされる懸念について、`selectedInventoryAction`を確認・拡張した：

- `entry.kind === 'equipment_instance'`ケースへ`def.category === 'accessory'`分岐を追加（weapon/armor分岐と同型、`equip_accessory`/`unequip_accessory`を返す）
- fallback（`entry.kind !== 'equipment_instance'`、instance未追跡の防御的経路）へも同様の`accessory`分岐を追加
- **`use_item`へのフォールスルーは発生しない** — accessory定義の`category`は必ず`'accessory'`であり、`def.category === 'accessory'`分岐が`def.consumable`チェックより先に評価されるため、そもそも`use_item`分岐（`def.consumable`のみを見るelse節）には到達しない

既存コードに実害のある一般的なfallback bugは、本Phaseの調査範囲では見つからなかった（Phase 24.5a1監査時点の懸念は、accessoryという新カテゴリ自体が存在しなかったための予防的指摘であり、既存weapon/armor/consumableの分岐ロジック自体に欠陥は確認していない）。修正は不要と判断した。

### 共通helper

`getHeldEquipmentInstances`をaccessoryを含む3カテゴリへ拡張した（上記equipment-instance.ts節参照）。

一方、次のweapon/armor限定helperへはaccessoryを混入させていない（明示的なcategory/型guardによる除外、詳細は「既存機能からの除外」節参照）：

- `getIncomingDamage`/`applyPlayerAttackToEnemy`等のcombat計算（accessory固有効果は本Phaseで未実装、フックすら追加していない）
- `resolveForgeCandidates`等solar forge関連（`isArmorDefinitionId`の型をwiden したが判定ロジック自体は無変更、accessoryは常に`false`）
- `getActiveCurseEligibleInstances`（curse eligibility）
- `getStarCandidates`/`getTemperanceCandidates`（Star/Temperance対象選択）

slot判定は文字列の偶然一致やfield有無で推測せず、`ITEM_DEFINITIONS[id].category`または`isAccessoryId`/`isWeaponOrArmorId`という定義/categoryベースの明示的判定で一意に解決している。

### identification（`src/game/item-identification.ts`）

Phase 24.4d1の一般アイテム鑑定基盤を再利用した。**実装中に1件の不具合を発見・修正した**（下記「発見した不具合」参照）。

- run共有・AccessoryId単位（既存の`identifiedGeneralItemIds`配列をそのまま共有）
- 装備成立時に鑑定（`applyAccessoryEquip`が`markGeneralItemIdentified`を呼ぶ）
- pickupだけでは鑑定しない（`isGeneralItemIdentified`のfocused testで確認）
- 不成立操作では鑑定しない（`markGeneralItemIdentified`はequip成功パス内でのみ呼ばれる）
- 同じdefinitionの別instanceにも鑑定結果を共有（run単位のdefinitionId粒度、focused testで確認）
- card identificationとは独立（`isCardIdentified`とは別の`identifiedGeneralItemIds`配列）

**発見した不具合**: `isGeneralIdentifiableEquipment`（鑑定対象かどうかの判定関数）が`category === 'weapon' || category === 'armor'`のみをチェックしており、`'accessory'`が含まれていなかった。この結果、`isGeneralItemIdentified`は「鑑定対象スコープ外のitemId」として扱い、**pickup直後から常にtrueを返す**（＝真名が即座に露見する）というアクセサリー鑑定の根幹契約を破る不具合だった。`isGeneralIdentifiableEquipment`の判定条件へ`|| category === 'accessory'`を追加して修正した。

この修正は本Phaseのaccessory実装に必要な最小修正であり、既存weapon/armor/consumableの鑑定挙動には一切影響しない（`category === 'accessory'`という新しい条件を追加しただけで、既存の`weapon`/`armor`分岐は無変更）。修正理由と影響範囲は本節に記録した。

また、`getDisplayedItemName`の未鑑定時フォールバック名（`GENERIC_WEAPON_NAME`/`GENERIC_ARMOR_NAME`と同型）として`GENERIC_ACCESSORY_NAME = '未鑑定のアクセサリー'`を新規追加した。

アクセサリー名を表示する全player-visible経路（inventory一覧、item detail、end screen）は共通resolver（`displayedItemName`→`getDisplayedItemName`）を経由する。

### UI（`src/main.ts`）

Phase 24.5a1の監査結果（専用の常設装備欄表示は存在しない、装備状態はinventory一覧のE markとitem detailでのみ確認可能）に従い、既存レイアウトを最小拡張した。

- **装備欄（HUD）**: 専用の常設HUD行は元々存在しないため、新規追加していない（Phase 24.5a1監査の`NOT_APPLICABLE`判定を踏襲、Phase 25相当の再配置を避ける）
- **inventory一覧**: `inventoryEntries`（`src/game/inventory.ts`）の`equipped`判定を`equippedWeaponInstanceId`/`equippedArmorInstanceId`の2分岐から`equippedAccessoryInstanceId`を含む3分岐へ拡張。E markが正しくaccessoryにも付く
- **item detail**: `def.category === 'accessory'`分岐を新規追加し、装備中/未装備の状態行のみを表示。攻撃力・防御力・強化値・curse markerは一切表示しない（既存weapon/armor分岐と異なり、そもそも数値系のpushを行っていない）
- **action UI**: `currentItemActions`の条件を`def.category === 'weapon' || def.category === 'armor'`から`|| def.category === 'accessory'`へ拡張。「装備する」/「外す」/「置く」/「捨てる」を提示。太陽鍛冶actionはweapon限定のまま（accessory分岐には追加していない）
- **end screen**: `summary.finalState.equipment`（telemetry export schema）は変更せず、`this.state.equippedAccessoryId`を直接参照して表示行へ追加した（詳細は下記「telemetry判断」参照）
- **layout**: 既存equipment欄（inventory一覧・item detail）へ最小の分岐追加のみ、固定height/幅の新設なし、action領域の競合なし、touch/gamepad専用UIは新設していない

action dispatchは選択された正確なinstance IDを保持する（`selectedInventoryAction`が`entry.instanceId`をそのまま`equipmentInstanceId`として渡す、weapon/armorと同型）。

## 既存機能からの除外結果

Phase 24.5a2/24.5a2aの監査で「`getHeldEquipmentInstances`拡張後も暗黙的に混入する危険がある」と特定された3箇所全てに、明示的なcategory/型guardを追加した。

| 除外対象 | 実装箇所 | 実装方法 | 結果 |
|---|---|---|---|
| Star変換元・変換結果 | `card-target-selection.ts`の`getStarCandidates` | inventory_itemループへ`def.category === 'accessory'`除外を追加、equipment_instanceループへ`isWeaponOrArmorId`ガードを追加 | 除外成立（focused test・production sanityで実証） |
| Temperance対象 | `card-target-selection.ts`の`getTemperanceCandidates` | `.filter((instance) => isWeaponOrArmorId(instance.definitionId))`を追加 | 除外成立（accessoryのcursed常時falseとは独立に、instanceを直接cursed:trueへ書き換えても除外されることをfocused testで確認済み） |
| mummy curse・curse_trap | `curse-active.ts`の`getActiveCurseEligibleInstances` | `isWeaponOrArmorId(instance.definitionId)`を判定条件へ追加 | 除外成立 |
| solar forge素材・出力 | 変更なし（`solar-forge.ts`のforge candidate列挙は元々`WeaponId`型の材料のみを扱う独立した経路） | `isArmorDefinitionId`のパラメータ型をwidenしたのみ（判定ロジック自体は無変更） | accessoryが到達する経路が存在しないため、構造的に除外済み |
| Moon/Sun対象 | 変更なし | Moon/Sunカードの対象選択ロジックはweapon/armor限定の既存経路を使用、accessory候補生成コード自体を追加していない | 構造的に除外済み |
| 通常床装備生成・monsterHouse報酬・enemy drop | 変更なし | Phase 24.5cの実装範囲、本Phaseでは生成コード自体を一切追加していない | accessoryが生成候補プールに一度も現れないため構造的に除外済み（production sanityで`state.groundItems`に一切現れないことを確認） |
| weapon攻撃力計算・armor防御力計算 | 変更なし | `computeAttackDamage`/`computeIncomingDamage`等の計算関数へaccessory由来の値を一切接続していない | 構造的に除外済み（production sanityでplayer.attack/defenseの不変を確認） |

「現在poolへ追加していないので偶然出ない」という状態に留まらず、Star/Temperance/mummy curse/curse_trapについてはgetHeldEquipmentInstancesの3カテゴリ拡張後も確実に除外されるよう明示的なguardを追加した。同じ除外を複数箇所へ重複実装せず、既存の候補helper境界（`getStarCandidates`/`getTemperanceCandidates`/`getActiveCurseEligibleInstances`という3つの単一集約点）を優先した。

## effect未適用保証

6種すべて固有効果なし。装備・解除は以下に一切影響しない：

- attack/defense（production sanityで`player.attack`/`player.defense`の不変を確認）
- max HP/hunger/solar energy（accessory equip/unequip処理はこれらのフィールドに一切触れない）
- combat RNG（`combatRngState`不変をfocused test・production sanityで確認）
- movement/enemy AI/item生成/status resistance（accessory関連コードはこれらの経路を一切呼び出さない）
- turn消費量（装備・解除自体の通常1ターン消費以外、追加のターン消費処理は実装していない）

## RNG非干渉

新規RNGストリームを一切追加していない。accessoryの手動fixture配置・pickup・equip・unequip・swap・place・discardの全経路が`combatRngState`/map生成RNG/floor item RNG/monsterHouse RNG/enemy-drop RNG/card-supply RNG/curse RNGのいずれも消費しないことを、focused test（`state.enemies = []`で敵ターンのRNG消費を分離した上での検証、既存Phase 24.1テストと同一パターン）とproduction sanityスクリプトの両方で確認した。

## telemetry判断

**schemaVersion 8を維持した。** accessory固有raw event・summary field・export schema変更は一切追加していない。

- `events.ts`へ追加した5イベント（`accessory_equipped`/`accessory_already_equipped`/`accessory_equip_blocked`/`accessory_unequipped`/`accessory_unequip_blocked`）は、GameEvent（内部的な操作記録）であり、telemetry.tsのRunSummary/JSON export schemaとは別の型。telemetry.tsのswitch文は非網羅的（`default`句あり）なため、この5イベントは一切telemetry.tsのraw event/summary field生成に影響しない
- `telemetry.ts`自体への機能追加は行っていない（型widening由来のnarrowing guard追加のみ、下記「telemetry.ts経由の型エラー対応」参照）
- **end screenのアクセサリー表示は`summary.finalState.equipment`（telemetry export schemaの一部）を変更せず、`this.state.equippedAccessoryId`をmain.ts側で直接参照する形にした** — これにより、player-visible UIの拡張とtelemetry export schemaの不変を両立させた。JSON export（`exportTelemetryJson`）のペイロード自体にaccessory関連フィールドは一切追加されていない
- `CURRENT_GAME_VERSION`（`telemetry.ts`）は無変更

## 既存テスト変更

`src/game/__tests__/phase-20-0a-card-definition-foundation.test.ts`の`ITEM_IDS_IN_ORDER is exactly...`テスト1件のみ変更した。

**旧前提**: `ITEM_IDS_IN_ORDER`が「既存12種＋Phase 24.3装備カタログ拡張＋17枚のカード」の完全列挙であることを検証していた。

**変更理由**: Phase 24.5bで`ITEM_IDS_IN_ORDER`へ6種のアクセサリーを追加したため、この完全列挙テストの期待値配列を更新する必要があった（タスク文書が明示的に許可する「全ItemId件数やカテゴリ件数など、6種追加により必然的に変わる列挙テスト」に該当）。期待値を弱めてはいない — 追加した6種の順序も含めて厳密に固定した完全一致アサーションのまま。テストタイトルの説明文も「Phase 24.5bのアクセサリーカタログ」を含む形へ更新した。

他の既存テストへの変更は一切行っていない。

## 全検証結果

- focused tests: **35件、全通過**（`phase-24-5b-accessory-core.test.ts`、catalog/type・state/identity・operations・identification/UI・exclusions・regression/non-interferenceの6カテゴリを網羅）
- 既存関連テスト回帰: Phase 24.1 equipment/inventory・Phase 24.4d1 identification・Phase 24.4d2/d2a Star・Phase 24.4e1 curse・Phase 24.4e2 telemetryの各テストファイルは、full suite実行の一部として全て通過を確認
- full suite: **126 files / 3187 tests、全通過**（既存125/3152 + 新規1ファイル/35件）
- typecheck: **成功**（`npx tsc --noEmit`エラー0件）
- production build: **成功**（`npx vite build`、`dist/`生成確認）
- `git diff --check`: **エラーなし**
- production sanity: **全チェック通過**（一時スクリプトで検証後、削除済み）
  - 6種すべてfixtureでpickup/equip/unequip可能
  - 同一ID複数instanceのswap成立
  - 1000回の操作列で例外なし
  - combat RNG非干渉（`combatRngState`不変）
  - weapon/armor戦闘値非干渉（`player.attack`/`player.defense`不変）
  - 真名漏洩なし（未鑑定時は`未鑑定のアクセサリー`のみ表示）
  - Star/Temperance/curse候補への混入なし

## Phase 24.5cへの残件

- 独立生成カテゴリの実装（通常床・monsterHouse報酬・enemy dropの3経路接続、独立RNG stream・独立salt）
- rank別（C/B/A/S）抽選ロジック
- accessory route weight・rank別weight比率のprovisional値決定（Phase 24.5a2の監査で構造は確認済み、数値は未確定）

## development-plan更新可否

`/mnt/project/`配下に`rogue-of-sun-development-plan.md`はプロジェクト知識として存在するが、リポジトリ内（`docs/`配下含む）には`development-plan.md`は存在しないため、新規作成していない。プロジェクト知識側のdevelopment-planへの反映はChatGPT側の作業とする。
