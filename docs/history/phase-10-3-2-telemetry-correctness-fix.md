# Phase 10.3.2 テレメトリ正確性修正

## 目的

Phase 10.3.1で追加したラン計測について、実プレイのクリアランJSON（`rogue-of-sun-run-v1-3716665143-clear.json`）から判明した集計不整合と重複撃破を修正しました。バランス数値は一切変更せず、実際のゲーム状態・イベント・終了画面・JSON集計を相互に一致させることを目的としています。

## 開始状態

開始時のHEADは`f73012928a07cffcfe799ad9641a8cdc41f44440`（Phase 10.3.1完了時点、origin/mainと一致、working tree clean）。baseline：`npx tsc --noEmit`エラーなし、`npx vitest run`45ファイル/939件全成功、`npx vite build`成功。添付JSON（seed 3716665143、clear、517ターン、3フロア、636イベント）を読み込み、再現資料として使用しました（テストfixtureやcommit対象にはしていません）。

## 修正前JSONで確認した不整合

イベント種別集計：`move 487 / move_blocked 71 / player_attack 14 / item_acquired 10 / enemy_attack 9 / enemy_defeated 6 / key_enemy_defeated 6 / sol_changed 6 / equipment_acquired 5 / player_damaged 4 / floor_started 3 / exit_reached 3 / floor_completed 3 / wait 3 / solar_charge 3 / run_started 1 / attack_invalid 1 / run_completed 1`。

turn 429〜440のcockatrice関連イベントを時系列確認したところ、turn433で`targetId=0`のcockatriceが`targetHpAfter:0`で撃破された後も、turn435・437・439で同じ`targetId:0`・`targetHpBefore:10, targetHpAfter:0`が繰り返し記録され、`enemy_defeated`もturn433とturn439で重複していました。

## 各不具合の根本原因

7件すべての根本原因を特定し、**ゲームロジック修正とtelemetry修正を明確に区別**しました。

| 不具合 | 原因の種別 | 根本原因 |
|---|---|---|
| invalid_key_events | telemetry設計ミス | `translateGameEvent`の`enemy_defeated`ケースが、本ゲームに存在しない「鍵」概念を前提に`key_enemy_defeated`を無条件生成していた |
| repeated_cockatrice_defeat / inconsistent_kill_counts / incorrect_hp_snapshots | telemetry変換バグ | `findEnemyByType(state, type)`が`alive`も`id`も見ずに「同じ種族の最初の1体」を常に返していた。フロアには同種族が2体スポーンしうる（`chooseSpecies`は重複を許容）ため、本物のcockatriceが死んだ後も、以後の実攻撃（別の生存個体への攻撃）が誤って死体のオブジェクトへ紐づけられ、`target.hp+damage`から逆算する旧実装が「10→0」を繰り返し捏造していた |
| missing_equipment_changes | main.ts統合漏れ | 装備変更はインベントリ画面のEnterキー操作（`handleInventoryKey`）経由で行われるが、この経路は`useSelectedInventoryItem(state)`を直接呼ぶだけで`recordTurn`/`finalizeRun`を一切呼んでいなかった。`weapon_equipped`イベント自体は`processTurn`内部で正しく生成されていたが、telemetryに一切渡っていなかった |
| per_floor_turn_mismatch | telemetry集計バグ | `perFloor.turns`をフロアごとの「イベントに現れた相異なるturn値の集合サイズ」として算出しており、`totalTurns`（全イベントのturn最大値）との定義が一致していなかった |
| zero_damage_hit_definition | telemetry集計バグ | `player_damaged`イベント（`damage>0`の時だけ発火）でのみ被弾集計の`hits`を加算しており、0ダメージ命中（防具で完全軽減）が集計から漏れていた |
| incorrect_turn_consumed | telemetry変換バグ | `enemy_defeated`等の派生イベントに`turnConsumed: false`を固定値でpushしていた |

いずれもゲームロジック（`turn.ts`の戦闘計算・乱数呼び出し順序・敵AI・ターン消費・命中率など）は正しく動作しており、**telemetry.tsの変換・集計ロジックとmain.tsの統合漏れのみ**が原因でした。

## ゲームロジック修正とtelemetry修正の区別

- **ゲームロジック側（`turn.ts`・`events.ts`）**：`player_attack`/`player_attack_missed`/`enemy_defeated`イベントへ`targetId`・`targetHpBefore`・`targetHpAfter`を、`enemy_attack`/`enemy_attack_missed`イベントへ`attackerId`を追加しました。これは指示の`observability_rule`が明示的に許容する「既存の構造化GameEventへの観測用フィールド追加」であり、ダメージ計算式・乱数呼び出し順序・敵AI・ターン消費のいずれも変更していません（値は`turn.ts`が既に計算済みの`target.id`・`target.hp`をそのまま記録するだけです）。
- **telemetry側（`telemetry.ts`）**：`findEnemyByType`による誤照合を廃止し、GameEventが運ぶ実IDを直接使用する方式へ全面書き換え。`key_enemy_defeated`/`key_acquired`の生成を完全削除。`turnConsumed`を`TurnResult.consumed`から一貫して引き継ぐよう変更。撃破・ターン数・0ダメージ命中の集計方法を刷新。
- **main.ts側**：`handleInventoryKey`のEnter分岐に`recordTurn`/`finalizeRun`呼び出しを追加。呼び出す`PlayerAction`を`inventory.ts`に新設した`selectedInventoryAction`ヘルパー（`useSelectedInventoryItem`と同じ選択ロジックを共有、重複実装なし）から取得しています。

