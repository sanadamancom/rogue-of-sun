# Phase 10.3.3a healingフィールド名修正

## 修正目的

Phase 10.3.3で追加した`player_healed`イベントについて、指定仕様では実回復量フィールドを`actualHealing`としていましたが、実装と出力JSONでは誤って`actualAmount`となっていました。Phase 10.4へ進む前に`actualHealing`へ統一し、schemaVersion 3の正式仕様を確定させました。今回はフィールド名だけの是正であり、戦闘・回復・SOLなどのバランス調整は一切行っていません。

## 開始時のbranch、HEAD、working tree

branch: main、HEAD: `978220c92857539edc1bf68f5a09c0b5434c7881`（Phase 10.3.3完了時点）、origin/mainと一致、working tree clean。

## baseline結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：47ファイル / 984件全成功
- `npx vite build`：成功

## 指定仕様がactualHealingだったこと

Phase 10.3.3のタスク仕様（`field_semantics`セクション）では実回復量フィールド名を明記していませんでしたが、本Phase（10.3.3a）の指示で`actualHealing`が正式仕様であることが確定しました。

## 実装がactualAmountになっていた原因

Phase 10.3.3実装時、`player_attack`側の実ダメージフィールドを`actualDamage`と命名した際、対となる回復側フィールドの命名を`actualAmount`という別の語で実装してしまい、`actualHealing`と統一しませんでした。単純な命名の不統一であり、ロジック自体に誤りはありませんでした。

## 変更箇所

`src/game/telemetry.ts`内の`player_healed`イベントに関する4箇所（型定義、自然回復イベント生成、アイテム回復イベント生成、`healingBySource`集計）で`actualAmount`を`actualHealing`へ機械的に置換しました。

## actualHealingの定義

`hpAfter - hpBefore`の実差分です。自然回復・アイテム回復とも、`turn.ts`が既に`Math.min(maxHp, ...)`でクランプ済みの値から計算されるため、最大HPを超える見かけ上の回復量が含まれることはありません。

## healingBySourceの集計方法

`computeRunSummary`が`player_healed`イベントを走査し、`event.source`（`'natural_regeneration'`または`'item'`）ごとに`event.actualHealing`を合算します。集計ロジック自体（走査対象イベント・グルーピングキー）はPhase 10.3.3から変更しておらず、参照するフィールド名のみを修正しました。

## schemaVersionを3のままとした理由

今回の修正は出力JSONの意味論を変えるものではなく（回復量の実体は変わらず、フィールド名のみの是正）、指示どおり`schemaVersion`は3のまま維持しました。出力ファイル名も`rogue-of-sun-run-v3-{seed}-{clear|death}.json`のまま変更していません。

## actualAmount互換を追加しないこと

指示に従い、`actualAmount`との併記や互換エイリアスは一切追加していません。修正後の`player_healed`イベントには`actualHealing`のみが存在し、`actualAmount`は出力されません。

## 変更ファイル一覧

- `src/game/telemetry.ts`：`player_healed`関連4箇所の`actualAmount`→`actualHealing`
- `src/game/__tests__/phase-10-3-1-telemetry.test.ts`：1箇所更新
- `src/game/__tests__/phase-10-3-3-damage-recovery-fix.test.ts`：6箇所更新（アサーション・変数名・コメント含む）
- `src/game/__tests__/phase-10-3-3a-healing-field-rename.test.ts`（新規、12件）
- `docs/history/phase-10-3-3-damage-and-recovery-telemetry-fix.md`：`actualAmount`と記載していた2箇所へPhase 10.3.3aでの訂正である旨を追記（過去の記述は削除せず維持）
- `docs/history/phase-10-3-3a-healing-field-name-fix.md`：本ドキュメント

## 追加または更新したテスト

新規12件（`phase-10-3-3a-healing-field-rename.test.ts`）：自然回復・アイテム回復それぞれで`actualHealing`が存在し`actualAmount`が存在しないことの直接検証2件、`actualHealing === hpAfter - hpBefore`の一致確認1件、最大HP付近でのクランプ確認1件、満タン時の非発生確認1件、`healingBySource`再集計一致確認2件、schemaVersion/ファイル名維持確認2件、JSON再parse後の構造検証（`actualAmount`不在の直接確認）1件、決定性確認1件、非干渉確認1件。既存テスト（`phase-10-3-1-telemetry.test.ts`1箇所、`phase-10-3-3-damage-recovery-fix.test.ts`6箇所）は削除・skip・onlyを一切行わず、期待値を`actualHealing`へ明示的に更新しました。

## 型チェック、全テスト、build、diff-check結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：**48ファイル / 996件全成功**（既存984件は更新のうえ全通過、新規12件追加）
- `npx vite build`：成功
- `git diff --check`：問題なし

## 手動確認結果

単一HTMLをPlaywrightでfile://起動し、ランダムなキー入力で実際に死亡させ、道中で自然回復（`player_healed`）が発生したランでJSON保存を実行しました。

- `schemaVersion: 3`、ファイル名`rogue-of-sun-run-v3-{seed}-death.json`（v3のまま）を確認
- 実際に発生した`player_healed`イベントに`actualHealing`フィールドが存在し、`actualAmount`フィールドが存在しないことを確認（`'actualAmount' in event === false`を直接検証）
- コンソールエラー・ページエラーともに0件

`healingBySource`と`actualHealing`再集計の一致は、自動テスト（`healingBySource is a correct re-aggregation of every player_healed.actualHealing`他）で厳密に確認済みです。

## バランス数値を変更していないこと

HP自然回復量（10）・周期（5ターン）・発生条件、最大HP、SOL最大値・回復量・消費量、武器・防具・敵・アイテムの数値、敵AI、マップ生成、ターン消費規則、乱数呼び出し順序はいずれも本Phaseで一切変更していません。変更は`player_healed`イベントのフィールド名のみです。

## Phase 10.4を開始していないこと

確認済みです。本Phaseはフィールド名の是正のみであり、HP自然回復のレベル別調整やSOL最大値拡張などのPhase 10.4で予定されている数値調整・新要素実装は一切行っていません。
