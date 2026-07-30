# Phase: phase-06-bat-hit-and-retreat-behavior

## 目的と対象範囲

コウモリ（bat）に「攻撃後、次の行動で1マス後退する」固有挙動を実装した。
既存のソード（`fast_melee`、高速接近）やゴーレム／アックス（`slow_melee`／
`recovery_melee`、休止系）と重複しない位置取りの違いを、火力や行動回数を
増やさずに表現する。壁抜け、クモの巣無効化、ランダム飛行、回避率、飛行
高度・状態、遠距離攻撃、状態異常、逃走AIなど、今回の仕様に含まれない
要素は一切追加していない。commit・push・PR作成は行っていない。

## precheck結果

- branch: `main`
- 開始時HEAD: `80ef51aa2fd10f388312b356d5183d0faff4d477`（origin/mainと完全一致）
- commit subject: `feat: add gameplay message log`（baselineと一致）
- working tree: clean、ahead/behindなし
- origin URLに認証情報が含まれていたため（cloneで一時的にPATが埋め込まれた
  状態）、作業開始前に`git remote set-url`で認証情報を除去した
- 開始時点で25ファイル・208件のテストが成功することを確認した

## 採用した状態管理

コウモリごとに`EnemyActor.retreating?: boolean`という個体単位のフラグを
`types.ts`に追加した。グローバルな単一フラグにはせず、他の敵の攻撃や
離脱状態に影響しない。フロア生成時は`createInitialEnemy`で毎回新しい
`EnemyActor`が作られるため、フロア移行・Enter再開・N新規seedのいずれでも
自動的に未設定（falsy）から始まり、追加のリセット処理は不要だった。

- 通常時（`retreating`が偽）：8方向近接攻撃可能なら攻撃し、成功したら
  `retreating`を真にする。攻撃できなければ既存の`tryChaseStep`で1マス
  追跡（bokと同じ挙動、専用メッセージなし）。
- 離脱待ち時（`retreating`が真）：まず`retreating`を偽に戻し、離脱を
  試みる。成功すれば1マス移動して`bat_retreat`イベントを1件生成し、
  その行動を終える（追加の移動・攻撃はしない）。失敗すれば同じターン
  内で通常AI（攻撃可能なら攻撃、不可なら追跡）にフォールバックする。
  フォールバック後も1行動のみで、この場合は`bat_retreat`を出さない。

攻撃した同じターンには後退しない（離脱判定は次にそのコウモリの行動順が
来たときに行われるため、構造的に同一ターン後退が起こり得ない）。

## 離脱先の決定方法

`turn.ts`に`tryBatRetreatStep`を追加した。既存の8方向移動基盤を再利用し、
新しい乱数判定は導入していない。

1. `ALL_DIRECTIONS`（`N,S,E,W,NE,NW,SE,SW`の固定順、既存コードの他の
   決定的走査と同じ順序）で8方向を走査する。
2. 各方向について`canMove`（既存の斜め角抜け禁止規則を含む）で移動可能か
   判定する。
3. 目的マスにプレイヤーまたは他の生存中の敵がいないか確認する
   （`tryChaseStep`と同じ占有判定パターンを踏襲）。
4. 目的マスとプレイヤーとのChebyshev距離（`max(|dx|,|dy|)`、既存の
   8方向移動グリッドと整合する距離指標）が、現在位置での距離より
   厳密に大きい候補だけを対象にする。
5. 対象候補のうち距離が最大のものを選ぶ。同距離の候補が複数あれば、
   `ALL_DIRECTIONS`の走査順で最初に見つかったものを採用する（Setや
   配列順への暗黙依存ではなく、固定配列の明示的な順序）。
6. 該当候補がなければ移動せず`false`を返し、呼び出し側
   （`resolveBatEnemy`）が通常AIへフォールバックする。

## 変更ファイル一覧

- 変更：
  - `src/game/types.ts`：`EnemyActor.retreating?: boolean`を追加
  - `src/game/events.ts`：`bat_retreat`イベント型
    （`{ type: 'bat_retreat', actorId, enemyType }`）を追加
  - `src/game/message-log.ts`：`bat_retreat`のフォーマッタを追加
  - `src/game/enemy-def.ts`：`BehaviorType`に`bat_retreat`を追加し、
    コウモリの`behaviorType`を`placeholder`から`bat_retreat`に変更
  - `src/game/turn.ts`：`chebyshevDistance`・`tryBatRetreatStep`・
    `resolveBatEnemy`を追加し、`resolveOneEnemy`のディスパッチに
    `bat_retreat`ケースを追加
- 新規：`src/game/__tests__/enemy-behavior-bat.test.ts`（16件）

コウモリ以外の固有挙動・スポーン数・プレイヤー成長要素・メッセージUIは
変更していない。

## 追加したイベントと表示文章

- イベント：`bat_retreat { actorId: number; enemyType: EnemyType }`
- 表示文章（離脱が実際に成功した場合のみ表示）：
  `「コウモリはひらりと距離を取った。」`
