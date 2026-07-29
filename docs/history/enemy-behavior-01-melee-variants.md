# Phase: enemy-behavior-01-melee-variants

## 目的と対象範囲

ボク・ゴーレム・ソード・アックスの4種へ、暫定的な行動速度・攻撃タイミング
の差を追加した。4種を実際に動かしたとき、以下の役割差を認識できる。

- ボク：標準速度・標準攻撃（従来通り、変更なし）
- ゴーレム：2ワールドターンに1回だけ行動する低速・高威力
- ソード：1ワールドターンで最大2マス接近できる高速接近型
- アックス：攻撃した次のターンは必ず1回休む高威力・隙のある近接型

完成版AI、細かなバランス調整（HP/攻撃力の本調整）、コカトリス・スパイダー・
コウモリ・マミー・クラーケンの固有挙動には着手していない。

## 変更前の状態（precheck）

- branch: `main`、HEAD: `7e61c4b feat: add spider enemy type`（変更なし）
- 前2タスク（enemy-roster-foundation、enemy-roster-density-correction）の
  未commit差分を保持したまま開始した。
- 開始時点で22ファイル・129件のテストが成功することを確認した。
- `enemy-def.ts`はbehaviorTypeが4種類（generic_melee/spider_cardinal/
  placeholder/stationary）で、bok/golem/sword/axeは全てgeneric_melee
  だった。
- `turn.ts`のresolveOneEnemyはbehaviorTypeでディスパッチする構造が既に
  あり、今回はケースを追加するだけで拡張できた。
- プレイヤー1行動につき、生きている敵が配列順に1回ずつ行動する
  （`resolveEnemiesAction`）。先に行動した敵の新しい座標は、後続の敵の
  障害物判定にそのまま反映される（既存仕様、変更なし）。

## behaviorTypeの追加（`enemy-def.ts`）

`BehaviorType`へ`slow_melee`（golem）・`fast_melee`（sword）・
`recovery_melee`（axe）を追加した。bokは`generic_melee`のまま変更していない。
hp/attackの値は bok=**3**/1, golem=8/3, sword=4/2, axe=6/3
（`provisional_roles`で明示されたbok hp=3を採用。後述の
enemy-behavior-01-melee-variants-correctionにて、既存値2からこの明示値へ
訂正した）。

## 追加した状態データ（`types.ts`）

`EnemyActor`へ以下の2つのoptionalフィールドを追加した。

- `spawnTurn?: number`：その敵が生成された時点のワールドターン数
  （`GameState.turn`）を記録する。golemの行動フェーズ判定
  `(state.turn - spawnTurn) % 2`にのみ使用する。新しいカウンターを
  追加するのではなく、既存のturn番号を敵ごとに固定された1点の基準値
  （アンカー）として参照するだけなので、「既存ターン番号を利用し、
  重複カウンターを追加しない」という指示に沿っている。フロア再生成時は
  新しい`createInitialEnemy`呼び出しで必ず現在のturn値がspawnTurnとして
  設定されるため、フロアをまたいで累積するturn値の偶奇に関わらず、
  各フロアの最初の敵ターンは必ずphase 0（行動可能）になる。Enter同一
  seed再開・N新規seed開始でも、状態は毎回新規生成されるため個体状態は
  一切引き継がれない。
- `recovering?: boolean`：axeが攻撃した直後にtrueとなり、次の敵行動で
  強制的に待機（移動も攻撃もしない）した後falseへ戻る。ソードには
  恒久的な追加状態を導入していない（1ワールドターン内の処理だけで完結
  するため）。

`createInitialEnemy`は`spawnTurn`を第5引数（デフォルト0）として受け取り、
`recovering: false`で初期化するよう変更した。

## 行動順と速度処理（`turn.ts`）

既存の`resolveBokEnemy`から、攻撃判定・追跡1歩移動のロジックを
`tryMeleeAttack` / `tryChaseStep`という2つの共通関数へ抽出した
（8方向近接系の全behaviorTypeで共有）。bok自体の外部から見た挙動は
変更していない。

- `resolveGolemEnemy`（slow_melee）：`(state.turn - spawnTurn) % 2`で
  phaseを判定。phase≠0の休みターンは`tryMeleeAttack`を一切呼ばず、
  隣接していても攻撃しない。phase=0の行動ターンはbokと同じ
  （隣接なら攻撃、そうでなければ1歩追跡）。
- `resolveSwordEnemy`（fast_melee）：ターン開始時に隣接していれば即攻撃
  して終了。非隣接なら1歩移動→隣接になったら攻撃して終了（2歩目へ
  進まない）→まだ非隣接なら2歩目移動（この2歩目移動後に隣接しても
  そのターンには攻撃しない）。1ターン内の攻撃は最大1回。
- `resolveAxeEnemy`（recovery_melee）：`recovering`がtrueならその場で
  何もせずフラグをfalseへ戻すだけ（強制休み）。そうでなければbokと同じ
  攻撃/追跡を行い、攻撃した場合のみ`recovering`をtrueにする。移動だけ
  では`recovering`を立てない。

