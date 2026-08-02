# Phase 13.3c 能力効果表示とtelemetry schemaVersion 7

## 目的

能力割り振りoverlayから、各能力（カラダ・ココロ・チカラ・ハヤサ）の
実際の効果と次rankでの変化を確認できるようにする。ラン終了時の4能力
rankをtelemetryで確認できることを保証し、telemetryをschemaVersion 7
へ更新する。Phase 13.3a・13.3bで確定したゲーム処理（数値式・速度式・
actionGaugeアルゴリズム・敵AI）は一切変更せず、Phase 13を実装上完結
させる。

## precheck結果

- branch: `phase-13-3b-speed-action-gauge`から`phase-13-3c-ability-ui-telemetry`
  を作成
- HEAD（起点）: `fe51ddc`（一致）
- working tree: clean
- origin/main: `b6dd0c6`のまま（Phase 13.3a/13.3bはpush済みでないため
  一致は不要、想定どおり）
- 既存テスト: 59ファイル / 1398件、全成功
- `npx tsc --noEmit`: エラーなし
- `npx vite build`: 成功
- telemetry schemaVersion: 6であることを確認（停止条件に該当せず）

### 実装調査結果

- ability overlayの生成・更新：`main.ts`の`createAbilityOverlay`/
  `refreshAbilityOverlay`。能力名・現在rank・割り振り確認文は
  `refreshAbilityOverlay`内で`ABILITY_DISPLAY_NAMES`と`getAbilities`
  から直接組み立てられていることを確認
- `allocateAbilityPoint`（`ability.ts`）：body/mind/power/speedそれぞ
  れの副作用が既に確定済みであることを再確認（Phase 13.3a/13.3b）
- `getMaxHp`/`getMaxSol`という専用getterは**存在しない**：body/mindの
  効果は`allocateAbilityPoint`が`state.player.maxHp`/
  `state.maxSolarEnergy`へ直接加算する方式のため、現在値は
  `state.player.maxHp`/`state.maxSolarEnergy`をそのまま読めばよいこと
  を確認
- `getPowerDamageBonus`/`getPlayerSpeed`（`ability.ts`）：既存の純粋
  getterをそのまま再利用可能であることを確認
- `RunTelemetry`/`RunSummary`/`createRunTelemetry`/`finalizeRun`/
  `computeRunSummary`/JSON export/終了画面表示（`telemetry.ts`・
  `main.ts`）：構造を確認
- **重要な発見**：`RunSummary.progression.endingAbilityRanks`
  （`AbilityValues`型）が**Phase 13.2の時点で既に実装済み**であり、
  `computeRunSummary`内で`getAbilities(finalState)`から直接生成され
  ていることを確認した。これは本フェーズが要求する
  `ability_rank_snapshot`（終了時の4能力rankをtelemetryへ記録する）
  の要件を、フィールド名の差異（`abilityRanks`ではなく
  `endingAbilityRanks`）を除いて完全に満たしている

条件が一致したため実装へ進んだ。

## 確定仕様

- カラダ／ココロ／チカラ／ハヤサの数値効果はPhase 13.3a/13.3bで確定
  済みの式をそのまま使用し、本フェーズでは一切変更しない
- ability overlayは既存の構造・選択方法・確認手順・キー操作を維持し
  たまま、各能力の効果表示行を追加する
- 現在値・次rank値は、`allocateAbilityPoint`が実際に使用している定数
  （`BODY_MAX_HP_PER_RANK`等）および既存の共有getterのみを再利用し、
  UI専用の効果計算式は実装しない
- telemetry schemaVersionを6→7へ更新する
- 終了時能力rankの記録には、新規フィールドを追加せず、Phase 13.2で既
  に実装済みの`endingAbilityRanks`をそのまま採用する

## 能力効果表示

`ability.ts`へ以下を追加した（Phaser/DOMに依存しない純粋関数）：

- `AbilityEffectDisplay`インターフェース：`{ ability, atRankCap,
  currentValue, nextValue: number | null }`
- `getAbilityEffectDisplay(state, ability)`：現在値と次rank値を計算す
  る。現在値の取得元は能力ごとに以下のとおり、いずれも既存の権威ある
  値をそのまま読むだけで、UI独自の再計算は行わない：
  - body: `state.player.maxHp`
  - mind: `state.maxSolarEnergy`
  - power: `getPowerDamageBonus(state)`
  - speed: `getPlayerSpeed(state)`

  次rank値は`atRankCap`（`rank >= ABILITY_RANK_CAP`）なら`null`、そう
  でなければ現在値に各能力の既存定数（`BODY_MAX_HP_PER_RANK`／
  `MIND_MAX_SOL_PER_RANK`／`POWER_DAMAGE_PER_RANK`／`SPEED_PER_RANK`）
  を加算するだけで求める——`allocateAbilityPoint`が実際に適用する加算
  量と完全に同じ式を再利用しているため、UIとゲーム処理が乖離すること
  はあり得ない

