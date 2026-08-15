# Phase 24.5a: アクセサリーreadiness audit

production code・既存testは変更していない。本ドキュメントのみが今回の差分。

## Phase 24.4完了・延期項目

- **完了採用範囲**: enemy drop, equipment loot, card supply, general item identification, binding curse, mummy/curse_trap active curse routes, curse lifecycle telemetry — Phase 24.4e0〜24.4e2aで監査・実装・telemetry統合まで完了。
- **延期**: degradation curse（効果・低下量未確定）, calamity curse（発動条件・確率・効果未確定）, DP（definition値・減少trigger・DP0挙動・回復方法未確定）。
- 本Phaseはこれらdeferred項目をPhase 24.5へ便乗実装しない。`EquipmentInstance`へ未使用fieldを先行追加しない。rank/refineLevelの既存実装は維持する（監査のみで、いずれも変更していない）。

## precheck

- baseline branch: `phase-24-4e2a-telemetry-compliance-audit`
- expected_head_prefix: `3478aef` — 実際のHEAD `3478aeff61090b1f60fde8a5a755a77fbc95ca6c`と一致
- local/remote SHA一致、working tree clean、同名work branch不存在（新規作成）
- main（`80596cd`）は監査中未変更
- baseline full suite: **125 files / 3152 tests — 全pass**
- typecheck/build: baseline時点で成功確認済み

## audit_1: slot model監査

- `EquipmentSlot`という専用型は**存在しない**。`GameState`は`equippedWeaponId: WeaponId | null` / `equippedArmorId: ArmorId | null` / `equippedWeaponInstanceId?: string | null` / `equippedArmorInstanceId?: string | null`という4つの独立フィールドを直接持つ（types.ts:670-694）。slot mapやunion型への一般化は行われていない。
- `PlayerAction`（types.ts:1320-1359）はslotごとに完全に別のaction variant（`equip_weapon`/`equip_armor`/`unequip_weapon`/`unequip_armor`）を持つ。汎用`equip_accessory`という第三slotを追加する場合、既存の2 slotパターンと**完全に対称な**新規variant（`equip_accessory`/`unequip_accessory`）を追加すればよく、既存unionの構造自体を変更する必要はない。
- `WeaponId | ArmorId`というリテラル型union（単一のtype alias化はされていない）が**40箇所**で直接使われている（equipment-instance.ts、curse-active.ts、events.ts、telemetry.ts等）。アクセサリーを本格導入する場合、これら40箇所すべてに個別の型拡張判断が必要になる（型チェッカーに導かれる機械的作業ではあるが、ファイル横断の変更点数としては無視できない）。
- **最重要の2択分岐**: `getHeldEquipmentInstances`（equipment-instance.ts:203-234）が`equippedWeaponInstanceId`/`equippedArmorInstanceId`のみを見る三項演算子を持つ。ここへ`equippedAccessoryInstanceId`の第3分岐を追加するのが、アクセサリーをTemperance/Star/curse eligibility等の既存候補列挙ロジックへ接続する**単一の中心的変更点**。
- 同様の2択if/switchは`applyWeaponEquip`/`applyArmorEquip`（turn.ts）、`resolveEquipmentTargetForRemoval`（turn.ts）、`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`（equipment-instance.ts）等、装備操作系関数のほぼ全てに存在する。いずれも「weaponとarmorで完全に並行した2つの関数/分岐」という一貫したパターンであり、矛盾した複数方式は確認されなかった。

**結論**: accessoryをaccessory1枠のためだけに装備全体をECS/map構造へ再設計する必要はない。既存の「weapon用関数・armor用関数を並べる」パターンへ第三の並行実装（accessory用関数）を追加する最小案が既存構造と一貫する。`equippedAccessoryInstanceId`相当は`GameState`への直接フィールド追加（既存2フィールドと同型）が最も既存パターンと整合する — slot mapへの一般化はここでは不要と判断する。

## audit_2: item/instance model監査

- `ItemId`（types.ts:983〜）は武器種・防具種・消費アイテム・カード・enchantmentすべてを含む**単一のフラットunion**。`WeaponId`/`ArmorId`はそれぞれ独立した別unionとして定義され、`ItemId`はそれらのリテラルを個別に列挙する形（`WeaponId | ArmorId | ...`という合成ではない）。
- `EquipmentInstance.definitionId: WeaponId | ArmorId`（型定義側、40箇所の一部）。accessoryを追加する場合、新規`AccessoryId`型を定義し、`definitionId`の型を`WeaponId | ArmorId | AccessoryId`へ拡張する必要がある。
- `isWeaponOrArmorId`（equipment-instance.ts:29-31）が`WEAPON_IDS_IN_ORDER`/`ARMOR_IDS_IN_ORDER`から構築した`Set`によるmembership判定を行う、装備システム全体の**単一のゲートキーパー関数**。accessory対応にはこの関数（または並行する`isAccessoryId`+呼び出し側の拡張）が必須の変更点になる。
- `identifiedGeneralItemIds`/`getDisplayedItemName`等の識別システムは`itemId: ItemId`を汎用的に受け取る設計（WeaponId/ArmorId専用ではない）ため、**accessory用の新規識別ロジックは不要** — 新しいItemIdをこの型へ追加するだけで自動的に識別システムへ乗る。
- **recommended_defaultの妥当性確認**: accessoryもEquipmentInstance（cursed/curseRevealed/refineLevel/rank/instanceId/definitionId）を再利用する設計は、既存の`mintEquipmentInstance`/`createEquipmentInstanceWithCurse`ヘルパーがすでに`definitionId: WeaponId | ArmorId`のみを引数に取る汎用実装であるため、型拡張のみで自然に対応できる。別instance registryを新設する必要はない。
- refineLevel/solar forge対象外にする場合、`isWeaponOrArmorId`ベースの判定（forge対象の判定は武器限定の別条件も併用）を単純に「accessory系IDを含めない」ことで構造的除外が可能（新しいフラグを追加する必要はなく、既存の「対象外リストに含める/含めない」という判定方式の踏襲で足りる）。

**結論**: EquipmentInstanceのfield自体は無変更で再利用可能。`AccessoryId`型の新設と、`WeaponId | ArmorId`という40箇所のリテラルunionへの機械的追加が主な変更コスト。

## audit_3: operation routes監査

