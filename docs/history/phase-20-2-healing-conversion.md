# Phase 20.2 恋人・吊るされた男

## 目的と対象カード

「恋人」（lovers）と「吊るされた男」（hanged_man）を、通常のカード使用経路（`processTurn`）で正しく動作させる。開始base commit：`2841098341fc6b2fbac25fbe37c35ca197f05f31`。

## 既存実装の監査結果

両カードは前セッションの作業で既にproduction登録済みだったが、実装は「効果0（満タン／無変化）の場合は使用不成立」という旧契約に基づいていた。今回の実装指示は「使用処理そのものを完了できる場合は、実際の状態変化が0でも使用成立とする」という新しい契約を要求しており、既存実装と矛盾していたため、当該部分のみ最小差分で修正した。`finishSuccessfulCardUse`（消費・鑑定・`card_used`イベント）、封印判定、既存の死亡解決経路は変更せず流用した。

## 恋人の確定仕様

現在SOLを`state.maxSolarEnergy`（stateから導出される現在の最大SOL、固定値15ではない）まで回復する。

**SOL満タン時も効果0で使用成立する契約**：満タン時も`consumed:true`、カード1枚消費、未鑑定なら鑑定、正確に1ターン進行。回復量（`recovered = maxSolarEnergy - solarEnergy`、満タン時は0）を`lovers_used { recovered }`イベントで報告し、`message-log.ts`が`recovered > 0`なら回復量を、`recovered === 0`なら「SOLは満タンだった」と表示する。RNGは使用しない（成功・不成立いずれもRNG state不変）。

## 吊るされた男の整数値交換式

使用前のLIFEを`L`、SOLを`S`とし、両方を**変更前の値から同時に**計算する（LIFEを先に変更してからSOL計算へ再利用しない）：

```
使用後LIFE = min(S, 最大LIFE)
使用後SOL  = min(L, 最大SOL)
```

最大値超過分は切り捨て、他方の資源へ戻さない。

**状態変化0でも使用成立する契約**：LとSが同値で交換結果が数値上無変化でも`consumed:true`、消費・鑑定・1ターン進行が成立する。RNGは使用しない。

**交換後LIFE0の死亡処理**：既存の`resolveDeathIfDefeated`（共通死亡解決境界）を呼ぶのみで、カードresolver内に死亡処理を複製していない。

## judgement provenance監査結果

`resolveDeathIfDefeated`と`judgement_triggered`イベントは、Phase 20.2のbase commit `2841098341fc6b2fbac25fbe37c35ca197f05f31`の時点で**既に存在していた**。導入commitは`19cf34771aa06e3306faf65f7264587289b1fc9d`（"feat: implement phase 20 card core loop"）で、`git merge-base --is-ancestor`により当該commitがbase commitの祖先であることを確認した。**Phase 20.2ではjudgement関連の実装・変更を一切行っていない**（`turn.ts`の差分に`judgement`/`resolveDeathIfDefeated`関連の変更が含まれないことを確認済み）。「吊るされた男」の実装は、この既存の死亡解決境界を単に呼び出しているだけであり、新規実装ではない。

**計画資料との不一致（要確認事項）**：`rogue-of-sun-development-plan.md`は審判（judgement）の実装を「単位20.3：死亡連動」としてPhase 20.3に位置づけている。しかし実際のproductionでは、judgementの機構はPhase 20.2着手より前（`19cf347`、20.0c/20.0d/20.1/20.2いずれよりも前のcommit）から既に存在していた。この食い違いは今回解消・修正しておらず、計画資料も変更していない。

## 共通成功・不成立契約の確認

- 成功時：消費・鑑定・`card_used`イベント・1ターン進行が各1回ずつ成立（`finishSuccessfulCardUse`経由）
- 未所持・封印中：完全な使用不成立（LIFE・SOL・inventory・鑑定・turn・RNGいずれも無変化）。封印時は既存`card_use_failed(reason:'sealed')`イベント発行
- Phase20.1の5カード、他15カードの効果・resolver登録に変更なし
- test専用resolverの追加なし

## lovers_usedイベントとmessage-logの確認

