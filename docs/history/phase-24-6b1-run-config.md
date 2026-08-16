# Phase 24.6b1: RunConfig・totalFloors基盤

`GameState`へ`RunConfig`（`totalFloors` + `runDepthTier`）を導入し、production生成・進行・Victoryが任意のtotalFloorsを参照できるようにした。default 3Fでは既存結果・RNG・telemetryを完全維持している。item availability・供給量・敵構成は一切変更していない。

## 1. precheck・pre-edit snapshot

- base branch: `phase-24-6b0-depth-tier-budget-audit`
- base HEAD: `3f11837bd14d443b566ff356e18898ee6744d9d9`（一致確認済み）
- work branch: `phase-24-6b1-run-config`（local/remoteとも重複なし、新規作成）
- baseline: `npx tsc --noEmit`（0 error）→ `npx vite build`（成功）→ `npx vitest run`（128 files / 3242 tests、全pass）— 指示のbaselineと完全一致
- 24.6b0 history確認: 78 ItemId・方式A（既存全itemをCORE_SHORT相当として維持）を踏襲する前提で本Phaseを実装した
- pre-edit snapshot: seed `[1, 2, 4, 42, 999, 4294967295]`について、floor1〜3各floorの`map.terrain`・`enemies`・`groundItems`・`equipmentInstances`・`combatRngState`・`phase`・`exit`等を一時script（`/tmp/audit-24-6b1/`、作業完了後削除）でJSON化し保存。実装完了後、同一seed・同一queryで再取得したJSONと`diff`し、**完全一致**を確認した（4節）。

## 2. RunConfig型とdefault

`types.ts`に追加:

```ts
export type RunDepthTier = 'short' | 'standard' | 'deep';

export interface RunConfig {
  totalFloors: number;
  runDepthTier: RunDepthTier;
}
```

`GameState`に`runConfig: Readonly<RunConfig>`を必須fieldとして追加。既存の`totalFloors: number`フィールドは削除せず維持（`buildFloorState`が`runConfig.totalFloors`と同じ値をここへ設定するため、`state.totalFloors === state.runConfig.totalFloors`が常に成立する — pre-24.6b1の全読み出し箇所を変更せずに済ませるための互換維持）。

`floor.ts`に追加:

```ts
export const DEFAULT_RUN_CONFIG: Readonly<RunConfig> = Object.freeze({
  totalFloors: TOTAL_FLOORS, // = 3
  runDepthTier: 'short',
});

export function normalizeRunConfig(config: RunConfig): Readonly<RunConfig> {
  // totalFloorsが有限整数かつ >= 1 でなければRangeError
  // 呼び出し側objectをフィールドごとに再構築してObject.freeze — 参照を共有しない
}
```

- `TOTAL_FLOORS`定数は互換用exportとしてそのまま維持（値は3のまま）。production logicからの直接参照は全て除去した（3節）。
- `createInitialState`の`runConfig`引数省略時は`DEFAULT_RUN_CONFIG`をそのまま使う（clone不要 — 既にfreeze済みの共有定数）。明示的に`RunConfig`を渡した場合のみ`normalizeRunConfig`でバリデーション・cloneする。
- `runDepthTier`はtotalFloorsから自動推測しない。10/30/99 presetやdifficultyは本Phaseで一切追加していない。

## 3. TOTAL_FLOORS直接参照の変更一覧

production logic（`__tests__`除く）から`TOTAL_FLOORS`定数への直接参照は、実装前は以下2箇所だった:

| ファイル | 変更前 | 変更後 |
|---|---|---|
| `state.ts:646`（`buildFloorState`内、GameState組み立て） | `totalFloors: TOTAL_FLOORS` | `totalFloors: runConfig.totalFloors`（+`runConfig`フィールド追加） |
| `state.ts:462`（`equipmentFloorRatio`計算） | `floorProgressRatio(floor, TOTAL_FLOORS)` | `floorProgressRatio(floor, runConfig.totalFloors)` |
| `turn.ts:515`（`resolveEnemyDropEquipmentDefinition`呼び出し） | `TOTAL_FLOORS`（import経由の定数） | `state.totalFloors`（既存fieldをそのまま参照） |

