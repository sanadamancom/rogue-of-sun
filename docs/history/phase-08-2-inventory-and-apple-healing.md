# Phase 08.2 インベントリ基盤とリンゴ回復

## 目的

今後の消耗品・武器・防具を追加できる最小限のインベントリ基盤を実装します。各フロアにリンゴを1個配置し、拾ってインベントリに格納、Tabキーで開くインベントリ画面からリンゴを使用してHPを回復できるようにします。

## 開始時のHEAD

`e299f62a2df918b96bbdd9fcf04fa0615d551f45`（origin/mainと一致、working tree clean）

## リンゴ画像について

ユーザーの指示により、添付画像の代わりに絵文字🍎で代用しました。`src/game/item-def.ts`の`ItemDefinition.glyph`に`'🍎'`として保持し、`main.ts`はPhaserのテキストオブジェクトとして描画します（画像アセットの読み込み・チロマキー処理は行っていません）。

## 調査した既存state、ターン進行、フロア遷移、入力処理

- `GameState`（`types.ts`）：`player`（HP/maxHp/attack等）、`enemies`、`webs`/`nextWebId`（フロアごとにリセットされるパターン）、`regenProgress`（`advanceToNextFloor`で引き継がれる値の例）を確認しました。
- `processTurn`（`turn.ts`）：1) プレイヤー行動解決 → 2) 死亡確認 → 3) 敵行動解決 → 4) 死亡確認 → 5) 自然HP回復 → 6) フロア進行確認 → 7) ターン加算、という正式な順序を確認しました。`applyPlayerAction`内で`petrified`/`slowed`/`wait`/移動/攻撃が処理されていることを確認しました。
- `state.ts`の`buildFloorState`：`choosePlacement`（配置座標用RNG）と`chooseSpecies`（敵種用RNG、独立ストリーム）の2本のRNGが、それぞれ`floorSeed ^ 定数`で分離されているパターンを確認しました。
- `main.ts`の`handleKey`：`phase !== 'playing'`のときはEnter/Nのみ処理、それ以外は`actionForKey`でPlayerActionに変換し`processTurn`へ渡す構造、`activeAnimations`によるアニメーション中の入力抑制を確認しました。既存のオーバーレイ（`messageText`、`logPanelText`）はいずれもPhaserの`Text`＋`Graphics`による`setScrollFactor(0)`固定パネルであることを確認しました。
- keydownリスナーは`this.input.keyboard!.on('keydown', ...)`の1箇所のみで、`preventDefault`やrepeat判定は未実装だったため、今回Tab用に追加しました。

## 採用したアイテムモデル

`src/game/item-def.ts`に、`ItemId`（`types.ts`で定義した`'apple'`のみのユニオン型）をキーとする`ITEM_DEFINITIONS: Record<ItemId, ItemDefinition>`を単一の正式な定義として作成しました。`ItemDefinition`は`id`/`displayName`/`glyph`/`healAmount`を持ちます。リンゴ専用のbooleanや単独変数は作らず、将来アイテムを追加する際は`ITEM_DEFINITIONS`と`ITEM_IDS_IN_ORDER`にエントリを足すだけで済む構造にしました。装備システムや過剰なクラス階層は導入していません。

## 採用したインベントリ形式

`Inventory = Record<ItemId, number>`（`types.ts`）として、`GameState.inventory`に持たせました。個数は`item-def.ts`の`createEmptyInventory()`で全アイテム0から初期化されます。表示用の`inventoryEntries()`（`inventory.ts`）は個数0のアイテムを除外して返すため、UIは自動的に「所持しているものだけ」を表示します。個数は`applyItemUse`（`turn.ts`）でのみ増減し、使用時のガード（`owned <= 0`なら不消費で終了）により0未満にはなりません。

地面のアイテムは`GroundItem { id, itemId, pos }`（`types.ts`）として`GameState.groundItems`に、`webs`と同様にフロアごとにリセットする配列として保持しました。`nextGroundItemId`も`nextWebId`と同じパターンで用意しています（Phase 08.2では1フロア1個のみ使用）。

