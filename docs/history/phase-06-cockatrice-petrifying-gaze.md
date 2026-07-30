# Phase: phase-06-cockatrice-petrifying-gaze

## 目的と対象範囲

コカトリス（cockatrice）に「予兆付きの石化光線」を実装した。射線上のプレ
イヤーを発見すると次回行動で照準を固定し、さらに次の行動で同じ方向へ発
射する。命中するとプレイヤーの次の1行動だけを石化で消費させる。光線に
よるHPダメージ、永続石化、状態異常UI、演出、反射、他敵の石化、クラーケ
ンの実装、コカトリス以外の固有挙動変更など、今回の仕様に含まれない要素
は追加していない。commit・push・PR作成は行っていない。

## precheck結果

- branch: `main`
- 開始時HEAD: `abb8101c53beaa98c7c796b45ab7030d76604fd8`（origin/mainと完
  全一致、subjectも`feat: add mummy shambling movement`でbaselineと一致）
- working tree: clean、ahead/behindなし
- origin URLに認証情報は含まれていない
- 開始時点で27ファイル・243件のテストが成功することを確認した

## 採用した照準・発射・石化の状態管理

- コカトリス個体ごとに`EnemyActor.gazeDirection?: Direction8`を追加し
  た。8方向のいずれか、または未設定（照準していない）を保持する。値は
  `Vec2`座標ではなく固定の`Direction8`そのものであり、照準した瞬間のプ
  レイヤー座標を保存しない。これにより「発射直前にプレイヤーの現在位置
  へ方向を補正しない」（追尾しない）ことを型レベルでも保証している。名
  称は`state_naming.preferred`どおり`gazeDirection`を採用し、コウモリの
  `retreating`、アックスの`recovering`、マミーの`restingAfterMove`とは
  別フィールドとして独立させた（グローバルな単一状態は使用していない）。
- プレイヤー側は`Actor.petrified?: boolean`を追加した。既存のクモの巣
  `slowed`と同じ設計パターン（次の有効な1行動だけを丸ごと別処理に置き
  換えてから解除する）を踏襲している。

フロア生成時は`createInitialEnemy`／`createInitialActor`で毎回新しい
`EnemyActor`／`Actor`が作られるため、フロア移行・Enter再開・N新規seed
のいずれでも`gazeDirection`・`petrified`は自動的に未設定（falsy）から始
まり、追加のリセット処理は不要だった（コウモリ・マミー実装時と同じ構
造）。

## 射程と射線判定

- `alignedGazeDirection(from, to)`：2点が同じx座標／同じy座標／
  `abs(dx) === abs(dy)`のいずれかを満たす場合だけ、対応する8方向と、そ
  の方向に沿った距離（＝Chebyshev距離。整列済みのため通常の直線距離と
  一致する）を返す。どの8方向にも整列していなければ`null`。
- 射程は`GAZE_MIN_RANGE = 2`〜`GAZE_MAX_RANGE = 5`（両端含む）。距離1
  （隣接）は光線の対象にせず、優先順位の時点で近接攻撃に処理させる。距
  離6以上は照準しない。
- 視線判定は既存の`canMove`（壁判定＋斜め角抜け禁止規則）をそのまま1マ
  スずつ再利用する`castGazeRay(map, from, direction, maxSteps)`で実装
  した。新しい経路探索は追加しておらず、`canMove`が失敗した時点（壁ま
  たはマップ外）でその場で走査を打ち切る。敵はブロックしない（占有判定
  を見ないので、既存敵がいてもそのマスを通過できる）。
- 照準判定は「`castGazeRay`で実際に届いたマス数」が「整列で求めた距離」
  と一致するかで判定する。一致しない（壁や角抜け禁止で手前が塞がれてい
  る）場合は照準しない。

## 行動周期の実測結果

新規テスト`enemy-behavior-cockatrice.test.ts`および手動シミュレーショ
ンで、優先順位どおりの周期を確認した。

1. 非照準・隣接していない・有効な射線がある：その場から動かず攻撃もせ
   ず、`gazeDirection`を保存して`cockatrice_gaze_aim`を1件だけ出す（同
   じ行動で発射・追跡フォールバックはしない）
