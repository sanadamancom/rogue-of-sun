# Phase 09.3 日向レイヤーとSOLチャージ

## 目的と開始時HEAD

既存3フロアへ、地形とは独立した「日向レイヤー」を追加し、日向マス上でVキーを押すと1ターン消費してSOLを1回復できるようにします。現在の3フロアは「太陽の塔を登る構成」の試作として位置づけ、既存のマップ・敵・出口・ground itemの生成結果は一切変更しません。開始時のHEADは`4bc9046c3547f80d5d3b11aceb49b2fd80b1c6b0`（origin/mainと一致、working tree clean、baseline 39ファイル/734件全成功）です。

## 調査結果

- **マップ構造**：`GameMap`は`terrain: Tile[][]`（'wall'|'floor'）と`rooms: Room[]`（`{x,y,width,height}`の矩形リスト）のみを持ち、通路専用のデータ構造は存在しません。通路は「到達可能な床タイルのうち、どの部屋の矩形にも含まれないもの」として`terrain`と`rooms`から間接的に導出可能と判断しました。
- **到達可能性判定**：`mapgen.ts`の`bfsDistances(map, start)`（Phase 08.2から既存、4方向BFS、`terrain==='floor'`のみ辿る）がground item配置で既に使われており、そのまま日向配置にも再利用できます。
- **floor/seed管理**：`deriveFloorSeed(runSeed, floor)`が純粋関数でfloorSeedを算出し、既存の各ground itemはこのfloorSeedへ固有のXOR定数を掛け合わせた`createRng`で独立ストリームを作る方式（Phase 08.2〜09.2で8ストリーム、Phase 09.2で9番目の太陽銃ストリームまで確立済み）。日向レイヤーもこの方式を踏襲し、10番目の独立ストリームとして実装しました。
- **描画**：`main.ts`の`drawTerrain()`が唯一の床描画箇所で、フロア切り替え時にのみ呼ばれる（`resetSceneToCurrentState`経由）ため、日向オーバーレイもここに追記すれば1フロアにつき1回の描画で完結します。
- **ターン成立後の敵行動**：`processTurn`が`applyPlayerAction`の`consumed`結果を見て`resolveEnemiesAction`を1回だけ呼ぶ既存パイプラインがあり、`use_item`と全く同じ形で新しいアクション種別を追加すれば自動的にこのパイプラインへ乗ることを確認しました。
- **SOL増減・上限処理**：`state.solarEnergy`/`maxSolarEnergy`はPhase 09.1で導入済みで、`Math.min(max, cur + amount)`によるクランプパターンが太陽の実（`applyItemUse`）で既に確立されています。
- **hammerRecovery**：Phase 09.2で「`action.type==='action'`の結果が`consumed`のときだけ`hammerRecovery`を更新する」という条件付き更新へ既に変更済みで、`use_item`や`equip_weapon`などXアクション以外の分岐は最初から`hammerRecovery`に一切触れない構造でした。チャージも同じくXアクションと独立した新分岐として実装すれば、成功・失敗いずれでも`hammerRecovery`へ触れずに済むと判断しました。
- **入力ロック**：`main.ts`の`handleKey`冒頭に`if (this.activeAnimations > 0) return;`があり、`animateMove`が`activeAnimations`をインクリメント/デクリメントしてこの間の入力を無視させる既存の仕組みがそのままチャージモーション中の二重入力防止に転用可能でした。
- **既存チャージ用画像**：リポジトリ内に該当するアニメーション素材は見当たりませんでした。プレイヤースプライトのスケールパルス（拡大→縮小の短いtween）で代替する方針としました。
- **現在使用中の全キー**：W/A/S/D、矢印キー、Q/E/Z/C（斜め移動）、X（攻撃）、Space（待機）、Tab（インベントリ開閉）、Escape（閉じる）、Enter（使用/装備、リスタート）、ArrowUp/ArrowDown（インベントリ選択）、N（新規シード再開）。**V**キーはこの中に含まれておらず、競合なくチャージ専用キーとして採用しました。

## sunlightレイヤーのデータ構造

`GameState`へ`sunlight: boolean[][]`を追加しました。`sunlight[y][x]`がtrueならそのタイルは日向です。`map.terrain`・`Room`・`Actor`・`GroundItem`などの既存構造には一切フィールドを追加していません。新規モジュール`src/game/sunlight.ts`の`generateSunlightLayer(map, floor, floorSeed, start)`が生成を担い、`isSunlitAt(sunlight, pos)`が範囲外座標を安全にfalse扱いする読み取りヘルパーです。

## 3フロアそれぞれの日向配置規則

