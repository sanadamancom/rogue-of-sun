# Phase 16: 序盤戦闘・空間バランス調整

作成日: 2026-08-06
対象commit: `phase-16-early-game-balance`ブランチ（`main` HEAD `371e0861e6268631a85e8097a7cb31327d506f9d`から分岐）

## 1. Phase 16へ分離した理由

Phase 15試遊で、初期状態のプレイヤーが1階の基本敵「ボク」の通常攻撃1回で実ダメージ6を受けることが確認された。初期LIFEは15のため、1体目のボクとの戦闘だけで大きく消耗し、2体目の敵との遭遇まで到達しにくい。

また、40×30マップに内寸4～9×4～7の部屋を6～9室配置した状態で、敵数を1階6体・2階7体・3階8体へ増やしたため、部屋内で距離を取る・回避する・引き返すといった選択の余地が乏しい。

この2点はPhase 15の対象範囲（数値・計算式の横断調整）そのものではなく、実プレイで判明した個別の序盤バランス問題のため、独立したPhase 16として分離した。

## 2. Phase 15試遊で確認された問題

- ボクの通常攻撃1回でLIFE 15→9相当の消耗（実ダメージ6）
- 部屋が手狭で、複数の敵との交戦時に距離を取る・迂回するといった選択が成立しにくい

## 3. baseline

- repository: `https://github.com/sanadamancom/rogue-of-sun.git`
- branch: `main`
- HEAD: `371e0861e6268631a85e8097a7cb31327d506f9d`（fix: block diagonal attacks through wall corners / Phase 15.6）
- working tree: clean
- baseline時点のテスト: 71ファイル / 1806件、すべて成功
- `npx tsc -b --noEmit`、`npx vite build`ともに成功

## 4. 修正前の戦闘値とダメージ計算経路

- プレイヤー初期値（`state.ts`の`createInitialActor(placement.start, 15, 2, 0, 90, 0)`）：hp 15、attack 2、defense 0、accuracy 90、evasion 0
- ボク定義（`enemy-def.ts`）：hp 6、attack 6、defense 0、accuracy 90、evasion 0
- 敵→プレイヤーのダメージ計算式（`combat.ts`の`computeIncomingDamage`、Phase 15.1導入）：
  `max(1, round(attackerAttack * 2^(-defenderDefense/10)))`
- 初期状態・防具なし（`defenderDefense = 0`）の場合、`2^0 = 1`となるため実ダメージ = `attackerAttack`そのもの。よって`computeIncomingDamage(6, 0) = 6`となり、報告された実ダメージ6を再現した。

## 5. ボクの変更箇所と変更前後の値

`src/game/enemy-def.ts`のボク定義のみを変更した。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| attack | 6 | 3 |
| hp | 6 | 6（維持） |
| defense | 0 | 0（維持） |
| accuracy | 90 | 90（維持） |
| evasion | 0 | 0（維持） |

`computeIncomingDamage`自体・他の敵の定義・プレイヤー側の値は一切変更していない。`computeIncomingDamage(3, 0) = max(1, round(3*1)) = 3`となることをテスト（`enemy-type.test.ts`）とエンジンレベルの直接呼び出し（tsx経由）の両方で確認し、通常攻撃の最終実ダメージが3になることを確認した。

## 6. 通常攻撃の最終実ダメージが3になった根拠

- 単体テスト`enemy-type.test.ts`「bok spawns with the common-table hp (6) and attack (3) values」で`ENEMY_DEFINITIONS.bok.attack === 3`を確認
- `src/game/combat.ts`の`computeIncomingDamage(3, 0)`をNode（tsx）から直接呼び出し、戻り値3を確認
- LIFE15のプレイヤーがボクの通常攻撃を1回受けるとLIFE12、2回でLIFE9になることを、上記計算式から直接導出（既存の一連の回帰テストで防御式・命中率・最低ダメージ保証などの周辺仕様が変わっていないことも確認済み）

## 7. 維持した戦闘値

- プレイヤー攻撃力（2）
- ボクのHP（6）、ボク撃破までの必要攻撃回数（プレイヤー攻撃2×3回=6で撃破、変更なし）
- プレイヤー初期LIFE（15）
- 自然回復量・回復間隔（`turn.ts`の`REGEN_AMOUNT_PER_TICK`等、未変更）
- 防御計算式（`computeIncomingDamage`本体、`computeAttackDamage`）
- 他8種の敵の攻撃力・HP・防御・命中・回避
- 命中率、回避率、クリティカル関連の仕様（本作にクリティカルという別区分は存在せず、通常命中のみ）
- 敵数（1階6体・2階7体・3階8体、`ENEMY_COUNT_BY_FLOOR`は未変更）

