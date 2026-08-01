# Phase 11.2 所持品UI整合・置く・捨てる

## 目的

Phase 11.1で導入した所持上限20を前提に、Phase 08.2〜08.3で既に実装済みの所持品一覧・選択・使用・装備UIを再実装せず、以下の不足のみを追加した：現在所持数/上限20の表示、床へ「置く」操作、完全に「捨てる」操作（確認付き）、既存の使用・装備との整合。満腹度・食料効果変更・飢餓は対象外。

## 開始時のrepository、branch、HEAD、working tree

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`
- HEAD: `8969595d313a2f305a6ac3a21b6b69bd987ca94a`
- working tree: clean

## baseline検証結果

- `npx tsc --noEmit`: 成功
- `npx vitest run`: 49テストファイル・1018件 全成功
- `npx vite build`: 成功

## 実装前の所持品UIと操作

- `src/main.ts`の`createInventoryOverlay`/`refreshInventoryOverlay`/`handleInventoryKey`（Phase 08.2〜08.3実装済み）
- Tab：開閉、Escape：閉じる、↑↓：選択移動、Enter：使用/装備（`selectedInventoryAction`によるカテゴリ判定でuse_item/equip_weapon/equip_armorへディスパッチ）
- 常設HUD（`hudText`）に所持数表示は存在しない（フロア/HP/SOL/エンチャント/ターンのみ）

## 実装前の使用・装備・解除機能

- `applyItemUse`（apple heal、sun_fruit sol回復）、`applyWeaponEquip`、`applyArmorEquip`（`turn.ts`）
- いずれも成功時`state.inventoryOpen = false`でオーバーレイを閉じる
- `processTurn`冒頭の`inventoryOpen`guardは`use_item`/`equip_weapon`/`equip_armor`のみ通過を許可していた

## groundItemsの構造と配置制約

- `types.ts`の`GameState.groundItems`コメントに「a tile can hold at most one ground item by construction（placement excludes existing ground item tiles）」と明記
- 拾得処理（`turn.ts`）は`findIndex`で最初の一致のみ処理するため、同一座標への複数配置は構造上サポートされない
- 上記から、置く操作は現在地に既存groundItemがある場合を`ground_occupied`失敗として扱うことにした

## 容量表示

- 形式：`現在所持数 / 20`（`totalInventoryCount(state) / INVENTORY_CAPACITY`）
- 配置：既存の所持品オーバーレイ内、タイトル直下（常時HUDへは追加していない）
- 使用・置く・捨て成功後は同じ`refreshInventoryOverlay`呼び出し経路で即座に反映される

## 採用した入力方法（Claude判断・理由）

- `P`：選択中アイテムを即座に置く（確認なし。`place_action`に`confirmation_required`の指定がないため）
- `X`：選択中アイテムの「捨てる」確認を開始（削除は行わない）
- 確認中：`Y`で確定、`N`または`Escape`でキャンセル（削除なし、確認状態のみクリア）
- 理由：オーバーレイが開いている間、既存コード（`handleInventoryKey`）は Escape/ArrowUp/ArrowDown/Enter 以外の全キーを無視しており、通常プレイの移動キー（WASD/矢印/QEZC/X/Space/F）と衝突しない。既存キー割当（`input.ts`のactionForKey）はオーバーレイ内では到達しないため、`P`/`X`/`Y`/`N`はオーバーレイ専用キーとして安全に追加できると判断した
- `Tab`/`Escape`によるオーバーレイの開閉・トグルは、保留中の捨てる確認を必ずクリアするようにした（`toggleInventory`/`closeInventory`を変更）。これにより「所持品画面を閉じた場合は削除しない」を保証しつつ、次回オープン時に確認状態が残留しない

## 置く操作

- `PlayerAction`に`{ type: 'place_item'; itemId }`を追加し、`applyPlaceItem`（`turn.ts`）で処理
- 成功条件：所持数>0、装備中の最後の1個でない、現在地にgroundItemが存在しない
- 成功時：`inventory[itemId] -= 1`、`groundItems`へプレイヤー座標に1個追加（`nextGroundItemId`を使用し既存のweb.ts同様のカウンタ方式で決定的に採番）、`item_placed`イベント発行、1ターン消費
- 失敗時：`item_place_failed`（reason: `ground_occupied`/`equipped`/`item_unavailable`）、状態変更なし、0ターン
- オーバーレイは閉じない（use/equipと異なり、連続して置ける設計とした）

## 捨てる操作と確認

- `PlayerAction`に`{ type: 'discard_item'; itemId }`を追加し、`applyDiscardItem`（`turn.ts`）で処理
- UI側で`state.discardConfirmItemId`（optionalフィールド）に選択中itemIdをセットして確認表示を開始。ゲームロジック側の`discard_item`アクション自体はUIの確認を経ずに直接呼ばれても同じ可否判定を再検証する（stale selection対策の多重防御）
- 確認中はオーバーレイの他の操作（選択移動、Enter、P、再度X）を`handleInventoryKey`内で無視
- 確定（Y）：`inventory[itemId] -= 1`、`item_discarded`イベント発行、1ターン消費、groundItem生成なし
- キャンセル（N/Escape）：`discardConfirmItemId`のみクリア、inventory・ターン・乱数とも無変更
- 失敗（数量0、装備中の最後の1個）：`item_discard_failed`（reason: `equipped`/`item_unavailable`）、状態変更なし、0ターン

## 装備中アイテムの制約

- `isLastEquippedCopy(state, itemId)`：所持数がちょうど1かつ`equippedWeaponId`または`equippedArmorId`と一致する場合のみ禁止
- 所持数2以上なら装備中でも1個だけ置く・捨てる可能（現行の武器/防具は`stackable: false`のため実際には発生しないが、確定仕様どおり一般化して実装）
- 成功後も同じitemIdが1個以上残るケースでは装備状態は変更しない

## 成功・失敗・キャンセル時のターン消費

- 置く成功／捨てる確定成功：1ターン消費、敵・環境が既存の`processTurn`パイプライン（`resolveEnemiesAction`等）どおり進行
- 置く失敗／捨てる失敗／捨てるキャンセル／メニュー操作（選択移動・開閉・確認開始）：0ターン
- いずれも乱数（`combatRngState`等）を変更しない

## 選択位置の補正

- `clampSelectedItemIndex(state)`（`turn.ts`、`inventoryEntries`を再利用）を置く・捨て成功時に呼び出し、`selectedItemIndex`を新しいエントリ数の範囲内へクランプ
- 最後の1個が消えて選択中エントリが消滅した場合、直前のインデックスへ自動的に補正される（配列shiftにより次に近い項目が同じインデックスに来る）

## イベントとメッセージ

- `events.ts`に追加：`item_placed`、`item_place_failed`（reason: ground_occupied/equipped/item_unavailable）、`item_discarded`、`item_discard_failed`（reason: equipped/item_unavailable）
- `message-log.ts`に対応する日本語メッセージを追加（置いた／置けない理由別／捨てた／捨てられない理由別）
- 同一結果を複数イベントで重複記録しない（各分岐で1回のみpush）
- テレメトリschemaVersionは変更していない。既存の`recordTurn`/`finalizeRun`経路（Enter使用時と同じパターン）でP/Y確定操作を記録する

## 決定性と乱数

- 置く・捨てるのいずれも乱数呼び出しを行わない
- `groundItems`の新規id割当は`nextGroundItemId`の単調増加カウンタのみで決定的（`web.ts`のnextWebIdと同じ方式）
- マップ生成・敵配置・アイテム配置には一切関与しない

## 変更ファイル

- `src/game/types.ts`：`PlayerAction`へ`place_item`/`discard_item`追加、`GameState`へoptionalな`discardConfirmItemId`追加
- `src/game/events.ts`：`item_placed`/`item_place_failed`/`item_discarded`/`item_discard_failed`追加
- `src/game/message-log.ts`：対応する日本語メッセージ追加
- `src/game/inventory.ts`：`selectedItemId`追加、`toggleInventory`/`closeInventory`で`discardConfirmItemId`をクリアするよう変更
- `src/game/turn.ts`：`applyPlaceItem`/`applyDiscardItem`/`isLastEquippedCopy`/`clampSelectedItemIndex`を追加し、`applyPlayerAction`のディスパッチと`processTurn`のinventoryOpen guard例外リストへ組み込み
- `src/main.ts`：容量表示・置く/捨てる操作・捨てる確認UIを`refreshInventoryOverlay`/`handleInventoryKey`へ追加
- `src/game/__tests__/inventory-actions.test.ts`：新規テストファイル

## 追加・更新テスト

`inventory-actions.test.ts`に46件追加：

- 容量表示ヘルパー（6件）
- 置く成功（8件）：数量減少、最後の1個、groundItem生成、自動再取得なし、1ターン消費、敵進行、乱数不変、イベント1回、weapon2個所持時の装備維持
- 置く失敗（6件）：ground_occupied、装備中最後の1個（weapon/armor）、存在しない、0ターン、乱数不変
- 捨てる成功・確認（7件）：確定前不変、適用後1減、groundItem非生成、1ターン、敵進行、乱数不変、イベント1回
- 捨てる失敗・キャンセル（6件）：確認保留中不変、キャンセルでターン不消費、装備中最後の1個禁止、2個以上なら可、存在しないアイテム禁止、乱数不変、オーバーレイクローズで確認状態クリア
- 選択位置補正（4件）
- ライフサイクル（3件）：容量解放、フロア移動での維持、新規ランでの確認状態なし
- 回帰（4件）：use_item・equip_weapon・通常移動拒否・place/discardのguard例外

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：50テストファイル・1064件（既存1018件 + 新規46件）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 既存の使用・装備機能を再実装していないこと

`applyItemUse`/`applyWeaponEquip`/`applyArmorEquip`、`selectedInventoryAction`、`useSelectedInventoryItem`、オーバーレイの選択・開閉ロジックはいずれも変更していない（`refreshInventoryOverlay`は表示行を追加しただけ、`handleInventoryKey`は既存のEscape/ArrowUp/ArrowDown/Enter分岐をそのまま残し新規分岐のみ追加）。

## 容量上限20を変更していないこと

`INVENTORY_CAPACITY`はPhase 11.1のまま。GameStateへ重複した容量値フィールドは追加していない。

## テレメトリschemaVersionを変更していないこと

schemaVersion 3のまま。既存の`recordTurn`/`finalizeRun`呼び出しパターンを踏襲し、新規schemaは追加していない。

## Phase 11.3以降を開始していないこと

満腹度、ターン経過による空腹、飢餓ダメージ、食料アイテム効果変更は実装していない。

## Claudeが判断したUI実装詳細と理由

- キー割当（P/X/Y/N）：既存キーとの非衝突を確認した上で決定（詳細は上記「採用した入力方法」参照）
- 容量表示の位置：オーバーレイタイトル直下（既存レイアウトへの最小差分）
- 満杯時の強調装飾：追加していない（`20 / 20`という数値表示自体で満杯と判別可能なため、既存UIの色・装飾規則を変更する必要はないと判断）
- 置く成功後にオーバーレイを閉じない：連続して複数アイテムを置ける操作性を優先し、use/equipの「成功時に閉じる」規則とは意図的に区別した

## 未確認事項

- `rogue-of-sun-development-plan.md`は引き続きリポジトリ管理外であり、Phase 11.3（満腹度）着手時に別途仕様確認が必要
- マウス操作によるP/X/Y/N相当の操作は追加していない（既存UIもキーボードのみでの操作であり、範囲外と判断した）
