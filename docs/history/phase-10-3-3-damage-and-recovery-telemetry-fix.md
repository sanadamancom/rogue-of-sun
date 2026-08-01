# Phase 10.3.3 与ダメージ・回復テレメトリ修正

## 目的

Phase 10.3.2後の実クリアランJSON（`rogue-of-sun-run-v2-1297621582-clear.json`）から判明した、与ダメージ集計へのoverkill混入と、HP回復がイベント・summaryへ記録されていない問題を修正しました。戦闘計算・回復量などのゲームバランスは変更せず、実際に発生したHP変化を構造化イベントとsummaryへ正確に記録することを目的としています。

## 開始状態

開始時のHEADは`e4de506d0fc9124fbc2ad7058b7a6590499d5417`（Phase 10.3.2完了時点）。baseline：46ファイル/965件全成功、型チェック・build成功。添付v2 JSON（seed 1297621582、clear）を再現資料として読み込みました。

## 添付v2 JSONの再集計結果

- 非ミスの`player_attack` 8件について、`totalDamage`合計240に対し実HP減少量（`targetHpBefore - targetHpAfter`）合計160、差分80
- フロア別：1F「recorded 60 / actual 40」、2F「recorded 80 / actual 50」、3F「recorded 100 / actual 70」
- 不一致4件はいずれも撃破攻撃（`targetHpAfter=0`）で、`totalDamage`が実際のHP減少量を上回っていた（例：turn55, sword, before20/after0で`totalDamage=40`recorded、実際は20）

## damageDealt 240と実HP減少量160の差分原因

telemetryの`translateGameEvent`が`'player_attack'`ケースで`event.damage`（`turn.ts`が計算した攻撃力そのもの、残HPで未クランプ）をそのまま`totalDamage`として記録していたため。Phase 10.3.2で追加済みの`targetHpBefore`/`targetHpAfter`を使って実際のHP減少量を計算し直す処理が欠けていました。`turn.ts`のHP減算自体（`target.hp = Math.max(0, target.hp - damage)`）は正しく、撃破時に残りHP以上のダメージが「無駄打ち」になる挙動もゲームロジックとして正しい既存仕様です。

## 現在のHP10回復の発生条件・周期・処理位置

`turn.ts`の`processTurn`末尾（1638〜1654行目）に既存する自然回復処理です。プレイヤーが生存中かつ`hp < maxHp`の場合、消費ターンごとに`regenProgress`を1加算し、`REGEN_TURNS_PER_HP`(5)に達すると`hp`へ+10（`maxHp`でクランプ）、`regenProgress`を0へリセットします。`hp === maxHp`の場合は`regenProgress`を0のまま維持し加算しません。

## 未記録だった理由

この自然回復は`TurnResult.playerRegenerated`という**boolean flagとしてのみ**存在し、`GameEvent`としては一切pushされていませんでした。`telemetry.ts`の`recordTurn`は`result.events`（`GameEvent[]`）のみを走査しており、`result.playerRegenerated`を一切参照していなかったため、回復が発生してもtelemetryには一切記録されませんでした。

## HP増加が仕様上の回復か状態リセット不具合か

**仕様上の回復です**。`player.hp`を書き換える全箇所を`rg`で抽出し確認した結果、以下の経路のみが存在しました。

- リンゴ回復（`turn.ts:661`、`applyItemUse`）
- 敵からの被ダメージ（`turn.ts:793`、`turn.ts:1396`）
- 自然回復（`turn.ts:1647`、上記）
- フロア遷移時の引き継ぎ（`state.ts:110`、`player.hp = carry.hp`）：**単純な複製のみで加算は一切発生しません**（`advanceToNextFloor`前後のHPが完全一致することをテストで確認済み）

「レベルアップ」や「状態再生成」に相当する処理は存在せず、フロア遷移によるHP変化・リセットも発生しません。HP状態リセット不具合は見つかりませんでした。

## actualDamageの定義

