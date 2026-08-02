# Phase 13.3a カラダ・ココロ・チカラの数値効果実装

## 目的

カラダ、ココロ、チカラの能力ランクを実際のゲーム数値へ反映する。ハヤ
サ・敵行動スケジューラ・telemetry・能力overlayの説明文には一切触れ
ず、rank0では既存挙動を完全に維持する。

## precheck結果

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`（作業は`phase-13-3a-ability-numeric-effects`ブランチで実施）
- HEAD / origin/main: `b6dd0c6`（一致）
- working tree: clean
- 既存テスト: 57ファイル / 1349件、全成功
- `npx tsc --noEmit`: エラーなし
- 能力ランク・最大HP・最大SOL・直接攻撃ダメージの計算地点を再調査し、
  以下を確認した：
  - 最大HP: `player.maxHp`（`state.ts`の`createInitialActor`で30固定、
    フロア遷移は`CarryOverStats.maxHp`で維持）
  - 最大SOL: `state.maxSolarEnergy`（`INITIAL_MAX_SOLAR_ENERGY=5`固定、
    フロア遷移は`CarryOverStats.maxSolarEnergy`で維持）
  - 直接攻撃ダメージ: `turn.ts`の`applyPlayerAttackToEnemy`内、
    `computeAttackDamage(state.player.attack + getPlayerAttackUpBonus(...), getPlayerWeaponBonus(state), target.defense)`
    の1箇所のみ
  - 素手・sword・spear・hammer・solar_gunはいずれも`applyPlayerAttackToEnemy`
    を共有していることを確認（近接系は`resolveFacingAttack`/
    `resolveReachAttack`経由、太陽銃は`resolveSolarGunAttack`経由——いずれも
    最終的に同一関数を呼ぶ）

条件が一致したため実装へ進んだ。

## 確定仕様

| 能力 | 効果式 | rank0 | 1 | 3 | 5 | 10 |
|---|---|---|---|---|---|---|
| カラダ | 最大HP = 30 + 4×rank、割り振り時に現在HPも+4 | 30 | 34 | 42 | 50 | 70 |
| ココロ | 最大SOL = 5 + rank、割り振り時に現在SOLも+1 | 5 | 6 | 8 | 10 | 15 |
| チカラ | 直接攻撃ダメージ +2×rank（素手/sword/spear/hammer/solar_gun全てへ適用、毒・餓死等の間接ダメージは対象外） | +0 | +2 | +6 | +10 | +20 |

各能力のランク上限は**10**。上限到達時は能力ポイントを消費せず、既存
の失敗時挙動（`success: false`、状態変更なし、イベント発行なし）を踏
襲する。

## 実装内容

### `src/game/ability.ts`

- `ABILITY_RANK_CAP = 10`を追加し、`allocateAbilityPoint`の冒頭で
  `previousValue >= ABILITY_RANK_CAP`なら既存の`failedAllocation`経路
  へ分岐するよう変更（不正な能力ID・ポイント不足と同じ失敗パターン）
- `BODY_MAX_HP_PER_RANK = 4`、`MIND_MAX_SOL_PER_RANK = 1`、
  `POWER_DAMAGE_PER_RANK = 2`を定数として追加
- `allocateAbilityPoint`の成功分岐（ランク加算・ポイント消費が既に確
  定した直後）に、`ability === 'body'`なら
  `player.maxHp += 4; player.hp = Math.min(maxHp, hp+4)`、
  `ability === 'mind'`なら
  `maxSolarEnergy += 1; solarEnergy = Math.min(maxSolarEnergy, solarEnergy+1)`
  を追加。`power`/`speed`には割り振り時点での状態変更を一切追加して
  いない
- `getPowerDamageBonus(state)`を新規エクスポート：
  `POWER_DAMAGE_PER_RANK * getAbilityValue(state, 'power')`を都度計算
  して返すだけの純粋関数（`state`へ書き込まない）

### `src/game/turn.ts`

- `ability.ts`から`getPowerDamageBonus`をインポート
- `applyPlayerAttackToEnemy`内の`computeAttackDamage`呼び出し1箇所の
  みへ、`state.player.attack + getPlayerAttackUpBonus(state, weaponId)`
  の直後に`+ getPowerDamageBonus(state)`を追加。太陽銃を含む全攻撃経
  路がこの1関数を共有しているため、他のファイル・他の攻撃解決関数へ
  は一切変更を加えていない

## 最大HP／SOLの二重加算を防いだ方法

最大HP・最大SOLは「割り振り成功時に既存値へ+4/+1する」という**差分加
算**のみで実装し、「現在のランクから最大値を再計算する」処理は一切追
加していない。新規ラン・死亡後再挑戦は`createInitialState`が常に
`player.maxHp=30`・`maxSolarEnergy=5`（能力もすべて0）から再構築する
ため自動的に整合する。フロア遷移は既存の`CarryOverStats.maxHp`/
`CarryOverStats.maxSolarEnergy`が、能力による加算後の値をそのまま
（他の永続ステータスと同様に）不透明な数値として運び続けるだけで、独
自の再計算ロジックを新設していない。したがって「初期化処理」と「割り
振り処理」の両方が同じランクの効果を重複して加算する経路は存在しない。

チカラは状態へ一切書き込まず、`getPowerDamageBonus`が呼ばれるたびに
現在のランクから計算し直す設計のため、二重加算という概念自体が発生し
ない。

## 変更ファイル

- 変更：`src/game/ability.ts`、`src/game/turn.ts`
- テスト新規：
  `src/game/__tests__/phase-13-3a-ability-numeric-effects.test.ts`（21件）
- テスト更新：`src/game/__tests__/phase-13-2-ability-allocation-screen.test.ts`
  （Phase 13.2時点で存在した「bodyもmindも既存戦闘値へ影響しない」とい
  う2件のテストを、本フェーズの確定仕様（+4 maxHP/+4現在HP、+1 maxSOL/
  +1現在SOL）を検証する内容へ更新。他のテストへの変更なし）

## テスト結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：58ファイル / 1370件 全て成功（既存1349件 + 新規21件）
- `npx vite build`：成功
- `git diff --check`：問題なし

## rank0後方互換性

新規テスト`compatibility`グループで以下を確認した：
- rank0で`player.maxHp === 30`、`maxSolarEnergy === 5`、
  `getPowerDamageBonus === 0`
- rank0で素手10・sword20・spear10・hammer30という既存のダメージ値が
  完全に維持される
- 既存58ファイル中の他57ファイル（Phase 13.3a以前からの全テスト）が
  無改変のまま成功する（唯一の例外は上記の2件、いずれもPhase 13.2時
  点で「まだ数値効果がない」ことを検証していたテストであり、本フェー
  ズの確定仕様に合わせて意図的に更新したもの）

## Phase 13.3bへ持ち越す内容

- ハヤサの数値効果（`speed = 100 + 10×rank`）
- `EnemyActor.actionGauge`の追加
- `resolveEnemiesAction`のスケジューラ化（閾値判定によるwhileループ化）
- ハヤサ割り振り時の全敵`actionGauge`リセット処理
- 全敵速度100固定でのrank0後方互換性確認

## 未変更事項

- 敵AI、敵行動順、RNG消費順（`resolveEnemiesAction`・各behaviorType関
  数は一切変更していない）
- telemetry schemaVersion（6のまま）
- 能力overlayの説明文（「能力の効果は次のフェーズで実装予定」のまま）
- 経験値供給量、武器の基礎攻撃力、太陽銃のSOL消費量
- ハヤサ（speed）の割り振り自体は引き続き成功するが、数値効果は依然
  として存在しない（Phase 13.2と同じ挙動）
