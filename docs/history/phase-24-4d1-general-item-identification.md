# Phase 24.4d1: 一般アイテム鑑定（カード以外の通常consumable・weapon・armor）

## Precheck

- 開始時HEAD: `11afa01e1e2172235986bd1a5629b50769f33666`（baseline branch `phase-24-4d0-identification-audit`、origin一致確認済み）
- HEADに`docs/history/phase-24-4d0-identification-audit.md`が存在することを確認済み
- working tree clean、mainおよびPhase 24.0〜24.4cの各既存branchはlocal未作成のためorigin参照のみで比較し、いずれもorigin側SHAと一致（未変更）
- 同名work branch（`phase-24-4d1-general-item-identification`）はlocal・originいずれにも存在せず
- baseline full suite: 120ファイル・3025テスト全通過、typecheck成功、production build成功を確認済み

## Phase 24.4d0監査から採用した設計

- **granularity**: consumable・weapon・armorともに`run_shared_by_item_definition`（監査のprovisional_recommendationをそのまま採用）
- **trigger**: consumableは使用成立時、weapon/armorは装備成立時
- Phase 20のカード基盤（`identifiedCardIds`/`isCardIdentified`/`markCardIdentified`）は一切変更せず、`item-identification.ts`という新規モジュールに同型のパターンを複製・拡張した

## 対象・対象外カテゴリ一覧

| カテゴリ | 種数 | 扱い |
|---|---|---|
| 通常consumable（カード以外） | 7 | 一般鑑定対象（apple/sun_fruit/chocolate/banana/antidote/panacea/clairvoyance_fruit） |
| one-time unlock pickup | 5 | 常に鑑定済み（sol_enchantment/flame/frost/cloud/earth_enchantment） |
| weapon | 27 | solar_gunを除く26種が一般鑑定対象、solar_gunは常に鑑定済み |
| armor | 15 | 全15種が一般鑑定対象（black_armor含む。現状生成経路なし、規則のみ適用） |
| card | 17 | Phase 20の既存契約を完全維持（本Phaseでは無変更） |

## consumableのgranularityとtrigger

- granularity: ItemId単位のrun共有set（`GameState.identifiedGeneralItemIds`）
- trigger: 各consumableの既存use成立処理（`applyAntidoteUse`/`applyPanaceaUse`/`applyClairvoyanceUse`/`applyBananaUse`/`applyChocolateUse`/apple heal分岐/sun_fruit solar分岐）が`consumed: true`を返した直後に`markGeneralItemIdentified`を呼び出す
- 使用不成立（HP満タン、毒でない状態での毒消し等）では鑑定・消費・ターン消費・RNG消費のいずれも発生しない（既存の失敗分岐をそのまま維持）

## equipmentのgranularityとtrigger

- granularity: WeaponId/ArmorId（definitionId）単位のrun共有set。同一definitionの複数個体は1回equipで全て鑑定済み表示になる
- trigger: `applyWeaponEquip`/`applyArmorEquip`の成立時（`weapon_equipped`/`armor_equipped`イベントpush直後）に`markGeneralItemIdentified`を呼び出す。curseRevealedの既存設定（`instance.cursed`なら`curseRevealed = true`）と同じ関数内に並置し、Phase 24.4d0監査の「同じ関数内に1行追加するだけで済む」という指摘どおりのテンプレートを利用した
- equip不成立（invalid_instance、cursed lock）では鑑定は発生しない
- 新規runは常にequippedWeaponId/equippedArmorIdがnullで始まるため、「run開始時点ですでに装備済み」のケースは現行コードでは到達しない（将来固定初期装備が追加された場合はequip成立と同じ関数を経由させることで自然に満たされる）

## always identified対象

- solar_gun（固有武器）
- sol_enchantment/flame_enchantment/frost_enchantment/cloud_enchantment/earth_enchantment（進行用取得物）
- いずれも`identifiedGeneralItemIds`へ格納せず、`isGeneralItemIdentified`が固定setメンバーシップで常にtrueを返す

## solar forge入出力の結果