- `formatAbilityEffectLine(state, ability)`：上記を1行の短い日本語へ
  整形する純粋関数。例：
  - `HP30→34（+4回復）`
  - `SOL5→6（+1回復）`
  - `攻撃+0→+2（全武器・太陽銃）`
  - `速度100→110（敵の頻度低下）`
  - rank10到達時：`HP70（上限）`等
  - ハヤサの表現は「敵の頻度低下」のみとし、「プレイヤーの行動回数増
    加」「移動距離増加」と誤解される語を一切含まない（テストで
    `/行動回数/`・`/移動距離/`・`/2回行動/`を含まないことを検証）

`main.ts`の`refreshAbilityOverlay`は、既存の`カラダ　{rank}`行の直後
に`formatAbilityEffectLine`の結果を1行追加するだけの最小変更とした。
旧来の「能力の効果は次のフェーズで実装予定」という注記は、実際の効果
が表示されるようになったため削除した。能力ポイント0の状態でも効果行
は変わらず表示される（割り振り可否の判定とは独立）。overlay幅は新し
い行の文字数に合わせ300→320へ最小限拡張し、高さは既存どおり行数から
自動算出されるため個別調整していない。

## telemetry schemaVersion 7

`RunTelemetry.schemaVersion`・`TelemetryDocument.schemaVersion`・
`createRunTelemetry`・`buildTelemetryDocument`の生成値・
`buildExportFilename`のプレフィックスを、6→7・`v6`→`v7`へ一括更新し
た。新規`GameEvent`・新規`RunEventPayload`は追加していない（本フェー
ズはUI表示とバージョン更新のみが目的であり、記録すべき新しい生データ
は発生しないため）。

## abilityRanksの記録地点

要求されていた「ラン終了時の4能力rankをtelemetryへ記録するフィール
ド」は、`RunSummary.progression.endingAbilityRanks`として**Phase
13.2時点で既に実装済み**であることが調査の結果判明した。

```
computeRunSummary内:
  endingAbilityRanks: getAbilities(finalState)
```

この既存実装は本フェーズの要求仕様（`ability_rank_snapshot`）を以下の
点ですべて満たしている：

- 出典：終了時`GameState`の`state.abilities`をそのまま読む（UI表示文
  字列や`maxHp`等の派生値からの逆算ではない）
- タイミング：`computeRunSummary`は`finalizeRun`後の`RunTelemetry`と
  最終`GameState`から呼ばれ、`finalizeRun`自体は`telemetry.finalized`
  ガードにより二重処理されない
- 値域：`state.abilities`の各値は`allocateAbilityPoint`のrank上限
  チェックにより常に0〜10（`unspentAbilityPoints`は含まれない）
- フロア遷移だけでは確定しない：`finalizeRun`は`state.phase`が
  `gameover`/`victory`のときのみ動作するため、フロア遷移時に呼ばれる
  ことはない
- GameState・RNGへ非介入：`getAbilities`は`state.abilities`のコピーを
  返すだけの純粋関数であり、`computeRunSummary`/
  `buildTelemetryDocument`のいずれも状態を変更しない

したがって、フィールド名を`abilityRanks`へ変更する、あるいは同じ内容
を保持する新規フィールドを別途追加することは、「schemaVersion以外の
既存フィールド名や意味を変更しない」「telemetryの既存集計値を再計
算・再定義しない」という制約に反する冗長な変更になると判断し、**既存
の`endingAbilityRanks`をそのまま採用**した。新規テスト
（`telemetry_ability_ranks`グループ）は、この既存フィールドが要求仕
様の全項目（rank0で全0、clear/death時の正確な記録、未使用ポイントの
非加算、フロア遷移非確定、二重finalize非変化、export繰り返しの一致、
GameState/RNG非介入）を満たすことを直接検証している。

## telemetryの非介入性

`getAbilityEffectDisplay`／`formatAbilityEffectLine`（UI側）と
`computeRunSummary`／`buildTelemetryDocument`（telemetry側）はいずれ
も既存の値を読み取るだけの純粋関数であり、`state`の変更・RNGの消費・
ゲームロジックの再実行を一切行わない。新規テストで、これらの呼び出し
前後で`JSON.stringify(state)`（能力効果表示側）および
`state.combatRngState`/`state.abilities`（telemetry側）が変化しない
ことを確認した。

## rank0後方互換性

本フェーズはUI表示とtelemetryバージョンのみを変更しており、
`allocateAbilityPoint`・`resolveEnemiesAction`・`actionGauge`・敵AI・
RNG消費順・既存イベント件数のいずれにも触れていない。既存59ファイル
1398件を実行し、1件も失敗しないことを確認した（新規追加分を含め全
60ファイル1430件が成功）。

## 実装内容

1. `src/game/ability.ts`：
   - `AbilityEffectDisplay`インターフェースを追加
   - `getAbilityEffectDisplay(state, ability)`を追加（既存getter/定数
     の再利用のみ、UI専用の計算式なし）
   - `formatAbilityEffectLine(state, ability)`を追加（Phaser/DOM非依
     存の純粋formatter）