2. 次のそのコカトリスの行動順：保存方向へ発射する。移動しない・近接攻
   撃に切り替えない。命中なら`cockatrice_gaze_fire(hit:true)`＋
   `player_petrified`、失敗なら`cockatrice_gaze_fire(hit:false)`のみ。
   発射後は`gazeDirection`を解除し、発射は連続しない（次のターンは条件
   を満たせば再度アイム、満たさなければ近接攻撃または追跡）
3. 非照準・隣接している：常に近接攻撃（アイム状態にはしない）
4. 照準済みで、発射時にたまたま隣接していても、近接攻撃に置き換えず光
   線を発射する（`implementation_policy`の明示要件どおり）

## 回避可能性の確認結果

実装から独立した手動シミュレーションスクリプトで2パターンを実行した
（作業後に削除済み、`git status --short`に残っていないことを確認）。

- **回避成功**：コカトリス(5,5)・プレイヤー(8,5)で照準（`E`, 距離3）→
  次のコカトリス行動の前にプレイヤーが`N`へ1マス移動して射線を外れる→
  発射時のイベントは`{ direction: 'E', hit: false }`、`player.petrified`
  は`false`のまま。**位置取りによる回避が実際に機能することを確認した。**
- **命中とその後の解除**：プレイヤーが射線上に留まった場合は
  `hit: true`で`player_petrified`が発生し、次の入力（`wait`）は
  `player_petrified_skip`に置き換わって`consumed: true`のままターンが
  進み、その直後に`petrified`は`false`へ解除された。解除直後のコカトリ
  スはまだ射程内なら発射を連続させず、条件を満たせば再度アイムする（実
  測でも次ターンは`cockatrice_gaze_aim`になり、発射イベントは出なかっ
  た）。

## 変更ファイル一覧

- 変更：
  - `src/game/types.ts`：`Actor.petrified?: boolean`、
    `EnemyActor.gazeDirection?: Direction8`を追加
  - `src/game/events.ts`：`cockatrice_gaze_aim`／`cockatrice_gaze_fire`
    ／`player_petrified`／`player_petrified_skip`の4イベント型を追加
  - `src/game/message-log.ts`：上記4イベントのフォーマッタを追加
  - `src/game/enemy-def.ts`：`BehaviorType`に`cockatrice_gaze`を追加し、
    コカトリスの`behaviorType`を`placeholder`から`cockatrice_gaze`に変
    更（`placeholder`は現時点でどの種族も使わない予約枠となった旨をコ
    メントで明記）
  - `src/game/turn.ts`：
    - `applyPlayerAction`の先頭に石化スキップ処理を追加（`wait`の早期
      returnより前、既存の`slowed`処理より前）
    - `alignedGazeDirection`／`castGazeRay`（既存`canMove`の再利用）／
      `resolveCockatriceEnemy`を追加
    - `resolveOneEnemy`のディスパッチに`cockatrice_gaze`ケースを追加
- 新規：`src/game/__tests__/enemy-behavior-cockatrice.test.ts`（46件）

コカトリス以外の固有挙動・スポーン数・能力値・メッセージUIは変更してい
ない。コウモリ／マミー実装（`turn.ts`内の別関数）にも手を加えていない。

## 追加したイベントと表示文章

| イベント | 必須データ | 表示文章 |
|---|---|---|
| `cockatrice_gaze_aim` | `actorId`, `enemyType`, `direction` | 「コカトリスがこちらへ石化光線の狙いを定めた。」 |
| `cockatrice_gaze_fire`（hit） | `actorId`, `enemyType`, `direction`, `hit` | 「コカトリスの石化光線を浴びた。」 |
| `cockatrice_gaze_fire`（miss） | 同上 | 「コカトリスの石化光線が放たれた。」 |
| `player_petrified` | `actorId`, `enemyType` | 「体が石のように動かない。」 |
| `player_petrified_skip` | なし | 「体が石のように動かない。」 |

