# Phase 24.6c2d: cumulative EXP table and even-level ability points

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §5・§16 row `24.6c2d`に基づき実装した。

## 1. 実装

- `src/game/progression.ts`に`CUMULATIVE_EXPERIENCE_BY_LEVEL`（Lv1～Lv50は設計正本§5の表そのまま、Lv51～`LEVEL_CAP`（99）は「前Lv+30000」のtechnical fallback）を追加した。
- `getExperienceRequirement(level)`を`level * 5`から`CUMULATIVE_EXPERIENCE_BY_LEVEL[level + 1] - CUMULATIVE_EXPERIENCE_BY_LEVEL[level]`へ置換した。関数のexport名・signatureは変更していないため、`src/main.ts`のHUD表示は無改修で動作する。
- `applyExperienceGain`の能力ポイント付与を、到達levelが偶数のときだけ1点付与するよう変更した（Lv2、Lv4、…）。`LevelUpResult.abilityPointsGained`は各level-upごとの実際の付与数（0または1）を保持し、`ExperienceGainResult.abilityPointsGained`はその合計を返す。
- `src/game/message-log.ts`の`player_leveled_up`表示から、`event.abilityPointsGained > 0`のときだけ「能力ポイントを1得た。」を追記するよう修正した（奇数levelへの到達では0点のため、この行を表示しない）。
- `src/game/ability.ts`の能力4種のrank別効果（`BODY_MAX_HP_PER_RANK`等）とrank上限は既に設計正本§5の効果表と一致していたため無改修。

## 2. 検証

- `npm run typecheck` / `npm test`（134ファイル、3368件）/ `npm run build` すべて通過。
- `phase-13-1-experience-level-foundation.test.ts`・`phase-13-2-ability-allocation-screen.test.ts`の既存hardcoded値（`level * 5`前提、毎level付与前提）を新table・偶数level限定付与へ更新した。