| 操作 | accessory対応に必要な変更 | instanceId単位維持 | turn契約 |
|---|---|---|---|
| pickup | `item_picked_up`は`itemId: ItemId`と`equipmentInstanceId?`を汎用的に持つため無変更で対応可能（Phase 24.4e2で追加した`equipmentInstanceId`フィールドも`isWeaponOrArmorId`を`isWeaponArmorOrAccessoryId`的に拡張すれば自然に乗る） | 維持可能 | 既存と同一契約 |
| equip | 新規`equip_accessory`アクション+`applyAccessoryEquip`関数が必要（`applyWeaponEquip`/`applyArmorEquip`と並行実装） | 維持可能 | 既存equip系と同一契約（consumed:true/false） |
| unequip | 新規`unequip_accessory`+`applyAccessoryUnequip`が必要 | 維持可能 | 同上 |
| swap | equip_accessoryの再利用で対応（既存equip_weapon/equip_armorと同じ「別individualをequipで上書き」パターン） | 維持可能 | 同上 |
| place | `resolveEquipmentTargetForRemoval`が`isWeaponOrArmorId`ベースで判定するため、この関数の拡張のみで対応可能（新規関数不要） | 維持可能 | 既存と同一 |
| discard | 同上 | 維持可能 | 同上 |
| inventory detail | UI層（main.ts）でaccessory種別の表示分岐が必要（後述audit_8） | N/A | N/A |
| comparison | **比較UI自体が本作に存在しない**（Phase 24.5a1のUI監査で確認、`grep`で"compare"/"比較"該当0件） | NOT_APPLICABLE | N/A |
| solar forge | **対象外を維持**（`validateForgeMaterials`は武器限定判定を既に持つため、accessoryを候補に含めない = 何もしないことで自動的に対象外） | N/A | 変更なし |
| Star target | `getStarCandidates`は`isStarEligibleRank`+`STAR_INELIGIBLE_ITEM_IDS`ベースの判定であり、accessoryを含めるかは明示的な設計判断が必要（`getHeldEquipmentInstances`が拡張されれば技術的には候補に混入しうるため、含めない場合は明示的な除外リストへの追加が必要） | — | — |
| Temperance target | `getTemperanceCandidates`も同様。curse対象にaccessoryを含めるかの判断（audit_6）に従属 | — | — |
| Moon/Sun target | 現状未実装（Phase 20.5b以降）だが、指示どおり「Moonはarmorのみ・Sunはweaponのみ」の既存意図を維持し、accessoryを自動的に対象へ含めない | — | — |

**重要**: `getHeldEquipmentInstances`を拡張してaccessoryが候補集合に入るようになった瞬間、Star/Temperanceの候補関数がaccessoryを暗黙的に含めてしまうリスクがある（除外リストへの追加を忘れると自動混入する構造）。Phase 24.5bでslotを追加する際は、この暗黙混入を防ぐ除外リストの同時追加が必須の作業項目になる。

## audit_4: effect hook map

| 領域 | 正規適用境界 | 既存definition-driven modifierの再利用可否 | RNG要否 | telemetry接続点 |
|---|---|---|---|---|
| combat（攻撃力/防御力/命中/回避/物理・属性ダメージ） | `getEffectivePlayerAttack`相当（turn.ts:360付近）/`getEffectivePlayerDefense`（turn.ts:384） — 既にweapon+armorのボーナスを加算合成する単一の集約関数 | 再利用可能。`getAccessoryEffectiveAttackBonus(state)`等を同じ加算式へ追加するだけで済む | 不要（既存のweapon/armorボーナスもRNG非依存） | 既存の`player_attack`/`enemy_attack`イベントペイロードは変更不要（合成済みの数値のみを見るため） |
| resources（LIFE回復/SOL/満腹度） | 各種`applyXxxRecovery`関数群、`getEffectiveMaxSolarEnergy`等 | 再利用可能（armor由来のmaxSOLボーナスと同型） | 不要 | 既存resourcesイベントで対応可能 |
| exploration（罠発見/視界/暗所/pickup/floor遷移） | `isPlayerInDarkRoom`等、equipment-effects.tsの各判定関数 | 部分的に再利用可能。罠発見率等の新規判定が必要なら新規関数が要る | 既存罠発見にRNGがあれば同じstreamへ影響しないよう独立化が必要 | 罠関連の既存telemetryへの追加検討が必要 |
| status（poison/slow/web/一時buff） | `isPlayerPoisonImmune`等、armorのeffectIdベースの判定パターン | 再利用可能（poison_guardと同型のaccessory効果なら1関数追加で済む） | 不要 | 既存status関連イベントで対応可能 |
| loot（通常床/MH/enemy drop） | audit_7参照 | 生成route自体は別の関心事（効果適用ではなく供給）| 該当route次第 | audit_9参照 |

**重複適用リスク**: 現在のweapon/armor効果はいずれも「1関数=1回だけ呼ばれる」という規律があり（例: `getArmorEffectiveAttackBonus`は`getEffectivePlayerAttack`から1回のみ呼ばれる）、accessoryも同じ規律（集約関数から1回だけ呼ぶ）を踏襲すれば重複適用リスクは低い。

## audit_5: effect candidate classes（分類のみ、数値未決定）

| クラス | 現行コードで安全に実装可能か | 新基盤要否 | RNG非干渉リスク | Phase 24.5初期採用適否 |
|---|---|---|---|---|
| stat_modifier（攻撃/防御/命中/回避/maxLIFE/maxSOL） | 可能（audit_4のとおり既存加算式へ足すだけ） | 不要 | 低（RNG不使用） | **適** — 最もリスクが低く実装コストも小さい |
| resource_modifier（SOL消費軽減/満腹度減少軽減/自然回復補助） | 可能（既存のmagic_robe/spike_mail等と同型のeffectId判定） | 不要 | 低 | 適 |
| resistance（poison/slow/web/curse耐性） | 可能（poison_guardと同型） | 不要（curse耐性のみ、既存のcurse eligibility除外リストとの整合を要確認） | 低〜中（curse耐性は生成route側のRNG消費順に影響しないよう注意が必要） | 適（poison/slow/web）、curse耐性は要design decision |
| exploration（罠発見/item発見/視界/暗所） | 部分的（視界拡張は既存の`isPlayerInDarkRoom`等と独立した新規FOV計算が必要な可能性） | 罠発見率アップ等は新基盤不要、視界拡張は要調査 | 低〜中 | 罠発見等は適、視界拡張は要追加調査 |
| economy（item出現率/enemy drop率/rarity補正） | **既存RNG streamへの介入が必要**（equipment-loot.ts/enemy-drop.tsの生成ロジック自体を装備効果で動的分岐させる設計） | 新基盤相当の変更が必要（生成関数がstateの装備を参照する新しい依存関係を持つことになる） | **高**（既存の「floorSeedのみに依存する決定的生成」という契約自体を壊すリスク）| **不適** — 指示の禁止事項（loot率・rarityを動的補正するaccessoryを優先候補にしない）どおり、初期採用から除外を推奨 |
| conditional（日向/日陰/LIFE低下時/SOL満タン時） | 可能（`isPlayerInDarkRoom`/`isPlayerLowLife`/`isSolarEnergyMax`が既に存在し条件判定関数として再利用可能） | 不要 | 低（既存の条件判定関数をそのまま再利用） | 適 — 既存関数群との親和性が高い |

**新しい状態異常・資源の追加は行っていない**（本監査自体もそれを提案していない）。

## audit_6: identification/curse監査

