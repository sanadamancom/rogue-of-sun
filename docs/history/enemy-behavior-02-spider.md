# Phase: enemy-behavior-02-spider

## 目的と対象範囲

確定済みSpider Lv1仕様（クモの巣・プレイヤー鈍足・角抜けA）を実装し、
スパイダーを経路妨害型の敵として通常プレイで固有挙動が成立する状態にした。
併せて、コウモリ・マミーなど後続敵が流用できる最小限の設置物・状態異常
基盤（`WebTile`、`Actor.slowed`、敵ごとのクールダウン管理パターン）を用意した。
毒・継続ダメージ・クモの巣の破壊/攻撃/射線遮断・敵への鈍足・状態異常の
汎用エンジン化・コカトリス/コウモリ/マミー/クラーケンの固有挙動には
着手していない。

## precheck結果

- branch: `main`、HEAD: `7e61c4b`（変更なし）
- 前4タスク（enemy-roster-foundation、enemy-roster-density-correction、
  enemy-behavior-01-melee-variants、そのcorrection）の未commit差分を
  保持したまま開始した。
- 開始時点で23ファイル・152件のテストが成功することを確認した。
- `types.ts`/`enemy-def.ts`/`state.ts`/`turn.ts`/`main.ts`の現構造、
  プレイヤー入力→`processTurn`の1ワールドターン経路、`canMove`の斜め
  移動・角抜け禁止判定（両側walkableを要求）、敵の逐次行動処理
  （`resolveEnemiesAction`、配列順、プレイヤー死亡で打ち切り）、
  フロア再開・次フロア・新規seed開始時の`buildFloorState`初期化経路を
  確認した。

## 変更ファイル一覧

- 新規：`src/game/web.ts`、`src/game/__tests__/enemy-behavior-spider.test.ts`
- 変更：`types.ts`（WebTile/Actor.slowed/EnemyActor.id・webCooldown/
  GameState.webs・nextWebId）、`turn.ts`（spider挙動全面書き換え、
  鈍足処理、web期限更新の呼び出し）、`state.ts`（webs/nextWebId初期化、
  敵idの付与）、`main.ts`（web描画、鈍足ティント描画）、
  `enemy-type.test.ts`・`turn.test.ts`（型追加に伴うfixture更新）

## spiderの行動優先順位

`resolveSpiderEnemy`（`turn.ts`）を1関数に集約し、以下の優先順位で判定する。

1. 直交隣接なら近接攻撃（斜め隣接は攻撃しない、既存仕様のまま）
2. `webCooldown<=0`かつ`canPlaceWebNow`（射程・射線・重複設置チェック）
   ならクモの巣を設置して行動終了（同じ行動中に移動・攻撃はしない）
3. 角抜けA（`tryCornerCross`）が現在位置よりプレイヤーへ厳密に近づく
   場合だけ実行
4. 通常の直交4方向追跡（既存の`SPIDER_DIRECTIONS`ロジックを
   `trySpiderChaseStep`として維持、ロジック自体は変更なし）
5. いずれも不可能なら待機

placement・corner-cross・chaseのいずれのケースでも、web設置以外の全ての
行動終了時に`decrementWebCooldown`を呼び、このスパイダー自身の
webCooldownだけを1減算する（設置した直後のターン自体は減算しない）。

## webのデータ構造

`types.ts`に`WebTile { id, pos, ownerEnemyId, placedTurn }`を追加し、
`GameState.webs: WebTile[]`・`GameState.nextWebId: number`
（生成順を兼ねる単調増加カウンタ）を持たせた。将来の状態異常全般を
先回りした大規模システムにはせず、クモの巣専用の最小構造とした。

## 射程と射線判定

`web.ts`の`hasClearLineOfSight(state, from, to, maxRange, ignoreEnemy)`が、
直交線・真対角線（`abs(dx)===abs(dy)`）のみを許可し、Chebyshev距離
（`max(abs(dx),abs(dy))`。直交・真対角のいずれでも実際のマス数と一致する）
で射程を判定する。始点（スパイダー）と終点（プレイヤー）は遮蔽物判定
から除外し、中間マスは壁または生存中の他の敵（対象スパイダー自身は除く）
で遮断する。クモの巣・出口などのfixtureは遮蔽物として扱わない。
`canPlaceWebNow`はこれに加え、対象マス（プレイヤーの現在マス）が
床であること、既存のクモの巣（所有者を問わず）が無いことを確認する。