## リンゴの配置規則

`src/game/mapgen.ts`に`chooseGroundItemPosition(map, start, exclude, rng)`を新規追加しました。既存の`bfsDistances`（`export`化）を再利用し、`start`から到達可能な床タイルのうち`exclude`（開始位置・出口・全敵位置）に含まれないものを候補とし、`rng()`を1回消費して1件選びます。候補が0件の場合は明示的に例外を投げ、無限探索や無言の配置失敗は発生しません。

`state.ts`の`buildFloorState`で、`placement.start`・`placement.exit`・`placement.enemies`（配置済み全敵座標）を除外リストとして渡しています。

## 既存乱数順とseed決定性を維持した方法

リンゴ配置には第3の独立RNGストリーム`createRng(floorSeed ^ 0xa3c17f05)`を使用しました。既存の`placementRng`（`^ 0x51ed270b`）・`speciesRng`（`^ 0x8f3c9d21`）とは異なるXOR定数であり、かつこれら2つのRNGの呼び出し順・回数を一切変更していないため、既存のマップ生成・配置座標・敵種決定の乱数消費順序とseed決定性は変わりません。`multi-floor-robustness.test.ts`をはじめとする既存の決定性テストが全て無変更で成功していることからもこれを確認しました。

## 取得処理

`turn.ts`の`applyPlayerAction`内、通常移動が成立した直後（webによる`slowed`判定の後）に、移動先座標と一致する`groundItems`要素を検索し、あれば`groundItems`から削除・`inventory[itemId]`を+1・`item_picked_up`イベントをpushする処理を追加しました。これは既存の1回の移動アクションに付随する処理であり、追加のターン消費はありません（取得した移動そのものの`processTurn`呼び出し内で、通常どおり敵行動も実行されます）。

## Tabを使うインベントリ操作

`main.ts`の`create()`でkeydownリスナーに`event.key === 'Tab'`の分岐を追加し、`event.preventDefault()`（ブラウザの標準フォーカス移動を抑止）と`event.repeat`時の早期returnを実装しました。`handleKey`は次の優先順位で分岐します。

1. `phase !== 'playing'`：既存のEnter/Nのみ（変更なし）
2. `activeAnimations > 0`：既存のアニメーション中入力抑制（Tab・インベントリ操作にも適用するよう対象を拡大）
3. `Tab`：`toggleInventory(state)`（ターン非消費、開くたびに選択位置を0にリセット）
4. `state.inventoryOpen`：`handleInventoryKey` — `Escape`で閉じる、`ArrowUp`/`ArrowDown`で`moveInventorySelection`、`Enter`で`useSelectedInventoryItem`、それ以外のキー（移動系含む）は無視
5. 上記のいずれでもない場合のみ、既存の`actionForKey` → `processTurn`の通常経路

`toggleInventory`/`closeInventory`/`moveInventorySelection`/`inventoryEntries`（`src/game/inventory.ts`、新規）はいずれもPhaserに依存しない純粋なGameState操作関数として実装し、`useSelectedInventoryItem`は`processTurn`に`{ type: 'use_item', itemId }`を渡すことで、既存のターン処理パイプラインをそのまま再利用します。

インベントリ表示中の移動拒否は、UI層（`handleInventoryKey`が移動キーを素通りさせない）に加えて、`processTurn`自体にも`state.inventoryOpen && action.type !== 'use_item'`のガードを追加し、二重に保証しています。

## リンゴの回復量と使用条件

`ITEM_DEFINITIONS.apple.healAmount = 2`。`turn.ts`の`applyItemUse`で、`player.hp < player.maxHp`のときのみ`Math.min(maxHp, hp + healAmount)`で回復を適用し、実際の回復量に関わらずリンゴを1個消費、`item_used`イベント（実回復量を含む）をpush、`state.inventoryOpen = false`でインベントリを閉じます。HP満タン時は`item_use_failed`イベントをpushして`consumed: false`を返し、インベントリは閉じず、所持数も減らしません。

