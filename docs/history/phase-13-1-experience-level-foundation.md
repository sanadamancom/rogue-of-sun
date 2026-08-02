# Phase 13.1 経験値・レベル・能力ポイント基盤

## 目的

敵を倒すことで経験値を獲得し、必要経験値に達するとレベルが上がり、
未使用能力ポイントを獲得する基盤を実装する。Phase 13.1では、獲得した
レベルや能力ポイントを既存の戦闘数値（HP、SOL、攻撃、防御、満腹度、
状態効果）へ一切反映しない。能力ポイントは獲得・保持・表示のみを行い、
使用方法はPhase 13.2以降で実装する。

## Phase 12を完了しPhase 12.5を作らなかった理由

Phase 12は12.1（attack_up）〜12.4（毒消し・万能薬と状態異常解除基盤）
で状態効果・トラップ・治療アイテムの基盤が一通り揃い、以降の敵バラン
ス調整は実プレイデータが集まるまでDEFER判定とすることが確認済みの
決定として既に存在していたため、Phase 12.5は作成せず、Phase 13へ進む。

## Phase 13の分割方針

Phase 13は「経験値・レベル・能力ポイントの獲得と保持」（13.1）、
「能力割り振り画面」（13.2）、「カラダ／ココロ／チカラ／ハヤサの実
効果」（13.3）に分割する。13.1では進行状態の獲得・保持・表示のみを
実装し、能力値そのものやその戦闘への反映は一切実装しない。

## 初期レベル、経験値、能力ポイント

- 初期レベル：1
- 初期経験値：0
- 初期未使用能力ポイント：0

## 必要経験値の計算式

現在レベル × 5（Lv1→Lv2：5、Lv2→Lv3：10、Lv3→Lv4：15 ...）。
`src/game/progression.ts`の`getExperienceRequirement`一箇所にのみ実装
し、HUD・レベルアップ処理・テストのすべてがこの関数を再利用する。

## 全既存敵を1 EXPとした理由

Phase 13.1の完了条件は「敵撃破で経験値が正しく付与される基盤があるこ
と」であり、敵種別ごとの経験値バランスは実プレイデータが不十分な段
階で決めるべきではない（DEFER分類の原則）。したがって現時点で登録済
みの全9種の敵に、暫定的に一律1 EXPを設定した。

## 敵定義への経験値報酬登録

`src/game/enemy-def.ts`の`EnemyDefinition`に`experienceReward: number`
を追加し、9種すべてに`experienceReward: 1`を明示的に設定した。敵IDや
表示名による否定判定・例外判定は行わず、将来的に敵種別ごとに値を変え
られる構造とした。

## 敵撃破と経験値付与の処理経路

`src/game/turn.ts`の`applyPlayerAttackToEnemy`が、プレイヤーの通常攻撃
・スピア攻撃を含む全攻撃経路が共有する唯一の`enemy_defeated`イベント
発行箇所であることを確認した。この関数内で`target.alive = false`を設
定し`enemy_defeated`イベントを発行した直後に、`progression.ts`の
`applyExperienceGain`を呼び出して経験値を付与し、`experience_gained`
および（該当する場合）`player_leveled_up`イベントを発行する。

## 二重付与防止

`applyPlayerAttackToEnemy`は、対象敵のHPが0になった「その瞬間」にのみ
`defeated`分岐へ入り、`target.alive`をfalseへ遷移させる。この分岐は
1回の攻撃解決につき最大1回しか通過しないため、経験値付与を同じ関数の
同じ分岐内に置くことで、二重攻撃・描画・イベント整形・ターン確定によ
る再付与は構造的に発生しない。既に`alive: false`の敵への攻撃はそもそ
も`target.hp`の再度0化や`defeated`判定の再成立を引き起こさない。

## 複数レベルアップと余剰経験値

`applyExperienceGain`は`while`ループで「現在の必要経験値以上か」を判
定し続け、満たすたびにレベルを1つ進めて必要経験値を差し引き、能力ポ
イントを1加算する。ループが終了するまで余剰経験値は失われず、1回の
経験値付与で複数レベル上昇に対応する。各段階の`newLevel`・
`unspentAbilityPointsAfter`を`levelUps`配列として保持し、`turn.ts`側
はこの配列を昇順にイテレートして`player_leveled_up`イベントを複数回
（レベルごとに1回）発行する。

## レベル上限

`LEVEL_CAP = 99`。ループは`level < LEVEL_CAP`の間のみ継続し、到達時点
で`level`を99に固定、`experience`を0にクランプする。Lv99到達後の敵撃
破・経験値付与自体は通常どおり発生するが、レベルアップと能力ポイント
獲得は発生しない。