## 8. マップと部屋寸法の変更前後

`src/game/mapgen.ts`の`MAP_GEN_PARAMS`のみを変更した。

| 項目 | 変更前 | 変更後 |
|---|---|---|
| width | 40 | 48 |
| height | 30 | 36 |
| roomWidth | 4～9 | 6～11 |
| roomHeight | 4～7 | 5～9 |
| roomCount | 6～9 | 6～9（維持） |
| sectionColumns / sectionRows | 3 / 3 | 3 / 3（維持） |
| sectionMargin | 1 | 1（維持） |
| extraConnections | 1～2 | 1～2（維持） |
| maxGenerationAttempts / maxConnectionAttempts | 50 / 20 | 50 / 20（維持） |

## 9. 部屋数と敵数を維持したこと

`roomCount: { min: 6, max: 9 }`と`ENEMY_COUNT_BY_FLOOR`（1階6体・2階7体・3階8体）はどちらもコード上未変更。1000seedのstress testで部屋数が範囲内に収まること、既存の敵数テスト（`phase-15-5-enemy-count-by-floor.test.ts`）が変更なしで成功することの両方で維持を確認した。

## 10. 生成アルゴリズムで変更した箇所

生成アルゴリズム本体（セクション分割、部屋配置、ルーティング、接続処理）は一切変更していない。`MAP_GEN_PARAMS`の数値のみを変更した。配置試行上限（`maxGenerationAttempts` 50、`maxConnectionAttempts` 20）は変更不要と判断し、変更しなかった（新しい寸法でも1000seed全件が生成に成功したため）。

新しい寸法での各セクションの利用可能領域は、部屋寸法の最大値を収める余地がある（例: 高さ方向はセクション毎の内部高さが概ね11前後、マージン差引後の利用可能高さが概ね9で新しい部屋高さ最大値9とちょうど一致する程度の余裕）。`placeRoomInSection`は要求最大値を利用可能領域に自動でクランプする既存実装のため、算出上の破綻は生じない。

## 11. seed stress test結果

- `npx vitest run`内の既存1000seedロバスト性テスト（`robustness.test.ts`、`phase-15-5-enemy-count-by-floor.test.ts`内の1000seedテスト等）：すべて成功
- 追加で、`generateMap`をtsx経由でseed 1～1000について直接呼び出し、以下をすべて確認：
  - 全seedで例外なく生成完了
  - 全seedでmap.width === 48、map.height === 36
  - 全seedで部屋数が6～9、各部屋の内寸が幅6～11・高さ5～9の範囲内
  - 結果: `ok: 1000, fail: 0`

## 12. カメラとブラウザ確認結果

タイルサイズ・カメラ追従ロジック・HUD配置に関わるコードは変更していない（`phase-14-5-camera.test.ts`含む既存テストは無変更のまま成功）。

**制約事項**: 本タスク実行環境のネットワーク許可リストにブラウザバイナリの取得元（`cdn.playwright.dev`）が含まれておらず、Playwrightによる実ブラウザでのスクリーンショット確認は実施できなかった。代替として、`npx vite preview`でproduction buildを起動しHTTPレスポンス200を確認した上で、`generateMap`・`computeIncomingDamage`をNode上でエンジンそのものに対して直接呼び出す形で、ブラウザが表示する内容と同一の計算結果（48×36マップ生成、部屋寸法範囲、ボク実ダメージ3）を検証した。実際の画面描画・カメラ追従・HUD崩れの目視確認は行えていない。

## 13. 試遊観察結果

上記のネットワーク制約により、ヘッドレスブラウザでの実プレイ試遊（1階を複数seedで開始し、ボク戦後の残りLIFEや2体目への到達可否を目視記録する）は実施できなかった。数値レベルでの検証（LIFE15→12→9の計算根拠、48×36・部屋拡大の生成成功）に留まる。

## 14. 更新した既存Markdown一覧

リポジトリ内には`docs/history/`以外にPhase進行を記載した既存Markdownが存在しなかった（`rogue-of-sun-development-plan.md`・`rogue-of-sun-phase15-balance-draft.md`はプロジェクト資料であり、このリポジトリのファイルではない）。README.mdにも現在のPhase番号の記載はなかったため、リポジトリ内の更新対象はこのhistory docのみとした。

## 15. Phase 26の最終調整とは別工程であること

本Phase 16は、Phase 15試遊で判明した序盤の個別バランス問題（ボクの初撃ダメージ、序盤マップの空間の狭さ）に限定した調整であり、完成版全体の階層数・敵・装備・イベントを含む最終調整（Phase 26）とは別工程である。

