# Phase 24.6c2c: leg-aware floor seed and deterministic normal reinforcement

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §4.4・§8・§16 row `24.6c2c`に基づき実装した。

## 1. 実装

- `src/game/floor.ts`の`deriveFloorSeed`に`leg: 'descent' | 'ascent' = 'descent'`引数を追加した。`'descent'`は既存の`(runSeed, floor)`呼び出しとbyte-identical。`'ascent'`は専用salt定数で独立したseed streamを導出する。productionの唯一の呼び出し元（`state.ts`の`buildFloorState`）は現状どおり`'descent'`のみ使用し、ascentは未接続のまま（§19の後続phase接続方針どおり）。
- `src/game/reinforcement.ts`を新規追加し、`getReinforcementRule(floor)`が`enemy-depth-bands.ts`の`getEnemyPopulationForDepth(floor).reinforcementIntervalTurns`（Phase 24.6c2bで追加済みの正本data）を再利用してcadence turnsを返す。cap bonus（+2）はこのfileのローカル定数。
- `src/game/turn.ts`に`resolveRegularReinforcement`を追加し、`floorTurn`が周期に達するたびに増援判定を行う。`reinforcementOrdinal`は判定1回につき必ず1増加する（実際にspawnしたか否かに関係なく）。`combatRngState`は一切消費せず、`(seed, floor, ordinal, leg)`から独立したRNG streamを都度導出する。
- spawnされた敵は`spawnSource: 'reinforcement'`とし、既存の`getEnemyPoolForFloor`／均一種族選択／`ENEMY_DEFINITIONS`・`applyEnemyLevelMultiplier(_, 1)`をそのまま再利用する（EnemyLevel帯データの接続は§19どおり後続phase）。
- `reinforcement_spawned`イベントを`events.ts`・`telemetry.ts`に追加し、telemetry `schemaVersion`を10→11へ更新した。

## 2. 検証

- `npm run typecheck` / `npm test`（134ファイル、3368件）/ `npm run build` すべて通過。
- `reinforcementOrdinal`が増援skip時（上限到達・配置候補0件）にも正しく1進むことをunit testで確認。
- `deriveFloorSeed`のdescent互換性・ascent独立性をunit testで確認。
- telemetry `schemaVersion` 10→11に伴う既存hardcoded-value testを全件更新（`phase-10-3-1`〜`phase-24-4e2`など）。

## 3. 経緯（correctionの記録）

本実装は実際のHermes non-interactive orchestrationセッションが `/ros-start` 経由で開始し、Codexへ委任した成果だが、そのClaude sessionはCodexをbackground委任のまま`.ai/status.json`を書かずに終了してしまい（別途修正済みのcontrol-layer bug）、working treeに未検証のまま残っていた。Claudeが独立してレビューした結果、`reinforcementOrdinal`がskip時に増加しない設計逸脱、`enemy-depth-bands.ts`との重複実装、未使用の`GroundItem.spawnSource`拡張、および無関係な既存test 1件のfilename正規表現の古い値、を発見し、bounded correctionとしてfresh Codexへ委任・再検証したうえで受け入れた。