`turn.ts:5457`のVictory判定（`state.floor >= state.totalFloors`）は実装前から既に`state.totalFloors`を参照しており、変更不要だった（24.6b0監査時点で確認済みの通り、floor数非依存の設計が既に成立していた）。

`buildFloorState`のsignatureに`runConfig: Readonly<RunConfig>`引数を追加し、`createInitialState`（optional第2引数、省略時`DEFAULT_RUN_CONFIG`）・`advanceToNextFloor`（`state.runConfig`をそのまま次floorへ引き継ぐ — 新規生成やmutationなし）・`buildRosterPreviewFloorState`（`DEFAULT_RUN_CONFIG`固定）の3呼び出し元を更新した。

`item-def.ts`のfloor2/3 staging、`state.ts`のfloor===1 chocolate保証、`sunlight.ts`のfloor===1/2/3手作りmap生成、`mapgen.ts`のENEMY_COUNT_BY_FLOOR、`equipment-loot.ts`/`enemy-drop.ts`/`card-loot.ts`/`accessory-loot.ts`のrank/rarity weightテーブル・drop率・curse率は**一切変更していない**（24.6b0監査のNEEDS_DESIGN_DECISION・out_of_scopeの通り、本Phaseの対象外）。

## 4. 3F完全互換結果

pre-edit snapshot（1節）と実装完了後の同一script実行結果を`diff`した結果、**完全一致（差分0）**を確認した。検証対象:

- seed `[1, 2, 4, 42, 999, 4294967295]` × floor1〜3
- `map.terrain`（壁/床の全タイル文字列）
- `enemies`（id・type・pos・hp）
- `groundItems`（id・itemId・pos・equipmentInstanceId）
- `equipmentInstances`（instanceId・definitionId・cursed・refineLevel）
- `combatRngState`
- `phase`・`exit`・`seed`・`totalFloors`

`createInitialState(seed)`（config省略）と`createInitialState(seed, { ...DEFAULT_RUN_CONFIG })`（DEFAULT_RUN_CONFIG明示）の両方で同一scriptを実行し、いずれもpre-edit snapshotと完全一致することを確認した（config省略時と明示時の一致要件を満たす）。

全3242 testsが変更なしで全pass（5節）。

## 5. 10/30/99 smoke

`{ totalFloors: 10, runDepthTier: 'short' }` / `{ totalFloors: 30, runDepthTier: 'standard' }` / `{ totalFloors: 99, runDepthTier: 'deep' }`の3設定で一時scriptによるsmoke testを実行した。

- 全floor生成で例外なし（`sunlight.ts`のfloor===1/2/3判定は floor>3で floor3扱いへフォールバックする既存実装のため、4F以降も未定義エラーにならない — 24.6b0監査4節で確認済みの挙動を再確認）
- `advanceToNextFloor`を指定totalFloorsまで繰り返し、最終floor（10/30/99）へ到達できることを確認
- 各floorで`state.runConfig.totalFloors`・`state.runConfig.runDepthTier`が設定値のまま不変であることを確認（floor transitionでの再構築・mutationなし）
- `floorProgressRatio(state.floor, state.totalFloors)`が指定totalFloorsを正しく使用していることを確認（`floor / totalFloors`と一致）
- runDepthTierのみを変えて（`short`/`standard`/`deep`、totalFloors=10固定）同一seedで生成した結果（enemies・groundItems・map）が完全一致することを確認 — runDepthTierは本Phaseでは生成結果に一切影響しない（task契約通り、eligibility実装は24.6b2へ分離）

Victoryが最終floorでのみ成立する挙動自体は`turn.ts:5457`の既存ロジック（`state.floor >= state.totalFloors`、階段への能動move経由でのみ到達）が変更されていないため、この一時scriptでは直接シミュレートしていない — 3242 testsの既存floor-transition/victory回帰テスト（totalFloors=3ケース）で担保されている。

## 6. RNG・telemetry