## 16. 追加修正：単一HTMLプレビューがボク攻撃6を表示していた不具合

### 16.1 発生した事象

Phase 16完了として最初に提示した単一HTMLプレビューを試遊したところ、戦闘ログに「ボクの攻撃！ 6ダメージを受けた。」と表示され、目標の3ダメージになっていなかった。

### 16.2 原因の切り分け

- `src/game/enemy-def.ts`（このブランチ`phase-16-early-game-balance`、HEAD `d0e0519`）上のボクの`attack`は**3で正しかった**
- `enemy-type.test.ts`のsourceレベルの単体テスト（`ENEMY_DEFINITIONS.bok.attack === 3`）は当branchで一貫してパスしていた
- 問題は、その後Enter/N再開キーの不具合を修正するために作成した別ブランチ`fix-gameover-restart-keys`を、誤って`phase-16-early-game-balance`（ボク修正・マップ拡張済み）ではなく**`main`（`371e0861`、Phase 16着手前）から分岐**させたことに起因する
- 2回目・3回目に提示した単一HTMLプレビューは、この`fix-gameover-restart-keys`ブランチのビルドから生成しており、そのブランチの`enemy-def.ts`は`main`由来のためボクの`attack`が**6のまま**だった
- `git merge-base fix-gameover-restart-keys phase-16-early-game-balance`が`371e0861`（Phase 16着手前のcommit）であることで、分岐元の取り違えを直接確認した

結論として、リポジトリの実装（`phase-16-early-game-balance`ブランチ）自体に不具合はなく、**単一HTMLプレビューの生成元ブランチを取り違えた**ことが直接原因だった（`stale_single_html`・`old_artifact_only`の複合）。このため、`enemy-def.ts`・`combat.ts`・`mapgen.ts`への追加のコード修正は行っていない。

### 16.3 再発防止として追加したもの

**実戦経路の統合テスト**（`src/game/__tests__/phase-16-runtime-combat.test.ts`、新規）：
`ENEMY_DEFINITIONS.bok`の値を直接使い、実際の`createInitialEnemy`→`processTurn`→`formatEvents`という実戦経路を通して、以下を検証する。

- 実際のボクEnemyインスタンス1体・初期状態のプレイヤー（LIFE15・attack2・defense0）で、通常攻撃1回の実ダメージが3であること
- LIFEが15→12になること
- メッセージログが正確に「ボクの攻撃！ 3ダメージを受けた。」になること
- 2回攻撃でLIFEが15→9になること
- `computeIncomingDamage(ENEMY_DEFINITIONS.bok.attack, 0)`が3であること
- ボク撃破に必要な実ダメージ合計が引き続き6（HP・プレイヤー攻撃力とも無変更）であること
- コウモリなど他の敵の実ダメージがボク修正の影響を受けていないこと（スポットチェック）

source定義だけを読む既存テストでは検出できなかった「正しいsourceから間違った成果物が作られる」という失敗モードを、実戦経路レベルで再現できるようにした。

**単一HTML生成スクリプト**（`scripts/build-single-html.mjs`、新規）：
今回の直接原因（生成元ブランチの取り違え）を機械的に防ぐため、単一HTML生成を手順化した。

- 実行前に`git status --porcelain`でworking treeがcleanであることを要求し、汚れていれば失敗させる
- 実行の度に`dist/`を削除して`vite build`を必ず再実行し、古い`dist`を絶対に使わない
- ビルド直後のファイルだけをディスクから読み直して埋め込む
- 出力ファイル名に短縮commit hashを含める（例: `rogue-of-sun-preview-d0e0519...html`）
- 出力HTMLの`<head>`内に`<meta name="build-commit">`・`<meta name="build-branch">`を埋め込み、どのcommit/branchから生成したかを事後にも確認できるようにする
- 埋め込み後、`assets/sprites/`への外部参照が残っていないことを自己検証する
- スクリプトタグの差し替えに文字列replacerではなく関数replacerを使う（`$&`等の特殊置換パターンによる事故を防ぐ、前回発生した構文エラーの再発防止も兼ねる）

### 16.4 検証

- `npx vitest run`：72ファイル・1812件すべて成功（新規6件を含む）
- `npx tsc -b --noEmit`：成功
- `npx vite build`：成功
- `scripts/build-single-html.mjs`を`phase-16-early-game-balance`のHEADに対して実行し、生成物の`<meta name="build-commit">`が実際のHEAD hashと一致すること、埋め込みbundle中にボクattack6の痕跡がないことを確認

