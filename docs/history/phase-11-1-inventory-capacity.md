# Phase 11.1 所持上限と満杯時の取得処理

## 目的

Phase 11「満腹度・所持品」の最初の分割として、プレイヤーの所持品に上限を導入し、所持品が満杯のときに床アイテムを取得できない処理を実装する。所持品一覧UI、選択、使用、置く、捨てる、満腹度、食料、飢餓は本タスクの対象外。

## 開始時のrepository、branch、HEAD、working tree

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`
- HEAD: `3824a3dbc1c20f3d0bd05f28c0f6646685ecdede`
- working tree: clean

## baseline検証結果

- `npx tsc --noEmit`: 成功
- `npx vitest run`: 48テストファイル・996件 全成功
- `npx vite build`: 成功

## Phase 11計画書から確認した仕様

`rogue-of-sun-development-plan.md`はリポジトリ内にもgit履歴にも存在しないため、計画書としては参照できなかった。事前調査の停止報告を受け、ユーザーから`phase_11_1_specification_decision`として以下が明示的に確定された：

- 所持上限：20
- 数え方：`GameState.inventory`内の全アイテム数量の合計（`Object.values(state.inventory)`の合計）
- スロット方式ではなく、現行`Record<ItemId, number>`構造を維持したまま合計20個制
- 上限対象：apple, sun_fruit, sword, armor, spear, hammer, solar_gun（および今後`inventory`へ格納される通常アイテム）
- 上限対象外：`sol_enchantment`（および今後、`inventory`を経由せずGameState上の専用フラグ・専用状態として管理されるもの）
- weapon/armorが装備中であっても、`inventory`内に数量が残る現行構造である限り1個として数える（装備状態と`inventory`の二重計上は行わない）
- 鍵アイテムは現行実装に存在しないため、専用例外は実装しない

`rogue-of-sun-development-plan.md`は今回アップロードされた版を参照したが、以後の参照・更新対象からは除外する（`correction_to_original_task`）。

## 実装前の所持品・床アイテム構造

- `GameState.inventory: Record<ItemId, number>`：全アイテムIDに対するスタック数のみを保持。スロット概念なし
- 拾得処理：`turn.ts`の移動処理内（旧407-421行付近）。`state.groundItems`から一致座標のアイテムを検索し、`sol_enchantment`以外は無条件で`state.inventory[item.itemId]++`
- `sol_enchantment`は`inventory`を経由せず`state.solUnlocked`を直接立てる特殊アイテム（Phase 10.1から既存）
- 登録アイテム：apple, sword, armor, spear, hammer, sun_fruit, solar_gun（`item-def.ts`）
- Phase 11.2相当の所持品一覧・選択・使用・装備UI（`inventory.ts`のtoggleInventory/inventoryEntries/moveInventorySelection/useSelectedInventoryItem等）は、Phase 08.2〜08.3時点で既に実装済みであることを確認した。今回はこれを新設・再実装せず、容量導入によって必要になる整合確認のみ行った（HUDに常設の所持数表示は存在せず、新規画面追加は行っていない）

## 採用した所持上限と数え方

- `INVENTORY_CAPACITY = 20`（`inventory.ts`に名前付き定数として定義）
- `totalInventoryCount(state)`：`state.inventory`の全値を合計する純粋関数
- `hasInventoryCapacity(state)`：合計が`INVENTORY_CAPACITY`未満かを判定する純粋関数

## 上限対象・対象外のアイテム区分

- 対象：apple, sword, armor, spear, hammer, sun_fruit, solar_gun
- 対象外：sol_enchantment（`turn.ts`の`sol_enchantment`分岐は従来どおり容量判定を経由しない）

## 取得成功時の処理

- 空きがある場合の挙動は従来を維持：床アイテムを`groundItems`から除去し、`state.inventory[itemId]`を1加算し、`item_picked_up`イベントを1回発行する

## 満杯時の処理

- `hasInventoryCapacity(state)`が`false`の場合、床アイテムを`groundItems`から除去せずそのまま残す（一度splice除去してから同じ位置・同じ内容で再挿入する形で実装し、id・種類・位置・状態を変更しない）
- `state.inventory`は変更しない
- `item_picked_up`は発生させず、代わりに`item_pickup_failed`イベント（`reason: 'inventory_full'`）を発行する
- `message-log.ts`に対応する日本語メッセージ「荷物がいっぱいで、〇〇をひろえない。」を追加し、既存のメッセージログ経路で通知する
- 乱数は使用しない

## ターン消費規則

- 満杯時も、通常の移動そのものは成立し1ターン消費する（拾得判定はその移動処理内の既存分岐に追加しただけで、拾得失敗を理由に移動を巻き戻したり追加ターンを消費させたりしない）
- 同じマスに留まり続けても毎ターン自動的に取得を再試行する仕様は追加していない（`wait`では拾得処理自体が呼ばれない既存の行動規則を維持）

## 状態ライフサイクル

- フロア移動時の所持品維持は既存の`advanceToNextFloor`のままで変更していない
- 新規ラン・同一seed再開・死亡後再挑戦の既存初期化規則（`createEmptyInventory`使用）は変更していない
- 容量の二重管理（ラン状態とフロア状態の分離管理）は行っていない。`GameState`へ可変の`capacity`フィールドは追加せず、定数のみで判定する

## 変更ファイル

- `src/game/inventory.ts`：`INVENTORY_CAPACITY`定数、`totalInventoryCount`、`hasInventoryCapacity`を追加
- `src/game/turn.ts`：移動時の拾得処理に容量判定を追加し、`hasInventoryCapacity`をimport
- `src/game/events.ts`：`item_pickup_failed`イベント型を追加
- `src/game/message-log.ts`：`item_pickup_failed`の日本語フォーマッタを追加
- `src/game/__tests__/inventory-capacity.test.ts`：新規テストファイル

## 追加・更新テスト

`inventory-capacity.test.ts`に22件追加：

- 容量定数・合計計算（3件）
- 境界条件：19→20は成功、ちょうど20で成功、20到達後は拒否、繰り返し試行しても超過しない、20超過状態でも防御的に拒否（5件）
- 満杯時の挙動：床アイテム残留、所持品不変、`item_picked_up`不発行、`item_pickup_failed`発行、他の床アイテム非影響、ターン消費が通常どおり1、追加ターン非消費、同一マス滞在での自動取得なし（8件）
- `sol_enchantment`の容量対象外確認（2件）
- ライフサイクル：フロア移動での維持、新規ラン初期化（2件）
- 回帰：容量未満での通常取得、アイテムなしマスでの非影響（2件）

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：49テストファイル・1018件（既存996件 + 新規22件、内訳は上記）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 乱数呼び出し順を変更していないこと

容量判定・満杯通知のいずれも乱数を使用しておらず、既存の乱数呼び出し箇所・順序に変更はない。

## バランス数値を変更していないこと

武器・防具・敵・アイテムの数値、HP自然回復、SOL関連数値は変更していない。

## Phase 11.2以降を開始していないこと

所持品一覧・選択・使用・装備UIは既存のPhase 08.2〜08.3実装をそのまま利用し、新設・再実装していない。置く・捨てる、満腹度、食料、飢餓は実装していない。

## 未確認事項

- `rogue-of-sun-development-plan.md`は正式にはリポジトリ管理外のドキュメントであり、今回参照した内容が今後変更される可能性がある
- 所持上限20が今後のアイテム種別追加やバランス調整時にも妥当かは、Phase 11.1の範囲では未検証
