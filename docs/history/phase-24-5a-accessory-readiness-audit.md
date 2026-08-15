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
| comparison | 既存の比較UIがweapon/armor専用構造なら同様の並行拡張が必要（未確認、要audit_8参照） | N/A | N/A |
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

## audit_8: UI/display監査

- `main.ts`のinventory list/item detail/equipment panelは本監査で全文を精査していないが、`equippedWeaponId`/`equippedArmorId`を直接参照する箇所がturn.ts同様に存在する可能性が高い（型定義側の2フィールド構造から推定）。accessory追加時はUI層にも並行する第三の表示ブロックが必要になる見込み。
- weapon/armor二択が固定表示されている箇所の全数調査は本監査のスコープでは完了していない（`grep`ベースの型定義調査に留まる）。Phase 24.5bの実装段階で個別に洗い出す必要がある。
- 未鑑定表示・curse表示: 既存のitem-identification.ts/message-log.tsの汎用ItemId対応により、UIロジック自体は無変更で対応できる可能性が高いが、実際のレイアウト（3つ目のスロット表示位置）は新規UI要素になる。
- **scope方針**: 指示どおり、Phase 24.5では機能上必要な最小UI（スロット存在の可視化・equip/unequip操作可能性）のみとし、完成版レイアウト・装飾はPhase 25へ委ねることを推奨する。

## audit_9: telemetry監査

- 既存の`equipment.acquiredCount`/`equipment.changeCount`/`equipment.endingEquipment`（RunSummary、telemetry.ts）は`weapon`/`armor`の2スロット構造を前提にしている（`endingEquipment: { weapon: WeaponId | null; armor: ArmorId | null }`）。accessory追加時はこの構造に`accessory: AccessoryId | null`相当を追加する必要があり、**schemaVersionの更新が必要**（Phase 24.4e2の判断根拠と同様、新規fieldの追加はschemaVersion bumpの対象）。
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
| UI | 未精査、weapon/armor二択の疑い | main.ts（未精査） | 第三ブロックの追加 | 中（範囲未確定） | 24.5b（最小） |
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