`RunEventPayload`の`player_attack`型へ`physicalDamage`（生の基礎ダメージ、sol発動時は`sol_enchantment_used`到着時に上書き）・`additionalDamage`（生のsol追加ダメージ）・`calculatedDamage`（両者の合計、クランプ前の戦闘計算値）・`actualDamage`（`max(0, targetHpBefore - targetHpAfter)`、実際にHPを減少させた量）を追加しました。summary集計（`combatOverall`・`combatByWeapon`・`perFloor`のいずれの`damageDealt`も）は`actualDamage`のみを正本とします。telemetry側での敵typeや現在のGameStateからの再照合は行わず、GameEventが既に運ぶ`targetHpBefore`/`targetHpAfter`（Phase 10.3.2で追加済み）から直接計算します。

## actualHealingの定義

`player_healed`イベント（Phase 10.3.2の`healed`から改名）へ`requestedAmount`（回復処理が試みた額面。アイテムは`ITEM_DEFINITIONS`の`healAmount`、自然回復は固定10）と`actualAmount`（`hpAfter - hpBefore`の実差分、`maxHp`でのクランプを自動的に反映）を分離しました。summaryの`healingBySource`は`actualAmount`のみを集計します。

> **Phase 10.3.3aでの訂正**：指定仕様のフィールド名は`actualHealing`でしたが、実装時に誤って`actualAmount`としていました。Phase 10.3.3aで`actualHealing`へ修正済みです。以下の記述は当時の実装事実として残していますが、現在の正式なフィールド名は`actualHealing`です。

## 回復sourceの定義

`'natural_regeneration'`（自然回復、`recordTurn`が`result.playerRegenerated`を直接参照して生成）と`'item'`（アイテム使用、既存の`item_used`GameEvent経由、`itemId`を付随フィールドとして保持）の2種類のみを実装しました。`'floor_transition'`・`'level_up'`は実際に存在する回復経路ではないため生成していません（`allowed_sources`のうち実在する経路のみを列挙する方針に従いました）。

## schemaVersion 3へ変更した理由

`damage`の意味修正（overkill除去）と`player_healed`イベント追加という、JSON構造の意味論的な変更を含むため、`schemaVersion`を3へ、出力ファイル名を`rogue-of-sun-run-v3-{seed}-{clear|death}.json`へ変更しました。v1・v2 JSONの読み込み互換機能は追加していません。

## v1・v2 JSONを正式比較対象外とすること

添付の`rogue-of-sun-run-v2-1297621582-clear.json`は本Phaseの不具合再現資料としてのみ使用しました。v1（Phase 10.3.1）・v2（Phase 10.3.2）で生成されたJSONはいずれも今回修正した2つの不具合を含むため、Phase 10.4以降の数値調整における正式な比較対象には含めません。

## 変更ファイル

- `src/game/telemetry.ts`：
  - `player_attack`型へ`calculatedDamage`・`actualDamage`追加（`totalDamage`を置換）
  - `healed`型を`player_healed`へ改名、`source`を`'natural_regeneration' | 'item'`の固定集合へ、`itemId`を追加
  - `translateGameEvent`の`player_attack`/`player_attack_missed`/`sol_enchantment_used`ケースを`actualDamage`算出に対応
  - `recordTurn`へ`result.playerRegenerated`のフックを追加し、自然回復を`player_healed`イベントとして記録
  - `item_used`ケースを`player_healed`（source: 'item'）へ更新、`ITEM_DEFINITIONS`から`requestedAmount`を取得
  - `computeRunSummary`の`damageDealt`集計を`actualDamage`基準へ、`healingBySource`集計を`player_healed`基準へ
  - `schemaVersion`を3へ、ファイル名を`rogue-of-sun-run-v3-`プレフィックスへ
- 既存テスト2ファイル（`phase-10-3-1-telemetry.test.ts`・`phase-10-3-2-telemetry-fix.test.ts`）：新フィールド名・schemaVersion 3に合わせて更新
- `src/game/__tests__/phase-10-3-3-damage-recovery-fix.test.ts`（新規、19件）
- `docs/history/phase-10-3-3-damage-and-recovery-telemetry-fix.md`：本ドキュメント

