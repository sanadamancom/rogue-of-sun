# Phase 24.0: 装備基盤の実装前監査とPhase 24.1仕様確定

## 起点commit・branch・precheck

- base branch: `origin/phase-23-7-final-run-structure`
- base commit: `272a5c81a954b0b5586aa7a252e9ae89fda53411`（一致確認済み）
- `origin/main`: `80596cd5334294255a439cb79db375f622193c50`（一致確認済み、未変更）
- precheck結果：
  - `git fetch origin` 実行済み
  - `origin/phase-23-7-final-run-structure` が指定commitと一致
  - `origin/main` が指定commitと一致（未変更）
  - working tree clean（precheck時点、作業終了時点とも）
  - `phase-24-0-equipment-readiness-audit` のlocal/remote branchは開始前に存在せず
  - 指定base commitから同名branchを新規作成
- 本Phaseはdesign-and-audit-onlyであり、production/testコードは一切変更していない。

## 確認した正式ロードマップとPhase 24の順序

Phase 24公式目的：「装備・太陽鍛冶・報酬・追加アイテム」。

敵Lv2/Lv3、敵ロスター追加、4F以降拡張、boss追加はPhase 24へ混在させない（Phase 23.7で将来工程へ延期済み）。

公式順序（今回はPhase 24.0のみ実施）：

| Phase | 範囲 |
|---|---|
| 24.0 | 今回。現行装備基盤の監査と24.1仕様確定 |
| 24.1 | 装備枠、個体単位の装備交換、床配置・取得・置く・捨てるの整合 |
| 24.2 | 同武器種・同ランク2個を基本とする太陽鍛冶 |
| 24.3 | 選定済み近接武器27種＋太陽銃、防具15種、個別性能と報酬テーブル |
| 24.4 | 通常戦利品、一般アイテムの未鑑定、呪い・解呪、カード床供給との接続 |
| 24.5 | アクセサリー1枠と採用品 |
| 24.6 | 出現率、R到達率、所持枠への影響調整 |
| 24.7 | 黒の鎧専用封印部屋、番人、撃破時確定報酬 |

## Phase 23.7時点の実装済み装備基盤

監査対象ファイルと責務：

- `src/game/types.ts`：`EquipmentInstance`型（`instanceId`/`definitionId`/`refineLevel`/`cursed`/`curseRevealed`）、`GameState`の`equipmentInstances`/`nextEquipmentInstanceId`/`equippedWeaponId`/`equippedWeaponInstanceId`/`equippedArmorId`/`equippedArmorInstanceId`、`Inventory`（`Record<ItemId, number>`種別単位カウント）、`GroundItem.equipmentInstanceId`、`PlayerAction`の`equip_weapon`/`equip_armor`/`place_item`/`discard_item`（全て**種別ID単位**のペイロードで、instanceIdを持たない）。
- `src/game/equipment-instance.ts`：個体の生成（`mintEquipmentInstance`/`createEquipmentInstance`）、正規化（`normalizeEquipmentInstances`）、呪いロック判定（`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`）、装備用個体解決（`ensureAvailableInstanceForEquip`→`findUnequippedInstance`）、place/discard用個体解決（`findUnequippedInstanceId`/`removeUnequippedInstance`）、保持個体一覧（`getHeldEquipmentInstances`）。
- `src/game/inventory.ts`：`inventoryEntries`（ItemId単位、count>0のみ、1 itemId=1エントリ）、選択インデックス操作、`selectedInventoryAction`/`selectedItemId`（**個体を区別しない**、選択対象は常にItemId）。
- `src/game/turn.ts`：`applyWeaponEquip`/`applyArmorEquip`/`applyPlaceItem`/`applyDiscardItem`（全てitemId/weaponId/armorId引数で動作し、`ensureAvailableInstanceForEquip`等の内部関数が「未装備個体を1つ選ぶ」処理を隠蔽）、`isLastEquippedCopy`（最後の1個かつ装備中の場合のみplace/discardを拒否）。
- `src/game/state.ts`：`buildFloorState`が新フロアの床アイテム生成時に`mintEquipmentInstance`で個体と呪い抽選（独立RNGではなく既存の床アイテム生成ロジック内、要精査対象）を実施、`advanceToNextFloor`系のcarry-over処理が`equipmentInstances`/`nextEquipmentInstanceId`/`equippedWeaponInstanceId`/`equippedArmorInstanceId`をフロア間で複製・引き継ぎ。
- `src/game/card-target-selection.ts`：`CardTargetRef = { kind: 'equipment_instance', instanceId }` という**個体単位で対象を参照する既存パターン**が確立済み（Temperance/Star用）。`isCardTargetStillValid`で選択後の再検証を行う。これはPhase 24.1のD1/D2が模範にすべき先行実装。
- `src/game/weapon-def.ts`/`armor-def.ts`：種別単位の性能定義（sword/spear/hammer/solar_gun、armor）。個体属性とは無関係。
- `src/game/events.ts`/`message-log.ts`：`weapon_equipped`/`armor_equipped`/`weapon_equip_blocked`/`armor_equip_blocked`/`item_placed`/`item_place_failed`/`item_discarded`/`item_discard_failed`等のイベント型とログ文言。現状これらのイベントは種別IDのみを運び、instanceIdを含まない。
- `src/main.ts`：UI層。インベントリ表示・選択・確定操作は`inventory.ts`の関数を経由するため、個体選択UIは現状存在しない。