## 成功時だけターンを消費する仕様

`use_item`アクションは`processTurn`の中で他の`PlayerAction`と全く同じ扱いを受けます。`applyItemUse`が`consumed: true`を返した場合のみ、その後段の敵行動解決・自然回復判定・フロア到達判定・ターン加算が実行されます。`consumed: false`（満タン時・不正な選択時）の場合は`processTurn`の`!consumed`早期returnにより、それ以降の処理は一切実行されません。アイテム専用の敵AI実装は行っておらず、`resolveEnemiesAction`（既存関数、無変更）がそのまま使われます。

なお、この早期return時に`events`配列を捨てて空配列を返していた既存コードが、`item_use_failed`イベントも握りつぶしてしまう副作用を引き起こしていたため、`events`（それまでに`push`された内容）をそのまま返すよう修正しました。ブロックされた移動（`events`が常に空のまま）の既存動作には影響しません。

## フロア遷移時の所持品維持

`state.ts`の`CarryOverStats`に`inventory: Inventory`を追加し、`advanceToNextFloor`が`state.inventory`をそのまま次フロアの`carry.inventory`として渡すようにしました。地面アイテム（`groundItems`）は`webs`と同様に毎フロア新規生成されるため引き継がれません。新規ゲーム開始（`createInitialState`、`carry`なし）では`createEmptyInventory()`により必ず空から始まります。

## 変更ファイル

- `src/game/types.ts`：`ItemId`/`Inventory`/`GroundItem`型、`PlayerAction`に`use_item`追加、`GameState`に`groundItems`/`nextGroundItemId`/`inventory`/`inventoryOpen`/`selectedItemIndex`追加
- `src/game/item-def.ts`（新規）：アイテム定義、空インベントリ生成
- `src/game/mapgen.ts`：`bfsDistances`をexport化、`chooseGroundItemPosition`追加
- `src/game/state.ts`：フロアごとのリンゴ配置、インベントリ引き継ぎ
- `src/game/events.ts`：`item_picked_up`/`item_used`/`item_use_failed`イベント追加
- `src/game/message-log.ts`：上記イベントの日本語フォーマッタ追加
- `src/game/turn.ts`：自動拾得、`applyItemUse`、`use_item`アクション処理、`inventoryOpen`時のmove/wait拒否ガード、`!consumed`時のevents握りつぶし修正
- `src/game/inventory.ts`（新規）：開閉・選択・使用の純粋ロジック
- `src/main.ts`：Tab/Escape/矢印/Enterのハンドリング、インベントリオーバーレイ描画、地面のリンゴ（絵文字）描画
- `src/game/__tests__/inventory-and-apple.test.ts`（新規）
- 既存テストフィクスチャ9ファイル（`enemy-behavior-*.test.ts`、`enemy-type.test.ts`、`message-log.test.ts`、`telegraph.test.ts`、`turn.test.ts`）：新規`GameState`フィールドを追加して型エラーを解消（挙動は無変更）
- `docs/history/phase-08-2-inventory-and-apple-healing.md`：本ファイル

## 追加または更新したテスト

新規`inventory-and-apple.test.ts`（33件）に以下を含みます。

- アイテム定義（ID、表示名、回復量）
- `chooseGroundItemPosition`の候補条件・決定性・候補なし時の例外
- 実際のフロア生成でのリンゴ配置1個・重複禁止・決定性・既存RNG無変更・フロアごとのリセット
- 拾得（インベントリ増加、地面から削除、追加ターンなし、新規ゲームは空、フロア遷移で維持）
- インベントリ開閉・選択（ターン非消費、選択リセット、空表示除外、開いている間の移動拒否、空インベントリでのEnter無害化）
- リンゴ使用（HP1→3、HP2→3、満タン時不可・不消費・開いたまま、成功時のみターン消費、成功時の敵行動発生、失敗時の敵行動なし、成功時のインベントリクローズ、所持数が負にならないこと、golemの隔ターン停止周期が使用ターンでも維持されること）
- 回帰（インベントリを一度も開いていない場合の通常移動・待機が従来どおり動くこと）