### 16.5 実ブラウザ確認について

このタスク実行環境ではPlaywrightのブラウザバイナリ取得元にネットワークアクセスできないため、今回も実ブラウザでの目視確認・試遊は実施できていない。上記の統合テストと生成スクリプトのメタデータ検証によるコードレベルの保証に留まる。ユーザー側での実ブラウザ再試遊（ボク1回攻撃でLIFE15→12、ログが3ダメージ表示）を依頼する。

## 17. Phase 16.1：試遊で見つかった3件のランタイム不具合の統合修正

Phase 16の試遊中に見つかった以下3件を、`fix-floor-transition-sprite-crash`ブランチ（`clearMessages`修正）と`fix-gameover-restart-keys`ブランチ（Enter/N/Escape修正、`main`から誤って分岐していたため個別にcherry-pickでこのブランチ系統へ統合）から取り込んだ。単一HTML生成元の取り違えについては、既に`scripts/build-single-html.mjs`（本ファイル16章）で対応済み。

### 17.1 終了画面のEnter/N再開キー未配線

`input-router.ts`のgameoverコンテキストがconfirm/cancelキーしか処理しておらず、`N`キーのルーティングも`handleMenuConfirm`側の受け皿も存在しなかった。`isNewSeedKey`と`gameover_restart_same`/`gameover_restart_new`/`gameover_dismiss_overlay`アクションを追加し、`main.ts`の`handleRoutedKey`で`restart()`・`hideEndScreen()`へ接続した。詳細な原因分析と対応箇所は本commitの`src/game/input-router.ts`・`src/main.ts`の該当差分を参照。

### 17.2 clearMessages()の自己再帰によるフロア移行クラッシュ（根本原因）

`clearMessages()`が`this.messageLog.clear()`ではなく`this.clearMessages()`と自分自身を呼ぶタイポになっており、フロア移行のたびに無限再帰で`RangeError: Maximum call stack size exceeded`が発生していた。この例外により、直後に控えていた`resetSceneToCurrentState()`（敵スプライトの再構築を含む）が実行されずに関数全体が中断し、`enemySprites`が前フロアの敵数のまま取り残される二次被害（`TypeError: Cannot read properties of undefined (reading 'setPosition')`）を引き起こしていた。`this.messageLog.clear()`への1行修正で解消。

あわせて、根本原因とは別に、こうした不整合が再発しても致命的クラッシュにならないよう`rebuildEnemySprites()`・`snapAllEnemies()`・`applyTurnResult`の敵スプライト同期処理へ防御的なガード（未存在スプライトのスキップ、生成失敗時のプレースホルダー、destroy＋全再生成をやめてスプライトを使い回す方式への変更）を追加した。

### 17.3 単一HTML生成元のbranch取り違え（再掲）

初回のPhase 16単一HTMLがボク攻撃6のまま提示された件。原因は生成元ブランチの取り違えであり、`enemy-def.ts`自体は常に正しかった。`scripts/build-single-html.mjs`（working tree clean必須・毎回`vite build`再実行・生成物へのcommitハッシュ埋め込み・外部sprite参照の残存チェック）で再発を防止している（詳細は16章）。

### 17.4 統合方法

`phase-16-early-game-balance`ブランチへ、`fix-floor-transition-sprite-crash`（直接の子孫だったためfast-forward）と`fix-gameover-restart-keys`（`main`から分岐していたため該当commitの差分のみをcherry-pick）を取り込み、1件の"fix: repair restart and floor transition runtime errors"commitとして記録した。個別修正時に作成していた`docs/history/fix-floor-transition-sprite-crash.md`・`docs/history/fix-gameover-restart-keys.md`は本ファイルへ統合し、削除した。

## 18. Phase 16.1：序盤の資源・戦闘圧バランス調整

対象commit: `phase-16-early-game-balance`ブランチ（17章のrepair統合commit `2052eae613b9de3cf0f42591025cf9d8b55a8fcf`の続き）

### 18.1 試遊で報告された問題

- 敵が大量に接近すると処理しきれない
- アイテムドロップが少なく感じる
- 満腹度の減少が早い
- 回復のために待機すると急速に空腹になる
- 2階へ行く前に食料を拾えない場合、餓死しやすい
- 太陽銃の初期エネルギー上限15に対して消費量が少なすぎる
- 太陽銃のエンチャントも消費軽減・継戦能力を過剰にしている可能性がある

### 18.2 調査結果（変更前の実測値）

