# Phase 10.3.1 プレイ計測・終了レポート・JSON出力

## 目的

1ラン中の移動・戦闘・装備・回復・SOL・フロア進行をブラウザ内で構造化データとして記録し、最終フロアクリアまたはプレイヤー死亡時にランを確定して終了画面へバランス確認用の集計結果を表示、詳細トレースをJSONとして任意保存できるようにしました。計測の追加によってゲーム進行・乱数・seed再現性が変化しないことを最優先条件としています。今回はHP・攻撃・防御・命中率・SOL威力などの数値は一切変更していません。

## 開始状態

開始時のHEADは`0a764eb2f88665eeb211c638c44496f7548ec346`（Phase 10.3完了時点、origin/mainと一致、working tree clean、remote URLにPATなし）。baseline：`npx tsc --noEmit`エラーなし、`npx vitest run`44ファイル/896件全成功、`npx vite build`成功。

## 事前調査結果

- `GameState.phase`には既に`'playing' | 'floor_cleared' | 'gameover' | 'victory'`の4値があり、`'victory'`が「最終フロアのクリア」を`'floor_cleared'`（途中フロアのクリア）と区別する形で既に実装されていました。この既存区別をそのまま`clear`/`death`判定の根拠として再利用しました（`turn.ts`の`processTurn`末尾、`state.floor >= state.totalFloors ? 'victory' : 'floor_cleared'`）。
- **移動イベントの重要な発見**：`move`アクションは成功時も失敗時もGameEventを一切pushしない設計でした（壁衝突・敵占有マスへの移動はconsumed:falseのまま無イベントでreturn）。そのため`move`/`move_blocked`/`wait`は`GameEvent`からではなく、`PlayerAction`の種別と移動前後の座標差分・`result.consumed`から導出する方式を採用しました。
- 装備の入手・変更は`item_picked_up`（拾得）・`weapon_equipped`/`armor_equipped`（装備）イベントで表現されていましたが、**装備の解除・破棄に対応する処理は存在しない**ことを確認しました（`equip_weapon`/`equip_armor`は既存装備を必ず新しい装備で置き換えるのみで、「外す」という操作自体がゲームにありません）。`equipment_removed`/`equipment_discarded`/`item_discarded`はイベントスキーマとしては定義しましたが、対応する既存処理がないため実際には発火しません。
- SOL・回復の経路：`item_used`（リンゴ、healed付き）、`sun_fruit_used`（SOL回復）、`solar_charge_used`（日照チャージ）、`sol_enchantment_used`（近接エンチャント消費）を確認。太陽銃自身のSOL消費は専用イベントを持たず、`resolveSolarGunAttack`内で`state.solarEnergy`を直接減算するのみだったため、`player_attack`/`player_attack_missed`イベント処理時に装備が`solar_gun`であることを条件に、呼び出し元が保持する消費前後のSOL差分から導出しました。
- クラーケンの`kraken_tentacle_strike`イベントには`hit`・`damage`はあるが、accuracy/evasion方式の`hitChance`・`roll`に相当する値は存在しません（既存の照準座標ベース判定のため）。指示どおり`hitChance: null, roll: null`として記録しています。
- 「鍵」システム：本ゲームには鍵アイテムは存在せず、階段解禁は「フロア上の全敵撃破」という既存条件（`stairsUnlocked`）です。`key_acquired`に対応する実処理は存在しないため常に発生しません。`key_enemy_defeated`は「敵撃破が階段解禁に寄与する」という設計意図を汲み、敵撃破のたびに発生する形にしました（本ゲームでは全ての敵撃破が実質的に鍵の役割を果たすため）。
- 単一HTMLでのBlobダウンロード：`URL.createObjectURL`＋一時`<a>`要素のクリックで動作することを、Playwrightのヘッドレスfile://環境で確認済みです（後述の手動確認）。

## 計測設計

`src/game/telemetry.ts`を新規作成し、`turn.ts`・`events.ts`は一切変更していません。`RunTelemetry`は`MainScene`が保持する独立フィールドで、`GameState`には格納しません（`GameState`の等価比較・carry-over・セーブ相当の処理に一切影響しないため）。すべての関数（`createRunTelemetry`・`recordTurn`・`recordFloorStarted`・`finalizeRun`・`computeRunSummary`・`buildTelemetryDocument`）は純粋関数で、GameStateを変更せず、乱数（`combatRngState`はもちろん、マップ生成用RNGも）を一切消費しません。`recordTurn`は`processTurn`が既に生成した`TurnResult.events`（`GameEvent[]`）と、呼び出し元（`main.ts`）が`processTurn`実行前に取得した状態スナップショット（`TurnSnapshot`）、実行後の`GameState`を突き合わせて`RunEvent`を導出するだけで、ゲームロジックの再実装は一切行っていません。

## ランの開始・フロア遷移・終了条件