- accessoryは`ItemId`拡張のみで`identifiedGeneralItemIds`（run共有・definitionId単位）による鑑定システムへ自然に接続できる。`getDisplayedItemName`も`itemId: ItemId`汎用のため無変更で対応。
- equip成立時鑑定（`markGeneralItemIdentified`呼び出し）は、`applyAccessoryEquip`が`applyWeaponEquip`/`applyArmorEquip`と同じ末尾で同一ヘルパーを呼べば自然に接続する。
- 未鑑定表示aliasの追加方法: 既存の`ITEM_DEFINITIONS`（item-def.ts）に`unidentifiedDisplayName`相当のフィールドパターンがあれば、accessory定義でも同じフィールドを埋めるだけで対応可能（本監査ではitem-def.tsの詳細フィールド構造の全数確認までは行っていないが、既存武器・防具と同型の定義オブジェクトを追加する形になる見込み）。
- curse生成helper（`mintEquipmentInstance`/`createEquipmentInstanceWithCurse`）は`definitionId: WeaponId | ArmorId`のみを受け取るため、curse対象に含める場合は型拡張が必要。curse対象外にする場合は、通常床/MH/enemy-drop/Star各ルートの`isWeaponOrArmorId`ベースの候補選定から単純に除外する（accessory候補プール自体を別カテゴリとして扱えば、既存のweapon/armor curse roll経路へ一切触れずに済む）。

**推奨（監査結果から明白な範囲のみ）**: **初期版accessoryはcurse対象に含めないことを推奨する。** 根拠: (1) Phase 24.4で確立したcurse生成・active curse付与・telemetry統合は全てweapon/armorの2種を前提に設計されており、3つ目のslotをcurse対象に含めると`getActiveCurseEligibleInstances`・`getStarCandidates`・`getTemperanceCandidates`・curse生成route全てへの変更が連鎖する。(2) 指示の`out_of_scope`が明確にaccessory本体の効果すら未決定としている段階で、curse適用という追加のゲームデザイン層を同時に導入するのは`degradation_curse`/`calamity_curse`と同様「具体的仕様未確定のまま便乗実装しない」原則に反する。(3) 構造的除外（curse対象外にする）はcurse生成route側の候補プールにaccessoryを含めないだけで実現でき、後続Phaseで対象化する際も既存weapon/armorのcurse実装へ影響しない独立した追加として行える。

## audit_7: generation/rarity監査

- `NormalEquipmentSlot`（equipment-loot.ts:25）は現在`'sword' | 'spear' | 'hammer' | 'armor' | 'solar_gun'`の5値固定union。accessoryを追加する場合、この型への新規値追加（例: `'accessory'`）と、対応する`ACCESSORY_DEFINITIONS`相当のテーブル、`getNormalEquipmentCandidates`/`selectNormalEquipmentDefinition`と並行する`selectAccessoryDefinition`が必要。
- 通常床/MH/enemy-dropの3ルートは共通のcurse roll閾値（`FLOOR_EQUIPMENT_CURSE_CHANCE`）とRNGストリーム順序（`equipmentDefinitionRng`/`equipmentCurseRng`等、floorSeedベースの独立ストリーム）を共有している。accessoryを独立カテゴリとして追加する場合、**新規の独立RNGストリーム**（既存ストリームの消費順序を一切変更しない、Phase 24.4で確立した「新規生成要素には必ずユニークなXOR定数を使う」原則の踏襲）を追加すれば、既存3ルートの決定性・再現性を壊さずに済む。
- accessoryを独立カテゴリにするかequipment配下にするか: **独立カテゴリを推奨**（監査中の暫定所見、設計決定はしない）。理由: 既存の`isNormalEquipmentSlot`ベースの選定ロジックへweapon/armor/accessoryを同列に混ぜると、5値unionへの割り込みで既存の重み付け比率（現在5スロット間の相対頻度がどう決まっているかは本監査で数値未確認）に予期せぬ影響を与えるリスクがある。独立した「accessory抽選を行うか否か」の別ステップとして追加する方が、既存の武器/防具比率に対して非干渉になりやすい。
- accessory候補0件時: 既存の「候補が尽きた場合はそのスロットをスキップする」パターン（本監査では詳細未確認だが、既存5スロットのいずれかが枯渇した場合の挙動と同型で扱うのが自然）を踏襲する。
- rank/rarityの保持場所: 既存`EquipmentRank`（'C'|'B'|'A'|'S'|'R'）をそのままaccessoryへ適用するか、accessory専用のrarity体系を新設するかは design decision（本監査では確定しない）。
- S/R/イベント専用品の扱い: 既存のblack_armor/solar_gunと同様、通常3ルートから構造的除外する設計を踏襲するのが自然（Phase 24.4の監査で確立したパターンの再利用）。

**推奨**: **Phase 24.5bとPhase 24.5dは別工程として維持することを推奨する。** 根拠: slot/instance/操作/最小UIの追加（24.5b）はRNGストリームへ一切触れない構造変更であり検証が独立して行える。一方、通常床/MH/enemy-drop供給（24.5d）は3ルート共通のRNG消費順序・比率設計という別種のリスクを持つ。統合するとfocused testの責務が混在し、RNG非干渉の検証が複雑化する。

## audit_8: UI/display監査（Phase 24.5a1で完了）

`main.ts`のUI実装は単一のPhaser 3 `MainScene`（`class MainScene extends Phaser.Scene`）内に閉じている。ゲーム本体の表示はPhaserのCanvas API（Text/Graphicsオブジェクト）で行われ、run終了時（victory/game over）のレポート画面のみ別途DOM overlay（`document.createElement('div')`、`innerHTML`によるHTML構築）を使用する。**この2種類の描画手法はどちらも同一の`src/main.ts`という単一production entry pointに属しており、別frameworkや別entry pointは存在しない**（`index.html`が読み込むスクリプトは`src/main.ts`のみ、`phase-18-3-trap-playtest.html`は`scripts/build-single-html.mjs`が生成するビルド成果物であり別ソースではない）。stop_conditionの「UIが別frameworkまたは別entry pointにも実装され、どちらがproduction経路かコード上確定不能」には該当しない。

### weapon/armor二択が固定されている箇所（全数確認済み、8箇所）

