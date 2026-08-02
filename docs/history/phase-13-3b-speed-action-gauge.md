# Phase 13.3b ハヤサと敵actionGauge方式の実装

## 目的

ハヤサのランクによって敵の行動頻度を決定論的に低下させる。Phase
13.3bでは全敵速度を100固定とし、敵別速度は導入しない。rank0では既存
の敵行動回数・処理順・RNG消費順を完全に維持し、プレイヤー基準の時間
経過処理（満腹度・毒・自然回復・SOL回復・activeEffects）は現状のまま
変更しない。

## precheck結果

- 起点: ローカルcommit `39f5be5`（ブランチ`phase-13-3a-ability-numeric-effects`、Phase 13.3a完了時点）
- HEAD: `39f5be5`（一致）
- working tree: clean
- origin/main: `b6dd0c6`のまま（Phase 13.3aはpush済みでないため一致は不要、想定どおり）
- 既存テスト: 58ファイル / 1370件、全成功
- `npx tsc --noEmit`: エラーなし

### 実装地点の調査結果

- `EnemyActor`型定義（`types.ts`）：`spawnTurn?`/`webCooldown?`等、既に
  「オプショナルフィールド＋読み取り時`?? 0`/`?? false`デフォルト」と
  いう統一パターンが存在することを確認したが、`actionGauge`は確定仕様
  （フロア開始時・新規生成敵とも厳密に0であること）に合わせ、後述の補
  正により**必須フィールド**として実装した（`recovering`/`webCooldown`
  も`createInitialEnemy`内で明示的に初期値を設定している点は同じ）
- 全`EnemyActor`生成地点：本番は`state.ts`の`buildEnemies`から
  `turn.ts`の`createInitialEnemy`を呼ぶ1箇所のみ
- テスト用`EnemyActor`生成ヘルパー：264箇所中263箇所が`createInitialEnemy`
  ファクトリを使用（`actionGauge`は同ファクトリ内で明示初期化されるた
  め個別更新不要）。唯一の例外である`enemy-type.test.ts`の2箇所（オブ
  ジェクトリテラル直書き）のみ`actionGauge: 0`を個別追加した
- `resolveEnemiesAction`（`turn.ts`）：生存敵を`state.enemies`配列の固
  定順で1体ずつ`resolveOneEnemy`を1回呼ぶ構造
- `resolveOneEnemy`：behaviorType別ディスパッチのみ、内部ロジックは変
  更対象外
- `allocateAbilityPoint`（`ability.ts`）：body/mind分岐と同じ箇所へ
  speed分岐を追加可能な構造であることを確認
- フロア生成・フロア遷移時の敵生成：`buildFloorState`が毎回
  `createInitialEnemy`で新規`EnemyActor`を作るため、`actionGauge`は
  同ファクトリ内の明示初期化により厳密に0となることを確認
- プレイヤー消費ターン後の時間経過処理：`applyHungerProgression`・
  `applyPoisonTick`・自然回復・`advanceEffectDurations`はいずれも
  `resolveEnemiesAction`の**外側**、`processTurn`内で1回だけ呼ばれる独
  立処理であることを確認（変更不要）
- 敵配列処理順：`for (const enemy of state.enemies)`の固定順
- プレイヤー死亡時の中断：`if (!state.player.alive) break;`で外側
  ループを即座に中断

条件が一致したため実装へ進んだ。

## 確定仕様

- ランク上限：10（Phase 13.3aで実装済みのものを流用、変更なし）
- プレイヤー速度：`100 + 10 × speedRank`
- 敵速度：Phase 13.3bでは全敵共通100固定。敵別速度テーブルは導入せず、
  `EnemyActor`へ`speed`フィールドは追加していない
- `actionGauge`初期値：0。`EnemyActor`の**必須フィールド**として定義
  し、`createInitialEnemy`（本番唯一の生成地点）が返却するオブジェク
  ト内で常に`actionGauge: 0`を明示する。新規生成敵・フロア遷移後の敵
  はいずれも`undefined`を経由せず、生成直後から厳密に`0`を持つ
- スケジューラ：`resolveEnemiesAction`の呼び出しごとに、生存敵1体につ
  き`actionGauge += 100`し、`actionGauge >= playerSpeed`である間
  `playerSpeed`を差し引きながら`resolveOneEnemy`を呼ぶ

## プレイヤー速度計算式

```
getPlayerSpeed(state) = PLAYER_BASE_SPEED + SPEED_PER_RANK * speedRank
                       = 100 + 10 * speedRank
```