`resolveOneEnemy`のswitch文へ`slow_melee`/`fast_melee`/`recovery_melee`
の3ケースを追加した。`generic_melee`と`placeholder`は従来通りbok流用
（cockatrice/bat/mummyの暫定挙動、krakenのstationary処理には触れていない）。

`state.ts`の`buildEnemies`は、そのフロアの開始ターン値（`buildFloorState`
の`turn`引数）を全敵の`spawnTurn`として渡すよう変更した
（`buildRosterPreviewFloorState`経由の全9種同時生成でも同様）。

## テストで対象敵を明示配置した方法

新規`enemy-behavior-melee-variants.test.ts`を作成し、
`createInitialState`や`buildRosterPreviewFloorState`（種類抽選PRNGや
通常2体構成に依存する経路）を一切使わず、turn.test.tsと同様の
「小さな固定マップ＋`createInitialActor`/`createInitialEnemy`を直接呼ぶ
GameStateリテラル」方式で、対象敵1体だけを望みの座標・turn値・spawnTurn
値で明示配置する`singleEnemyState()`ヘルパーを用意した。これにより、
速度・攻撃・硬直だけを、通常生成の出現seed探索なしに直接検証できる。
この明示配置はテストファイル内だけで完結しており、通常プレイの生成仕様
（`state.ts`のchooseSpecies/buildFloorState）へは一切混入していない。

## テスト結果

- 新規`enemy-behavior-melee-variants.test.ts`：22件追加、全て成功。
  - bok：1歩ずつ接近、隣接時attack1で攻撃、1ターン1回まで
  - golem：生成直後の最初の敵ターンは行動、次は待機、以降交互、
    休みターンは隣接していても攻撃しない、再生成で常にphase 0へ戻る
  - sword：直線で1ターン2マス接近、1歩目で隣接なら攻撃して2歩目なし、
    2歩目で初めて隣接した場合はそのターン攻撃しない、開始時点で隣接
    なら移動せず即攻撃、1ターン最大1攻撃、壁・他actorを飛び越えない
  - axe：1歩ずつ接近、隣接時attack3、攻撃直後の次ターンは強制待機
    （隣接していても攻撃しない）、待機後は通常へ復帰
  - shared：4種とも壁・マップ外へ移動しない、同一状態・同一入力列で
    決定的、プレイヤー死亡後は後続敵が行動しない
- 既存`enemy-roster-foundation.test.ts`の該当テスト名を、golem/sword/axe
  がもはや一律generic_melee流用ではなくなったことに合わせて更新し、
  golemのphase判定がループ順に依存しないよう`state.turn`を各敵の
  `spawnTurn`へ明示的に再アラインするよう修正した（アサーション内容
  そのものは変更していない：3種とも最初の行動機会で隣接プレイヤーへ
  攻撃することを引き続き確認している）。
- `npx tsc --noEmit`：エラーなし。
- `npx vitest run`：**23ファイル / 151件全て成功**（開始時点129件 + 新規22件）。
- `npx vite build`：成功（既存の500KB超チャンク警告のみ）。

## 画面確認結果

初回実装時は`vite preview` + Playwrightでコンソールエラー・テクスチャ
警告がないことのみを確認し、「4種を画面上に表示して数ターン操作し、速度差・
待機・硬直を確認する」という表示・操作の統合確認は未実施だった。
enemy-behavior-01-melee-variants-correctionにて、以下の通り実施した
（内容は本ファイル末尾の「補正（enemy-behavior-01-melee-variants-
correction）」節を参照）。

## 通常2体生成と9種抽選が維持されていること

- `mapgen.ts`の`ENEMY_COUNT_PER_FLOOR`（2）、`state.ts`の
  `chooseSpecies`（9種から独立シードRNGで抽選、重複許容）、
  `buildRosterPreviewFloorState`が本番コード（`main.ts`）から参照
  されていないことは、いずれも本タスクで変更していない。
- `enemy-type.test.ts`・`enemy-roster-foundation.test.ts`の該当テストは
  引き続き成功しており、通常フロア2体・全9種抽選候補・roster preview
  分離の仕様が壊れていないことを確認済み。

## 既知の暫定仕様

- golemの行動フェーズは`spawnTurn`アンカー＋既存turn番号の偶奇で判定し
  ており、独立した新規カウンターは追加していない。
- ソードの2歩移動、アックスの硬直は「1ワールドターン＝1回の
  `resolveOneEnemy`呼び出し」の中で完結する設計とした。

## 残課題

- コカトリス・スパイダー・コウモリ・マミーの固有AI設計・実装。
- クラーケンの遠隔攻撃を含む固有行動。
- 敵種ごとの出現密度・重み付け（現状は均等抽選のみ）。
- HP/攻撃力の本調整、状態異常、ドロップ、経験値、ボス処理。

## git diff要約