## クールダウンと寿命の実装

- クールダウン：設置時に`enemy.webCooldown = 3`。以後、そのスパイダー
  自身のターンのたびに（設置以外の全行動終了時に）1減算。値が0以下の
  ときだけ次の設置が許可される。これにより「設置直後の次の3行動は
  設置不可、4回目の行動から再設置可能」という仕様どおりの境界になる
  （`webCooldown`の値が3→2→1→0と3回の行動をかけて減り、0になった時点の
  行動＝4回目で再設置が許可される）。他の敵の行動では一切変化しない
  （このスパイダー自身の`resolveOneEnemy`呼び出し内でしか変更されない
  ため）。
- 寿命：`placedTurn`は設置時点の`state.turn`値。`expireWebs`
  （`web.ts`）が`state.turn >= placedTurn + 6`のwebを削除する。
  `processTurn`内で「プレイヤー行動→敵の逐次行動→死亡/回復/階層判定→
  `state.turn += 1`→`expireWebs`」の順で1回だけ呼ばれるため、設置した
  ワールドターンを含めてちょうど6ワールドターン存続し、7ターン目
  （`turn`が`placedTurn+6`に達した回）の`processTurn`呼び出しで削除
  される。ゲーム終了状態（`phase !== 'playing'`）では`processTurn`が
  早期returnするため、それ以降の呼び出しで寿命が進むことはない。

## 最大2個と最古置換の実装

`placeWeb`（`web.ts`）が、設置しようとしているスパイダーの
`ownerEnemyId`が一致するwebだけを`state.webs`から抽出し、既に2個以上
持っていれば`id`が最小（＝最古）の1個だけを削除してから新しいwebを
追加する。`id`は`GameState.nextWebId`から採番される単調増加値のため、
同一ワールドターン内で複数のスパイダーがそれぞれ設置しても、各web
の生成順が配列順や`Math.random`に依存せず一意に決定される。他の
スパイダーが所有するwebは対象にしない。

## 鈍足のターン処理

- `Actor.slowed?: boolean`をプレイヤー用に追加（Actor型自体は敵とも
  共有しているが、敵側は一切参照・設定しない）。
- 発動：`applyPlayerAction`の通常移動処理内で、移動が成立した直後に
  移動先タイルにwebが存在すれば`player.slowed = true`にする。
  クモの巣がプレイヤーの現在位置へ新規設置されただけではこの分岐を
  通らないため、その場では発動しない。
- 失敗処理：`applyPlayerAction`の先頭で`player.slowed`をチェックし、
  真であれば（攻撃解決や壁判定より前に）即座に`slowed=false`へ戻し、
  座標を変更せず`consumed: true`を返す。これにより、鈍足中の
  移動入力は種類（通常移動・攻撃解決になるはずだった移動・壁への
  移動）を問わず一律に失敗し、1ワールドターンを消費し、同じ
  `processTurn`呼び出し内で敵の行動・自然回復・階層判定が通常どおり
  進む。`wait`入力は元から別分岐のため鈍足を一切消費しない。
- 重複・更新なし：`slowed`は真偽値であり、既に鈍足中に別のweb
  マスへ入っても`true`が`true`のまま変わらない（延長・二重化しない）。
  一度発動したwebはそれ自体では消滅せず、寿命またはFIFO置換でのみ
  消滅する。プレイヤーが離れてから同じwebへ再進入すれば、通常の移動
  成立処理を再度通るため、もう一度発動する。

## 角抜けAの実装

`canCornerCross(state, enemy, dir)`が、斜め方向`dir`の目的地が
床・場外でなく・プレイヤーや生存中の他の敵がいないこと、かつ現在位置と
目的地の間にある直交2マス（`sideA`/`sideB`）が両方とも非walkable
（壁または場外）であることを確認する。既存の通常斜め移動の角抜け禁止
判定（`map.ts`の`canMove`、両側walkableを要求）とは正反対の条件になる
ことを明示的にコメントした。`tryCornerCross`は`CORNER_CROSS_DIRECTIONS
= ['NE','NW','SE','SW']`の固定順で候補を評価し、Manhattan距離が最も
改善する候補を選ぶ（同距離は固定順で決定、`Math.random`不使用）。
選んだ候補の距離が現在位置の距離より厳密に小さい場合だけ実際に移動し、
改善しない場合は角抜けを使わず優先順位4（通常追跡）へ進む。角抜けを
行った行動では攻撃を行わない（優先順位1が既にその行動の冒頭で判定
済みのため、構造上重複しない）。