`ability.ts`に純粋なgetterとして実装し、GameStateへ別途「現在速度」
フィールドを保存しない（常にランクから都度算出、二重管理なし）。

| rank | 0 | 1 | 3 | 5 | 10 |
|---|---|---|---|---|---|
| speed | 100 | 110 | 130 | 150 | 200 |

## actionGaugeアルゴリズム

`turn.ts`の`resolveEnemiesAction`内、既存の「生存敵に対して
`resolveOneEnemy`を1回呼ぶ」処理を以下へ置き換えた：

```
for (const enemy of state.enemies) {
  if (!enemy.alive) continue;
  const playerSpeed = getPlayerSpeed(state);
  enemy.actionGauge += ENEMY_BASE_SPEED;   // 100（必須フィールド、生成時から常に数値）
  while (enemy.actionGauge >= playerSpeed) {
    enemy.actionGauge -= playerSpeed;
    const result = resolveOneEnemy(state, enemy, events);
    // acted/attacked集計...
    if (!enemy.alive) break;   // 対象敵が行動中に死亡した場合（現状のゲームメカニクスでは到達しない防御的分岐）
    if (!state.player.alive) break;
  }
  if (!state.player.alive) break;
}
```

- 敵の配列処理順・呼び出し先（`resolveOneEnemy`とその内部の
  behaviorType別ロジック）は一切変更していない
- `resolveOneEnemy`の戻り値（no-opであっても）は必ず1回分の行動権消費
  として扱い、再試行や払い戻しは行わない（golemの隔ターン休止・
  mummyの移動後休止・axeの攻撃後休止もこの意味で「1回消費」として扱わ
  れる）
- 余りは切り捨てず、次のプレイヤーターンへそのまま持ち越す
- 敵が行動中に死亡した場合はそのwhileループのみ中断（現状のゲームメ
  カニクスでは敵が自分自身の行動で死亡することはないため、この分岐は
  防御的コードであり実際には到達しない——`interruption.enemy_death`要
  件に対応するための備え）
- プレイヤーが死亡した場合、現在の敵のwhileループと後続の敵すべての
  処理を即座に中断する（既存の中断条件を内側・外側の両ループへ適用）

## rank0後方互換性

rank0（`playerSpeed=100`）・全敵`actionGauge`初期値0・敵速度100固定の
条件では、`resolveEnemiesAction`の1回のパスにつき`gauge = 0 + 100 =
100`、`100 >= 100`を満たすため必ずちょうど1回`resolveOneEnemy`が呼ば
れ、`100 - 100 = 0`で余りは常に0。これは`resolveEnemiesAction`が1回の
プレイヤーターン中に複数回呼ばれる既存ケース（movement_slowによる追
加敵フェーズ）でも、各パスの余りが独立して常に0になるため、通し回数
に関わらず成立する。

この条件を既存テストスイート全体（58ファイル1370件）で検証し、**1件
も失敗しないことを確認した**（新規テストの`rank0 backward
compatibility`グループでも追加検証済み）。RNG消費順・イベント順序・
既存の全アサーションが変化していない。

## 能力割り振り時のリセット

`ability.ts`の`allocateAbilityPoint`成功分岐に、`ability === 'speed'`
の場合のみ以下を追加した：

```
for (const enemy of state.enemies) {
  enemy.actionGauge = 0;
}
```

- body/mind/power の割り振り成功時は`actionGauge`に触れない
- 確認画面のキャンセル・ポイント不足・rank10到達済み等の失敗経路は
  （既存の`failedAllocation`早期returnにより）`actionGauge`へ一切到達
  しない
- リセット自体は`allocateAbilityPoint`という既存の非ターン消費関数内
  の追加分岐に過ぎず、`state.turn`・敵行動・時間経過処理のいずれも誘
  発しない

## 時間経過処理との分離

`applyHungerProgression`・`applyPoisonTick`・自然HP回復・
`advanceEffectDurations`は`processTurn`内で`resolveEnemiesAction`（お
よび追加敵フェーズ）の**後に、1回だけ**呼ばれる既存構造をそのまま維
持した。`resolveEnemiesAction`内のwhileループ（敵の複数回行動）へこ
れらの処理を一切移動していないため、敵の行動回数が0回・1回・複数回の
いずれであっても、満腹度・毒・自然回復・SOL回復・activeEffectsの残り
時間は必ずプレイヤーの消費ターン1回につき1回だけ更新される。新規テス
トの`time progression`グループで、敵の`actionGauge`を意図的に250へ設
定し1ターンで複数回行動させた場合でも`hungerDecreaseProgress`が1、
`activeEffects[0].remainingTurns`の減少が1、`poison_damage`イベントが
1件のみであることを確認した。