## 現行データフロー図・責務表

```
[床生成: state.ts buildFloorState]
  → mintEquipmentInstance(cursed roll) → EquipmentInstance
  → GroundItem.equipmentInstanceId で床アイテムに個体を紐付け

[拾う: turn.ts pickup処理]
  → inventory[itemId] += 1（種別カウントのみ増加）
  → GroundItem.equipmentInstanceId を持つ個体はそのまま equipmentInstances に残存（既に存在）

[UI選択: inventory.ts inventoryEntries]
  → ItemId単位で1エントリ（個体を区別しない・選択不可）

[装備: turn.ts applyWeaponEquip/applyArmorEquip]
  → ensureAvailableInstanceForEquip(definitionId, 現装備instanceId)
  → 内部で「現装備でない最初の個体」を機械的に選択 ← 既知バグの発生源
  → state.equippedXxxId / equippedXxxInstanceId を更新

[置く: turn.ts applyPlaceItem]
  → inventory[itemId] -= 1
  → findUnequippedInstanceId で「未装備の最初の個体」を選び GroundItem に紐付け ← 同じ選択方式

[捨てる: turn.ts applyDiscardItem]
  → inventory[itemId] -= 1
  → removeUnequippedInstance で「未装備の最初の個体」を equipmentInstances から削除 ← 同じ選択方式

[フロア遷移: state.ts advanceToNextFloor]
  → equipmentInstances/nextEquipmentInstanceId/equippedXxxInstanceId を複製carry-over
```

責務境界：
- `equipment-instance.ts`：個体の生成・正規化・検索のみ（productionロジックを持たない・純粋関数中心）
- `turn.ts`：actionディスパッチと状態遷移の適用（個体**選択**は`equipment-instance.ts`のヘルパーへ委譲）
- `inventory.ts`：UI選択状態（`selectedItemIndex`）とItemId単位の表示のみ（個体選択状態を持たない）
- `card-target-selection.ts`：個体単位の選択・検証パターンを既に確立（Temperance/Starのみ対象）

## 既知の同種複数装備バグの原因

`equipment-instance.ts`の`findUnequippedInstance`（および`findUnequippedInstanceId`/`removeUnequippedInstance`）は、`definitionId`が一致し現装備instanceIdでない**最初に見つかった個体**を機械的に返す。

これにより：
- 同一`definitionId`の個体を2つ以上所持していても、UI（`inventoryEntries`）はItemId単位で1エントリしか表示せず、プレイヤーはどちらの個体を対象にするか選べない。
- 装備・交換・place・discardの全操作が「配列内で最初に見つかった未装備個体」を暗黙に選ぶため、プレイヤーの意図と異なる個体が操作される可能性がある。
- 特定個体（例えばrefineLevelが異なる個体、または呪い未判明個体）を選んで装備・交換・破棄することが構造的に不可能。