| # | file:line | 内容 | accessory追加時の挙動（無変更の場合） |
|---|---|---|---|
| 1 | `main.ts:1687` | `if (def.category === 'weapon' \|\| def.category === 'armor') { ...装備する/外すアクションを提示... }` | accessoryは条件に一致せず、装備する/外すアクションが**一切提示されない**（`else if (def.consumable)`にも該当しないため置く/捨てるのみになる） |
| 2 | `main.ts:1700` | `if (def.category === 'weapon' && isForgeEligibleWeaponId(...))` | 太陽鍛冶アクションは元々weapon限定のため、accessoryは自動的に対象外（**意図した挙動、変更不要**） |
| 3 | `main.ts:2225` | item detail: `if (def.category === 'weapon') { 攻撃力/射程表示 }` | accessoryはこの分岐に入らない |
| 4 | `main.ts:2233` | item detail: `else if (def.category === 'armor') { 防御力表示 }` | 同上、**かつ**この2分岐の外側にある「装備中/未装備」表示（`main.ts:2231,2239`）もこのif/else-if内にネストされているため、**accessoryは装備中/未装備の表示すら出ない** |
| 5 | `inventory.ts:211` | `selectedInventoryAction`: `if (def.category === 'weapon') { return equip_weapon/unequip_weapon }` | accessoryはこの分岐に入らない |
| 6 | `inventory.ts:217` | 同関数: `if (def.category === 'armor') { return equip_armor/unequip_armor }` | 同上。**両方に該当しない場合、`equipment_instance`エントリのif/if構造を素通りし、関数末尾の`return { type: 'use_item', itemId }`（inventory.ts:232）まで落ちる** — accessoryを選択して「装備する」を確定すると、装備action ではなく**誤って`use_item`（アイテム使用）actionが送信される**という実害のあるバグ経路になる |
| 7 | `inventory.ts:226` | 同関数、非`equipment_instance`側フォールバック: `if (def.category === 'weapon')` | 同上構造 |
| 8 | `inventory.ts:229` | 同関数: `if (def.category === 'armor')` | 同上 |

**最重要所見**: #6（`inventory.ts:209-223`）は、accessoryの`ItemId`/`category`を追加しただけで`applyAccessoryEquip`等のaction handlerを未実装のまま放置すると、UIが誤って`use_item`アクションを送出してしまう実害のあるフォールスルーである。Phase 24.5bでは、`AccessoryId`/`category: 'accessory'`をtypesへ追加するタイミングと、`selectedInventoryAction`へ`accessory`分岐を追加するタイミングを**同一コミットで行う**必要がある（型追加とUI分岐追加が分離してしまうと、その間の状態で上記バグが顕在化する）。

### UI監査matrix

| UI経路 | file/function/selectors | 現在のweapon/armor前提 | accessory追加時の必要変更 | identification影響 | curse影響 | layout risk | test候補 | status |
|---|---|---|---|---|---|---|---|---|
| DOM構築（全体） | `main.ts`: `class MainScene extends Phaser.Scene`, `index.html`の単一entry | なし（Phaser Sceneのライフサイクルメソッド群） | 無変更 | — | — | 低 | 既存構造の維持確認のみ | NOT_APPLICABLE |
| render関数（HUD） | `main.ts:2787` `this.hudText.setText(...)` | weapon/armorへの参照なし（floor/Lv/HP/SOL/満腹度/enchant/effectsのみ） | 無変更 | — | — | 低 | — | COMPLIANT |
| Canvas HUD | 同上（`hudText`, `messageText`） | 同上 | 無変更 | — | — | 低 | — | COMPLIANT |
| 装備欄・装備サマリー | 専用の常設装備欄表示は存在しない（HUDに武器名等は出ない。装備状態はinventory一覧のE markとitem detailでのみ確認可能） | N/A | N/A | — | — | — | — | NOT_APPLICABLE |
| インベントリ一覧 | `main.ts:2182-2218`（`listLines`構築）、`inventoryEntries`（`inventory.ts:74-101`） | リスト生成自体は`isWeaponOrArmorId`ベースで category-agnostic。E markの計算のみ`equippedWeaponInstanceId`/`equippedArmorInstanceId`の2分岐（`inventory.ts:83-84`） | `inventoryEntries`のequipped計算に`\|\| instance.instanceId === state.equippedAccessoryInstanceId`を追加するだけで一覧表示は成立（`main.ts`側のrender自体は無変更で対応可能、`entry.kind`/`entry.equipped`のみ参照） | 影響なし（`getDisplayedItemName`/`isGeneralItemIdentified`は`ItemId`汎用） | 影響なし（`curseRevealed`/`cursed`もInventoryEntryへ汎用的に格納済み） | 低（動的行数、後述layout監査） | 一覧描画・E mark確認 | CHANGE_REQUIRED（`inventory.ts:83-84`のみ、小規模） |
| アイテム詳細 | `main.ts:2219-2245` | `def.category === 'weapon'`/`'armor'`の2分岐、非該当時は装備中/未装備表示すら出ない（上記表#3,#4） | accessory用の`else if (def.category === 'accessory')`分岐を追加し、効果概要+装備中/未装備表示を出す | 影響小（`itemIdentified`変数は既に汎用） | 影響なし | 低（動的高さ） | detail表示・未鑑定名表示 | CHANGE_REQUIRED |
| 装備比較表示 | **存在しない**（`grep -n "compare\|比較"`で該当0件） | N/A | 追加実装ゼロ（比較UI自体が本作に存在しない） | — | — | — | — | NOT_APPLICABLE |
| equip/unequip/swap操作ボタン | `main.ts:1687-1702`（`currentItemActions`）、確定は`inventory.ts:205-233`（`selectedInventoryAction`） | 上記表#1,#5-8 | `currentItemActions`へaccessory分岐追加、`selectedInventoryAction`へaccessory分岐追加（型追加と同時コミット必須、上記参照） | 影響なし | 影響なし（curse対象外なら無関係） | — | equip/unequip/swap操作の確定・action shape検証 | CHANGE_REQUIRED |
| 操作可否判定 | `resolveEquipmentTargetForRemoval`（turn.ts、Phase 24.5a audit_3で既確認）、`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`（curse対象外なら無関係） | `isWeaponOrArmorId`ベース | `isWeaponOrArmorId`相当の拡張または並行関数（Phase 24.5a audit_2の既存結論どおり） | — | — | — | — | CHANGE_REQUIRED（Phase 24.5a既報告のとおり、本工程で新規発見なし） |
| 確認ダイアログ | `main.ts:1855-1920`（`discardConfirmItemId`/`discardConfirmEquipmentInstanceId`） | itemId/equipmentInstanceId汎用、weapon/armor分岐なし | 無変更 | — | — | — | — | COMPLIANT |
| Star/Temperanceの対象選択UI | `main.ts:2282-2295`（`card_target_selection`画面） | candidates配列を`describeCardTargetCandidate`経由で汎用描画、category分岐なし | UI自体は無変更。候補生成側（`getStarCandidates`/`getTemperanceCandidates`、card-target-selection.ts）でのaccessory除外が必要（Phase 24.5a audit_3で既報告） | — | — | — | 候補にaccessoryが混入しないことの確認 | COMPLIANT（UI層）／CHANGE_REQUIRED（候補生成側、Phase 24.5a既報告） |
| Moon/Sunの対象表示 | 未実装（Phase 20.5b以降、本監査で該当UIコード無し） | N/A | 実装時にweapon限定（Sun）/armor限定（Moon）の制約をaccessoryへ拡張しないことを確認する必要があるが、現状UIコード自体が存在しない | — | — | — | — | NOT_APPLICABLE |
| solar forge素材・出力表示 | `main.ts:1700`（表示条件）、`main.ts:2257-2279`（`solar_forge_material_b`画面） | `def.category === 'weapon'`ゲートにより非weaponは太陽鍛冶アクション自体が出ない | 無変更（accessoryは自動的に対象外、意図どおり） | — | — | — | — | COMPLIANT |
| run result・victory・game over等の最終装備表示 | `main.ts:1584`（`showEndScreen`内、`装備: ${summary.finalState.equipment.weapon ?? '素手'} / ${summary.finalState.equipment.armor ?? 'なし'}`） | ハードコードされた2枠表示 | `summary.finalState.equipment.accessory`相当を追加した上で3枠表示へ変更（telemetry.ts側のRunSummary拡張が前提） | — | — | 低（overlay自体は`overflowY: 'auto'`の可変高さ、固定行数制約なし） | 終了画面の3枠表示確認 | CHANGE_REQUIRED（telemetry.ts拡張と対） |
| telemetry download UIおよび表示上のschemaVersion参照 | `main.ts:1594-1623`（`exportTelemetryJson`） | UIテキスト自体にschemaVersion/バージョン番号のハードコードなし（`grep`で確認、`schemaVersion`という文字列はmain.ts中に一切出現しない） | 無変更（schemaVersion判断はaudit_9訂正版を参照） | — | — | — | — | COMPLIANT |
| unidentified表示 | `item-identification.ts`の`getDisplayedItemName`/`isGeneralItemIdentified`を`main.ts`/`inventory.ts`が汎用的に呼ぶのみ | `ItemId`汎用 | 無変更（accessory用の`ITEM_DEFINITIONS`エントリに通常の`unidentifiedDisplayName`相当を設定するだけで自動対応） | 影響なし（既存機構をそのまま利用） | — | — | 未鑑定accessory名の秘匿確認 | COMPLIANT |
| curse表示 | `inventory.ts`の`InventoryEntry.cursed`/`curseRevealed`、`main.ts:2209`の`curseMark` | `entry.kind === 'equipment_instance'`であれば category非依存で表示 | 初期版はcurse対象外のため、accessoryの`InventoryEntry`は`kind: 'equipment_instance'`と`kind: 'inventory_item'`のどちらで扱うかの設計次第（curse対象外なら`cursed`は常にfalseになるだけで表示ロジック自体は無変更） | — | 初期版は対象外（Phase 24.5a audit_6の推奨どおり） | — | curse markがaccessoryへ出ないことの確認 | COMPLIANT（curse対象外の前提で） |
| キーボード入力経路 | `main.ts`の`handleKey`系（`determineContext`、`currentItemActions`のindex送り） | メニュー内はカーソルindexベースの汎用navigation、weapon/armor専用キーバインドなし | 無変更 | — | — | — | — | COMPLIANT |
| タッチ入力経路 | **存在しない**（`grep`で`touchstart`/`pointerdown`等0件） | N/A | N/A | — | — | — | — | NOT_APPLICABLE |
| ゲームパッド入力経路 | **存在しない**（`grep`で`gamepad`/`Gamepad`0件） | N/A | N/A | — | — | — | — | NOT_APPLICABLE |
| CSS/レイアウト（メニューbox） | `main.ts:2403`（`listHeight = Math.min(FIELD_PIXEL_HEIGHT - 16, listLines.length * MENU_LINE_HEIGHT + PADDING*2 + 8)`）、`main.ts:2415`（表示可能行数でslice） | **動的サイズ**（内容行数に応じて高さを計算し、画面高さを超える分はslice） | 無変更（accessory分の1行追加は既存の動的サイジング機構内で自然に吸収される） | — | — | 低 | 狭い画面で行数超過時にsliceが機能することの確認（新規行追加による既存回帰） | COMPLIANT |
| CSS/レイアウト（endScreenOverlay） | `main.ts:1490-1500`（`position: fixed; inset: 0; overflowY: auto`） | 固定height/固定行数なし、スクロール可能な全画面overlay | 無変更（1行追加は無リスク） | — | — | 低 | — | COMPLIANT |