`turn.ts`・`events.ts`・`combat.ts`・`enemy-def.ts`・`weapon-def.ts`など、ダメージ計算・回復量・命中率・敵AIに関わるファイルは一切変更していません。

## 追加テスト数と全テスト結果

新規19件：実ダメージ5件（撃破時のoverkill除去、ちょうど残HPと同値の攻撃、before/after接続、死亡済み敵の非再ダメージ、集計間の一致）、自然回復健全性7件（発生確認、maxHpクランプ、満タン時非発生、未使用アイテムの非記録、アイテム使用の正しいsource記録、フロア遷移での非発生、healingBySource集計一致）、ライフサイクル再確認2件、NaN/Infinity/負数非生成1件、schema v3関連4件。

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：**47ファイル / 984件全成功**（既存965件は新フィールド名に合わせた2ファイルの更新のうえ全通過、新規19件追加）
- `npx vite build`：成功
- `git diff --check`：問題なし

## 決定性・乱数状態の確認結果

`recordTurn`前後で`combatRngState`が不変であること、同一seed・同一入力列で同一JSON文書が生成されることを単体テストで確認済みです。`turn.ts`のダメージ計算式・命中判定・乱数呼び出し順序・自然回復の発生条件と量はいずれも無変更です。

## 手動確認結果

単一HTMLをPlaywrightでfile://起動し、ランダムなキー入力で実際に死亡させ、終了画面のJSON保存を実行しました。

- `schemaVersion: 3`、ファイル名`rogue-of-sun-run-v3-{seed}-death.json`（v3プレフィックス）を確認
- 同一ランで2回JSON保存を実行し、内容が完全に一致することを確認（`json_export`の非破壊性の再確認）
- コンソールエラー・ページエラーともに0件

自然回復の発生前後HP・`actualHealing`（当時の実装では`actualAmount`。Phase 10.3.3aで訂正）・sourceの確認、および残HPを超える攻撃での`actualDamage`確認は、ランダム操作による短時間の手動プレイでは狙って再現することが困難だったため、これらは自動テスト（`phase-10-3-3-damage-recovery-fix.test.ts`の該当12件、自然回復・overkillの双方を実際の`turn.ts`ロジック経由で明示的に検証）の結果をもって確認済みとします。

## 戦闘・回復・SOLのバランス数値を変更していないこと

`combat.ts`（ダメージ計算式・命中率式）・`enemy-def.ts`（敵ステータス）・`weapon-def.ts`（武器ステータス）・`turn.ts`のHP自然回復量（+10/`REGEN_TURNS_PER_HP`=5ターン）・SOL関連の最大値/回復量/消費量は、いずれも本Phaseで一切変更していません。`turn.ts`への変更は一切行っておらず、`telemetry.ts`が既存の`TurnResult.playerRegenerated`フラグを新たに参照するようになった点のみが変更です。

## 残課題

- 実機でのクリアラン（3フロア到達）確認（Phase 10.3.1から継続未実施）
- 自然回復・overkillそれぞれを狙って発生させた上での実機手動確認（今回は自動テストでの代替確認に留まる）
- 添付v2 JSON（seed 1297621582）自体を修正版で再生成しての差分比較（同一seedでの再現は本タスクの範囲外）

## 次Phase 10.4でHP自然回復とSOLを調整予定であること

本Phaseで数値変更は一切行っていません。次のPhase 10.4では、今回正確に記録できるようになった実測データ（`healingBySource`・`damageDealt`・武器別/敵別集計）を基に、HP自然回復（風来のシレン5・6型：レベル帯に応じた消費ターンごとの回復量）とSOL（ボクらの太陽固有資源：最大値拡張・条件付き毎ターン回復）を独立して調整する計画です。これらの仕様は本Phaseの`future_design_policy`として指示に記載されたものであり、実装・数値変更は次Phase以降で行います。