## 新規ラン、死亡後再挑戦、フロア遷移

- 新規ラン・死亡後再挑戦：`main.ts`の`restart`は常に
  `state.ts`の`createInitialState`（`buildFloorState`をcarryなしで呼
  び出す経路）を通るため、level/experience/unspentAbilityPointsは常に
  初期値（1, 0, 0）へ戻る。
- フロア遷移：`advanceToNextFloor`の`CarryOverStats`にlevel/experience
  /unspentAbilityPointsを追加し、`buildFloorState`がcarry有無で初期化
  /維持を切り替える既存パターン（hunger等）に合わせて実装した。フロ
  ア遷移時に追加の経験値は一切付与されない。

## HUD表示

`main.ts`の`refreshStaticView`内、既存の満腹度表示の直後に
`LV {level}  EXP {experience}/{required}  能力P {unspentAbilityPoints}`
を1行で追加した。Lv99では`EXP {experience}/{required}`の代わりに
`EXP MAX`を表示する。インベントリオーバーレイを開かなくても常時確認
できる既存HUD領域内。

## イベントとメッセージ

- `experience_gained`：`amount`/`enemyId`/`enemyType`/`level`/
  `experience`を持ち、敵1体の撃破につき1回発行。
- `player_leveled_up`：`previousLevel`/`newLevel`/`abilityPointsGained`
  /`unspentAbilityPoints`を持ち、上昇したレベル1段階につき1回、昇順で
  発行。
- メッセージ：「経験値を{amount}得た。」「レベルが{newLevel}に上がっ
  た。」「能力ポイントを1得た。」（レベルアップメッセージは2行を
  `\n`で1イベント内に含める形とした）。

## telemetry schemaVersion 5

`RunTelemetry`/`TelemetryDocument`の`schemaVersion`を4→5に、export
prefixを`rogue-of-sun-run-v4-`→`rogue-of-sun-run-v5-`に変更した。新規
`RunEventPayload`として`experience_gained`/`player_leveled_up`を追加
し、`RunSummary.progression`へ`experienceGained`/`levelsGained`/
`endingLevel`/`endingExperience`/`unspentAbilityPoints`を追加した。
既存の`damageTaken`/`item_used`/`endCause`等の集計ロジックは変更して
いない。

## レベルアップが既存能力値へ影響しないこと

`applyExperienceGain`はGameStateのうち`level`/`experience`/
`unspentAbilityPoints`のみを変更し、`player.hp`/`maxHp`/`attack`/
`defense`/`activeEffects`等には一切触れない。テストで、レベルアップ
を伴う敵撃破の前後でHP・maxHp・SOL・攻撃・防御が変化しないことを確認
した。

## 変更ファイル

- 新規：`src/game/progression.ts`
- 変更：`src/game/types.ts`、`src/game/enemy-def.ts`、
  `src/game/events.ts`、`src/game/turn.ts`、`src/game/message-log.ts`、
  `src/game/state.ts`、`src/main.ts`、`src/game/telemetry.ts`
- テスト新規：
  `src/game/__tests__/phase-13-1-experience-level-foundation.test.ts`
- テスト更新（schemaVersion/ファイル名の期待値をv5へ、経験値イベント
  追加分を反映）：`src/game/__tests__/message-log.test.ts`、
  `src/game/__tests__/phase-10-3-1-telemetry.test.ts`、
  `src/game/__tests__/phase-10-3-2-telemetry-fix.test.ts`、
  `src/game/__tests__/phase-10-3-3-damage-recovery-fix.test.ts`、
  `src/game/__tests__/phase-10-3-3a-healing-field-rename.test.ts`

## 追加・更新テスト

新規ファイルに18件を追加（進行計算9件、敵報酬4件、イベント3件、ライ
フサイクル2件、既存能力値への非影響1件）。既存5ファイルはschemaVersion
/exportファイル名プレフィックスの期待値更新、および`enemy_defeated`後
に`experience_gained`が続くことを反映する形で更新した。

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：56ファイル / 1312件 全て成功（既存1294件 + 新規18件）
- `npx vite build`：成功
- `git diff --check`：問題なし

## Phase 13.2以降を開始していないこと

能力割り振りUI、カラダ／ココロ／チカラ／ハヤサの実装、レベルによる能
力補正、レベルアップ時のHP/SOL回復は一切実装していない。獲得した
`unspentAbilityPoints`は保持・表示のみで、消費経路は存在しない。

## 未確認事項

- 各敵種別ごとの経験値バランス調整（実プレイデータが集まり次第、
  Phase 13.1のDEFER方針に沿って別途着手する）
- 能力ポイントの割り振りUIおよび使用効果（Phase 13.2以降）
