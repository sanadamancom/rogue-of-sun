# Phase: phase-06-mummy-shambling-movement

## 目的と対象範囲

マミー（mummy）に「移動後の次回行動を1ターン休止するが、隣接中は毎ターン
攻撃できる」固有挙動を実装した。ゴーレム／アックス（`recovery_melee`、
攻撃後休止）とは逆の役割で、接近速度だけを抑え、近づかれると連続攻撃する
設計にした。歩行・近接攻撃自体は既存の共通処理を維持している。マミーの
静止敵化、攻撃後休止、初回行動の無条件休止、2ターン以上の連続休止、能力値
変更、状態異常、遠距離攻撃など、今回の仕様に含まれない要素は追加していな
い。commit・push・PR作成は行っていない。

## precheck結果

- branch: `main`
- 開始時HEAD: `39d65f0841d19fc5d4c59cc93be82492b0872f3f`（origin/mainと完全
  一致、subjectも`feat: add bat hit-and-retreat behavior`でbaselineと一致）
- working tree: clean、ahead/behindなし
- origin URLに認証情報は含まれていない（前回のbatタスクで除去済みの状態
  が維持されていることを確認した）
- 開始時点で26ファイル・224件のテストが成功することを確認した

## 採用した状態管理

マミーごとに`EnemyActor.restingAfterMove?: boolean`という個体単位のフラ
グを`types.ts`に追加した。コウモリの`retreating`やアックスの`recovering`
とは別フィールドとし、`state_naming`の指示どおり意味の混同を避けている。
グローバルな単一フラグにはせず、他のマミーや他種の敵の状態に影響しない。
フロア生成時は`createInitialEnemy`で毎回新しい`EnemyActor`が作られるため、
フロア移行・Enter再開・N新規seedのいずれでも自動的に未設定（falsy）から
始まり、追加のリセット処理は不要だった（コウモリ実装時と同じ構造）。

- 休止待ちでない場合：8方向近接攻撃可能なら攻撃する（休止待ちにはしな
  い）。攻撃できなければ既存の`tryChaseStep`で1マス追跡し、実際に移動が
  成功した場合だけ`restingAfterMove`を真にする。移動不能（`false`が返る
  場合）は休止待ちにしない。
- 休止待ちの場合：`restingAfterMove`を先に偽へ戻し、その場から動かず、
  隣接していても攻撃せず、`mummy_shamble_rest`イベントを1件生成してその
  行動を終える。コウモリと異なり、休止できない場合の分岐は存在しない
  （休止は常に成功する＝移動しない・攻撃しないだけの行動のため、フォー
  ルバック処理自体が不要）。

攻撃した場合は休止待ちにならないため、隣接し続ける限り「攻撃→攻撃」が続
き、移動をはさんだときだけ「移動→休止→移動→休止」の周期になる。

## 行動周期の実測結果

新規テスト`enemy-behavior-mummy.test.ts`の`mummy rest action`内、
「does not rest on two consecutive turns」で以下を実測確認した。

1. ターン1：プレイヤーから離れているため追跡移動が成功し、
   `restingAfterMove`が真になる（移動マスは検証済み）
2. ターン2：休止し、位置が変わらず`mummy_shamble_rest`が1件生成され、
   `restingAfterMove`が偽に戻る
3. ターン3：通常AIへ復帰し、まだプレイヤーへ届いていないため再び移動す
   る（2ターン連続の休止にはならない）

また`mummy combat`内のテストで、隣接時は攻撃した次のターンも（休止を挟
まず）再度攻撃することを確認した。

## 変更ファイル一覧

- 変更：
  - `src/game/types.ts`：`EnemyActor.restingAfterMove?: boolean`を追加
  - `src/game/events.ts`：`mummy_shamble_rest`イベント型
    （`{ type: 'mummy_shamble_rest', actorId, enemyType }`）を追加
  - `src/game/message-log.ts`：`mummy_shamble_rest`のフォーマッタを追加
  - `src/game/enemy-def.ts`：`BehaviorType`に`mummy_shamble`を追加し、
    マミーの`behaviorType`を`placeholder`から`mummy_shamble`に変更
  - `src/game/turn.ts`：`resolveMummyEnemy`を追加し、`resolveOneEnemy`
    のディスパッチに`mummy_shamble`ケースを追加
- 新規：`src/game/__tests__/enemy-behavior-mummy.test.ts`（19件）

マミー以外の固有挙動・スポーン数・プレイヤー成長要素・メッセージUIは変更
していない。コウモリの`bat_retreat`実装（`turn.ts`内の別関数）にも手を加
えていない。

## 追加したイベントと表示文章

- イベント：
  `mummy_shamble_rest { actorId: number; enemyType: EnemyType }`
- 表示文章（実際に休止した場合のみ表示）：
  `「マミーは足を止めて体勢を整えた。」`
- 表示名は`ENEMY_DEFINITIONS`の一元化された`displayName`から取得してお
  り、`turn.ts`側に完成文章を直接書いていない。
- マミーの攻撃は既存の`enemy_attack`イベント、撃破は既存の
  `enemy_defeated`イベントをそのまま使用している。移動自体には専用メッ
  セージを出しておらず、移動したターンではなく次回の休止ターンにのみ
  `mummy_shamble_rest`を出している。