根本原因は「UI選択粒度（ItemId単位）」と「内部データ粒度（EquipmentInstance単位）」の不一致であり、`findUnequippedInstance`系のロジック自体の誤りではなく、**その場しのぎの先頭個体選択に頼らざるを得ないUI/action層の設計不足**が真因。

## Phase 24.1へ入れる変更

- D1〜D6の決定に基づき、以下をPhase 24.1の実装対象として確定する：
  1. 武器・防具について、`inventoryEntries`に相当する表示を「種別スタック表示」から「個体単位で選択可能な表示」へ拡張する（消耗品は既存のItemIdスタック表示を維持）。
  2. `PlayerAction`の`equip_weapon`/`equip_armor`/`place_item`/`discard_item`を、`card-target-selection.ts`の`CardTargetRef`パターンに倣い、対象個体を明示的な`instanceId`（武器・防具の場合）で受け取れるよう拡張する。既存の種別ID単位ペイロードとの後方互換は維持しつつ、個体指定がある場合はそれを優先する。
  3. `findUnequippedInstance`系の「先頭個体を機械的に選ぶ」ロジックを、明示的instanceId指定がない場合のみのフォールバックとして限定し、UI側が通常は明示的instanceIdを渡す経路を新設する。
  4. 装備・交換・解除・置く・捨てるの状態遷移表（後述）に基づき、判明済み呪い個体・未判明呪い個体・同一定義複数個体を区別したガード条件をturn.tsへ追加する。
  5. `EquipmentInstance`へrankとDP系フィールドを追加するかどうかはD4の結論に従い、データ基盤（型定義・normalize規則）のみ追加するかを判断する（下記rank・DP節を参照）。

## Phase 24.1へ入れない変更

- 太陽鍛冶（同種同ランク合成、S+S→R固有）の実装：Phase 24.2。
- 27武器・15防具の追加定義・名称確定：Phase 24.3。
- 一般アイテムの未鑑定システム、敵通常ドロップとの接続、カード床供給拡張：Phase 24.4。
- アクセサリー枠の追加：Phase 24.5。
- 出現率・weight・R到達率・所持枠影響の調整：Phase 24.6。
- 黒の鎧専用封印部屋・番人・確定報酬：Phase 24.7。
- 敵Lv2/Lv3、敵ロスター追加、4F以降拡張、boss追加：Phase 24範囲外（将来Phase）。
- rank/DPの戦闘計算への接続（数値効果自体）：D4の結論により後続へ送る（下記参照）。

## 装備・交換・解除の状態遷移表

| 現在の状態 | 選択対象 | 結果 | ターン消費 | RNG消費 | inventoryOpen |
|---|---|---|---|---|---|
| 未装備（該当スロット空） | 所持個体A | Aを装備、`equippedXxxInstanceId=A` | 消費 | なし | close |
| 装備中Aと同一個体Aを再選択 | 個体A（装備中） | no-op（`weapon/armor_already_equipped`相当） | 不消費 | なし | 維持（open） |
| 装備中Aと同一definitionの別個体B | 個体B | Aが呪いロックでなければB装備、AはequipmentInstancesに残存（未装備） | 消費 | なし | close |
| 装備中Aと別definitionのC | 個体C | Aが呪いロックでなければC装備、AはequipmentInstancesに残存 | 消費 | なし | close |
| 装備中Aが判明済み呪い | 別個体/別定義への交換操作 | 拒否（`weapon/armor_equip_blocked reason:'cursed'`） | 不消費 | なし | 維持 |
| 未判明呪い個体Xを新規装備 | 個体X | 装備成功、`curseRevealed=true`に変化（発見イベント） | 消費 | なし（curseは床生成時に既に確定済み） | close |
| 明示的「解除」操作 | なし（既存仕様に unequip actionなし） | Phase 24.1でも「装備解除専用action」は追加しない方針を維持するか要決定（未確定事項参照） | - | - | - |

## 取得・置く・捨てる・フロア遷移時のidentity契約