- `getSolarForgeCandidates`/`getSolarForgeCandidatesWithLineage`（solar-forge.ts）の候補列挙フィルタへ`isGeneralItemIdentified`チェックを追加。未鑑定weaponは合成素材候補として一切成立しない
- `applySolarForge`（turn.ts）の成立時（`solar_forge_completed`イベントpush直後）に出力definitionを`markGeneralItemIdentified`で鑑定。B/A/S/Rいずれのrankでも同一規則
- 合成不成立では鑑定状態は変化しない（既存のvalidateForgeMaterialsWithLineage拒否パスに変更なし）

## 星変換の結果

- `star`カード自体の変換効果（`resolveCardTargetEffect`側の実適用）はdevelopment-plan.mdの既存記載どおり本Phase時点で未実装（先行するPhase 20.5aの担当）であり、変換成立時の出力鑑定ロジックは実装対象コードパスが存在しない
- 一方、Phase 24.4d0監査が発見した第2の表示漏洩箇所である`card-target-selection.ts`の`describeCardTargetCandidate`は本Phaseで修正した：inventory_item/equipment_instanceいずれの候補も`getDisplayedItemName`（共通resolver）を経由するようになり、未鑑定の通常品・装備の真名が星の対象一覧から漏れなくなった。加えて`refineLevel`は本体鑑定済みの場合にのみ表示する（未鑑定情報として扱う）よう変更した
- temperanceの`note`（「呪われている」）はcurseRevealed前提の既存事実表示のままで変更していない

## 本体鑑定とcurseRevealedの独立性

- `identifiedGeneralItemIds`（本体鑑定、GameState直下のrun共有set）と`EquipmentInstance.cursed`/`curseRevealed`（個体単位の既存フィールド）は別フィールド・別責務のまま。本Phaseでは一切結合していない
- 未鑑定の呪い装備を装備した場合：equip成立により本体鑑定（`markGeneralItemIdentified`）とcurseRevealed設定（既存処理）が同一関数内で並行して発生するが、互いのフィールドは独立して書き込まれる
- 解呪・鑑定のいずれも相手のフィールドを変更しない（コード上、両者を同時に書き換える処理は存在しない）

## seed別aliasを採用しなかったこと

- authoritative_decisions.unidentified_alias.use_seed_alias: falseの指示どおり、カテゴリ固定のgeneric表示（未鑑定の消耗品／未鑑定の武器／未鑑定の防具）のみを実装した。seed別色名・仮名・シャッフル表は追加していない

## 共通表示resolverと接続surface

新規モジュール`src/game/item-identification.ts`が単一の共通resolver（`getDisplayedItemName`）を提供し、以下のsurfaceが個別の未鑑定判定を複製せずこれを利用する形に接続した：

- `main.ts`の`displayedItemName`（inventory一覧・item detail双方が経由）
- `main.ts`のinventory一覧：equipment_instanceエントリのrank/refineLevel/curse markを本体未鑑定時は非表示化
- `main.ts`のitem detail：attackPower/reach（武器）、armorValue（防具）を本体未鑑定時は非表示化
- `card-target-selection.ts`の`describeCardTargetCandidate`（星・節制の対象候補表示）
- `message-log.ts`のformatEvent：pickup/pickup失敗/use失敗/place成功失敗/discard成功失敗/equip blocked/enemy dropの各イベントで、push時点（turn.ts、state参照可能）に事前解決した`displayName`フィールドをformatEventが優先的に読む、既存の`unidentifiedCard`パターンと同じアーキテクチャを踏襲
- `solar-forge.ts`の候補列挙2関数

## internal IDとplayer-visible表示の境界

- Inventory、GroundItem、EquipmentInstance.definitionId、event payloadのItemId/WeaponId/ArmorIdはすべて真値のまま変更していない
- telemetry/resultは本Phaseで一切変更しておらず、真IDを保持し続ける
- `getDisplayedItemName`は表示文字列を返すのみで、ゲームロジック上のIDを書き換えない

## state lifetime

- `GameState.identifiedGeneralItemIds?: ItemId[]`をtypes.tsへ追加（identifiedCardIdsと同じoptional-default-empty パターン、schemaVersion変更なし）
- `state.ts`のCarryOverStatsへ`identifiedGeneralItemIds`を追加し、`buildFloorState`のfloor間引き継ぎ・`advanceToNextFloor`の`normalizeIdentifiedGeneralItemIds`正規化を実装
- 新規run（`createInitialState`、carryなし）では自動的に空配列で初期化される（identifiedCardIdsと同一の分岐構造）
- gameover/victory後の次runへは持ち越されない（`createInitialState`は常にcarryなしでbuildFloorStateを呼ぶ）