## 複数spider時の個体別管理

`EnemyActor.id`（フロア内の配列インデックス、`state.ts`の
`buildEnemies`が付与）でweb所有者を識別し、`webCooldown`も
`EnemyActor`ごとの独立フィールドのため、複数のスパイダーが同時に
存在してもクールダウンとweb所有権は完全に独立している
（`enemy-behavior-spider.test.ts`の「is tracked independently per
spider」「never evicts a web owned by a different spider」で確認）。

## 追加・更新したテスト

新規`enemy-behavior-spider.test.ts`（36件）を作成し、通常生成の出現
seed探索は行わず、spider・player・壁・他の敵・既存webをテスト用stateへ
明示配置する方式で以下を検証した。

- action_priority：隣接時の攻撃優先、非隣接時の設置、クールダウン中の
  角抜け/通常追跡フォールバック、いずれも不可時の待機
- web_targeting：直交/真対角の射程4内は設置可、射程5・非真対角は不可、
  壁越し/他の敵越しは不可、web越しは可、同一マスへの重複設置不可
- cooldown：初回設置可、次3行動不可、4行動目で再設置可、他の敵の行動
  では進まない、複数spiderで独立
- lifetime_and_limit：設置ターンを含む6ワールドターンで消滅、2個上限、
  3個目設置で自分の最古のみ削除、他spider所有分は削除しない
- slow：設置だけでは発動しない、移動進入で発動、次の移動失敗・1ターン
  消費、失敗後解除、待機で消費しない、重複/更新なし、離脱後再進入で
  再発動、敵は影響を受けない
- corner_crossing_a：両側壁のみ許可、片側だけの壁は不許可、両側床は
  不使用、目的地が壁/actorのいるマスは不可、複数候補時の決定的選択、
  角抜けと同一行動での追加攻撃なし
- regression：bok等他種は`webs`に一切触れず、web/角抜け関連の分岐を
  持たないことを確認

既存`enemy-type.test.ts`・`turn.test.ts`のGameState/EnemyActorリテラル
fixtureへ、型追加分（`webs: []`, `nextWebId: 0`）を追加した。これらの
テスト自体のアサーション内容は変更していない（既存のspider基本回帰
テスト・turn処理テストは、スパイダーの新しい優先順位でも従来通り
成立することを確認済み）。

## typecheck、全テスト、build、git diff checkの結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：**24ファイル / 188件全て成功**（開始時点152件 + 新規36件）
- `npx vite build`：成功（既存の500KB超チャンク警告のみ）
- `git diff --check`：問題なし

## 画面確認方法と確認結果

初回実装時の画面確認では、クモの巣の描画・鈍足ティントの出現/解除・
コンソールエラーなしのみを確認しており、以下6項目の統合確認が不足して
いた（enemy-behavior-02-spider-visual-correctionにて実施・補完）。

- 直交隣接時にクモの巣より近接攻撃を優先すること
- クモの巣設置時に同時移動しないこと
- 両側が壁の角で角抜けAが発生すること
- 開けた床では斜め移動しないこと
- 通常プレイで敵が2体だけ生成されること
- 鈍足時の失敗移動で座標が変わらず、敵ターンが進むこと

### 実施方法

一時的に`main.ts`へ、数字キー`1`〜`6`で6種の固定シナリオを構築する
デバッグハーネスと、実際の`processTurn`呼び出し直後に
`{turn, playerPos, playerHp, playerSlowed, enemiesCount, spiderPos,
spiderWebCooldown, webs}`をコンソールへ出力する`logDebugState`を追加し、
Playwright(headless Chromium)でビルド済み成果物を操作して、各シナリオの
実際のstate変化を実測した。ピクセル差分だけを根拠にせず、実際の
`GameState`の値そのもの（座標・HP・鈍足フラグ・web配列・クールダウン）
を一次証拠とし、描画はスクリーンショットで補助確認するに留めた。

