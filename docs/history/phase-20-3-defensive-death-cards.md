# Phase 20.3 皇帝・死神・審判

## 目的

死神・審判の正式監査と、Phase単位表から抜けていた皇帝の実装を同一バッチで行う。開始base commit：`d494f6e17467411eeafbd2f7f0a006cd708f0bf9`。

## 皇帝がPhase単位表から抜けていた事実

`rogue-of-sun-development-plan.md`のPhase20単位表には皇帝の専用単位が存在せず、`emperor`カードの`floorDropEnabled`は既存実装で`false`のまま、resolverも未登録だった（Phase20.0aで定義のみ存在）。今回この欠落を発見し、死亡連動カードと同じ戦闘関連バッチへ皇帝を含めて実装した。

## 皇帝の仮値・対象ダメージ・除外ダメージ・継続・再使用規則

- 軽減率：敵の直接ダメージを50%軽減、切り上げ、元ダメージ1以上なら最低1
- 対象：敵の通常近接・遠距離・固有攻撃に含まれる直接ダメージ（`getIncomingDamage`——「every enemy damage to player HP must route through this」と既存コメントに明記された単一境界へ適用）
- 除外：飢餓・毒・罠・カードによる自傷・塔による自傷（いずれも`getIncomingDamage`を経由しない既存の別処理のため、除外リストではなく境界選択そのものにより自動的に除外される）
- 継続：5ターン。既存`EFFECT_DEFINITIONS`/`grantOrRefreshEffect`機構を再利用（新規独立ターン管理は作成していない）
- 再使用：残りターンを5へ更新、加算・多重stackなし（`grantOrRefreshEffect`の既存契約をそのまま利用）。残りターン変化がなくても1枚消費・鑑定・1ターン進行は成立する

## deathとjudgementの正確な処理順

死神：1枚消費・鑑定（`finishSuccessfulCardUse`）→LIFEを0に→SOLを現在の最大SOLへ→`alive=false`→`resolveDeathIfDefeated`。審判が発動可能なら1枚消費・LIFEを現在の最大LIFEへ・死亡取消。死神使用分の1ターンのみ進行。

## judgement既存実装のprovenance

`resolveDeathIfDefeated`と`judgement_triggered`イベントは、今回のbase commit（`d494f6e`）より前、commit`19cf34771aa06e3306faf65f7264587289b1fc9d`（"feat: implement phase 20 card core loop"）の時点で既に実装済みだった（`git merge-base --is-ancestor`で祖先関係を確認済み、Phase20.2の監査で既に確定済みの事実を再確認）。今回、審判・死神の新規実装は行っておらず、既存処理をそのまま監査・利用した。

## 既存処理から補完した内容

- 敵撃破処理（経験値付与・レベルアップ）を`applyPlayerAttackToEnemy`内から`defeatEnemyIfNeeded`という共通関数へ抽出した。既存の近接攻撃はこの関数を呼ぶよう更新し、Phase20.4の正義・悪魔・塔も同じ関数を再利用する（撃破処理の複製を避けるための最小リファクタ）

## 専用テスト名と結果

`phase-20-3-defensive-death-cards.test.ts`：33件、全通過

**emperor（13件）**：直接攻撃50%軽減の実測、最低1ダメージ、mitigation比較、飢餓非軽減、毒非軽減、自傷非軽減、5ターン継続、使用ターンから即有効、再使用時の非stack更新、再使用時も消費/鑑定/ターン進行、フロア移動後の維持、新規runでの非活性、通常成功契約

**death（9件）**：審判なし死亡、審判ありでLIFE/SOL全回復、固定値15を使わないこと、SOL満タン時も成立、消費数、ターン進行、RNG非消費、封印時不成立

**judgement（11件）**：通常使用非成立、インベントリ表示、敵攻撃/飢餓/毒/吊るされた男/死神からの発動、封印中発動、消費数、追加ターンなし、発動時鑑定、未所持時通常死亡

## focused検証結果

phase-20-core-loop・Phase20.1・Phase20.2・既存戦闘/毒/飢餓関連テスト、全通過（7ファイル、346件）

## 変更ファイル一覧

- 変更：`src/game/turn.ts`（`defeatEnemyIfNeeded`抽出、`getIncomingDamage`皇帝軽減、`applyEmperorCardUse`、ディスパッチ登録）、`src/game/types.ts`（`EffectId`へ`emperor_shield`追加）、`src/game/effects.ts`（`EFFECT_DEFINITIONS.emperor_shield`）、`src/game/events.ts`・`src/game/message-log.ts`（room効果カード用イベント型を今回追加したが、実際の使用はPhase20.4のjustice/devil/towerから）、`src/game/__tests__/phase-20-core-loop.test.ts`（emperorが実装済みになったことに伴う未実装リスト更新）
- 新規：`src/game/__tests__/phase-20-3-defensive-death-cards.test.ts`

（`events.ts`/`message-log.ts`のroom効果イベント追加はStage4-6のjustice/devil/tower実装と同時に行ったため、commit1にはPhase20.3で使用する部分（`card_use_failed`のinsufficient_resource等は未使用）のみが実質的に影響する。詳細な切り分けはcommit時のstaged差分監査で確認する）

## 数値の位置づけ

軽減率50%・継続5ターンはいずれもPhase20仮値であり、Phase27で最終調整する。