```
src/game/__tests__/enemy-type.test.ts |  94 +++++++++++++------
src/game/mapgen.ts                    |  38 +++++---
src/game/state.ts                     |  73 +++++++++++++--
src/game/turn.ts                      | 171 +++++++++++++++++++++++++++++-----
src/game/types.ts                     |  37 +++++++-
src/main.ts                           |  96 ++++++++++++-------
6 files changed, 401 insertions(+), 108 deletions(-)
```

（新規：`docs/history/phase-06-enemy-roster-foundation.md`、
`docs/history/enemy-behavior-01-melee-variants.md`（本ファイル）、
`src/game/__tests__/enemy-roster-foundation.test.ts`、
`src/game/__tests__/enemy-behavior-melee-variants.test.ts`、
`src/game/enemy-def.ts`）

`src/main.ts`・`mapgen.ts`・`state.ts`・`types.ts`・
`enemy-type.test.ts`の差分は前2タスク由来のものを含む（本タスクでは
`types.ts`のEnemyActorへのフィールド追加、`state.ts`のspawnTurn引き渡し
のみを追加）。`turn.ts`の大部分の増分が本タスクによるもの。

## git status

```
 M src/game/__tests__/enemy-type.test.ts
 M src/game/mapgen.ts
 M src/game/state.ts
 M src/game/turn.ts
 M src/game/types.ts
 M src/main.ts
?? docs/history/enemy-behavior-01-melee-variants.md
?? docs/history/phase-06-enemy-roster-foundation.md
?? src/game/__tests__/enemy-behavior-melee-variants.test.ts
?? src/game/__tests__/enemy-roster-foundation.test.ts
?? src/game/enemy-def.ts
```

branch: `main`（変更なし）、HEAD: `7e61c4b`（変更なし）。commit、push、
PR作成は行っていない。

## 補正（enemy-behavior-01-melee-variants-correction）

初回実装への2点の指摘を受けて補正した。

### 1. bok.hp の訂正

- `enemy-def.ts`のbok定義を`hp: 2`から`hp: 3`（`provisional_roles`の明示値）
  へ変更した。attack=1、behaviorType=generic_melee、毎ターン1歩の移動は
  変更していない。他8種のhp/attack/behaviorTypeも変更していない。
- `enemy-type.test.ts`の該当テストを、`bok.hp = 2`と手動代入してから
  同じ値を検証するだけの実質的なトートロジーだったものから、
  `ENEMY_DEFINITIONS.bok`の実際の値（hp=3, attack=1）と、
  `createInitialEnemy`で生成した個体が実際にhp=3を持つことを検証する
  形へ書き換えた。あわせて「合計3ダメージで撃破される」ことを確認する
  テストを追加した（`Math.max(0, hp - 3) === 0`）。
- 共通ダメージ処理・撃破条件（`turn.ts`のapplyPlayerAction/
  resolveEnemiesAction）は変更していない。

### 2. 画面上での統合確認

一時的に`main.ts`へ確認専用のキー（`v`）を追加し、押下時に
`state.enemies`をbok・golem・sword・axeの4体（enemy-defから実際のhp/
attackを取得、`createInitialEnemy`で生成、プレイヤー付近へ配置）へ
差し替えるデバッグハーネスを組み込んだ上で、以下を実施した。

1. `npx vite build`でビルドし、`vite preview`でホスティング。
2. Playwright(headless Chromium)でページを開き、`v`キーで4体を配置。
3. 待機キー（スペース）を6回連続で押下し、実際の描画・入力・敵ターン
   処理（`processTurn`→`resolveEnemiesAction`→アニメーション）を通して
   フレームごとにスクリーンショットを取得。
4. 連続フレーム間のピクセル差分を計測したところ、変化量が全フレームで
   一様ではなく（例: 2718px変化する遷移が続く中、1回だけ820pxしか
   変化しない遷移が発生）、これはgolemが休みターンで静止する一方、
   bok/sword/axeが動く・攻撃するターンとの非一様性に整合する。
5. コンソールログ・pageerrorを監視し、エラー・テクスチャ未検出警告が
   0件であることを確認した。
6. 確認後、`main.ts`をこの確認開始前のバイト列と完全一致するまで復元し
   （`diff`でバイト単位一致を確認済み）、デバッグキー・ログ・
   スクリーンショットは一切リポジトリへ残さなかった。

この確認は「表示・操作の統合に問題がないこと」を確かめる簡潔な確認と
位置づけており、速度差・待機・硬直の正しさそのものは
`enemy-behavior-melee-variants.test.ts`の決定的テスト（22件）で
既に検証済みという整理を維持している。

### 補正後の検証結果

- `npx tsc --noEmit`：エラーなし。
- `npx vitest run`：**23ファイル / 152件全て成功**（151件 + bok撃破テスト1件）。
- `npx vite build`：成功。
- `git diff --check`：問題なし（空白関連のエラーなし）。
- `main.ts`は補正前後で完全に同一（一時ハーネスは復元済み）。