### シナリオ1: melee_priority（直交隣接時の近接攻撃優先）

初期配置：player(9,7)、spider(10,7)（直交隣接）。入力：待機キー1回。

実測：`playerHp: 3→2`（攻撃発生）、`webs: []`のまま（設置なし）、
`spiderPos: (10,7)→(10,7)`（移動なし）。→ 隣接時は近接攻撃を優先し、
クモの巣設置も移動も行わないことを確認。

### シナリオ2: web_placement（射程内・非隣接での設置）

初期配置：player(9,7)、spider(13,7)（直交距離4、射程内・非隣接）。
入力：待機キー1回。

実測：`webs: [{pos:(9,7), id:0}]`（プレイヤーの現在マスへ1個生成）、
`spiderWebCooldown: 0→3`、`spiderPos: (13,7)→(13,7)`（移動なし）。
→ 設置時に同時移動しないこと、web数が1個増えること、プレイヤーの
現在マスへ設置されることを確認。描画面でも、対象マスに菱形＋
クロスハッチのweb装飾（`drawWebs`）が表示されることをスクリーンショット
で確認した。

### シナリオ3: slow_turn（鈍足の発動・失敗移動・解除・復帰）

初期配置：player(9,7)、web(10,7)（1マス東、既存配置として注入）。
入力：東移動キーを3回連続。

実測：
1. 1回目（web上へ進入）：`playerPos:(9,7)→(10,7)`、
   `playerSlowed: false→true`、`turn: 2→3`。
2. 2回目（鈍足中の移動）：`playerPos`変化なし（(10,7)のまま）、
   `playerSlowed: true→false`（解除）、`turn: 3→4`（世界ターンは進行し、
   同ターン内でspiderも実際に行動している＝敵ターンが進むことを確認）。
3. 3回目（鈍足解除後の通常移動）：`playerPos:(10,7)→(11,7)`
   （通常どおり移動成立）、`turn: 4→5`。

→ web進入で鈍足発動、次の移動入力は座標変更なしで1ターン消費、
その間も敵行動が進み、移動失敗後に鈍足が解除され、次の移動入力では
通常移動できることを実測値で確認した。

### シナリオ4: corner_crossing（角抜けAの成立と同時攻撃なし）

初期配置：spider(11,7)、その東(12,7)と南(11,8)を壁化、南東(12,8)を床、
playerを(16,12)へ離して配置（角抜け先が現在地よりプレイヤーへ近づく
配置）。入力：待機キー1回。

実測：`spiderPos: (11,7)→(12,8)`（斜め1マスの角抜けが実際に発生）、
`playerHp`は変化なし（同じ行動中に攻撃していない）。→ 両側壁の角で
角抜けAが発生すること、角抜けと同一行動中に追加攻撃しないことを確認。

### シナリオ5: open_floor（開けた床での斜め移動なし）

初期配置：spider(21,12)、player(16,12)（同一行、直交距離5、射程外＝
設置不可でchaseに落ちる状況）。入力：待機キー1回。

実測：`spiderPos: (21,12)→(20,12)`（dx=-1, dy=0の直交1マスのみ）。
→ 開けた床でのspiderの通常追跡が直交移動のみで、斜め移動を行わない
ことを確認（spiderの候補方向が元々N/S/E/Wのみに限定されている設計と
整合）。

### シナリオ6: production_generation（通常生成への影響なし）

新しいランダムseedで`restart`（通常のフロア開始経路、`createInitialState`
と同じ経路）を実行し、直後にログ出力。

実測：`enemiesCount: 2`、`turn: 0`。→ 一時的なシナリオ配置が通常生成へ
一切混入しておらず、通常プレイでは引き続き敵が2体だけ生成されることを
確認。

### 共通確認

全シナリオを通し、Playwrightのconsoleイベントでエラー・
「Texture not found」等の警告が0件であることを確認した。

### 撤去

確認後、`main.ts`をこの確認開始前のバイト列と`diff`で完全一致するまで
復元した。デバッグ用シナリオ構築コード・ログ出力コード・スクリーン
ショットは一切リポジトリへ残していない。本来のweb描画
（`drawWebs`）と鈍足ティント表示（`updatePlayerSlowedTint`）は
そのまま保持されている。