## 自動テスト結果

新規`enemy-behavior-mummy.test.ts`（19件、すべて成功）で以下を検証した。

- イベント・フォーマッタ：`mummy_shamble_rest`が指定の日本語文章に変換
  されること（正式な表示名を使用）
- 移動トリガー：追跡移動が成功すると休止待ちになること／移動した同じ
  ターンには休止しないこと／移動不能では休止待ちにならないこと／攻撃後
  は休止待ちにならないこと／初回行動を無条件に休止しないこと
- 休止行動：休止ターンで位置が変化しないこと、攻撃しないこと、追加移動
  しないこと、`mummy_shamble_rest`が1件だけ生成されること、休止後に状態
  が解除されること、2ターン連続で休止しないこと
- 戦闘：休止状態でなければ隣接時に通常攻撃すること、攻撃後の次回行動で
  も隣接中なら再度攻撃すること（攻撃後休止しないこと）
- エッジケース：移動後・休止ターンまでの間にプレイヤーが隣接／離脱して
  も休止すること、複数マミーが独立して状態を持つこと、休止予定のマミー
  を先に撃破しても`mummy_shamble_rest`が出ないこと
- ライフサイクル：`createInitialEnemy`直後は`restingAfterMove`が偽であ
  ること（＝フロア移行／Enter再開／N新規seedでの初期化を保証する経路の
  確認）、同一状態内でコウモリの`retreating`と干渉しないこと

`npx vitest run`で既存224件＋新規19件の計243件がすべて成功した。

## 手動確認した内容と未確認項目

このセッションはコンテナ内でのコード変更・自動テスト・ビルド検証のみを
行った。ブラウザでの実プレイ確認はユーザー側で別途、コウモリのときと同
様の確認用ビルド（`buildRosterPreviewFloorState`を使った全種族出現プレ
ビュー等）を用いて行う想定であり、本レポート作成時点では以下の
`manual_validation`項目は未実施：

- 離れた位置からマミーを実際に接近させる目視確認
- 「移動→休止→移動→休止」の周期を実画面で確認
- 隣接中「攻撃→攻撃」で休止が挟まらないことの目視確認
- 休止ターンの専用メッセージ表示確認
- 壁際での移動不能時の挙動確認
- 複数敵が同時にいる場合のメッセージ順確認
- Enter再開、N新規seed、次フロア移行後の状態初期化確認

上記はいずれも自動テストの範囲で構造的に検証済みだが、実画面での確認は
別途必要。

## 既存敵への影響確認

- `bok`/`spider`/`golem`/`sword`/`axe`/`bat`/`cockatrice`/`kraken`など
  他の`behaviorType`分岐には一切手を加えていない
- 新イベント追加はGameEvent判別共用体への型追加のみで、既存の敵の処理順
  ・乱数消費順（`resolveEnemiesAction`の配列順反復）を変えていない
- 新規テストの`does not interfere with an independent bat retreating in
  the same state`で、同一ターン内にマミーとコウモリが混在してもコウモリ
  の`retreating`解決に影響しないことを確認した
- `npx vitest run`で既存224件がすべて変更なしで成功することを確認した
  （敵数2体、配置、ターン数、終了条件は無変更）

## 発見した問題と対応

今回の実装範囲で既存の共通AI・基盤コードの不具合は発見しなかった。

## 最終検証結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：27ファイル・243件すべて成功（既存224件＋新規19件）
- `npx vite build`：ビルド成功（バンドルサイズに関する既存の警告のみ、
  今回の変更に起因するエラーなし。生成された`dist/`は確認後に削除済み）
- `git diff --check`：問題なし
- `git status --short`：追跡対象の変更5ファイル＋新規テストファイル1件
  ＋本ドキュメント1件のみ、一時デバッグ出力やスクリーンショット等の生成
  物は残っていない

## git diff要約

```
 src/game/enemy-def.ts   | 17 ++++++++++++-----
 src/game/events.ts      |  1 +
 src/game/message-log.ts |  4 ++++
 src/game/turn.ts        | 35 +++++++++++++++++++++++++++++++++++
 src/game/types.ts       | 12 ++++++++++++
 5 files changed, 64 insertions(+), 5 deletions(-)
```

新規ファイル（`git status --short`より）：
`?? src/game/__tests__/enemy-behavior-mummy.test.ts`
（本ドキュメント作成後は`docs/history/phase-06-mummy-shambling-movement.md`
も追加で未追跡となる）

## git status

```
 M src/game/enemy-def.ts
 M src/game/events.ts
 M src/game/message-log.ts
 M src/game/turn.ts
 M src/game/types.ts
?? src/game/__tests__/enemy-behavior-mummy.test.ts
```
（本ドキュメントファイル追加前の状態。ドキュメント作成後は
`?? docs/history/phase-06-mummy-shambling-movement.md`が加わる）

## commit可能かどうか

自動テスト・型チェック・ビルドはすべて成功しており、コード変更としては
commit可能な状態にある。ただし本タスクの指示（`repository_rules`：
commit・push・PR作成を行わない）に従い、commitは行っていない。マミーが
弱すぎないかの実画面確認（HPや配置とのバランス）は、指示どおり今回の休
止頻度を変えずに別途行う想定。
