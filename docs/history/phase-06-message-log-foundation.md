# Phase 06: Message Log Foundation

## 目的と対象範囲

通常プレイ中に起きた重要な行動（ダメージ、撃破、死亡、各固有挙動の
節目など）を画面下部のメッセージ欄へ表示できるようにした。ゲーム処理
（`turn.ts`）は完成文章を持たず、型付きイベント（`GameEvent`）だけを
生成し、表示側（`message-log.ts`）がそれを日本語文章へ変換する。UIの
細かな意匠調整、履歴画面、会話システムは対象外。commit/push/PR作成は
行っていない。

## イベント構造（`src/game/events.ts`、新設）

`required_event_categories`の10種をそのまま判別可能なunion型として定義:

```ts
type GameEvent =
  | { type: 'player_attack'; enemyType: EnemyType; damage: number }
  | { type: 'enemy_attack'; enemyType: EnemyType; damage: number }
  | { type: 'enemy_defeated'; enemyType: EnemyType }
  | { type: 'enemy_recovering'; enemyType: EnemyType }
  | { type: 'sword_dash'; enemyType: EnemyType }
  | { type: 'web_placed'; enemyType: EnemyType }
  | { type: 'player_webbed' }
  | { type: 'slowed_move_cancelled' }
  | { type: 'floor_advanced' }
  | { type: 'player_defeated' };
```

- `enemyType`を持つ種別は表示名を`ENEMY_DEFINITIONS`から取得するため、
  ロジック側で敵名を重複管理しない。
- `formatEvent`（`message-log.ts`）は`switch`＋`never`の網羅性チェック
  を使い、未対応イベントが追加された場合はTypeScriptのコンパイルが
  失敗する。

## `turn.ts`への組み込み

- `TurnResult`に`events: GameEvent[]`を追加した。
- `processTurn`内で`events`配列を生成し、`applyPlayerAction`・
  `resolveEnemiesAction`（各`resolveXxxEnemy`/`tryMeleeAttack`）へ
  引数として渡し、実際の処理が起きた箇所で直接`events.push(...)`する
  方式にした。イベント生成のためだけの新しい判定・分岐は追加せず、
  既存の分岐がそのまま行動結果を返す箇所にpushを差し込んだだけなので、
  行動結果・乱数消費順・ターン進行は変化しない。
- 発生順は「プレイヤー行動→各敵の行動（`state.enemies`の配列順）」の
  実処理順そのまま。

## 表示対象・表示しない行動

**表示するもの**（`message-model.ts`の`formatEvent`が対応）
- プレイヤーの攻撃ダメージ、敵撃破
- 敵から受けたダメージ、プレイヤー死亡
- golem/axeの「休みターン」（`enemy_recovering`）
- swordの2マス接近が実際に成立した場合のみ（`sword_dash`）
- spiderのweb設置、プレイヤーのweb進入、slowedによる移動失敗
- フロア移行（`floor_advanced`）

**表示しないもの**
- 通常移動、通常待機（イベントを生成しない）
- swordの1マス移動のみで終わったターン（2マス目が不成立の場合）
- golem/axeの攻撃ターンそのもの（そのターンの`enemy_attack`は共通の
  被ダメージメッセージとして出るが、「強い近接攻撃」という専用文言は
  付けていない。ダメージ量自体は`enemy_attack`の文面に数値として
  含まれるため、「ダメージ量付き表示」の要件は満たしている）
- kraken（stationary）は元々毎ターン何もしないので何も出ない
- bat/mummy/cockatriceは現状`generic_melee`にフォールバックしている
  ため、その共通攻撃が起きた場合のみ共通`enemy_attack`が出る。未実装の
  固有挙動を示唆する文言は追加していない

## メッセージの保持と初期化（`src/game/message-log.ts`の`MessageLog`、`src/main.ts`側での運用）

- `MessageLog`はゲーム状態から独立した表示専用クラス（文字列の固定長
  FIFO、既定容量3）。`GameState`には一切追加していない
  （`design_policy`の「表示用イベントと永続的なゲーム状態を必要以上に
  結合しない」に対応）。
- 1ターンで4件以上イベントが出ても、発生順を保ったまま末尾3件だけが
  残る（`pushMany`が順番にpushし、都度容量超過分を先頭から捨てる）。
- メッセージが無い通常移動・通常待機はイベントを生成しないため、既存
  メッセージは自動的には消えない（要件通り）。
- Enter（同一seed再開）／N（新規seed）は`MainScene.restart()`内で
  `messageLog.clear()`を呼び、直前の死亡メッセージ等を消去してから
  次のシーンを組み立てる。
- 次フロア移行（`floor_cleared`）検出時は`messageLog.clear()`のあと
  `floor_advanced`イベント1件だけをpushし、前フロアの戦闘メッセージを
  持ち越さない。
- gameover時は最後のターンで生成された`player_defeated`（および同ターン
  内の`enemy_attack`等）がそのままログに残るため、死亡メッセージを
  確認できる。

## UI（`src/main.ts`）

- `MainScene`に`MessageLog`インスタンスと、画面下部固定の
  `logPanelBg`（半透明の背景矩形＋枠線）／`logPanelText`
  （最大3行、`setScrollFactor(0)`でカメラに追従しない）を追加した。
- `handleKey`で`processTurn`の戻り値`result.events`を
  `formatEvents`で文章化し、`messageLog.pushMany(...)`する。
- `refreshStaticView()`の中で毎回`refreshLogPanel()`を呼び、パネル
  テキストをログの現在の内容に同期させている（HUD更新と同じタイミング）。