表示名はすべて`ENEMY_DEFINITIONS`の一元化された`displayName`から取得し
ており、`turn.ts`側に完成文章を直接書いていない。命中時は
`cockatrice_gaze_fire`（「光線を浴びた」）と`player_petrified`（「体が
石のように動かない」）が同じターンに両方生成されるが、テキストは異なる
ため文字どおりの二重表示にはならない（`duplicate_policy`が禁じているの
はこの「同一ターン内の同一内容の二重表示」で、これは満たしている）。一
方`player_petrified`と`player_petrified_skip`は、仕様書の
`formatting.player_petrified`と`recommended_display.skipped_action`が
どちらも「体が石のように動かない。」を指定しているため、意図的に同一テ
キストを採用した。ただし両者は別ターン（命中の瞬間／実際に行動が消費さ
れる瞬間）に表示されるため、同一メッセージバッチ内での二重表示ではな
い。これは`仕様上の判断が必要な矛盾`というほどの対立ではなく、単に同じ
語を2箇所で指定した記述と解釈し、実装を停止せず両方に指定どおりのテキ
ストを採用した。判断の余地があった点として明記する。

## 自動テスト結果

新規`enemy-behavior-cockatrice.test.ts`（46件、すべて成功）で以下を検
証した。

- イベント・フォーマッタ：4イベントすべてが指定文章に変換されること、
  命中と失敗で表示が区別されること、命中時に`cockatrice_gaze_fire`と
  `player_petrified`が同一内容で二重表示されないこと
- 照準（targeting）：縦・横・斜め（SE）で照準できること、8方向に整列
  しない場合は照準しないこと、距離2（最小）・距離5（最大）で照準でき
  ること、距離1では近接攻撃すること、距離6以上では照準せず追跡へフォ
  ールバックすること、壁越しには照準しないこと、斜めの角抜け禁止射線を
  作らないこと
- 照準行動：移動しない・攻撃しない・`cockatrice_gaze_aim`が1件だけ生
  成される・同じ行動で発射しない・同じ行動で追跡へフォールバックしない
  こと
- 発射：次回行動で保存方向へ発射すること、発射時に位置が変わらず近接攻
  撃もしないこと、発射時にプレイヤーの新しい位置へ追尾しない（保存方向
  のまま撃って外れる）こと、発射後に`gazeDirection`が解除されること、
  照準済みなら隣接していても近接攻撃に置き換わらず発射すること、発射が
  連続しないこと
- 命中・失敗：射線上に留まると命中すること、横へ移動すると失敗するこ
  と、発射前に壁で遮られると失敗すること、命中してもHPが減らないこと、
  他の敵が光線を遮ったりダメージ・状態異常を受けたりしないこと
- プレイヤー石化：次の有効な行動（move／wait問わず）が1回だけ消費され
  ターンが進むこと、消費後は石化が解除され次の行動は通常どおり実行でき
  ること、石化中でも敵ターンは通常どおり進行すること（別のマミーが移動
  することを確認）、`player_petrified_skip`が1件だけ生成されること、連
  続命中でも消費回数が蓄積しないこと
- 優先順位：非照準・隣接時は近接攻撃すること、近接攻撃後は照準状態にな
  らないこと、非照準・射線なしでは追跡すること
- 複数敵：複数コカトリスが独立した`gazeDirection`を持つこと、一方の発
  射が他方の照準状態に影響しないこと、照準中の個体を撃破すると状態も消
  滅すること
- 回帰：同一状態内でコウモリの`retreating`・マミーの`restingAfterMove`
  と干渉しないこと
- ライフサイクル：`createInitialEnemy`／`createInitialActor`直後は
  `gazeDirection`／`petrified`が未設定であること（＝フロア移行／Enter
  再開／N新規seedでの初期化を保証する経路の確認）

`npx vitest run`で既存243件＋新規46件の計289件がすべて成功した。

## 手動確認した内容と未確認項目

このセッションはコンテナ内でのコード変更・自動テスト・ビルド検証・自動
テストとは別の使い捨てシミュレーションスクリプト（作業後削除済み）のみ
を行った。ブラウザでの実プレイ確認はユーザー側で行う想定であり、本レポ
ート作成時点では以下の`manual_validation`項目は未実施：