- **拾う**：床の`GroundItem.equipmentInstanceId`が指す個体をそのまま`inventory[itemId] += 1`の対象として引き継ぐ。新規個体は生成しない。
- **置く**：プレイヤーが選択した個体の`instanceId`のみを対象とする。装備中個体は`isLastEquippedCopy`相当のガードにより「最後の1個かつ装備中」の場合は拒否。複数所持時は非装備個体の中から明示的に選ばれた個体を床へ移し、`GroundItem.equipmentInstanceId`に同一IDを設定する。複製・再抽選は行わない。
- **捨てる**：選択された個体の`instanceId`のみを`equipmentInstances`から削除する。装備中個体・呪いロック中個体は同様に拒否。他の同一definition個体には影響しない。
- **フロア遷移**：`equipmentInstances`配列全体・`nextEquipmentInstanceId`・`equippedWeaponInstanceId`・`equippedArmorInstanceId`を複製してcarry-overする（既存実装済み・変更不要）。個体のinstanceId・refineLevel・cursed・curseRevealedはフロアを跨いでも維持される。
- **所持上限との関係**：`INVENTORY_CAPACITY`（総数20）は`inventory`の値の合計で判定されており、個体単位の選択粒度を導入してもこのカウント方式自体は変更しない。

## rank・DP・normalize・互換性方針

- 正式計画では`EquipmentInstance`へ装備ランク（C/B/A/S/R）とDP系フィールドを追加する予定だが、DPの効果・増減規則は本ドキュメント時点で未確定。
- D4の判断：**Phase 24.1ではデータ基盤（型フィールドの追加・初期値・normalize規則・carry-over規則）のみを追加し、戦闘計算への接続は行わない**方針を提案する。理由：
  - 27武器・15防具の個別性能（Phase 24.3）が未確定な段階でDP効果を戦闘へ接続すると、Phase 24.3で再設計が必要になり手戻りが大きい。
  - `refineLevel`が既に「値は保持するが効果は未接続」という前例（Phase 20.0c時点）を持っており、同じ段階的導入パターンをrank/DPにも適用できる。
  - ただし、rank/DPフィールド追加自体をPhase 24.1に含めるか、24.3（性能確定と同時）に含めるかはproducer判断が必要（未確定事項参照）。

## RNGストリームとseed再現性への影響

- Phase 24.1で追加予定のUI/action層の個体選択拡張は、いずれもRNGを消費しない（既存の`findUnequployedInstance`系と同様、配列検索のみ）。
- 呪い抽選は既存通り床生成時（`state.ts buildFloorState`）にのみ発生し、Phase 24.1では変更しない。
- rank/DPフィールドをデータ基盤のみ追加する場合も、初期値は固定値（例：rank='C', dp=0等の具体値は未確定）とし、RNGストリームを新設しない。
- 上記の結果、同一seedからの再現性はPhase 24.1で変更されない見込み。

## 想定変更ファイル一覧（Phase 24.1実装時の見込み、今回は変更なし）

- `src/game/types.ts`（`PlayerAction`のequip/place/discardへinstanceId追加、EquipmentInstanceへrank/DPフィールド追加検討）
- `src/game/equipment-instance.ts`（明示的instanceId指定に対応する関数追加、normalize拡張）
- `src/game/inventory.ts`（個体単位表示のためのエントリ構造拡張）
- `src/game/turn.ts`（applyWeaponEquip/applyArmorEquip/applyPlaceItem/applyDiscardItemの拡張）
- `src/main.ts`（個体選択UI）
- `src/game/events.ts`/`message-log.ts`（instanceIdを含むイベント拡張が必要な場合）
- 対応するテストファイル群（下記テストマトリクス参照）

## テスト先行実装のテストマトリクス

以下をPhase 24.1のテスト先行実装で満たすべき項目として確定する：