## 重複撃破がゲームロジック由来だったかtelemetry由来だったか

**telemetry由来**です。`turn.ts`の実際の戦闘処理は、同種族の複数体を正しく個別に扱っており、撃破された敵は`alive:false`のまま`state.enemies`配列に残り続けますが（これは意図的な既存設計で、削除ではなくフラグ管理）、以後の攻撃・行動対象には一切なりません（`isAdjacent`等の判定は常に`alive`を伴う実装のまま無変更）。バグは、telemetryが「type一致の最初の1体」という不完全な再照合をしていたことに限られます。

## 撃破数の正本

`computeRunSummary`内で、`player_attack`イベントの`defeated===true`から`(floor, targetId)`をキーとする**単一のSet**を最初に構築し、`combatOverall.kills`・各武器の`kills`・`progression.enemiesDefeated`・各フロアの`kills`はすべてこの同一Setから導出します。同じ撃破事実から算出されるため、4つの数値が食い違うことは構造的にありえません。

## 修正後の集計不変条件

- `combatOverall.kills === Σ(combatByWeapon[*].kills) === progression.enemiesDefeated === Σ(perFloor[*].kills)`
- `Σ(perFloor[*].turns) === run.totalTurns`
- `equipment.changeCount === equipment_changedイベント数`
- 0ダメージ命中は`hits`へ加算、`damage`へは非加算、`zeroDamageHits`へ加算
- ミスは従来どおり`misses`へ加算
- NaN・Infinity・負のdamageを一切生成しない

いずれも新規テスト（26件）で自動検証しています。

## HP前後値と実ダメージの取得方法

`turn.ts`の`applyPlayerAttackToEnemy`・`resolveEnemyAttackHit`が実際にダメージ計算・HP減算を行う箇所で、減算前後の値をローカル変数（`targetHpBefore`/`targetHpAfter`）として捕捉し、そのままGameEventのフィールドとして記録します。telemetry側での再計算・再照合は一切行いません。overkill分を別途加算することもなく、`turn.ts`が計算した`damage`をそのまま`totalDamage`として使用します（`target.hp`は`Math.max(0, hp-damage)`で0未満にならないよう既にクランプ済み）。

## 装備変更の捕捉位置

`weapon_equipped`/`armor_equipped`イベント（`processTurn`内で生成、無変更）を`translateGameEvent`が捕捉し`equipment_changed`を生成する点はPhase 10.3.1から変更していません。今回の修正は、この経路自体に到達していなかった**main.ts側の統合漏れ**（インベントリ画面のEnter操作が`recordTurn`を呼んでいなかった）を修正したものです。

## 0ダメージ命中の集計定義

`enemy_attack`イベントの`outcome`（`'hit' | 'miss'`）を命中判定の正本とし、`outcome==='hit'`であれば`damage`の値に関わらず`hits`へ加算します。`damage===0`の場合はさらに`zeroDamageHits`へも加算し、`damage`の集計（実被ダメージ合計）には含めません。武器別の`player_attack`側も同様に、`totalDamage===0`のヒットを`hits`へ含めつつ`zeroDamageHits`へ計上します。

## totalTurnsとperFloor.turnsの定義

`totalTurns`は最終`GameState.turn`（`buildTelemetryDocument`が`finalState.turn`を直接使用、イベントからの最大値推定をやめました）。`perFloor[n].turns`は、そのフロアの`floor_started`イベントの`turn`から、`floor_completed`（クリア済みフロア）または`run_completed`（最終フロア、または実行中の`computeRunSummary`呼び出し時点の`finalState.turn`）の`turn`を引いた差分です。`state.turn`はフロア遷移をまたいでもリセットされないグローバルカウンタのため、各フロアの区間が重複・欠落なく`totalTurns`をちょうど分割し、合計が必ず一致します。

## schemaVersion 2へ変更した理由とv1 JSONの扱い

修正前（v1）のJSONと修正後（v2）のJSONを混在させないよう、`schemaVersion`を2へ、出力ファイル名を`rogue-of-sun-run-v2-{seed}-{clear|death}.json`へ変更しました。v1 JSONの読み込み互換機能は追加していません。添付の`rogue-of-sun-run-v1-3716665143-clear.json`は不具合の再現資料としてのみ使用し、修正後の数値比較対象には含めません。