**敵の同時接敵**：`tryChaseStep`（bok/golem/sword/axe/bat/mummyが共有）・`trySpiderChaseStep`など、あらゆる敵の追跡関数に索敵範囲の概念が一切なく、スポーンした瞬間から毎ターン無条件でプレイヤーへ直進していた。48×36への拡大後もこの挙動自体は変わっていないため、探索を進めるほど遠方の敵まで同時に収束してくる構造だった。

**アイテム供給**：floor1のground itemプール11種のうち、満腹度を回復するのは`chocolate`1種のみ（`apple`はHP回復用で別役割）。`GROUND_ITEM_COUNT_WEIGHTS`の期待値4個・`drawGroundItemSelection`の一様抽選という条件から、floor1でchocolateが1つも出ない確率は理論上約(10/11)^4 ≈ 68%と算出した。1000seedの実測でも、変更前はこの理論値に近い割合でfloor1が食料0個になっていた（変更後の保証実装と合わせて68章参照）。

**満腹度と回復の交換比**（変更前）：`HUNGER_MAX=100`、`HUNGER_DECREASE_INTERVAL=4`（4ターンごとに-1）、`REGEN_TURNS_PER_HP=10`・`REGEN_AMOUNT_PER_TICK=1`（自然回復、無変更）。

| 目的 | 待機ターン数 | 満腹度消費（変更前） |
|---|---|---|
| 3ダメージ回復（ボク通常攻撃1回分） | 30 | 7 |
| 6ダメージ回復（ボク通常攻撃2回分） | 60 | 15 |

**太陽銃**：`maxSolarEnergy=15`（Phase 15.1）に対し`solarCost=1`。無強化で15連射可能。`ELEMENT_ENCHANT_ELIGIBLE_WEAPONS`（`turn.ts`）は`['sword','spear','hammer']`のみで太陽銃自身は対象外のため、太陽銃の消費を軽減するエンチャント機構はコード上存在しないことを確認した（`sol_enchantment`はメレー武器へsol属性を付与するだけで、太陽銃のsolarCost計算には一切関与しない）。

### 18.3 実装した変更

**敵の同時接敵**（`src/game/turn.ts`）：
`resolveOneEnemy`に索敵範囲ゲートを追加した。`AGGRO_RANGE = 8`（Chebyshev距離）、すでに隣接している敵は常に行動する。範囲外の敵は移動・攻撃・各種固有の内部処理（webクールダウン減少、退避/休息フラグ等）を一切行わない。視界（FOV/LOS）システムではなく、単純な距離しきい値。

**食料供給**（`src/game/state.ts`）：
floor1限定で、`drawGroundItemSelection`の結果に`chocolate`が含まれていなければ、最後の抽選枠を`chocolate`へ置き換える。総アイテム数・placement処理・RNG消費順序は変更しない。floor2以降は無変更（プールが累積的に拡大するため相対的にリスクが下がる）。

**満腹度**（`src/game/hunger.ts`）：
`HUNGER_DECREASE_INTERVAL`を4→5へ変更。`HUNGER_DECREASE_AMOUNT`（1）・`HUNGER_MAX`（100）・自然回復関連定数（`REGEN_AMOUNT_PER_TICK`・`REGEN_TURNS_PER_HP`、`turn.ts`）は無変更。

**太陽銃**（`src/game/weapon-def.ts`）：
`solarCost`を1→3へ変更。`attackPower`（1）・`reach`（5）は無変更。エンチャント側の追加調整は、上記調査の結果、対象となる既存メカニズムが存在しないため実施しなかった。

### 18.4 変更後の値

| 項目 | 変更前 | 変更後 |
|---|---|---|
| 敵の索敵範囲 | 無制限（常時追跡） | Chebyshev距離8 |
| floor1食料保証 | なし（理論上約68%のseedで0個） | 1000seed全件で最低1個保証 |
| HUNGER_DECREASE_INTERVAL | 4 | 5 |
| 3ダメージ回復の満腹度消費 | 7 | 6 |
| 6ダメージ回復の満腹度消費 | 15 | 12 |
| 太陽銃solarCost | 1 | 3 |
| 満タン(15)からの連射可能回数 | 15回 | 5回 |

### 18.5 測定結果

**同時接敵（30seed、floor1スポーン時点）**：Chebyshev距離8以内にいる敵の数の分布は平均0.70・最大2（30seed中、3以上は0件）。数値例：`[2,0,0,2,2,0,1,1,0,1,1,0,0,0,2,1,1,1,1,0,1,1,1,0,0,0,0,1,1,0]`。1対1が基本、時々1対2、1対3以上が序盤の通常状態にならないというbalance_targetsに合致することを確認した。