- **開始**：`main.ts`の`create()`（初回起動）と`restart()`（Enter/N）の両方で`createRunTelemetry(state)`を呼び、常に新しいランとして初期化します。Enterは同一`runSeed`、Nは新しい`runSeed`で`createInitialState`を呼ぶ既存構造をそのまま利用しているため、telemetry側で追加のseed処理は不要でした。
- **フロア遷移**：`recordTurn`が`before.phase==='playing'`から`after.phase`が`'floor_cleared'`または`'victory'`へ遷移したことを検出して`exit_reached`・`floor_completed`を記録し、`main.ts`が`advanceToNextFloor`を呼んだ直後に`recordFloorStarted`で新フロアの`floor_started`を記録します。ランは維持されたままイベント列・累積集計が継続します。
- **終了**：`finalizeRun(telemetry, state)`が`state.phase`が`'gameover'`または`'victory'`になった直後（`handleKey`内、`recordTurn`の直後）に毎ターン呼ばれますが、`telemetry.finalized`が真であれば即座に何もしません。最初の1回だけ`run_completed`イベントを追加し、`result`（`'clear'`/`'death'`）・`endCause`（死因は直近の`player_damaged`イベントの`source`、クリア時は`'floor_cleared'`固定）・終端状態（フロア・座標・HP・SOL）をイベント自体にコピーして記録します。

## イベントスキーマ

`RunEventCommon`として`eventIndex`（0起点、`telemetry.events.length`）・`turn`・`floor`・`turnConsumed`を全イベント共通で持たせ、種別ごとの追加フィールドは`RunEventPayload`のdiscriminated unionで定義しています（`run_started`/`floor_started`/`floor_completed`/`run_completed`/`move`/`move_blocked`/`wait`/`player_attack`/`enemy_attack`/`attack_invalid`/`enemy_defeated`/`player_damaged`/`player_defeated`/`equipment_acquired`/`equipment_changed`/`equipment_removed`/`equipment_discarded`/`item_acquired`/`item_used`/`item_discarded`/`sol_changed`/`solar_charge`/`healed`/`key_enemy_defeated`/`key_acquired`/`exit_reached`）。実時間timestampは一切記録していません。

## 集計項目と計算規則

`computeRunSummary`は`telemetry.events`を1回走査するだけで、移動（成功/失敗/待機）・武器別戦闘（有効攻撃数・命中・ミス・命中率・与ダメージ・平均命中ダメージ・撃破数）・敵種別被害・装備（入手数・変更数・終了時装備）・資源（SOL収支・チャージ回数・回復源別集計・アイテム使用種別集計）・進行（撃破数・鍵取得数・出口到達数）・フロア別集計・終了時状態を算出します。命中率・平均ダメージは分母が0の場合、`0/0`によるNaNを避けるため明示的に`null`を返すガード条件（`validAttacks > 0 ? ... : null`）を実装しており、単体テストで`NaN`/`Infinity`が一切出力されないことを確認しています。

## 移動・戦闘・装備・SOL・回復の記録位置

- 移動：`recordTurn`冒頭、`action.type==='move'`分岐で座標差分から導出
- 戦闘：`translateGameEvent`内、`player_attack`/`player_attack_missed`/`enemy_attack`/`enemy_attack_missed`/`kraken_tentacle_strike`/`player_whiff`/`solar_gun_insufficient_solar`の各GameEventケース
- 装備：`item_picked_up`（拾得時、武器/防具IDなら`equipment_acquired`も追加）、`weapon_equipped`/`armor_equipped`（`equipment_changed`、fromは呼び出し元スナップショットの装備ID）
- SOL：`sol_enchantment_used`（近接消費）、太陽銃消費（`player_attack`/`player_attack_missed`処理後、装備が`solar_gun`かつSOL減少があった場合に差分から導出）、`solar_charge_used`（日照チャージ）、`sun_fruit_used`（アイテムSOL回復）
- 回復：`item_used`の`healed>0`の場合に`healed`イベントを追加記録（実回復量のみ、最大HP超過分は`player.hp`の`Math.min`クランプ済みの値をそのまま使うため自動的に除外）

## 終了画面

Phaserのcanvas上に大量の表形式レポートを描画するのは非現実的なため、既存のPhaserシーンとは別に、通常のHTML `<div>`によるオーバーレイをDOMへ直接構築する方式を採用しました（`createEndScreenOverlay`で1回だけ生成、`showEndScreen`で内容を都度書き換えて表示）。CLEAR/GAME OVERの見出し、seed・到達フロア・総ターン、概要（撃破数・与/被ダメージ合計・SOL収支・回復量）、武器別テーブル、被害元別テーブル、フロア別テーブル、終了時情報（原因・LIFE・SOL・装備・所持品）、JSON保存ボタン、再開操作案内を含みます。CLEAR/GAME OVERは色だけでなく見出しテキスト自体で区別しています。オーバーレイは`overflow-y: auto`でスクロール可能にし、ゲーム盤面・HUDのレイアウトは一切変更していません。

## JSON出力仕様