2. `src/main.ts`：
   - `formatAbilityEffectLine`をインポート
   - `refreshAbilityOverlay`の各能力行の直後へ効果表示行を追加
   - 「能力の効果は次のフェーズで実装予定」の注記を削除
   - `ABILITY_OVERLAY_WIDTH`を300→320へ最小限拡張
3. `src/game/telemetry.ts`：
   - `RunTelemetry.schemaVersion`／`TelemetryDocument.schemaVersion`
     を7へ
   - `createRunTelemetry`／`buildTelemetryDocument`の生成値を7へ
   - `buildExportFilename`のプレフィックスを`v7`へ
4. テスト更新：schemaVersion/exportファイル名の期待値をv7へ更新
   （4ファイル、値そのものを検証する無関係なアサーションへは影響な
   し）

## 変更ファイル

- 変更：`src/game/ability.ts`、`src/main.ts`、`src/game/telemetry.ts`
- テスト更新：`src/game/__tests__/phase-10-3-1-telemetry.test.ts`、
  `src/game/__tests__/phase-10-3-2-telemetry-fix.test.ts`、
  `src/game/__tests__/phase-10-3-3-damage-recovery-fix.test.ts`、
  `src/game/__tests__/phase-10-3-3a-healing-field-rename.test.ts`
- テスト新規：
  `src/game/__tests__/phase-13-3c-ability-ui-telemetry.test.ts`（32件）

## テスト結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：60ファイル / 1430件 全て成功（既存1398件 + 新規32件）
- `npx vite build`：成功
- `git diff --check`：問題なし
- `rg`によるschemaVersion 6 / v6の残存参照確認：機能コード上の残存な
  し（`telemetry.ts`内の「6 -> 7」という履歴コメント1件のみ、意図的）

新規テストの内訳：能力効果表示（body/mind/power/speedのrank0/1/9/10
検証16件＋ハヤサ誤解表現なし1件＋rank上限1件＋ポイント0での閲覧可否
1件＋非破壊性1件）、telemetry schemaVersion（4件）、telemetry
abilityRanksスナップショット（8件）。

## Phase 13完了判定

`phase_13_completion_check`の全項目を確認した：

| 項目 | 状態 |
|---|---|
| 敵撃破による経験値獲得 | 実装済み（Phase 13.1） |
| レベルアップによる能力ポイント獲得 | 実装済み（Phase 13.1） |
| ポイント保留が可能 | 実装済み（`unspentAbilityPoints`） |
| 能力割り振り中はゲーム進行が停止する | 実装済み（非ターン消費・overlayガード） |
| 4能力のrankがフロア間で維持される | 実装済み（`CarryOverStats.abilities`） |
| 死亡後再挑戦・新規ランでrankが0へ戻る | 実装済み |
| rank上限10が機能する | 実装済み（Phase 13.3a） |
| body/mind/power/speedの数値効果が機能する | 実装済み（Phase 13.3a/13.3b） |
| overlayで各効果と次rank値を確認できる | 実装済み（本フェーズ） |
| ラン終了telemetryで最終能力構成を確認できる | 実装済み（Phase 13.2、本フェーズでschemaVersion 7化） |

未成立項目なし。**Phase 13（経験値・レベル・能力ポイント・能力割り振
り・能力実効果・表示・telemetry）を完了と判定する。**

## Phase 14へ持ち越す内容

- 敵別速度の導入（golem/mummy/bat等、既存AIとの統合方針確定後）
- 経験値・能力ポイント供給量の見直し（現行バランスでは1ランあたり
  実質1ポイント程度しか得られない）
- 能力ランク上限の再評価（供給量見直しと連動）
- 実測プレイテストに基づく数値バランス調整

## 敵速度とactionGaugeを表示しなかった理由

`EnemyActor.actionGauge`・敵ごとの内部ゲージ残量・敵速度一覧・次の敵
行動までの厳密なターン予告・スケジューラの内部計算式は、いずれも
overlayやHUDへ一切表示していない。Phase 13.3bでは全敵速度が100固定で
あり、敵種別に異なる値を表示する意味が現時点で存在しないこと、
`actionGauge`はプレイヤーが直接管理・参照する資源ではなく内部実装の
詳細であること、将来の敵別速度導入を先回りしたUIを作らないことを理由
とする。

## 未変更事項

- Phase 13.3aの数値式（カラダ+4/rank、ココロ+1/rank、チカラ+2/rank）
- Phase 13.3bの速度式（100+10×rank）、敵速度100固定、actionGaugeアル
  ゴリズム、ハヤサ割り振り時のゲージリセット
- 敵AI、`enemy-def.ts`（speedフィールドは追加していない）
- 新規`GameEvent`（追加していない）
- 経験値・レベル・能力ポイント供給量
- rank上限10
- 太陽銃へのチカラ適用（既存どおり適用対象）
- 通常HUD（敵速度・ゲージは追加していない）
- 終了画面の構成（DOM要素・レイアウトは変更していない）
- telemetryの既存集計値（`abilityPointsSpent`等、再計算・再定義していない）