- **floor 1（塔前の庭・入口）**：`bfsDistances`で到達可能な床タイル全体を基本的に日向とし、独立RNGで約15%（暫定値、`FLOOR1_SHADOW_FRACTION`）を日陰として間引きます。開始位置は間引き対象から除外し、常に日向で開始します。
- **floor 2（塔内部・吹き抜け階）**：`map.rooms`（マップ生成が確定させた既存の部屋矩形）から独立RNGで1〜2部屋を選び、その部屋の床タイル全体を日向の中庭とし、それ以外は日陰のままにします。部屋はmapgenの接続性保証により元々到達可能なため、追加の到達可能性チェックは行っていません。
- **floor 3（上層接続部）**：到達可能な床タイルのうち、どの部屋矩形にも含まれないタイル（＝通路タイル）を抽出し、存在すれば独立RNGで選んだ1タイルを起点に通路タイルのみを辿るBFSで最大8タイル（暫定値、`FLOOR3_WALKWAY_LENGTH`）の「渡り廊下」を日向化します。通路タイルが見つからない場合は、`failure_policy`の指示どおりマップ生成を変更せず、既存の部屋1つをテラス相当の日向区画として代替します。

いずれのフロアも「最低1か所は確実に日向を配置する」ため、部屋・通路が万一空だった場合の防御的フォールバック（開始位置を日向にする）を用意していますが、通常の生成パラメータでは到達しない経路です。

## 既存マップとRNGを変更しない方法

`generateSunlightLayer`は`floorSeed ^ 0x7c3a91e6`という10番目の独立`createRng`ストリームのみを消費します。マップ生成・配置・敵種・apple・sword・armor・spear・hammer・sun_fruit・solar_gunの各既存ストリームには一切アクセスせず、呼び出し順・消費回数を変えません。`state.ts`の`buildFloorState`内で、既存の全ground item配置が完了した後に`generateSunlightLayer(map, floor, floorSeed, placement.start)`を呼ぶだけで、`map`・`enemies`・`exit`・`groundItems`の生成結果には触れていません。同一seedで2回`createInitialState`した際の`terrain`・`rooms`・`player.pos`・`enemies`・`exit`・`groundItems`の完全一致、および`sunlight`自体の一致を自動テストで確認しています。

## 日向と日陰の表示方法

`main.ts`の`drawTerrain()`で、床タイルを描いた直後（壁を除く）、日向タイルにだけ暖色系の半透明矩形（`0xffb454`、アルファ0.22）を重ね塗りします。新しい画像アセットは追加していません。actor・item・exit・壁との判別を妨げないよう、既存の床/壁の塗り分けとタイル境界線描画（既存の黒い枠線）はそのまま維持し、オーバーレイは最後に一度だけ追加で塗るのみです。当たり判定・座標計算には一切影響しません。操作案内テキストへ「V:日向でチャージ」を追記しました。

## Vチャージの成立条件

`input.ts`へ`v` → `{ type: 'charge' }`のマッピングを追加しました。`turn.ts`の`applyPlayerAction`へ、`equip_armor`の後・`wait`の前に新しい分岐を追加し、`resolveCharge`を呼びます。成立条件は「プレイヤーの現在座標が日向（`isSunlitAt(state.sunlight, state.player.pos)`）」かつ「現在SOLが最大値未満」の両方です。

## SOL回復量、ターン消費、敵行動

成功時はSOLを1回復（`Math.min(maxSolarEnergy, solarEnergy + 1)`でクランプ）し、`consumed: true`を返します。これにより`processTurn`の既存パイプラインがそのまま走り、敵が正式に1回だけ行動し、ターンが1進みます。回復量1・回復条件はいずれも本フェーズ時点の暫定値です。

## 日陰と満タン時の不成立処理

日陰では`solar_charge_failed_shadow`イベントを積んで`consumed: false`を返すのみで、SOL・ターン・敵行動のいずれにも触れません。SOL満タン時（日向であっても）は`solar_charge_failed_full`イベントを積んで同様に`consumed: false`を返します。両者とも判定順は「日陰チェックが先、満タンチェックが後」で、日陰かつ満タンの場合は日陰の理由だけがログに出ます（重複ログなし）。

## チャージモーションと入力ロック