**注記**：この測定はフロア生成直後（ターン0）の静的な位置関係のみを対象としており、探索を進めた後の動的な接敵パターン（プレイヤーが移動するにつれて追加の敵が索敵範囲へ入ってくる推移）までは追跡していない。より厳密な検証には、複数seedでの自動探索シミュレーションが必要。

**アイテム供給（1000seed、floor1）**：平均アイテム数4.00個/フロア（変更前後で不変、`GROUND_ITEM_COUNT_WEIGHTS`は無変更のため）。chocolate出現率は1000/1000（100%、保証実装により)。参考値としてapple出現率は286/1000（28.6%、無保証のまま）。

**手動試遊について**：このタスク実行環境には実ブラウザがなく、人間のプレイヤーと同様の判断を伴う手動試遊は実施できていない。上記はすべてゲームエンジンの関数（`createInitialState`・`processTurn`等）をNode上から直接呼び出した計算・集計であり、画面を見ながらの主観的なプレイフィールの確認ではない。ユーザー側での実プレイ確認を推奨する。

### 18.6 テスト

- `src/game/__tests__/phase-16-1-aggro-range.test.ts`（新規5件）：索敵範囲の境界値（範囲外で停止、境界で追跡開始、範囲内は従来どおり、隣接時は範囲によらず攻撃、範囲内に入ってから追跡再開）
- `src/game/__tests__/phase-16-1-solar-gun-rebalance.test.ts`（新規3件）：solarCost=3、満タンから5発、攻撃力/射程は無変更
- `src/game/__tests__/hunger-food-starvation.test.ts`：chocolate関連テストを、旧仕様「floor1でも出ないことがある」から新仕様「floor1は1000seed全件で最低1個保証」へ置き換え
- 既存の敵配置座標に依存するテスト（`phase-12-2-slow-trap.test.ts`・`phase-12-3-poison-trap.test.ts`・`phase-12-4-curative-items.test.ts`・`enemy-behavior-bat.test.ts`・`enemy-behavior-kraken.test.ts`）：索敵範囲の導入で「遠く離れた敵は動かない」という前提に変わったため、各テストの意図（トラップ処理・退避処理・薙刀範囲判定など）を保ったまま敵/プレイヤーの座標を索敵範囲内へ調整
- 太陽銃solarCost変更に伴うテスト（`phase-09-2-solar-gun.test.ts`・`phase-10-1-sol-enchant.test.ts`・`phase-10-2-combat-stat-scale.test.ts`・`phase-10-3-1-telemetry.test.ts`・`phase-10-3-accuracy-evasion.test.ts`）：期待消費量を1→3へ更新
- 満腹度間隔変更に伴うテスト（`phase-10-3-1-telemetry.test.ts`のsatiety.minテスト）：期待ターン数を4→5へ更新
- `npx vitest run`：74ファイル・1820件すべて成功
- `npx tsc -b --noEmit`：成功
- `npx vite build`：成功

### 18.7 out_of_scopeとの整合

マップ・部屋寸法、プレイヤー攻撃力・初期LIFE、ボクHP/attack、他の敵の攻撃力、自然回復量・間隔、太陽銃の攻撃力・射程、新アイテム・新敵・視界システムの追加、いずれも変更していない。

## 19. Phase 16.2：自然回復・満腹度の再調整と通路入口の視認性改善

対象commit: `phase-16-early-game-balance`ブランチ（Phase 16.1のcommit `c68488a946fcc553175e82bc38961fe81553607b`の続き）

### 19.1 テストプレイ者からのフィードバック

Phase 16.1版の試遊後、以下3件の追加フィードバックを受けた。

- HPの自然回復は1ターンに1回復でよい
- 満腹度は10ターンに1減少でよい
- 大きな部屋に入った際、進める通路の最初の1マスが見えると進みやすい

### 19.2 変更前の値

- `REGEN_TURNS_PER_HP = 10`、`REGEN_AMOUNT_PER_TICK = 1`（`src/game/turn.ts`）
- `HUNGER_DECREASE_INTERVAL = 5`、`HUNGER_DECREASE_AMOUNT = 1`（`src/game/hunger.ts`、Phase 16.1で4→5にした値）

| 項目 | 変更前 |
|---|---|
| 3ダメージ回復に必要な待機ターン | 30 |
| 6ダメージ回復に必要な待機ターン | 60 |
| 3ダメージ回復中の満腹度消費 | 6 |
| 6ダメージ回復中の満腹度消費 | 12 |
| 満腹度100から0到達までの行動可能ターン数 | 500 |

### 19.3 実装した変更