ランダム試行から確率を推定するテストや、UIの細かなDOM構造を固定するテストは追加していません。

## 検証結果（自動）

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：**32ファイル / 409件**、全成功（既存376件＋新規33件）
- `npx vite build`：成功。既知の「チャンクサイズ500kB超」警告以外に新規警告なし
- `git diff --check`：成功
- `package.json`／`package-lock.json`：差分なし

## 手動確認結果

ネットワーク制限内で利用可能なPlaywright（キャッシュ済みChromium revision 1194 + playwright-core 1.56.0）を用い、ビルド済みプレビューをヘッドレスブラウザで操作して確認しました。確認のため一時的にデバッグ用フック（`window.__debugState`、`window.__debugTeleportAndRefresh`）をmain.tsに追加しましたが、確認後に完全に削除し、commit対象には含めていません。

確認できた項目：

- 通常画面でゲームが起動すること
- 床上にリンゴが🍎として表示され、1マス内で識別できること（スクリーンショットで確認）
- リンゴのマスへ移動すると自動取得され、`inventory.apple`が1増え、`groundItems`から消えること。取得した移動は`turn`を1だけ進めること（追加ターンなし）
- Tabキーでインベントリが開閉すること。Escapeでも閉じること
- インベントリ表示中に移動キー（D）を押してもプレイヤー座標・ターンが変化しないこと（移動が発生しない）
- HPを1に設定した状態でリンゴを使用すると、最大HP3まで回復し、所持数が0になり、インベントリが自動的に閉じ、ターンが1だけ進むこと
- HP満タン時にリンゴを使用しようとすると、回復せず、所持数も減らず、ターンも進まず、インベントリが開いたままになり、「HPは満タンで、リンゴは使えない。」のログが表示されること
- 上記いずれの操作でもブラウザコンソールに新規エラーが出ないこと

確認できなかった項目（自動テストのみでカバー、実画面では未確認）：

- 敵に隣接した状態でのリンゴ使用成功後、その敵が実際に1ターン行動する見た目のアニメーション（自動テストの`enemyActed`/`enemyAttacked`検証では確認済みですが、実画面でのタイミング・視認性は未確認です）
- フロア2・3への遷移後もインベントリが維持される画面上の見え方（自動テストの`advanceToNextFloor`検証では確認済みですが、実画面操作での到達は未確認です）
- 新しいゲーム（Nキー）で所持品が空に戻る画面上の見え方（自動テストでは確認済みですが、実画面操作は未確認です）

長時間のバランステストは実施していません。リンゴによる最終的な難易度の判定は行っていません。

## 敵性能・敵数・敵候補集合・マップ生成について

いずれも変更していません。`ENEMY_DEFINITIONS`、`ENEMY_COUNT_PER_FLOOR`、`ENEMY_FIRST_APPEARANCE_FLOOR`（Phase 08.1）、`choosePlacement`、`generateMap`は無変更です。Phase 08.1の階層別敵候補テスト（`floor-enemy-pools.test.ts`）を含む既存テストは全て無変更のまま成功しています。

## 未実装であること

太陽の実、太陽銃、ソード、鎧、装備欄、装備切り替え、インベントリ容量制限、アイテムの廃棄・並べ替え、アイテム詳細画面、複数種類の消耗品、ショップ、宝箱、経験値、レベルアップ、最大HP増加、プレイヤー能力の恒久強化は、いずれも今回実装していません。

## 今回の位置づけ

今回はインベントリ基盤とリンゴ回復（HP2回復・1個消費・満タン時不可・成功時のみターン消費で敵行動を伴う）の実装であり、成長導線全体の完成ではありません。リンゴの追加により最終的なゲームバランスが成立したとは断定しません。次候補としては太陽銃または近接武器の実装が考えられますが、今回のcommitには含めていません。
