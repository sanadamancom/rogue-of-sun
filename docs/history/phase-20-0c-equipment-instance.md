# Phase 20.0c 装備個体基盤

## 実施内容

武器・防具を個体単位で管理する基盤を実装した。同一定義（sword等）の複数所持でも個体を区別し、装備・所持・フロア遷移を通じて個体属性を維持できる構造にした。

この単位ではTemperance・Star・Moon・Sunのカード効果は実装していない。将来これらとPhase 24の装備拡張から共通利用できる基盤としてのみ実装した。

## データ構造

- `EquipmentInstance { instanceId, definitionId, refineLevel, cursed, curseRevealed }`（`types.ts`）。`instanceId`（個体ID）と`definitionId`（種別ID、`WeaponId | ArmorId`）を明確に分離した。
- `GameState.equipmentInstances?: EquipmentInstance[]`、`nextEquipmentInstanceId?: number`（連番カウンタ、RNG不使用）。
- `GameState.equippedWeaponInstanceId?` / `equippedArmorInstanceId?`：装備中の個体を種別IDとは別に追跡。
- `GroundItem.equipmentInstanceId?`：床上の武器・防具個体を追跡し、pickup時に同一個体として引き継ぐ。

## inventoryと装備中個体の管理方法

`Inventory`（種別ごとの個数）は変更せず維持。個体は`state.equipmentInstances`配列で並行管理する。`getHeldEquipmentInstances`（`equipment-instance.ts`）が、`inventory`の種別ごとの個数を上限として装備中個体を優先的に含め、`inventory`数を超える孤立個体を除外する。

## seed決定的な呪い付与

`state.ts`の`buildFloorState`内、床アイテム配置ループで武器・防具個体を生成する時点（取得時ではなく床生成時点）で、専用RNGストリーム`createRng(floorSeed ^ 0xc7d4a19e)`を1個体につき1回消費し、`FLOOR_EQUIPMENT_CURSE_CHANCE = 0.1`（10%、仮値）未満なら`cursed=true`とする。既存のitem種別抽選・配置座標抽選ストリームとは独立しており、これらの消費順・回数に影響を与えない。

## 装備時の呪い判明

`applyWeaponEquip`/`applyArmorEquip`（`turn.ts`）が、装備した個体の`cursed`が`true`の場合に限り`curseRevealed`を`true`に設定する。`cursed`自体はこの時点で変更しない。

## 判明済み呪い装備の解除・交換制限

`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`が`cursed && curseRevealed`を判定。装備中個体がこの条件を満たす場合、別の武器・防具への持ち替え（このゲームには専用の「装備解除」アクションがなく、持ち替えが唯一の変更経路）を`weapon_equip_blocked`/`armor_equip_blocked`イベントで拒否する。拒否時はInventory・装備状態・ターンを変更しない。

## 既存save補完とschemaVersion 7維持の根拠

このリポジトリには永続save/load機構（JSON/localStorage等）が存在せず、実際の状態継続経路は`advanceToNextFloor`のフロア間carry-overのみである。`identifiedCardIds`と同じadditive-defaultパターンで`equipmentInstances`/`nextEquipmentInstanceId`/`equippedWeaponInstanceId`/`equippedArmorInstanceId`をcarry-overし、欠落時は空配列・0・nullで補完する。`normalizeEquipmentInstances`が不正なrefineLevel（負数・非整数・上限超過）、不正型のcurse fieldを正規化する。フィールド追加のみで既存フィールドの意味変更を伴わないため、schemaVersionは7のまま維持した。

## 強化上限（仮値）

`EQUIPMENT_REFINE_LEVEL_CAP = 3`。Moon/Sunが将来再利用できる`isValidRefineLevel`関数で共通判定を提供。Phase 27で最終調整予定。

## 62件の専用テスト結果

`phase-20-0c-equipment-instance.test.ts`：new_equipment_instance、equipment_persistence、curse_behavior、normalization、regression、refine_cap、curse_generation、ground_identity、exclusionsの各カテゴリ、計62件、全通過。

## 検証結果

- Phase 20.0c専用62件：全通過
- 全通常テストスイート（88ファイル、2184件）：全通過
- `npx tsc --noEmit`：成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 対象外

DP、最大DP、装備破損、太陽鍛冶、報酬システム、全アイテム共通の未鑑定・封印拡張（いずれもPhase 24）。Temperance・Star・Moon・Sunのカード効果実装（Phase 20.5）。