- 新規RNG streamなし、新規saltなし（`equipmentFloorRatio`計算式自体は変更せず、第2引数の値の出所を変えただけ）
- default 3Fはbyte-for-byte一致（4節のsnapshot diff結果）
- 異なるtotalFloorsではprogress依存のloot差が生じる（`floorProgressRatio`の結果が変わるため — 意図通り）
- map生成・戦闘等のtotalFloors非依存streamは同seed・同floorで一致することを、5節のrunDepthTier-invariance検証（enemies/groundItems/mapが3tier間で完全一致）で確認した
- runDepthTierだけを変えても全生成結果が一致することを5節で確認済み
- telemetry: `schemaVersion`は8のまま変更していない（`telemetry.ts`に`runConfig`関連のexport・フィールドは一切追加していない）。既存のfloor/Victory記録ロジックも変更していない。

## 7. 既存test変更

61ファイルを変更（productionコード4ファイル + テストファイル57ファイル）。

**production（4ファイル）**: `types.ts`（型追加）、`floor.ts`（DEFAULT_RUN_CONFIG・normalizeRunConfig追加）、`state.ts`（buildFloorState/createInitialState/advanceToNextFloor/buildRosterPreviewFloorState更新）、`turn.ts`（TOTAL_FLOORS直接参照除去）。

**テスト（57ファイル）**: `GameState`リテラルを直接構築している既存testで、`totalFloors: 3,`の直後に`runConfig: DEFAULT_RUN_CONFIG,`を追加し、`../floor`から`DEFAULT_RUN_CONFIG`をimportする変更のみを機械的に適用した。**gameplay期待値・RNG期待値・3F生成snapshotの変更は一切行っていない** — 追加した2行（フィールド1行 + import1行、ファイルによっては複数箇所）以外の差分はない（`git diff`で確認済み、3節参照）。

対象は主にGameStateを直接literalで組み立てる`freshState`的なローカルhelper関数を持つファイル群（enemy-behavior系、phase-09〜13/16/18/21〜24系、inventory/hunger/message-log/turn/weapon系など）。共通fixture helperモジュールは本リポジトリに存在しないため、各ファイルのローカルdefaultへ個別に補完した（既存構造を変更しない対応）。

## 8. 全検証結果

| gate | 結果 |
|---|---|
| focused検証（clone/immutability、invalid totalFloors拒否、config省略/明示一致、3F snapshot一致、10/30/99 transition/Victory、runConfig state lifetime、runDepthTier非作用、RNG非干渉） | 全PASS（一時script、詳細は4〜6節） |
| `npx tsc --noEmit` | 0 error |
| `npx vitest run` | 128 files / 3242 tests、全pass |
| `npx vite build` | 成功 |
| `git diff --cached --check` | OK |
| production sanity（4節snapshot diff） | 差分0 |

`normalizeRunConfig`のバリデーションは`0`・`-1`・`1.5`・`NaN`・`Infinity`・`-Infinity`の6ケース全てで`RangeError`をstate構築前に投げることを確認した。`DEFAULT_RUN_CONFIG`・生成された`state.runConfig`はいずれも`Object.freeze`済みで、mutation試行後も値が変化しないことを確認した。呼び出し元が渡した`RunConfig`オブジェクトを後から書き換えても、既に構築済みの`state.runConfig`には影響しないこと（clone契約）も確認した。

## 9. 指示逸脱・停止事項

なし。stop_conditionsのいずれにも該当しなかった（default 3F snapshotは完全一致・維持できた、RunConfig必須化は既存schemaと衝突しなかった、Victory正本は元々`state.totalFloors`単一参照で統一済みだった、telemetry schemaVersion変更は不要だった、4F以降生成は既存のfloor3フォールバックで新規content追加なしに動作した、totalFloors導入に既存RNG streamの変更は不要だった）。out_of_scope（item minimumRunDepth/unlockProgress、pool変更、power/sustain budget、MH・black_armor遭遇率、10/30/99 mode選択UI、difficulty、save/load、敵・地形・event追加）には一切着手していない。