## 変更ファイル

- `src/game/events.ts`：`player_attack`/`player_attack_missed`/`enemy_defeated`へ`targetId`・`targetHpBefore`・`targetHpAfter`、`enemy_attack`/`enemy_attack_missed`へ`attackerId`を追加（観測用フィールドのみ、計算・乱数・AI・ターン消費は無変更）
- `src/game/turn.ts`：`applyPlayerAttackToEnemy`・`resolveEnemyAttackHit`が上記フィールドへ実際の値を設定
- `src/game/telemetry.ts`：全面改修（`findEnemyByType`廃止・実ID直接使用、`key_*`イベント削除、`turnConsumed`一貫化、撃破・ターン数・0ダメージ命中の集計刷新、schemaVersion 2）
- `src/game/inventory.ts`：`selectedInventoryAction`ヘルパー新設（`useSelectedInventoryItem`と選択ロジックを共有）
- `src/main.ts`：`recordTurn`呼び出しを`TurnResult`全体を渡す形へ、`handleInventoryKey`のEnter分岐へ`recordTurn`/`finalizeRun`呼び出しを追加
- 既存テスト4ファイル：GameEventの新規必須フィールドに合わせてフィクスチャ・アサーションを更新（`message-log.test.ts`・`armor-and-golem.test.ts`・`enemy-behavior-melee-variants.test.ts`・`weapon-and-sword.test.ts`）
- `src/game/__tests__/phase-10-3-1-telemetry.test.ts`：schemaVersion/ファイル名期待値をv2へ更新、`recordTurn`呼び出しを新シグネチャへ
- `src/game/__tests__/phase-10-3-2-telemetry-fix.test.ts`（新規、26件）：7件の不具合それぞれの再発防止テスト
- `docs/history/phase-10-3-2-telemetry-correctness-fix.md`：本ドキュメント

`combat.ts`・`enemy-def.ts`・`weapon-def.ts`など、ダメージ計算・命中率・敵AIに関わるファイルは一切変更していません。

## 追加テストと全テスト結果

新規26件（`phase-10-3-2-telemetry-fix.test.ts`）：key events禁止2件、重複撃破防止3件、HP整合性2件、装備変更5件、0ダメージ命中3件、turnConsumed一貫性1件、フロア別ターン数2件、集計不変条件2件、JSON schema v2 3件、非干渉再確認2件、その他1件。

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：**46ファイル / 965件全成功**（既存939件は新規フィールドに合わせた4ファイルのフィクスチャ更新のうえ全通過、新規26件追加）
- `npx vite build`：成功
- `git diff --check`：問題なし

## 決定性・乱数状態の確認結果

`combatRngState`は`recordTurn`前後で不変であることを単体テストで確認済み（`turn.ts`のダメージ計算・命中判定・乱数消費順序は無変更）。同一seed・同一入力列で完全に同一のJSON文書が生成されることも確認しています。

## 手動確認結果

単一HTMLをPlaywrightでfile://起動し、ランダムなキー入力で実際に死亡させ、終了画面のJSON保存を実行しました。

- schemaVersion 2、ファイル名`rogue-of-sun-run-v2-{seed}-death.json`（v2プレフィックス）を確認
- `combatOverall.kills`・武器別kills合計・`progression.enemiesDefeated`・フロア別kills合計がすべて一致（このランでは撃破0件のため0=0=0=0で一致）
- `perFloor.turns`合計と`totalTurns`が完全一致（144=144）
- `key_`で始まるイベントが0件
- `enemy_defeated`の重複（同一floor・targetId）が0件
- コンソールエラー・ページエラーともに0件
- JSON保存・再parseとも成功

実際に敵を撃破した上での「撃破後の再攻撃不可」、および複数武器を取得・装備した上での「装備変更記録」は、ランダム操作による短時間の手動確認では再現できなかったため、これらは自動テスト（`phase-10-3-2-telemetry-fix.test.ts`の該当5件、撃破・装備変更を明示的にシミュレートして検証）の結果をもって確認済みとします。

## 戦闘数値・乱数消費順を変更していないこと

`combat.ts`（ダメージ計算式・命中率式）・`enemy-def.ts`（敵ステータス）・`weapon-def.ts`（武器ステータス）はいずれも本Phaseで一切変更していません。`turn.ts`への変更は、既に計算済みの値をGameEventへ追加で記録する2行程度の追加のみで、ダメージ計算式・命中判定式・乱数呼び出し回数と順序・敵AIの判断ロジック・ターン消費規則はすべて無変更です。

## 残課題

- 実機でのクリアラン（3フロア到達）での終了画面確認（Phase 10.3.1から引き続き未実施）
- 敵撃破・装備変更を含む長時間の実機手動プレイでの最終確認（今回は自動テストでの代替確認に留まる）
- 添付v1 JSON（seed 3716665143）自体を修正版で再生成しての差分比較（同一seedでの再現は本タスクの範囲外）