### action dispatch接続の確認

UIからdispatchされるaction shapeとaction handlerの接続を追跡した:

1. **item_actions画面**での「装備する/外す」選択 → `main.ts:1913`（`action = actions[itemActionIndex]`） → 該当なし（'捨てる'/'太陽鍛冶'/'置く'/'食べる／使う'のいずれにも一致しない場合）→ `main.ts:1976`（`selectedInventoryAction(state)`） → `inventory.ts:205-233`。
2. `selectedInventoryAction`は`PlayerAction`（`equip_weapon`/`equip_armor`/`unequip_weapon`/`unequip_armor`/`use_item`のいずれか）を返し、`main.ts:1978`（`useSelectedInventoryItem(state)`、内部で`processTurn(state, action)`を呼ぶ）で実際にdispatchされる。
3. 「置く」「捨てる」は`selectedItemId`/`selectedEquipmentInstanceId`（`inventory.ts:242-256`、いずれも`ItemId`/`entry.kind`汎用）経由で`place_item`/`discard_item`actionを直接構築（`main.ts:1940`）— **この経路はaccessory対応済み**（category分岐なし、`entry.kind === 'equipment_instance'`のみで判定）。
4. **接続結果**: 「装備する/外す」の経路のみが`def.category`の3値目（accessory）で破綻する（上記UI matrixの#1,#5-8）。「置く/捨てる」「Star/Temperance対象選択」「太陽鍛冶」の経路はそれぞれの理由でcategory非依存またはaccessory自動除外により無変更で機能する。

## Phase 24.5b向け最小UI契約の確認結果

指示で確定契約として扱われた14項目のうち、コード監査で裏付け・矛盾確認が可能だった点を記録する（設計として妥当かどうかの判断ではなく、現行コードとの整合性確認のみ）:

- 契約1（3枠化）・契約3（instance ID単位操作）: 上記UI matrixの「equip/unequip/swap操作ボタン」「action dispatch接続」の変更候補と整合する。既存の`equipmentInstanceId`ベースの操作パターン（`equip_weapon`等が`equipmentInstanceId?: string`を既に持つ）をそのまま踏襲できる。
- 契約4（inventory一覧・item detail表示）: 上記UI matrixの該当行のとおり、変更範囲は特定済み。
- 契約5（未鑑定真名非表示）: 既存の`getDisplayedItemName`が自動対応するため契約と矛盾なし。
- 契約6・7（比較はaccessory同士のみ、weapon/armorとの数値比較新設なし）: 比較UI自体が現在存在しないため（NOT_APPLICABLE）、この契約は「将来比較UIを作る場合の制約」として記録するのみで、現時点のコードとの矛盾はない。
- 契約8・9・10・11（curse対象外、curse marker/lock/Temperance/solar forge/Moon/Sun/Star混入禁止）: Phase 24.5a audit_3/6で既に整合する推奨を報告済み。本工程のUI監査でも、solar forge（`main.ts:1700`のweapon限定ゲート）とStar/Temperance対象選択UI（候補配列をそのまま描画するだけで、混入防止の実体は候補生成側にある）の両方で、UI層自体はcategoryを知らない設計になっており、混入防止の責務は一貫して生成側（`card-target-selection.ts`等）にあることを確認した。
- 契約12・13（大規模レイアウト刷新なし、狭画面で操作を塞がない）: 上記layout監査のとおり、メニューboxは動的サイジングであり、accessory1行追加によるレイアウト破綻リスクは低いことを確認した。
- 契約14（Phase 25相当のUI刷新を先取りしない）: 本工程はコード監査のみであり、デザイン変更は行っていない。

