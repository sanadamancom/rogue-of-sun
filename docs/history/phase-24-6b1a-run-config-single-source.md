# Phase 24.6b1a: RunConfig single-source correction

24.6b1で`GameState.totalFloors`（既存field）と`GameState.runConfig.totalFloors`（24.6b1新規field）が同じ値を二重保存していた問題を補正した。`GameState.totalFloors`・`GameState.runDepthTier`を唯一の正本とし、`GameState.runConfig`フィールド自体を削除した。`RunConfig`型は「run作成時の入力」と「`buildFloorState`の内部引数」としてのみ残る。

## 1. precheck

- base branch: `phase-24-6b1-run-config`
- base HEAD: `90165be1c5d539dc6e20cd4c3f1dd20a8b42291d`（一致確認済み）
- work branch: `phase-24-6b1a-run-config-single-source`（local/remoteとも重複なし、新規作成。`stop_if_branch_exists`条件も満たさず正常続行）
- baseline: `npx tsc --noEmit`（0 error）→ `npx vitest run`（128 files / 3242 tests、全pass）→ `npx vite build`（成功）
- working tree: precheck時点でclean
- pre-edit snapshot: seed `[1, 2, 4, 42, 999, 4294967295]`のfloor1〜3を一時script（`/tmp/audit-24-6b1a/`、作業完了後削除）でJSON化し保存（3節）

## 2. 二重正本が生じた原因

24.6b1の実装時、`GameState`へ「run生成に使う設定」を持たせる方法として、`RunConfig`オブジェクトそのものを`state.runConfig`フィールドに保存する設計を採用した。同時に、既存の`state.totalFloors`フィールドは pre-24.6b1 の全read site（`floorProgressRatio`呼び出し・victory判定など）を変更せずに済ませる目的で削除せず維持した。

結果として `state.totalFloors` と `state.runConfig.totalFloors` が同じ値を指す2つのフィールドとして共存し、`types.ts`のコメントも「両者は同期される」ことを前提に書かれていた（`buildFloorState`が両方を同じ`RunConfig`引数から設定していたため実際に乖離することはなかったが、正本が1つに定まっていない状態そのものが将来のfixture更新・状態migration・部分的な状態更新コードで両者を乖離させうるリスクだった）。

## 3. 補正前後のstate構造

### 補正前（24.6b1時点）

```ts
export interface GameState {
  // ...
  totalFloors: number;              // 既存field
  runConfig: Readonly<RunConfig>;   // 24.6b1新規field（totalFloors/runDepthTierを含むオブジェクトごと保存）
  // ...
}
```

### 補正後（24.6b1a）

```ts
export interface GameState {
  // ...
  totalFloors: number;      // 唯一の最大階層正本（変更なし、既存read siteそのまま）
  runDepthTier: RunDepthTier; // 新規required field、totalFloorsと並ぶ唯一の正本
  // runConfig フィールドは存在しない
  // ...
}
```

`RunConfig`型自体（`totalFloors` + `runDepthTier`）は維持しているが、その役割を「run作成時の入力（`createInitialState`の第2引数）」と「`buildFloorState`内部の一時引数」に限定した。`buildFloorState`はこの`RunConfig`引数から`totalFloors`と`runDepthTier`を個別に読み取り、返却する`GameState`へ個別フィールドとしてコピーする（オブジェクトごと保存しない）。

`advanceToNextFloor`は、次floor構築のために`buildFloorState`へ渡す`RunConfig`引数を、保存済みの`state.totalFloors`・`state.runDepthTier`（両方とも唯一の正本）から都度その場で組み立てる:

```ts
const nextState = buildFloorState(
  state.runSeed,
  state.floor + 1,
  state.turn,
  { totalFloors: state.totalFloors, runDepthTier: state.runDepthTier },
  carry,
);
```

## 4. 全参照監査結果

`audit.search`の5キーワードで`src/game`（`__tests__`除く）を全件監査した結果:

| 検索語 | 補正前件数 | 補正後件数 | 内容 |
|---|---|---|---|
| `state.runConfig` | 2（`state.ts`の`advanceToNextFloor`呼び出し1件、`types.ts`のコメント1件） | **0** | 完全除去 |
| `runConfig:`（フィールド定義/リテラル） | 2（`state.ts`のbuildFloorState引数宣言、`types.ts`のGameStateフィールド定義） | 1（`state.ts`のbuildFloorState**引数**宣言のみ — GameStateフィールドとしては存在しない） | 許容範囲（入力引数としてのみ） |
| `state.totalFloors` | 3（`turn.ts`2箇所、`state.ts`のGameState組み立て1箇所） | 3（変更なし、全て正本参照） | 既存のまま |
| `TOTAL_FLOORS` | コメントのみ6箇所 + `floor.ts`定義1箇所 | 変更なし | 影響なし |
| `.runConfig.totalFloors` | 0（24.6b1時点で既にこの形の直接参照は存在しなかった） | 0 | — |