- パネル高さは`MESSAGE_LOG_CAPACITY(3) × LOG_LINE_HEIGHT(18) + padding`
  で固定。画面サイズが変わってもゲーム自体のCanvas幅は固定（既存の
  `VIEWPORT_TILES_WIDE/HIGH`のまま変更していない）なので画面外へは
  出ない。マップ・HUD・操作説明とは重ならない位置（画面最下部の帯）
  にのみ描画している。
- スクロール・展開ボタン・色分け・アイコン・文字送りは実装していない
  （`ui.requirements`通り）。

## 自動テスト結果

`src/game/__tests__/message-log.test.ts`（新規、20件）:
- `formatEvent`/`formatEvents`のダメージ量・敵表示名の反映
- `MessageLog`の直近3件保持、4件以上の発生順維持、`clear()`
- `processTurn`が生成する`events`の内容:
  - 通常移動でイベントが空であること
  - プレイヤー攻撃／撃破／被ダメージ／死亡
  - golem・axeの休みターン
  - swordの2マス接近成立時のみ`sword_dash`、1マス移動時は出ないこと
  - spiderのweb設置、プレイヤーのweb進入、slowedによる移動失敗
  - イベント生成後も既存の敵行動結果・ターン数が変化しないこと

既存24ファイル188件は変更なしですべて成功。

```
Test Files  25 passed (25)
     Tests  208 passed (208)
```

## 手動確認（コードレビューベース）

Phaserの対話操作は本環境では実行できないため、上記の自動テストと
コードパスの目視追跡で以下シナリオを確認した。いずれも該当分岐で
`events.push`が呼ばれ、`main.ts`側で`formatEvents`→
`messageLog.pushMany`→`refreshLogPanel`という一本の経路を通ることを
確認済み。実機（ブラウザ）での目視確認は未実施。

| シナリオ | 該当コード | 確認内容 |
| --- | --- | --- |
| プレイヤー攻撃→撃破 | `applyPlayerAction` | `player_attack`の直後に`enemy_defeated`が同一ターンでpushされる順序をテストで確認 |
| bokの攻撃 | `tryMeleeAttack`（`resolveBokEnemy`経由） | 共通`enemy_attack`をテストで確認 |
| golemの休み | `resolveGolemEnemy`のphase!=0分岐 | `enemy_recovering`をテストで確認 |
| swordの2マス接近 | `resolveSwordEnemy`のstep2成立時のみ | `sword_dash`が出る/出ないケース双方をテストで確認 |
| axeの休み | `resolveAxeEnemy`の`recovering`分岐 | 攻撃ターン→休みターンの2ターン連続でテスト確認 |
| spiderのweb設置 | `resolveSpiderEnemy`の`placeWeb`分岐 | `web_placed`をテストで確認 |
| web進入→次移動失敗 | `applyPlayerAction`の`slowed`分岐と移動onto web分岐 | `player_webbed`→（次ターン）`slowed_move_cancelled`をそれぞれテストで確認 |
| 複数敵の順序 | `resolveEnemiesAction`のfor-of | 既存実装のまま`state.enemies`配列順で反復するため、実処理順=表示順であることをコードで確認（追加の並べ替え処理を持ち込んでいない） |
| プレイヤー死亡 | `processTurn`内`playerDefeated`判定直後 | `player_defeated`が末尾に付くことをテストで確認 |
| 次フロアへ進む | `main.ts`の`floor_cleared`分岐 | `messageLog.clear()`→`floor_advanced`のpushをコードで確認 |
| Enter再開／N新規seed | `MainScene.restart()` | `messageLog.clear()`をコードで確認 |

## 発見した問題と対応

- 特になし。既存の`resolveXxxEnemy`系関数がすでに「攻撃/移動/休み」を
  明確に分岐させていたため、その分岐点にpushを追加するだけで済み、
  ロジック自体の変更は不要だった。

## 後回しにした項目

- メッセージパネルの意匠調整（背景・枠・フォントの作り込み）
- 履歴画面（直近3件を超える過去ログの閲覧）
- 会話システム
- bat/mummy/cockatriceの固有AIとそれに伴う専用メッセージ
- メッセージの多言語化・文言の細かなチューニング

## 最終検証結果

```
$ npx tsc --noEmit
(エラーなし)

$ npx vitest run
Test Files  25 passed (25)
     Tests  208 passed (208)

$ npx vite build
✓ built in 11.28s

$ git diff --check
(出力なし)
```

## git diff要約

```
 src/game/turn.ts | 105 +++++++++++++++++++++++++++++++++++++++++++------------
 src/main.ts      |  58 ++++++++++++++++++++++++++++--
 2 files changed, 139 insertions(+), 24 deletions(-)
```

新規ファイル: `src/game/events.ts`, `src/game/message-log.ts`,
`src/game/__tests__/message-log.test.ts`

## git status

```
 M src/game/turn.ts
 M src/main.ts
?? src/game/__tests__/message-log.test.ts
?? src/game/events.ts
?? src/game/message-log.ts
```

（このドキュメントファイル自体も追跡外として追加される）

## commit可能かどうか

`npx tsc --noEmit`／`npx vitest run`（既存188件＋新規20件、計208件）／
`npx vite build`／`git diff --check`のいずれも問題なし。認証情報・生成物・
一時ファイルの追加はない。commit/push/PR作成は指示によりこのタスクでは
実施していないが、内容としてはcommit可能な状態。
