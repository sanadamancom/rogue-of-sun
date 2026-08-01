# Phase 09.2 太陽銃とSOL消費攻撃

## 目的と開始時HEAD

SOLを消費して撃つ遠距離武器「太陽銃」を追加し、現在の向きとXアクションを使って8方向へ直線射撃できるようにします。太陽の実によるSOL回復を通常操作（射撃→使用）で確認できるようにする点も目的に含みます。日向・日陰、自然回復、天候連動はまだ実装しません。開始時のHEADは`696fba78d72823390ba07d154003011f3d652995`（origin/mainと一致、working tree clean、baseline 38ファイル/670件全成功）です。

## 調査結果

既存武器の攻撃解決は`turn.ts`の`resolveFacingAttack`に集約されており、隣接1マス判定→（`reach>=2`のスピアのみ）2マス先判定、という決め打ちの2段階構造でした。太陽銃の射程5はこの構造を素直に拡張できないため、別関数として切り出す方針にしました。8方向・斜め角抜け禁止の判定は`map.ts`の`canMove`が単一の真実源で、Phase 07.1のコカトリス石化光線が使っている`castGazeRay`（`canMove`を1マスずつ繰り返し呼び、壁・マップ外・斜め角抜けで停止する既存のray歩行ヘルパー、`turn.ts`でexport済み）がそのまま太陽銃の射線にも再利用可能と判断しました。`hammerRecovery`は、Xアクションの分岐内で`resolveFacingAttack`の呼び出し後に`state.hammerRecovery = state.equippedWeaponId === 'hammer'`を無条件に実行しており、これはこれまでの近接攻撃（必ず`consumed: true`）では問題なかったものの、太陽銃のSOL不足による不発（`consumed: false`）でも同じ行を素通りすると誤って解除してしまうことが分かったため、`result.consumed`が真の場合のみ実行するよう修正が必要と判断しました。

## 太陽銃の攻撃力・射程・SOL消費

`weapon-def.ts`の`WEAPON_DEFINITIONS`へ`solar_gun`を追加：`attackPower: 1`、`reach: 5`（太陽銃については「射程マス数」の意味で流用）、`knockbackDistance: 0`、`hasRecoil: false`、`solarCost: 1`。`solarCost`は`WeaponDefinition`への新規オプショナルフィールドで、これが設定されている武器だけが射撃武器として扱われます（今のところ太陽銃のみ）。攻撃力1・射程5・SOL消費1はいずれも暫定値です。

## Xと現在向きを使った射撃方法

専用の射撃キーは追加していません。`resolveFacingAttack`の冒頭で、装備武器の`solarCost`が設定されていれば新設の`resolveSolarGunAttack`へ即座に処理を委譲し、以降の近接（隣接1マス／リーチ2マス）判定には一切入りません。射撃方向は既存のShift+方向キーで更新される`player.facing`をそのまま使用し、Xで発射します。

## 射線・壁・敵・斜め角抜けの規則

`castGazeRay(state.map, state.player.pos, direction, weaponDef.reach)`（無変更の既存関数）でプレイヤー位置から最大5マスの到達タイル列を取得します。これは`canMove`を1マスずつ呼ぶため、壁・マップ外・既存の斜め角抜け禁止規則を近接攻撃・ノックバック・コカトリス光線と完全に同一の基準で適用します。取得したタイル列を近い順に走査し、生存中の敵が最初に見つかった時点で確定・停止するため、貫通は発生せず、複数の敵が射線上にいても最も近い1体だけがダメージを受けます。`castGazeRay`は地形（`terrain`）のみを見て`groundItems`や`exit`を一切参照しないため、これらは既存のとおり射線を妨げません。

## 空撃ちとSOL不足時の扱い

`resolveSolarGunAttack`は最初に`state.solarEnergy < solarCost`を判定し、不足していれば`solar_gun_insufficient_solar`イベントを積んで`consumed: false`を返すだけで、SOL残量にもマップ状態にも一切触れません（ダメージなし、ターン不消費、敵不行動）。SOLが足りていれば、命中の有無や射線が即座に壁へ当たったかに関わらず、まず`solarCost`（1）を無条件で減算してから射線判定に入ります。敵に命中しなかった場合は既存の`player_whiff`イベント（武器ID付き）を積み、`consumed: true`を返します。

## ターン消費と敵行動

太陽銃はSOLが足りている限り常に`consumed: true`を返す（命中・撃破・空撃ち・隣接壁への射撃のいずれでも）ため、`processTurn`の既存パイプラインがそのまま走り、敵が1回だけ行動し、ターンが1進みます。SOL不足時は`consumed: false`のため、既存の分岐によりターンも敵行動も一切進みません。この経路はいずれも`processTurn`本体・`resolveEnemiesAction`を変更せずに実現しています。

## hammerRecoveryとの関係

`turn.ts`のXアクション分岐を、`resolveFacingAttack`の戻り値の`consumed`が真の場合のみ`state.hammerRecovery = state.equippedWeaponId === 'hammer'`を実行するよう変更しました。これにより：

- 太陽銃での命中・空撃ちなど、射撃が成立したケース（`consumed: true`）は「別武器攻撃」として扱われ、`hammerRecovery`が確実に`false`へ解除されます。
- SOL不足による不発（`consumed: false`）では、この行自体が実行されないため`hammerRecovery`は変化しません（反動中に装備を太陽銃へ切り替えた直後で残っていた`true`もそのまま維持されます）。
- ハンマー自身の「構え直し」処理（Xアクション冒頭の別分岐）は無変更です。
- 装備の付け替え（`applyWeaponEquip`）はこれまでどおり`hammerRecovery`に触れません。