**自然回復**（`src/game/turn.ts`）：`REGEN_TURNS_PER_HP`を10→1へ変更。`REGEN_AMOUNT_PER_TICK`（1）は無変更。LIFE最大未満の通常ターン経過ごとに1回復する。

**満腹度**（`src/game/hunger.ts`）：`HUNGER_DECREASE_INTERVAL`を5→10へ変更。`HUNGER_DECREASE_AMOUNT`（1）・満腹度最大値・空腹/餓死処理・食料の回復量は無変更。

**通路入口の視認性**（`src/game/mapgen.ts`の新規`getRoomCorridorEntrances`関数 + `src/main.ts`）：
部屋の四辺それぞれについて、部屋の境界のすぐ外側（1マス分）にある床タイルを走査し、通路の入口タイルとして返す純粋関数を`mapgen.ts`に追加した。この走査ロジックは既存の`doorway-rule.test.ts`（100 seedで検証済み）と同じ境界スキャン方式を再利用しており、部屋同士が接触・重複しないという既存の生成規則により、この1マス外側のリングにある床タイルは必ずその部屋自身に接続する通路の入口タイル（幅1マスの一意な戸口）であることが保証されている。

`main.ts`の`markCameraWindowExplored()`（毎ターンの描画更新で呼ばれる、カメラウィンドウ内を探索済みにする既存処理）に、プレイヤーが現在いる部屋を`roomIndexContaining`で判定し、その部屋の`getRoomCorridorEntrances`が返す入口タイルも同じ`exploredTiles`（探索済み判定用の配列、GameStateの外側で管理される描画専用データ）へ加える処理を追加した。既存の可視履歴（`exploredTiles`）の仕組みをそのまま流用しているため、探索済みとして記憶される・移動可否には一切影響しない・GameState/seed/RNG/telemetryに影響しないという既存仕様をそのまま踏襲している。

### 19.4 変更後の値

| 項目 | 変更後 |
|---|---|
| 3ダメージ回復に必要な待機ターン | 3 |
| 6ダメージ回復に必要な待機ターン | 6 |
| 3ダメージ回復中の満腹度消費 | 0（3ターン<10ターン間隔のため） |
| 6ダメージ回復中の満腹度消費 | 0（6ターン<10ターン間隔のため） |
| 満腹度100から0到達までの行動可能ターン数 | 1000 |

自然回復が10倍速くなったことで、軽度の被弾からの回復に必要な待機ターンが大幅に短縮され、かつ満腹度消費もほぼ発生しなくなった（10ターン未満の待機では満腹度が全く減らないため）。

### 19.5 通路入口表示の正確な仕様

- 対象：プレイヤーが現在立っている部屋（`roomIndexContaining`で判定）に直接接続するすべての通路
- 表示範囲：各通路につき、部屋の境界から1マス外側にある床タイル1つだけ（`getRoomCorridorEntrances`が返す集合そのもの）
- 壁越しの床、接続していない近接の通路、2マス目以降は一切表示しない（走査範囲を境界の1マス外側リングだけに限定しているため、原理的に含まれない）
- 表示は`exploredTiles`（既存の探索済み判定）に加えるだけで、GameState・移動可否・RNG消費には影響しない
- 部屋の大小に関わらず同じ`roomIndexContaining`/`getRoomCorridorEntrances`を使うため、小さい部屋でも同様に動作する

### 19.6 固定seedでの検証

`src/game/__tests__/phase-16-2-corridor-guidance.test.ts`（新規）で、Phase 16の最大部屋寸法（幅6-11・高さ5-9）に近い大部屋を含むことを事前に確認した3つの固定seed（6, 9, 10）を使い、以下を検証した。

- 全ての部屋で最低1つの入口タイルが見つかる
- 返されるタイルはすべて床であり、壁ではない
- 返されるタイルは部屋の境界から正確に1マス外側のリング内にのみ存在する（それより遠い位置は返されない）
- 返されるタイルはどの部屋の矩形にも属さない（`roomIndexContaining`で-1になる、すなわち通路/戸口タイルである）
- 入口数が境界リングの床タイル総数と一致する（二重カウントや取りこぼしがない）
- マップ端に接する部屋（合成マップでの単体テスト）では、存在しない側のリングを走査しないことを確認

### 19.7 テスト・検証