`lovers_used { recovered: number }`（既存`sun_fruit_used`と同型）。`recovered`が0のときのみ「満タンだった」を表示し、正の場合は既存文体（チョコレート等）に沿った回復結果を表示。重複イベント発行なし。

## 変更・新規ファイル一覧

- 変更：`src/game/turn.ts`、`src/game/events.ts`、`src/game/message-log.ts`、`src/game/__tests__/phase-20-core-loop.test.ts`
- 新規：`src/game/__tests__/phase-20-2-healing-conversion.test.ts`

## Phase 20.2専用テストのカテゴリ別件数

| category | 件数 |
|---|---|
| lovers | 9 |
| hanged_man | 12 |
| shared_success_contract | 4 |
| rejection_contract | 7 |
| persistence_and_regression | 7 |
| **合計** | **39** |

## 39件すべてのテスト名

**lovers**
1. restores current SOL to max when SOL is below max
2. restores to the current (grown) max SOL, not a fixed value, when max SOL has increased
3. succeeds even when SOL is already at max
4. does not change SOL when already at max
5. consumes one copy even when SOL is already at max
6. identifies the card even when SOL is already at max
7. advances the turn by exactly 1 even when SOL is already at max
8. emits a zero-effect log/event when SOL is already at max
9. does not change combatRngState on success

**hanged_man**
10. swaps LIFE and SOL as integer values
11. truncates LIFE when the incoming SOL value exceeds maxLIFE
12. truncates SOL when the incoming LIFE value exceeds maxSOL
13. truncates both sides simultaneously when both exceed the opposite max
14. computes both results from the pre-swap values simultaneously (never chaining LIFE into the SOL calculation)
15. succeeds even when LIFE and SOL are already equal (numeric no-op swap)
16. consumes and identifies even when LIFE and SOL are already equal
17. advances the turn by exactly 1 when LIFE and SOL are already equal
18. SOL of 0 results in LIFE becoming 0 after the swap
19. LIFE 0 after the swap connects to the existing death/gameover pipeline
20. LIFE 0 after the swap triggers judgement if held (reuses the existing shared death-resolution boundary, no duplicated death logic)
21. does not change combatRngState on success

**shared_success_contract**
22. lovers consumes exactly one copy even when holding several
23. hanged_man consumes exactly one copy even when holding several
24. lovers emits the existing card_used event shape on success
25. hanged_man emits the existing card_used event shape on success

**rejection_contract**
26. lovers: not owning the card is a complete no-op
27. hanged_man: not owning the card is a complete no-op
28. lovers: sealed use is a complete no-op
29. hanged_man: sealed use is a complete no-op
30. lovers: sealed use emits the existing card_use_failed(sealed) event
31. hanged_man: sealed use emits the existing card_use_failed(sealed) event
32. rejection paths never change combatRngState

**persistence_and_regression**
33. lovers-restored SOL persists across a floor transition
34. hanged_man swap result persists across a floor transition
35. a new run starts with existing initial LIFE and SOL values
36. Phase 20.1 permanent-growth cards are unaffected
37. all 17 cards remain outside every floor weighted loot pool
38. no card appears across 100 seeds of real floor generation
39. equipment instance and curse state are unaffected by lovers/hanged_man use

## focused検証結果

5ファイル、281件、全通過

## 全通常テストの結果

90ファイル、2260件、全通過

## typecheck・build・git diff --check結果

- `npx tsc --noEmit`：成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 版・依存の不変性

CURRENT_GAME_VERSION：'phase-19'のまま、schemaVersion：7のまま、package.json/package-lock.json：無変更

## 全17カードの床・敵ドロップ除外状態

`floorDropEnabled: true`：0件、`enemyDropEnabled: true`：0件、いずれも全17カードでfalseを維持

## Phase 20.3以降への未着手

皇帝・死神・節制・正義・悪魔・塔・星・月・太陽の効果、および審判の新規実装・変更はいずれも行っていない。

## 既知の未解決事項

上記「judgement provenance監査結果」に記載の通り、開発計画上のPhase構成（審判をPhase20.3に配置）と実際のproduction実装順序（judgementの機構がPhase20.2以前から存在）の間に食い違いがある。今回はこの食い違いの調査・報告のみを行い、計画資料・productionいずれも修正していない。