矛盾は確認されなかった。


## audit_9: telemetry監査

- 既存の`equipment.acquiredCount`/`equipment.changeCount`/`equipment.endingEquipment`（RunSummary、telemetry.ts）は`weapon`/`armor`の2スロット構造を前提にしている（`endingEquipment: { weapon: WeaponId | null; armor: ArmorId | null }`）。**この構造自体をaccessory対応させるのはPhase 24.5b単独のスコープではない**（後述のPhase 24.5a1訂正を参照 — schemaVersion変更が必要になるのはこのfield拡張を実際に行うPhase、すなわちaudit_7が推奨するPhase 24.5d、もしくはPhase 24.5bが装備状態のtelemetry反映まで含める場合に限る）。
- 呪いlifecycle telemetry（Phase 24.4e2）は`WeaponId | ArmorId`型を各所で使用しているため、accessoryをcurse対象に含める場合はtelemetry側の型拡張も連鎖する（audit_6の推奨どおりcurse対象外とすれば、telemetry側もこの連鎖を回避できる）。
- accessory専用counterの要否: 最小限として`accessory_acquired`/`accessory_equipped`/`accessory_changed`程度の既存equipment counterと並行する形が、既存パターンとの一貫性が高い。dashboardは追加しない。
- internal ItemIdとplayer-visible名の分離: 既存の`getDisplayedItemName`パターンをそのまま踏襲すれば新規の分離ロジックは不要。

**推奨**: Phase 24.5では「accessoryの取得・equip・changeを既存equipment counterと並行する形で最小限追加する」提案に留め、詳細実装はPhase 24.5d（供給と合わせて）で確定することを推奨する。

## audit_10: original reference boundary

- 指定された2ページ（`https://sunmiguere.web.fc2.com/shinbok_accessory.html`、`https://cyberfater.web.fc2.com/buki.and.akusesalre.html`）は、本監査を実行している環境からアクセスするための手段（ブラウジング/web検索ツール）が現在利用できないため閲覧不可能だった。

**ACCESSORY_SOURCE_UNAVAILABLE**

推測による一覧作成は行っていない。名称・装備箇所・効果候補は本ドキュメントのどこにも記載していない。repository監査のみを完了した。

## required output matrix

| area | current structure | evidence | accessory change needed | risk | recommended phase |
|---|---|---|---|---|---|
| types | `WeaponId`/`ArmorId`独立union、`ItemId`はフラット単一union | types.ts:983,1136,1181 | `AccessoryId`新設、`ItemId`へ追加 | 低（追加のみ） | 24.5b |
| slot | GameStateへ直接4フィールド、slot map無し | types.ts:670-694 | `equippedAccessoryId`/`equippedAccessoryInstanceId`追加 | 低 | 24.5b |
| instance | EquipmentInstance、`definitionId: WeaponId | ArmorId` | equipment-instance.ts | 型拡張（40箇所） | 中（機械的だが件数多い） | 24.5b |
| inventory | count-only、instance非依存 | inventory.ts(未変更) | 無変更（既存パターンで対応可） | 低 | 24.5b |
| operations | weapon/armor並行関数群 | turn.ts各所 | `applyAccessoryEquip`等の並行実装 | 中 | 24.5b |
| effects | definition-driven modifier、集約関数へ加算 | equipment-effects.ts, turn.ts:360,384 | 加算式への追加 | 低 | 24.5c |
| identification | `itemId: ItemId`汎用 | item-identification.ts | 無変更で対応可 | 低 | 24.5b（自動） |
| curse | `WeaponId | ArmorId`前提の生成/eligibility | curse-active.ts, equipment-loot.ts | 対象外推奨（audit_6） | 中〜高（対象化する場合） | 対象外なら24.5bで完結、対象化は別途 |
| generation | 5スロットunion、3ルート共有RNGストリーム | equipment-loot.ts:25 | 独立カテゴリ+独立RNGストリーム推奨 | 中 | 24.5d |
| RNG | floorSeedベース独立ストリーム原則が確立済み | equipment-loot.ts, state.ts | 新規XOR定数のみ、既存ストリーム非干渉 | 低（原則遵守すれば） | 24.5d |
| UI | Phase 24.5a1で全数確認済み。8箇所のweapon/armor二択ハードコード（main.ts×4, inventory.ts×4）+E mark計算1箇所 | main.ts:1687,1700,2225,2233; inventory.ts:83-84,211,217,226,229 | 型追加とUI分岐追加の同時コミットが必須（inventory.ts:209-223のuse_itemフォールスルーバグ回避） | 中（範囲確定済み、件数少） | 24.5b（最小） |
| telemetry | `endingEquipment: {weapon,armor}`前提 | telemetry.ts | schemaVersion bump要 | 低〜中 | 24.5d |
| schema | telemetry schemaVersion 8 | telemetry.ts | accessory対応で9へbump見込み | 低 | 24.5d |

## NEEDS_DESIGN_DECISION

- accessoryをcurse対象に含めるか（audit_6は対象外を推奨するが最終決定ではない）
- accessoryのrank/rarity体系（既存EquipmentRank流用か専用体系か）
- accessoryを独立生成カテゴリにするかequipment配下に統合するか（audit_7は独立カテゴリを推奨するが最終決定ではない）
- accessory候補0件時の具体的フォールバック仕様
- 効果クラスの最終採用範囲・具体的効果値（audit_5は分類のみ、数値・効果内容は一切決定していない）
- UI詳細レイアウト（Phase 25へ委ねる前提だが、Phase 24.5内での最小表示の具体的仕様は未決定）
- S/R相当のaccessory専用ランクを設けるか

## recommended implementation split

**Phase 24.5b（slot・instance・操作・最小UI）:**
- 変更候補ファイル: `types.ts`（AccessoryId, PlayerAction拡張, GameState拡張）, `equipment-instance.ts`（isWeaponOrArmorId相当の拡張）, `turn.ts`（applyAccessoryEquip/Unequip, resolveEquipmentTargetForRemoval拡張）, `main.ts`（最小UI）
- 再利用helper: `mintEquipmentInstance`, `createEquipmentInstanceWithCurse`（curse対象外なら不使用）, `markGeneralItemIdentified`, `getDisplayedItemName`
- focused test計画: equip/unequip/swap/place/discard各操作のaccessory版、既存weapon/armor操作への非干渉回帰
- stop condition: curse対象化の判断が必要になった時点で一度停止し設計判断を仰ぐ