### 自動テストとの役割分担

射程・射線の細かな境界値、クールダウンの正確な行動回数境界、FIFO
置換、角抜けA成立/不成立の詳細な条件分岐など、数値的な正しさの
網羅的検証は`enemy-behavior-spider.test.ts`の36件の決定的テストが
担っている。上記の画面確認は、それらのロジックが実際の描画・入力・
`processTurn`・敵逐次行動という本番の統合経路を通しても、意図した
形でstateに反映され、画面上にも表示されることを確認するためのもので
あり、個別挙動の正しさの一次的な証明はテストに委ねている。

## 通常2体生成と9種抽選が維持されていること

`mapgen.ts`の`ENEMY_COUNT_PER_FLOOR`（2）、`state.ts`の
`chooseSpecies`（9種から独立シードRNGで抽選、重複許容）、
`buildRosterPreviewFloorState`の本番未参照は本タスクで変更していない。
`enemy-type.test.ts`・`enemy-roster-foundation.test.ts`の該当テストは
引き続き成功している。

## 既知の暫定仕様

- `EnemyActor.id`はフロア内の配列インデックスをそのまま使用している
  （敵の生成順が変わらない限り安定するが、将来的に敵の動的追加/削除が
  入る場合は採番方式の見直しが必要になる可能性がある）。
- 角抜けAの距離評価はManhattan距離を用いている（スパイダーの通常追跡
  と同じ指標に揃えている）。
- クールダウンの単位は「このスパイダー自身の行動回数」であり、
  ワールドターン数ではない（他の敵の行動やクールダウン中の攻撃・
  角抜け・通常追跡はいずれも1回としてカウントする）。

## 残課題

- コカトリス・コウモリ・マミーの固有AI設計・実装。
- クラーケンの遠隔攻撃を含む固有行動。
- 毒・継続ダメージ、クモの巣の破壊/攻撃/射線遮断、鈍足の重複・段階化、
  プレイヤー以外への鈍足、汎用状態異常エンジン化はいずれも未着手
  （out_of_scope通り）。
- 敵種ごとの出現密度・重み付け、HP/攻撃力の本調整。

## git diff要約

```
src/game/__tests__/enemy-type.test.ts |  96 ++++++---
src/game/__tests__/turn.test.ts       |   2 +
src/game/mapgen.ts                    |  38 +++-
src/game/state.ts                     |  78 +++++++-
src/game/turn.ts                      | 365 ++++++++++++++++++++++++++++++----
src/game/types.ts                     |  84 +++++++-
src/main.ts                           | 149 ++++++++++----
7 files changed, 681 insertions(+), 131 deletions(-)
```

（新規：`docs/history/enemy-behavior-02-spider.md`（本ファイル）、
`src/game/web.ts`、`src/game/__tests__/enemy-behavior-spider.test.ts`、
および前タスクまでの新規ファイル一式）

`mapgen.ts`・`state.ts`（一部）・`main.ts`（一部）・`types.ts`（一部）・
`enemy-type.test.ts`（一部）の差分は前4タスク由来のものを含む。
本タスクによる純増分はおおむね`turn.ts`の365行、`web.ts`の新設、
`types.ts`のWebTile/slowed/id/webCooldown追加、`state.ts`のwebs/nextWebId
初期化とid付与、`main.ts`のweb描画・鈍足ティント。

## git status

```
 M src/game/__tests__/enemy-type.test.ts
 M src/game/__tests__/turn.test.ts
 M src/game/mapgen.ts
 M src/game/state.ts
 M src/game/turn.ts
 M src/game/types.ts
 M src/main.ts
?? docs/history/enemy-behavior-01-melee-variants.md
?? docs/history/enemy-behavior-02-spider.md
?? docs/history/phase-06-enemy-roster-foundation.md
?? src/game/__tests__/enemy-behavior-melee-variants.test.ts
?? src/game/__tests__/enemy-behavior-spider.test.ts
?? src/game/__tests__/enemy-roster-foundation.test.ts
?? src/game/enemy-def.ts
?? src/game/web.ts
```

branch: `main`、HEAD: `7e61c4b`（いずれも変更なし）。commit、push、
PR作成は行っていない。