**acceptance確認**:
- production上の`state.runConfig`参照: **0件**
- `GameState` interfaceに`runConfig` field: **存在しない**（`types.ts`の`GameState`定義に`runConfig`キーなし、grep一致0件）
- 永続state上の最大階層正本: `totalFloors`のみ（`runDepthTier`はrank/tier正本として別軸、両者とも「入力→canonical stateへコピー」の同じパターンで統一）
- `RunConfig`の残存用途: (1) `createInitialState`の`runConfig?: RunConfig`optional引数（run作成時の入力）、(2) `buildFloorState`の`runConfig: Readonly<RunConfig>`必須引数（内部でtotalFloors/runDepthTierを個別にstateへコピーするためだけに使う一時引数） — この2箇所以外に存在しない

## 5. 3F snapshot互換

pre-edit snapshot（1節）と実装完了後の同一script実行結果を`diff`し、**完全一致（差分0）**を確認した。検証対象は24.6b1時と同一（seed 6件 × floor1〜3の map/enemies/groundItems/equipmentInstances/combatRngState等）。

## 6. 10/30/99F結果

一時scriptによるfocused検証で以下を全てPASS確認:

- `createInitialState(seed)`省略時と`createInitialState(seed, { ...DEFAULT_RUN_CONFIG })`明示時で`totalFloors`・`runDepthTier`・`runConfig`フィールド非存在が完全一致
- `{ totalFloors: 10, runDepthTier: 'short' }` / `{ totalFloors: 30, runDepthTier: 'standard' }` / `{ totalFloors: 99, runDepthTier: 'deep' }`の3設定で、`advanceToNextFloor`後も`state.totalFloors`・`state.runDepthTier`が入力値のまま維持されることを確認（floor transitionでの値の欠落・変質なし）
- 各totalFloors（3/10/30/99）でVictory判定式（`floor >= totalFloors`）が最終floorでのみ真になることを確認
- `runDepthTier`のみを変えて（`short`/`standard`/`deep`、totalFloors=10固定、同一seed）生成した`enemies`・`groundItems`・`map`が完全一致することを確認（生成結果・RNGへの非干渉）
- `createInitialState`へ渡した入力`RunConfig`オブジェクトを作成後に書き換えても、既に構築済みの`state.totalFloors`・`state.runDepthTier`には影響しないことを確認（`normalizeRunConfig`のフィールド個別コピーによるclone契約）
- `0`・`-1`・`1.5`・`NaN`・`Infinity`・`-Infinity`の6ケース全てで`normalizeRunConfig`が`RangeError`を投げることを確認
- `floorProgressRatio(state.floor, state.totalFloors)`がcustom totalFloors（例: 20）を正しく使用することを確認

## 7. 既存test変更理由

57ファイルを変更。全て機械的置換のみ:

```diff
-      runConfig: DEFAULT_RUN_CONFIG,
+      runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,
```

`GameState`リテラルを直接構築している既存testのローカルdefaultで、`runConfig: DEFAULT_RUN_CONFIG,`（24.6b1で追加したフィールド）を`runDepthTier: DEFAULT_RUN_CONFIG.runDepthTier,`（本Phaseで唯一の正本となったフィールド）へ1行置換した。import文（`DEFAULT_RUN_CONFIG`を`../floor`から取得）はそのまま維持している（`.runDepthTier`プロパティアクセスに使うため、import自体の変更は不要だった）。

`git diff -- src/game/__tests__`の全追加/削除行を確認した結果、上記の1行置換パターン（57ファイル × 1箇所、`enemy-behavior-spider.test.ts`と`phase-24-4e1-active-curse-routes.test.ts`のみ2箇所）以外の差分は存在しない（57 files changed, 59 insertions, 59 deletions）。gameplay期待値・RNG期待値の変更、assertionの削除・緩和は一切行っていない。

## 8. development_plan

リポジトリ内（`sanadamancom/rogue-of-sun`）を検索したが、`development-plan`という名前のファイルは存在しなかった（プロジェクトknowledge側にのみ`rogue-of-sun-development-plan_.md`が存在し、リポジトリ内には未配置）。task指示の「repository内に存在する場合のみ更新」に従い、新規作成は行わず**更新不能**として報告する。

## 9. 全検証結果

| gate | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| focused tests（8項目、上記6節） | 全PASS |
| `npx vitest run` | 128 files / 3242 tests、全pass（既存3242件、追加・削除なし） |
| `npx vite build` | 成功 |
| `git diff --cached --check` | OK |
| 3F pre/post snapshot diff | 差分0 |

## 10. 指示逸脱・停止事項

なし。stop_conditionsのいずれにも該当しなかった（`state.totalFloors`削除を要する重大な既存依存は発見されなかった、単一正本化は`totalFloors`/`runDepthTier`の個別フィールド化という単一設計案で完結した、3F snapshotおよび既存gameplay期待値の変化なし、production変更はscope内に収まった、baseline/dirty tree/branch衝突のいずれも発生しなかった）。`implementation.prohibited`に列挙されたavailability/minimumRunDepth/unlockProgress実装、power/sustain budget実装、route weight・rank weight変更、新規RNG stream/salt、telemetry schema変更、3F gameplay期待値変更のいずれにも着手していない。