- `src/game/__tests__/phase-16-2-corridor-guidance.test.ts`（新規5件）：上記
- `src/game/__tests__/hunger-food-starvation.test.ts`：`REGEN_TURNS_PER_HP`の期待値を10→1へ更新
- 自然回復が毎ターン発火するようになったことで、既存の多数のテスト（敵の1ターン攻撃後のHP検証、armor/poison/telemetry関連）が「被ダメージ+同ターン回復」の相殺を考慮していなかったため、影響を受けたテストファイルすべての期待値をこの相殺を反映した値へ更新した（`weapon-and-sword.test.ts`・`spear-reach-weapon.test.ts`・`turn.test.ts`・`armor-and-golem.test.ts`・`enemy-behavior-melee-variants.test.ts`・`enemy-behavior-spider.test.ts`・`enemy-behavior-kraken.test.ts`・`enemy-roster-foundation.test.ts`・`enemy-type.test.ts`・`facing-and-action-controls.test.ts`・`hammer-knockback-weapon.test.ts`・`inventory-and-apple.test.ts`・`multi-floor.test.ts`・`phase-09-1-solar-energy-foundation.test.ts`・`phase-09-2-solar-gun.test.ts`・`phase-10-2-combat-stat-scale.test.ts`・`phase-10-3-accuracy-evasion.test.ts`・`phase-16-runtime-combat.test.ts`・`phase-12-3-poison-trap.test.ts`）
- **副次的に発見・修正した既存バグ**：`telemetry.ts`の`recordTurn`が自然回復のactualHealingを「ターン開始時から終了時までのHP差分」という粗い方法で計算していたため、同一ターンにアイテム使用など他の回復も発生すると、その分まで自然回復側の集計へ誤って混入していた。これはPhase 16.1以前（`REGEN_TURNS_PER_HP=10`）はほぼ表面化しなかったが、毎ターン回復するようになったことで容易に再現するようになった。`turn.ts`の`TurnResult`に`playerRegenAmount`（回復ティック自身の増分だけを保持する新フィールド）を追加し、`telemetry.ts`側はその値をそのまま使うよう修正した（`phase-10-3-1-telemetry.test.ts`・`phase-10-3-3-damage-recovery-fix.test.ts`・`phase-10-3-3a-healing-field-rename.test.ts`を対応する期待値に更新）
- `npx vitest run`：76ファイル・1829件すべて成功
- `npx tsc -b --noEmit`：成功
- `npx vite build`：成功

### 19.8 実ブラウザ確認について

このタスク実行環境には実ブラウザがなく、通路入口表示・自然回復・満腹度変化の実際の見た目・プレイ感覚の確認はできていない。`main.ts`（Phaser Scene）はこのリポジトリのvitestスイートの対象外（DOM/Phaser環境が構成されていない）であり、`markCameraWindowExplored`への変更自体への直接的なユニットテストも追加できていない。`getRoomCorridorEntrances`という純粋関数部分のみ、上記の固定seedテストで検証済み。ユーザー側での実プレイ確認を推奨する。

## 20. Phase 16 正式終了：Phase 16.2の実ブラウザ試遊とbaseline採用

### 20.1 実施内容

ユーザーがPhase 16.2版の単一HTMLを実ブラウザで試遊した。3階まで容易にクリアできた。自然回復が1ターンにつきLIFE1になったことで、序盤の戦闘ではほぼ常時ほぼ全回復を維持できる状態だった。

現時点では3階構成かつ序盤の敵（1階6体・2階7体・3階8体、いずれもPhase 16.1で導入した索敵範囲8の範囲内での軽量な敵構成）のみであり、より深い階層や強敵が実装された後の難易度は今回の試遊だけでは評価できない。

### 20.2 判断

- 自然回復（`REGEN_TURNS_PER_HP=1`）、満腹度（`HUNGER_DECREASE_INTERVAL=10`）、floor1食料最低1個保証、敵索敵距離8、太陽銃solarCost 3など、SOL・食料・敵関連の追加調整は今回行わない
- Phase 16.3（追加のバランス調整）は実施しない
- Phase 16.2で採用した以下の仕様を、現行のbaselineとして正式採用する
  - 自然回復：1ターンにつきLIFE 1
  - 満腹度減少：10ターンにつき1
  - 部屋から接続する通路入口1マスの表示
  - ボクattack 3
  - 敵索敵距離8（Chebyshev）
  - 1階の食料（chocolate）最低1個保証
  - 太陽銃solarCost 3
  - マップ48×36、部屋内寸6～11×5～9
  - 階層別敵数1階6体・2階7体・3階8体
- 後半階層・強敵が実装された時点で、自然回復の速さと食料経済（floor1限定の食料保証が後半階層でも十分かを含む）を改めて評価する

### 20.3 今後の方針

Phase 16をここで正式に終了し、mainへ統合する。Phase 17（視界・暗い区画）へ進む。