- 表示名は`ENEMY_DEFINITIONS`の一元化された`displayName`から取得しており、
  `turn.ts`側に完成文章を直接書いていない。
- コウモリの攻撃は既存の`enemy_attack`イベント、撃破は既存の
  `enemy_defeated`イベントをそのまま使用しており、攻撃と離脱は別ターンで
  それぞれ発生したターンに表示される。

## 自動テスト結果

新規`enemy-behavior-bat.test.ts`（16件、すべて成功）で以下を検証した。

- イベント・フォーマッタ：`bat_retreat`が指定の日本語文章に変換される
  こと（正式な表示名を使用）
- トリガー：近接攻撃成功時のみ離脱待ちになること／通常移動・攻撃不能
  時は離脱待ちにならないこと／攻撃と同じターンには後退しないこと
  （位置変化なし・`bat_retreat`イベントなし）
- 離脱成功：距離が厳密に増える候補の中から最大距離のマスへ1マス移動
  すること、同距離候補では`ALL_DIRECTIONS`の固定順で選ばれること、
  移動後に`retreating`が解除されること、`bat_retreat`が1件だけ生成
  されること、離脱ターンに追加のダメージ（攻撃）が発生しないこと
- 離脱失敗（フォールバック）：完全に囲まれている場合に通常AIへ戻り、
  位置が変わらず`retreating`が解除され、`bat_retreat`を出さないこと。
  他の生存敵のマス・プレイヤーのマス・斜め角抜けを候補にしないこと
- ライフサイクル：複数コウモリが独立した`retreating`状態を持つこと、
  `createInitialEnemy`直後は`retreating`が偽であること
  （＝フロア移行／Enter再開／N新規seedでの初期化を保証する経路の確認）

`npx vitest run`で既存208件＋新規16件の計224件がすべて成功した。

## 手動確認したシナリオと未確認項目

このセッションはコンテナ内でのコード変更・自動テスト・ビルド検証のみを
行い、ブラウザでの実プレイは行っていない。そのため、以下は自動テストの
範囲で構造的に確認できた事項であり、`manual_validation`に列挙された
実画面での確認（コウモリへの接近・離脱の視認・壁際での候補限定・メッセージ
順の目視確認・再開/次フロア後の状態確認・操作性や表示崩れの有無など）は
未実施である。実画面での確認は別途、ユーザー側での実プレイ確認が必要。

## 既存挙動への影響確認

- `bok`/`spider`/`golem`/`sword`/`axe`/`kraken`など他の`behaviorType`の
  分岐・処理には一切手を加えていない
- 新イベント追加はGameEvent判別共用体への型追加のみで、既存の敵の処理順
  ・乱数消費順（`resolveEnemiesAction`の配列順反復）を変えていない
- `npx vitest run`で既存208件がすべて変更なしで成功することを確認した
  （敵数2体、配置、ターン数、終了条件は無変更）

## 発見した問題と対応

- clone直後、`git remote -v`の出力にPersonal Access Tokenが含まれる状態
  だった（precheck要件「origin URLに認証情報が含まれていない」に抵触）。
  `git remote set-url origin https://github.com/sanadamancom/rogue-of-sun.git`
  で認証情報を除いたURLに修正した。fetch/pushの認証自体はcloneコマンド
  実行時に一時的に使用したのみで、リポジトリ内のファイルには一切書き込ん
  でいない。
- それ以外に既存の共通AI・基盤コードの不具合は発見しなかった。

## 最終検証結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：26ファイル・224件すべて成功（既存208件＋新規16件）
- `npx vite build`：ビルド成功（バンドルサイズに関する既存の警告のみ、
  今回の変更に起因するエラーなし。生成された`dist/`は確認後に削除済み）
- `git diff --check`：問題なし
- `git status --short`：追跡対象の変更5ファイル＋新規テストファイル1件
  のみ、一時デバッグ出力やスクリーンショット等の生成物は残っていない

## git diff要約

```
 src/game/enemy-def.ts   | 11 +++++--
 src/game/events.ts      |  1 +
 src/game/message-log.ts |  4 +++
 src/game/turn.ts        | 88 +++++++++++++++++++++++++++++++++++++++++++++++++
 src/game/types.ts       |  9 +++++
 5 files changed, 111 insertions(+), 2 deletions(-)
```

新規ファイル（`git status --short`より）：
`?? src/game/__tests__/enemy-behavior-bat.test.ts`

## git status

```
 M src/game/enemy-def.ts
 M src/game/events.ts
 M src/game/message-log.ts
 M src/game/turn.ts
 M src/game/types.ts
?? src/game/__tests__/enemy-behavior-bat.test.ts
```

## commit可能かどうか

自動テスト・型チェック・ビルドはすべて成功しており、コード変更としては
commit可能な状態にある。ただし本タスクの指示（`repository_rules`：
commit・push・PR作成を行わない）に従い、commitは行っていない。また、
`manual_validation`に列挙された実画面での確認が未実施のため、実プレイで
「離脱が戦術として認識できるか」「追いかける手間が過剰でないか」を確認
した上でcommitする、というユーザー側の運用方針にも合致する。