近接武器（素手・ソード・スピア・ハンマー）は`resolveFacingAttack`の通常経路が常に`consumed: true`を返すため、この変更による挙動差はありません（自動テストで確認済み）。

## 第1フロアへの配置

`state.ts`の`buildFloorState`で、太陽の実の配置が完了した直後、floor 1限定で9番目の独立RNGストリーム`createRng(floorSeed ^ 0x2b9e5c74)`を使って太陽銃を1個配置します。除外リストはstart・exit・全敵座標・その時点までの全ground item座標（apple・sword・armor・sun_fruit）です。floor 2以降には配置しません。既存の乱数呼び出し順序（マップ生成→配置→敵種→apple→sword→armor→spear/hammer→sun_fruit）はそのままで、太陽銃のRNG呼び出しは常にその末尾に追加されるだけです。

## 既存seed決定性の維持方法

太陽銃のRNGストリームは既存8ストリームと異なるXOR定数を使う独立呼び出しのため、既存のマップ生成・配置・敵種・apple・sword・armor・spear・hammer・sun_fruitの各RNG消費順序・消費回数には影響しません。同一run seedを2回`createInitialState`した際の太陽銃座標の一致、既存ground item座標・敵座標・exit座標の不変を自動テストで確認しています。

## 太陽の実による回復確認

`tsx`によるヘッドレス実行で、太陽銃を2回射撃してSOLを5→3まで減らした状態から太陽の実を使用し、SOLが5（最大値）まで回復することを確認しました（自動テストにも同シナリオを追加済み）。太陽の実がHPを回復しないこと・リンゴがSOLを回復しないこと（Phase 09.1から無変更）も改めて確認しています。

## 変更ファイル

- `src/game/types.ts`（`ItemId`/`WeaponId`へ`solar_gun`追加）
- `src/game/item-def.ts`（`solar_gun`アイテム定義追加、`ITEM_IDS_IN_ORDER`へ追加）
- `src/game/weapon-def.ts`（`WeaponDefinition.solarCost`追加、`solar_gun`武器定義追加、`WEAPON_IDS_IN_ORDER`へ追加）
- `src/game/events.ts`（`solar_gun_insufficient_solar`イベント追加）
- `src/game/message-log.ts`（同イベントの日本語フォーマッタ追加）
- `src/game/turn.ts`（`resolveFacingAttack`冒頭に太陽銃分岐追加、`resolveSolarGunAttack`新設、Xアクション分岐の`hammerRecovery`更新を`consumed`条件付きへ変更）
- `src/game/state.ts`（太陽銃のfloor1限定配置ロジック追加）
- 既存テストファイル14件（`GameState`/`Inventory`リテラルへ`solar_gun`フィールドを追加するのみの機械的な差分。期待値・アサーションの変更は含まない）
- `src/game/__tests__/phase-09-2-solar-gun.test.ts`（新規、64件）

## 自動テスト・TypeScript・build・diff checkの結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：全39ファイル734件成功（Phase 09.1までの670件 + 新規64件、既存670件に失敗・スキップなし）
- `npx vite build`：成功（エラーなし、チャンクサイズ警告のみ）
- `git diff --check`：成功
- `package.json`/`package-lock.json`：差分なし

## 手動確認結果と未確認項目

`tsx`によるヘッドレス実行で以下を実測しました。

- floor 1の`groundItems`：`apple, sword, armor, sun_fruit, solar_gun`（太陽銃1個、座標は決定的）
- 太陽銃を装備：ログ「太陽銃を装備した。」、`equippedWeaponId: 'solar_gun'`
- 敵なしで射撃：`consumed: true`、ログ「空振りした。」、SOL 5→4
- 距離3の敵へ射撃：`consumed: true`、ログ「太陽銃でボクに1ダメージ。」、SOL 4→3、敵HP5→4
- SOL 0で射撃：`consumed: false`、ログ「太陽エネルギーが足りない。」、SOLは0のまま
- SOL 2の状態で太陽の実使用：`consumed: true`、ログ「太陽の実を使い、太陽エネルギーが回復した。」、SOL 2→4

Playwright（Chromium、`dist/`をローカルHTTPサーバ配信）でビルド済みゲームを起動し、コンソールエラー0件を確認しました。Tabキーでのインベントリ表示自体は正常に開閉できることを確認しましたが、実際にキー操作で太陽銃を取得→装備→射撃→SOL減少をブラウザ上のプレイで辿る確認、壁越し不発の目視確認、HUDのSOL数値がリアルタイムに追従する目視確認は今回未実施です。

## Phase 09.2で未実装の要素

日向・日陰マス、SOLの自然回復（移動・待機によるものを含む）、天候・時刻・位置情報などの外部連動、SOL最大値の成長、弾薬・リロード、貫通・範囲攻撃・爆発、射撃アニメーション・光線・マズルフラッシュ・効果音・画面揺れはいずれも未実装です。攻撃力1・射程5・SOL消費1は本フェーズ時点の暫定値であり、最終確定したものではありません。

## 完了可否

Phase 09.2は完了。