## save schema変更なし

- save/load機構は現時点で存在しないため、schemaVersionは変更していない
- telemetryのschemaVersionはsave schemaとして扱っていない

## RNG消費なし

- `markGeneralItemIdentified`/`isGeneralItemIdentified`/`getDisplayedItemName`のいずれもRNGストリームを参照・消費しない（production sanityスクリプトで`combatRngState`不変を確認済み、focused testsにも同項目を含む）

## 変更ファイル一覧

新規:
- `src/game/item-identification.ts`
- `src/game/__tests__/phase-24-4d1-general-item-identification.test.ts`

変更:
- `src/game/types.ts`（`GameState.identifiedGeneralItemIds`追加）
- `src/game/state.ts`（CarryOverStats拡張、floor間引き継ぎ、normalize呼び出し）
- `src/game/events.ts`（`general_item_identified`イベント追加、9イベント型へ`displayName?`フィールド追加）
- `src/game/turn.ts`（consumable7種のuse成立・weapon/armor equip成立への鑑定接続、各種イベントpushへの`displayName`付与、solar forge出力鑑定接続）
- `src/game/message-log.ts`（formatEventの各caseで`event.displayName`優先読み込み、`general_item_identified`ケース追加）
- `src/game/card-target-selection.ts`（`describeCardTargetCandidate`の共通resolver接続、refineLevel隠蔽）
- `src/game/solar-forge.ts`（候補列挙2関数への未鑑定除外フィルタ追加）
- `src/main.ts`（`displayedItemName`のresolver委譲、inventory一覧・item detailの未鑑定時非表示）
- 既存テスト8ファイル（displayNameフィールド追加による期待値更新、鑑定済みフィクスチャ初期化追加）

## focused tests・full suite・typecheck・build・diff-check結果

- 新規focused tests: `phase-24-4d1-general-item-identification.test.ts` 41件、全通過
- full suite: 121ファイル・3066テスト全通過（既存3025件＋新規41件）
- typecheck: `npx tsc --noEmit` 成功（エラーなし）
- production build: `npx vite build` 成功（49 modules transformed）
- diff-check: `git status --short`でproduction/テストコードのみの変更を確認、dist等の生成物・一時ファイル・認証情報は含まれない

## production sanity結果

一時スクリプト（`tmp-sanity.ts`、確認後削除済み）で以下13項目を確認：

1. apple: 取得直後はgeneric表示、使用成立後は真名表示
2. sword: 取得直後はgeneric表示、equip成立後は真名表示
3. 同definitionの2個体が同時に鑑定済み表示になる
4. 呪い装備のequip成立で本体鑑定とcurseRevealedが独立して成立する
5. カードの未鑑定placeholder表示が変わっていない
6. floor移動後も鑑定状態が維持される
7. new runで一般アイテム鑑定状態が初期化される

全13アサーション通過。

## Phase 24.4eへ残す呪い付与経路・DP・rank接続

- 本Phaseは呪い付与率・付与経路の拡張を一切行っていない（out_of_scope明記どおり）
- DP・rank・refineLevelの数値ロジックは変更していない（表示の隠蔽のみ）
- black_armor/S/R装備は引き続き生成経路が存在しないため、鑑定規則（コード）のみ適用済みで実プレイでは到達しない
- 星カードの実変換効果（`resolveCardTargetEffect`側）はPhase 20.5aの担当として未着手のまま

## development-plan更新可否

repository内（`/mnt/project/target_repository`のclone先）に`rogue-of-sun-development-plan.md`という名前のファイルが存在しないことを確認した（`find`コマンドで確認、`docs/`配下にも存在せず）。projectナレッジ側にのみ`rogue-of-sun-development-plan_.md`（末尾アンダースコア）が存在するが、これはrepository外のprojectナレッジ添付資料であり、commit対象外（policyの「repository外のプロジェクトナレッジや添付資料はcommitしない」に該当）。よって本Phaseではdevelopment-plan.mdを更新していない。