## 実装内容

1. `src/game/types.ts`：`EnemyActor`へ`actionGauge: number`を**必須
   フィールド**として追加（オプショナルにはしていない。フロア開始時・
   新規生成敵とも厳密に`0`であることを保証するため）
2. `src/game/ability.ts`：
   - `PLAYER_BASE_SPEED = 100`、`SPEED_PER_RANK = 10`、
     `getPlayerSpeed(state)`を追加
   - `allocateAbilityPoint`の成功分岐へ`ability === 'speed'`時の全敵
     `actionGauge`リセットを追加
3. `src/game/turn.ts`：
   - `ability.ts`から`getPlayerSpeed`をインポート
   - `ENEMY_BASE_SPEED = 100`定数を追加
   - `resolveEnemiesAction`をactionGaugeスケジューラ方式（while ループ）
     へ変更（`enemy.actionGauge += ENEMY_BASE_SPEED`——必須フィールド
     となったため`?? 0`フォールバックは行わない）
   - `createInitialEnemy`の返却オブジェクトへ`actionGauge: 0`を明示追
     加（`recovering: false`/`webCooldown: 0`と同じ様式）
4. `src/game/__tests__/enemy-type.test.ts`：`createInitialEnemy`を経由
   しない唯一のテスト用`EnemyActor`オブジェクトリテラル2箇所へ
   `actionGauge: 0`を追加（型必須化に伴う最小限の追随）

## 変更ファイル

- 変更：`src/game/types.ts`、`src/game/ability.ts`、`src/game/turn.ts`、
  `src/game/__tests__/enemy-type.test.ts`
- テスト新規：
  `src/game/__tests__/phase-13-3b-speed-action-gauge.test.ts`（28件）

## テスト結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：59ファイル / 1398件 全て成功（既存1370件 + 新規28件）
- `npx vite build`：成功
- `git diff --check`：問題なし

新規テストの内訳：プレイヤー速度3件、スケジューラ行動回数（代表値5
件＋余剰ゲージ持ち越し2件）、rank0後方互換性2件、割り振り時リセット
7件、ライフサイクル5件（`createInitialEnemy`直後・フロア生成直後・フ
ロア遷移直後の`actionGauge`厳密0検証を含む）、時間経過処理の分離4件。

## Phase 13.3cへ持ち越す内容

- 能力overlayの効果表示更新（「能力の効果は次のフェーズで実装予定」
  の文言差し替え）
- telemetry schemaVersionの更新（新規フィールド追加が実際に発生する
  タイミングでの更新）
- 実測ログ・プレイテストによる数値の妥当性確認

## 敵別速度を未導入とした理由

既存AI（golemの隔ターン制御・mummyの移動後休止・axeの攻撃後休止・
swordの2歩移動）は、既にそれぞれ独自の疑似的な速度個性を内蔵してい
る。ここへ敵別のactionGauge速度値（golem75やbat130等）を追加すると、
新旧2つの頻度低下・増加メカニズムが二重に作用し（例：golem75は単独
でスケジューラ上75%の頻度になるところへ、既存の隔ターン制御がさらに
重なり実効頻度が大きく低下する）、意図しないバランス変化を招く。また
敵別速度を導入した時点で、その敵に対する「rank0で既存行動回数を完全
維持する」という本フェーズの受け入れ条件が成立しなくなる（全敵速度
100固定でなければ、たとえプレイヤーがrank0でも敵ごとに異なる頻度が生
まれてしまうため）。既存AIとの統合方針を確定させたうえで敵別速度を導
入する判断は、Phase 13.3b以降の後続フェーズへ切り離した。

## 未変更事項

- カラダ・ココロ・チカラの計算式（Phase 13.3aのまま）
- 武器の基礎攻撃力、太陽銃のSOL消費量
- 敵別速度（全敵100固定のまま）
- 既存敵AI（golem/mummy/axe/swordそれぞれの内部ロジック）
- 敵の配列処理順
- RNGの実装・消費順序
- telemetry schemaVersion（6のまま）
- 能力overlayの説明文
- 経験値・能力ポイント供給量
- フロア生成ロジック
- HUD（速度やゲージの表示は追加していない）