1. 同一定義の装備を2個以上保持し個別選択できる
2. 同一定義の別個体へ交換できる
3. 装備中個体を明示的に識別できる
4. 正常な装備解除（既存の「別武器へ装備＝実質的な入れ替え」方式を維持するか、専用unequipを追加するかは未確定事項）
5. 判明済み呪い装備の解除・交換拒否
6. 未判明呪い装備を装備するとcurseRevealedになる
7. 置いた装備のinstanceIdが床上でも維持される
8. 再取得後もinstanceIdと個体属性が維持される
9. 捨てた個体だけが削除される（同一definitionの他個体は影響を受けない）
10. 装備中個体を置く・捨てる場合の確定契約（既存のisLastEquippedCopy相当ガードの個体単位拡張）
11. 所持上限と装備個体数の整合
12. フロア遷移後の個体・装備状態維持
13. 新規runとretryでの初期化（equipmentInstances=[]、nextEquipmentInstanceId=0からの開始）
14. 古いfixture/stateのnormalize（instanceId未指定のPlayerActionが来た場合の後方互換動作を含む）
15. 成功・失敗時のターン消費
16. 成功・失敗時のRNG非消費
17. Moon/Sun/Temperanceの既存動作維持（`card-target-selection.ts`のCardTargetRefパターンとの整合）
18. 太陽銃・スピア・ハンマー固有挙動の維持

## Phase 24.1の完了条件

- 上記テストマトリクス全項目がテスト先行実装で網羅されている
- 同種複数装備の個体選択・解除バグが解消されている
- rank/DPフィールドの導入範囲（データ基盤のみか、24.1で含めるか）がproducer判断により確定している
- 既存2757テスト全通過を維持したうえで新規テストが追加されている
- tsc clean、vite build成功
- 敵Lv2/Lv3、4F拡張等Phase 24範囲外の変更が含まれていない

## 24.2以降への依存関係

- 24.2（太陽鍛冶）はPhase 24.1で確定する個体選択UI・instanceId参照パターンに依存する（合成対象2個の個体選択が必要）。
- 24.3（27武器・15防具）はPhase 24.1のrank/DPデータ基盤方針に依存する（フィールドが24.1で追加されていない場合、24.3側で追加する必要がある）。
- 24.4（一般アイテム未鑑定・敵ドロップ・カード床供給）はPhase 24.1のground item identity契約（instanceId維持ルール）をそのまま再利用する想定。
- 24.7（黒の鎧専用部屋）は27武器・15防具確定後の個別アイテムであり、24.1の個体管理基盤に依存する。

## 未確定事項とproducer判断が必要な項目

1. **専用「装備解除」actionを追加するか**：現行仕様には解除専用actionがなく、別武器への装備が実質的な入れ替えとして機能している。Phase 24.1で「素手/防具なし」へ戻す専用操作を追加するかは要判断。
2. **rank/DPフィールドをPhase 24.1で追加するか、24.3まで待つか**：本監査ではデータ基盤のみ24.1に含める案を提案したが、確定はproducer判断に委ねる。
3. **PlayerActionのinstanceId拡張方法**：既存の`{ type: 'equip_weapon'; weaponId }`へoptionalな`instanceId`を追加する案と、`card-target-selection.ts`の`CardTargetRef`を再利用・拡張する案の2通りが考えられる。どちらを採用するかは24.1着手時に詳細設計が必要。
4. **床生成時の呪い抽選が独立RNGストリームかどうか**：本監査では`state.ts`の`buildFloorState`内で実施されることのみ確認し、既存の他の床アイテム生成RNGと共有ストリームかどうかまでは今回精査していない（Phase 24.1着手時に再確認が必要）。
5. **UIの個体表示形式**：同一definitionの複数個体をどうリスト表示するか（refineLevel/呪い判明状況を含めた表示文言）は今回のドキュメントでは決定していない。

## 指示逸脱の有無

なし。指定されたprecheck・監査対象・禁止事項をすべて遵守し、production/testコードの変更は行っていない。

## テストを再実行しなかった理由

本Phaseはdocs/history配下の新規文書追加のみであり、production/testコードへの変更が0件のため、`npx vitest run`・`npx tsc --noEmit`・`npx vite build`の再実行は行わない。変更ファイルが本文書のみであることは`git status`/`git diff --check`で確認する。