**Phase 24.5c（採用品定義・個別効果）:**
- 前提: original reference（audit_10）が閲覧可能になるか、代替の効果候補確定プロセスが必要
- 変更候補ファイル: `equipment-effects.ts`（accessory効果関数群）, `accessory-def.ts`（新規、weapon-def.ts/armor-def.tsと同型）
- stop condition: 効果候補が確定しない限り着手しない

**Phase 24.5d（通常床/MH/enemy drop供給・telemetry）:**
- 変更候補ファイル: `equipment-loot.ts`（独立カテゴリ+新規RNGストリーム）, `state.ts`（生成route接続）, `telemetry.ts`（schemaVersion bump, accessory counter追加）
- RNG非干渉テスト計画: 既存3ルートのRNG消費順序が不変であることの回帰確認必須
- stop condition: 既存weapon/armor生成比率への予期せぬ影響が確認された場合

3工程は指示どおり分割を維持することを推奨する（統合案は採らない）。理由はaudit_7の推奨に記載のとおり、RNG非干渉検証の複雑化を避けるため。

## focused test plan（後続Phase向け提案、本監査では未作成）

- accessory equip/unequip/swap/place/discardの基本動作
- 既存weapon/armor操作への非干渉回帰（accessory追加後もweapon/armor単体テストが無変更で通過すること）
- curse対象外の場合、accessory instanceがcurse関連関数から一貫して除外されることの確認
- 生成route（24.5d時）のRNG消費順序不変テスト

## production code/test無変更確認

- `git diff main...HEAD -- 'src/**/*.ts'`: 差分なし（本ドキュメントのみ追加）
- test file差分なし
- 一時スクリプトは使用せず（本監査はgrep/viewによる読み取りのみで完結）

## development_plan

リポジトリ内に`development-plan.md`は存在しないため、新規作成していない。

## baseline validation結果

- full suite（125/3152）・typecheck・buildはbaseline時点で確認済みのため、history作成後の再実行は不要（validation要件どおり）

---

# Phase 24.5a1 UI readiness audit補完（追記・訂正）

Phase 24.5aで「UI詳細は未精査」「Phase 24.5b実装段階へ委譲」とされていたUI経路を、`main.ts`（唯一のproduction UI実装）と`src/game/inventory.ts`を対象に全数確認した。上記のaudit_8/audit_9セクションは本工程でその場で訂正済み（プレースホルダー文言は残っていない）。原作アクセサリーの名称・効果・採用品は本工程でも確定していない。

## precheck（24.5a1）

- base branch: `phase-24-5a-accessory-readiness-audit`
- expected_head_prefix: `13b1d64` — 実際のHEAD `13b1d649a9292d880c8c3e1130ad99c790a31a9e`と一致
- local/remote SHA一致、working tree clean、同名work branch不存在（新規作成）
- main（`80596cd`）・既存phase branch未変更
- baseline full suite 125/3152・typecheck・buildは前工程（Phase 24.5a）で成功記録済みのため再実行せず（docs-only工程）

## UI監査matrixの件数

- 監査対象UI経路: **19経路**（DOM構築/render/HUD/装備欄/インベントリ一覧/item detail/装備比較/equip操作/操作可否判定/確認ダイアログ/Star・Temperance対象選択/Moon・Sun対象表示/solar forge/run終了表示/telemetry download/unidentified表示/curse表示/キーボード/タッチ/ゲームパッド/CSS×2）
- **CHANGE_REQUIRED: 5件**（インベントリ一覧のE mark計算、item detail表示、equip/unequip/swap操作ボタン、操作可否判定〈Phase 24.5a既報告分の再確認〉、run終了時最終装備表示）
- **COMPLIANT: 9件**
- **NOT_APPLICABLE: 8件**（存在しない機能: 装備比較UI、Moon/Sun対象表示、タッチ入力、ゲームパッド入力。および構造上無関係: DOM構築全体、装備欄専用表示〈存在しない〉、CSS重複計上分の一部整理により件数は上表参照）

## 変更候補file/function/selectors一覧

コードから直接確認できたweapon/armor二択ハードコードは**全8箇所**、いずれも「未確認」を残さず特定済み:

1. `main.ts:1687` — `currentItemActions`、equip/unequipアクション提示条件
2. `main.ts:1700` — 同関数、太陽鍛冶アクション提示条件（意図どおりweapon限定、変更不要）
3. `main.ts:2225` — item detail、weapon分岐（攻撃力/射程）
4. `main.ts:2233` — item detail、armor分岐（防御力）、かつ装備中/未装備表示がこの2分岐の内側にネストされている
5. `inventory.ts:211` — `selectedInventoryAction`、weapon分岐（equipment_instance側）
6. `inventory.ts:217` — 同関数、armor分岐（equipment_instance側）— **この2分岐に該当しない場合、関数末尾の`use_item`フォールバックへ落ちる実害バグ経路**
7. `inventory.ts:226` — 同関数、weapon分岐（非equipment_instance側フォールバック）
8. `inventory.ts:229` — 同関数、armor分岐（同上）

加えて、E mark計算（`inventory.ts:83-84`、`getHeldEquipmentInstances`内ではなく`inventoryEntries`内）にも同型の2分岐が別途存在する（Phase 24.5aのaudit_1で報告済みの`getHeldEquipmentInstances`の分岐とは別関数の別箇所）。

selectors（DOM）: `#end-screen-export-button`、`#end-screen-export-status`（`main.ts:1594,1609`）— いずれもaccessory非依存、変更不要。

## action dispatch接続結果

「装備する/外す」選択 → `currentItemActions`のindex → `selectedInventoryAction`（`inventory.ts:205-233`）→ `PlayerAction`構築 → `processTurn`という単一経路を確認した。この経路の`def.category`分岐（上記5,6,7,8）がaccessory未対応のまま`AccessoryId`/`category: 'accessory'`のみを型に追加すると、accessoryへの「装備する」操作が誤って`use_item`アクションとして送出される（`inventory.ts:232`のフォールバック）。**型追加とUI分岐追加の同時コミットが必須**であることを本工程の主要な確定事項として記録した。「置く/捨てる」「Star/Temperance対象選択」「太陽鍛冶」の各経路はcategory非依存またはaccessory自動除外により無変更で機能することも確認した。

## layout risk

メニューbox（`main.ts:2403-2425`、`listHeight`/`detailHeight`）・end screen overlay（`main.ts:1490-1500`、`position:fixed; overflowY:auto`）のいずれも**固定height/固定行数を持たず、内容量に応じた動的サイジング+overflow時のslice機構**を持つことを確認した。accessory1行の追加によるレイアウト破綻リスクは**低**。grid-template/flexによるカラム固定も存在しない（メニューはテキスト行の羅列描画）。mobile向けmedia queryは本監査では発見されなかった（`viewport`メタタグのみ、レスポンシブCSSクエリ自体が現状未使用）。