`main.ts`の`applyTurnResult`内で、確定した`result.events`に`solar_charge_used`が含まれる場合のみ`playChargeMotion()`を呼びます。これはプレイヤースプライトの拡大→縮小のyoyoツイーン（160ms、`Sine.easeInOut`）で、新規画像は使わず既存スプライトのスケールのみを操作します。入力そのものではなく確定済みのイベントを見て発火させているため、不成立時（日陰・満タン）には再生されません。開始時に既存の`activeAnimations`カウンタをインクリメントし、`handleKey`冒頭の`if (this.activeAnimations > 0) return;`ガード（`animateMove`と共有）がモーション中の全入力（再度のVキーを含む）を無視するため、二重チャージやモーション中の他操作の割り込みを防ぎます。SOL回復量・ターン処理は`resolveCharge`が`processTurn`内で同期的に確定済みであり、モーションの再生時間はアニメーション効果のみで、回復量やターン数には一切影響しません。

## hammerRecoveryとの関係

`resolveCharge`は成功・失敗のいずれの経路でも`state.hammerRecovery`を一切変更しません。チャージはXアクション（`action.type === 'action'`）とは別の独立したアクション種別として実装されているため、Phase 09.2で導入した「Xアクションの結果が`consumed`のときだけ`hammerRecovery`を更新する」というロジックの対象外です。自動テストで、チャージ成功時・日陰不成立時・満タン不成立時のいずれでも`hammerRecovery`の値（true/false）が変化しないこと、および既存のハンマー構え直し（X）・太陽銃射撃によるhammerRecovery解除（Phase 09.2で実装済み）が引き続き無変更で動作することを確認しています。

## 変更ファイル

- `src/game/types.ts`（`GameState.sunlight`追加、`PlayerAction`へ`charge`追加）
- `src/game/sunlight.ts`（新規：`generateSunlightLayer`、`isSunlitAt`）
- `src/game/state.ts`（`buildFloorState`で`generateSunlightLayer`呼び出し）
- `src/game/events.ts`（`solar_charge_used`/`solar_charge_failed_shadow`/`solar_charge_failed_full`追加）
- `src/game/message-log.ts`（上記イベントの日本語フォーマッタ追加）
- `src/game/turn.ts`（`resolveCharge`新設、`applyPlayerAction`へ分岐追加）
- `src/game/input.ts`（`v` → `charge`マッピング追加）
- `src/main.ts`（`drawTerrain`へ日向オーバーレイ追加、操作案内更新、`playChargeMotion`追加、`applyTurnResult`からの発火）
- 既存テストファイル18件（`GameState`リテラルへ`sunlight: []`を追加するのみの機械的な差分。期待値・アサーションの変更は含まない）
- `src/game/__tests__/phase-09-3-sunlight-and-charge.test.ts`（新規、38件）

## 自動テスト・TypeScript・build・diff checkの結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：全40ファイル772件成功（Phase 09.2までの734件 + 新規38件、既存734件に失敗・スキップなし）
- `npx vite build`：成功（エラーなし、チャンクサイズ警告のみ）
- `git diff --check`：成功
- `package.json`/`package-lock.json`：差分なし

## 手動確認結果と未確認項目

`tsx`によるヘッドレス実行で以下を実測しました。

- run seed 7777、floor 1：開始位置は日向（`true`）、床タイル317枚中270枚（約85%）が日向・47枚が日陰
- 日陰タイル（(7,27)）へ移動してVを押下：`consumed: false`、ログ「日向でないとチャージできない。」、SOL変化なし
- 開始位置（日向）でSOL3の状態でVを押下：`consumed: true`、ログ「太陽の光でチャージし、太陽エネルギーが回復した。」、SOL 3→4
- SOL5（満タン）の状態でVを押下：`consumed: false`、ログ「太陽エネルギーは満タンだ。」、SOL変化なし
- floor2（同seed）：床タイル429枚中72枚が日向
- floor3（同seed）：床タイル397枚中8枚が日向

Playwright（Chromium、`dist/`をローカルHTTPサーバ配信）でビルド済みゲームを起動し、コンソールエラー0件を確認しました。Vキー押下後のスクリーンショットも取得しましたが、チャージモーションが視覚的に1回だけ再生されたかの目視確認、日向/日陰の色分けが画面上で明確に判別できるかの目視確認、2階・3階の日向区画の見え方、HUDのSOL数値がV押下後に即座に反映される様子の目視確認、V連打時の二重回復が起きないことの実操作確認は今回未実施です。

## Phase 09.3で未実装の要素

現在のマップは引き続き3フロアのみの試作であり、10階層化は未実装です。実際の橋・穴・落下処理、天候・時刻・位置情報などの外部連動、日向に立つだけでの自動回復、移動やSpace待機によるSOL回復は実装していません。日向配置量（floor1の日陰比率15%、floor3の渡り廊下長8タイル）とチャージ回復量1は、いずれも本フェーズ時点の暫定値であり、最終確定したものではありません。

## 完了可否

Phase 09.3は完了。