`buildTelemetryDocument`が`{schemaVersion: 1, gameVersion: 'phase-10.3.1', run: {...}, summary: RunSummary, events: RunEvent[]}`を構築し、`JSON.stringify(doc, null, 2)`でインデント付き文字列化、`Blob`＋`URL.createObjectURL`で一時オブジェクトURLを生成、非表示の`<a>`要素をクリックしてダウンロードを起動した直後に`URL.revokeObjectURL`で解放しています。ファイル名は`rogue-of-sun-run-v1-{seed}-{clear または death}.json`で、seed以外の可変情報は含みません。生成・保存に失敗した場合はtry-catchで捕捉し、終了画面内に短いエラーメッセージを表示するのみで、ゲーム本体やコンソールへの未捕捉例外は発生しません。

## 乱数と決定性への非干渉

`telemetry.ts`のいずれの関数も`state.combatRngState`・マップ生成用RNG・`Math.random`のいずれも一切参照・変更しません。単体テストで以下を確認済みです。

- `recordTurn`呼び出し前後で`state.combatRngState`が変化しないこと（`processTurn`自体が既に消費した値と完全一致）
- `computeRunSummary`呼び出し前後で`telemetry.events`の長さが変化しないこと
- 同一runSeedから生成した2つの`GameState`（片方だけtelemetryを生成）でマップ地形・`combatRngState`が完全一致すること
- 同一seed・同一入力列で2回別々に実行したイベント列（JSON文字列化して比較）が完全一致すること

## 変更ファイル

- `src/game/telemetry.ts`（新規）：計測の全ロジック
- `src/main.ts`：`telemetry`フィールド追加、`create()`/`restart()`での初期化、`handleKey()`での`recordTurn`/`finalizeRun`呼び出し、フロア遷移時の`recordFloorStarted`呼び出し、終了画面DOMオーバーレイ（`createEndScreenOverlay`/`showEndScreen`/`hideEndScreen`/`exportTelemetryJson`）
- `src/game/__tests__/phase-10-3-1-telemetry.test.ts`（新規、43件）
- `docs/history/phase-10-3-1-run-telemetry-and-result-report.md`：本ドキュメント

`turn.ts`・`events.ts`・`combat.ts`・`enemy-def.ts`・`weapon-def.ts`など、既存の戦闘ロジックに関わるファイルは一切変更していません。

## 型チェック・テスト・build結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：**45ファイル / 939件全成功**（既存896件は無変更のまま全通過、新規43件追加）
- `npx vite build`：成功
- `git diff --check`：問題なし

## 死亡ランの手動確認

Playwrightでビルド成果物（単一HTML）をfile://起動し、ランダムな移動・攻撃キー入力を繰り返して実際に死亡させました。

- GAME OVER画面が表示された（見出し・seed・到達フロア・総ターン・概要・武器別テーブル・被害元別テーブル・フロア別テーブル・終了時情報すべて正しく表示）
- 終了原因（`endCause`）が実際に致命傷を与えた敵種（`bok`）と一致
- JSON保存ボタンのクリックでダウンロードが発生し、ファイル名が`rogue-of-sun-run-v1-{seed}-death.json`形式
- 保存されたJSONを再度`json.load`で問題なくparseでき、`schemaVersion: 1`・`run.result: 'death'`・イベント総数が画面表示と整合
- コンソールエラー・ページエラーともに0件

## クリアランの手動確認

3フロアクリアまでの手動プレイは、ランダム入力による到達が非現実的な試行回数を要するため今回のタスクでは実施していません。ただし、クリア（`victory`）相当の挙動は単体テスト（`phase-10-3-1-telemetry.test.ts`の"finalizeRun confirms exactly once on the final floor clear"等）で、`state.phase`が`'victory'`になった際に`telemetry.result`が`'clear'`になり、`run_completed`が1回だけ記録されることを確認済みです。実機での3フロア通しクリア確認は次回以降の課題とします。

## 単一HTML確認

`/mnt/user-data/outputs/rogue-of-sun-phase-10-3-1.html`をPlaywrightでfile://起動し、外部リクエスト0件・コンソールエラー0件を確認しました。BlobによるJSON保存も同一環境で正常に機能することを確認済みです。

## 未実装項目

- クリアラン（3フロア到達）の実機手動確認（単体テストでのロジック確認に留まる）
- `key_acquired`（対応する実メカニクスが本ゲームに存在しないため常に未発生）
- 複数ラン比較UI、ヒートマップ、リプレイ再生（out_of_scope）
- 完成版のリザルト演出（現在は簡素なHTML表・ボタンのみ）

## 次の数値バランス調整で確認する指標

- 武器別実命中率・平均命中ダメージ・撃破数（`combatByWeapon`）
- 敵種別の被弾回数・被ダメージ（`damageTakenByEnemy`）
- SOL収支（`resources.solGained`/`solConsumed`/`solarChargeActions`）
- フロア別滞在ターン数・与被ダメージ（`perFloor`）
- 複数ラン分のJSONを横並びで比較し、Phase 10.2の暫定数値（HP・攻撃・防御・回復量・SOL追加ダメージ）とPhase 10.3の命中率設定を合わせて再調整する