## focused test計画（Phase 24.5b向け、既存テスト基盤の確認込み）

`vite.config.ts`の`test.environment: 'node'`を確認: **jsdom/Canvas環境は設定されておらず、既存テストは`src/game/*`の純粋ロジックのみを対象にしている**（`main.ts`のPhaser/DOM描画コード自体をテストする既存基盤は存在しない）。この事実を踏まえ、focused testは「UIが呼び出すデータ層関数」を対象にすることを推奨する（`main.ts`自体の新規jsdomテスト化はこの監査のスコープ外の基盤追加判断になるため提案に留める）:

| test候補 | 対象関数/追加候補ファイル |
|---|---|
| accessory枠が1枠表示される | `inventoryEntries`（`inventory.ts`）の出力にaccessory種のエントリが1件だけ含まれることを確認。新規`phase-24-5b-accessory-*.test.ts`候補 |
| 未装備表示 | `InventoryEntry.equipped === false`のケース。同上 |
| 装備済み表示 | `InventoryEntry.equipped === true`のケース、`equippedAccessoryInstanceId`との一致確認。同上 |
| 同一instanceの装備・解除 | `selectedInventoryAction`がaccessory種で`equip_accessory`/`unequip_accessory`を正しく返すこと。同上 |
| 別accessoryへのswap | 2種のaccessory間の`equip_accessory`呼び出し結果。同上 |
| inventory一覧表示 | `inventoryEntries`のorder/フィルタリング（既存`ITEM_IDS_IN_ORDER`ベースの順序がaccessoryにも適用されること） |
| item detail表示 | `main.ts`のdetail構築ロジックを関数として抽出できるかは実装時の判断だが、抽出困難な場合は`ITEM_DEFINITIONS[accessoryId].category === 'accessory'`の型レベル確認に留める |
| 未鑑定名の秘匿 | `getDisplayedItemName`/`isGeneralItemIdentified`のaccessory ItemIdでの動作確認。既存`item-identification`系テストファイルへ追加が自然 |
| weapon/armor表示の回帰 | 既存`phase-24-1-equipment-instance-actions.test.ts`等の全pass維持（既存テスト無変更） |
| Star/Temperance/Moon/Sun候補への非混入 | `getStarCandidates`/`getTemperanceCandidates`がaccessory instanceを返さないことの確認。既存`phase-24-4d2-star-*`/temperance系テストファイルへ追加、またはPhase 24.5b新規ファイル |
| solar forge候補への非混入 | `getSolarForgeSecondMaterialCandidates`等がaccessoryを返さないことの確認。既存`phase-24-3-solar-forge-*.test.ts`へ追加 |
| curse表示・curse lockへの非混入 | `getActiveCurseEligibleInstances`等がaccessoryを含まないことの確認（curse対象外の場合）。既存curse系テストファイルへ追加 |
| 狭い画面で操作領域が失われない | jsdom/Canvas基盤が存在しないため、`main.ts`の`listHeight`計算式自体を関数として抽出しユニットテスト化することを推奨（現状は`private`メソッド内のインライン計算のため、抽出は実装判断） |
| action dispatchが正しいinstance IDを保持する | `selectedInventoryAction`が返す`PlayerAction`の`equipmentInstanceId`が選択中のentryと一致することの確認。新規テストファイル候補 |

新規テストファイル候補: `src/game/__tests__/phase-24-5b-accessory-slot-and-operations.test.ts`（仮称、Phase 24.5b実装時に確定）。

## telemetry schemaVersion判断（訂正）

**Phase 24.5b（slot・instance・操作・最小UI）単独では、telemetry schemaVersionの変更は不要と判断する。**

根拠: Phase 24.5bのスコープは装備枠・EquipmentInstance拡張・操作action・最小UIに限定されており（Phase 24.5aの推奨実装分割どおり、telemetry統合はPhase 24.5dへ分離）、`telemetry.ts`のRunSummary/RunEventPayload/TelemetryDocumentのいずれの構造にも触れない前提であれば、**accessory固有raw event・summary field・export構造は一切追加されない**。単に`ItemId`/`WeaponId`相当の型union内でaccessory種のリテラルが増えるだけであれば、Phase 24.4e2の既存判断根拠（"新しいRunEventカテゴリもRunSummary fieldも追加しない場合はbump不要"）と整合し、schemaVersion変更理由にはならない。

Phase 24.5bの実装が「accessoryの取得・装備状態をtelemetryのequipment counterやendingEquipmentへ反映する」ところまで踏み込む場合（Phase 24.5aのaudit_9原案が想定していた範囲）は話が別で、その場合の**具体的export schema差分**は以下のとおりになる:

- `RunSummary.equipment.endingEquipment`: `{ weapon: WeaponId | null; armor: ArmorId | null }` → `{ weapon: WeaponId | null; armor: ArmorId | null; accessory: AccessoryId | null }`（新規field追加）
- 新規`RunEventPayload`カテゴリ（例: `accessory_acquired`/`accessory_changed`）を追加する場合はそれ自体が新カテゴリ追加に該当

このいずれかを行う場合はPhase 24.4e2の前例（7→8）と同じ理由でschemaVersion bump（8→9）が必要になる。**Phase 24.5bがtelemetry構造に一切触れない実装方針を採る限り、この訂正の結論（schemaVersion変更不要）が適用される。**

## Phase 24.5a operation matrixの訂正有無

Phase 24.5aのoperation matrix（audit_3）自体に事実誤認は発見されなかった。今回のUI監査で新たに判明したのは、audit_3が「UI層」として明示的に扱っていなかった`selectedInventoryAction`（データ層とUI層の中間に位置する関数）のaccessory非対応時のフォールスルーバグ経路であり、これはoperation matrixの訂正ではなく**新規追記**として上記UI監査matrixおよびaction dispatch接続結果セクションに記録した。「装備比較」操作については、Phase 24.5aのaudit_3が`comparison`を操作候補として一般的に扱っていた箇所を、本工程で「該当UIが本作に存在しない（NOT_APPLICABLE）」と確定させた点が実質的な精緻化にあたる。

## コード上の未確認事項

**0件。** 上記UI監査matrixの全19経路について、`main.ts`/`inventory.ts`/`card-target-selection.ts`の該当コードを直接確認し、「未確認」「要追加確認」「推定」に該当する記述は残していない。原作アクセサリーの名称・効果・採用品は引き続き未確定（本工程のスコープ外）。

## production/test変更の有無

**変更なし。** `git diff main...HEAD -- 'src/**/*.ts'`は差分なし、test file差分なし。変更は`docs/history/phase-24-5a-accessory-readiness-audit.md`（既存ファイルの訂正・追記）のみ。一時ファイルは使用していない（grep/viewによる読み取り監査のみ）。