- 直線上へ実際に歩いて入り、照準メッセージを目視確認
- 射線上に留まって次の発射で実際に石化することの目視確認
- 石化後の入力が1回だけ無効になり、敵ターンが進むことの目視確認
- 次の入力では通常どおり行動できることの目視確認
- 照準後に横へ移動して光線を回避する操作感の確認
- 照準後に壁の裏へ移動して光線を遮る操作感の確認
- 縦・横・斜めの射線の見た目上の確認
- 隣接中は通常攻撃することの目視確認
- 複数敵がいる状態でのメッセージ順の目視確認
- Enter再開、N新規seed、次フロア移行後の状態初期化の目視確認

上記はいずれも自動テスト（一部は手動シミュレーションスクリプト）の範囲
で構造的に検証済みだが、実画面での確認は別途必要。

## 既存敵への影響確認

- `bok`/`spider`/`golem`/`sword`/`axe`/`bat`/`mummy`/`kraken`など他の
  `behaviorType`分岐には一切手を加えていない
- 新イベント追加はGameEvent判別共用体への型追加のみで、既存の敵の処理
  順・乱数消費順（`resolveEnemiesAction`の配列順反復）を変えていない
  （発射判定・照準判定とも乱数は一切使用していない）
- `applyPlayerAction`の石化チェックは既存の`slowed`チェックより前に追
  加したが、`slowed`自身のロジック・判定条件・イベントは変更していな
  い。新規テストで石化状態でも敵ターン（マミーの移動）が通常どおり進む
  ことを確認した
- 新規テストの「regression / no interference」で、同一ターン内にコカ
  トリスとコウモリ、コカトリスとマミーが混在してもそれぞれの個体状態解
  決に影響しないことを確認した
- `npx vitest run`で既存243件がすべて変更なしで成功することを確認した
  （敵数2体、配置、ターン数、終了条件は無変更）

## 発見した問題と対応

今回の実装範囲で既存の共通AI・基盤コードの不具合は発見しなかった。前述
のとおり、`player_petrified`と`player_petrified_skip`の表示文章が仕様
書内の2箇所でどちらも「体が石のように動かない。」と指定されている点だ
けは判断を要したが、矛盾というより同一文言の重複指定と解釈し、両方に指
定どおりのテキストをそのまま採用した（実装を停止するほどの対立ではない
と判断した）。

## 最終検証結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：28ファイル・289件すべて成功（既存243件＋新規46件）
- `npx vite build`：ビルド成功（バンドルサイズに関する既存の警告のみ、
  今回の変更に起因するエラーなし。生成された`dist/`は確認後に削除済み）
- `git diff --check`：問題なし
- `git status --short`：追跡対象の変更5ファイル＋新規テストファイル1件
  ＋本ドキュメント1件のみ。手動シミュレーション用の一時ファイルは作業
  後に削除済みで残っていない

## git diff要約

```
 src/game/enemy-def.ts   |  24 ++++++---
 src/game/events.ts      |  12 ++++-
 src/game/message-log.ts |  12 +++++
 src/game/turn.ts        | 127 ++++++++++++++++++++++++++++++++++++++++++++++--
 src/game/types.ts       |  25 ++++++++++
 5 files changed, 189 insertions(+), 11 deletions(-)
```

新規ファイル（`git status --short`より）：
`?? src/game/__tests__/enemy-behavior-cockatrice.test.ts`
（本ドキュメント作成後は
`?? docs/history/phase-06-cockatrice-petrifying-gaze.md`も追加）

## git status

```
 M src/game/enemy-def.ts
 M src/game/events.ts
 M src/game/message-log.ts
 M src/game/turn.ts
 M src/game/types.ts
?? src/game/__tests__/enemy-behavior-cockatrice.test.ts
```
（本ドキュメントファイル追加前の状態）

## commit可能かどうか

自動テスト・型チェック・ビルドはすべて成功しており、コード変更として
はcommit可能な状態にある。ただし本タスクの指示（`repository_rules`：
commit・push・PR作成を行わない）に従い、commitは行っていない。実画面
での`manual_validation`項目（回避操作の手触り、メッセージ表示など）を
確認したうえでのcommitを推奨する。
