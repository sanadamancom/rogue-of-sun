# Phase 09.1 太陽エネルギー基盤と太陽の実

## 目的と開始時HEAD

今後の太陽銃・日向回復で共通利用する太陽エネルギー状態を追加し、太陽エネルギーを回復する消耗品「太陽の実」を実装します。太陽銃・日向日陰・自然回復・天候連動はこのフェーズでは実装しません。開始時のHEADは`decbd99e10d1059002b997d3fc8aebb30e1c1f56`（origin/mainと一致、working tree clean、baseline 37ファイル/632件全成功）です。

## SOLの初期値・最大値・維持規則

`GameState`へ`solarEnergy`（現在値）と`maxSolarEnergy`（最大値）を新設しました。新規ゲームは`createInitialState`から`5/5`で開始します。`buildFloorState`の`carry`引数（`CarryOverStats`）へ`solarEnergy`/`maxSolarEnergy`を追加し、`advanceToNextFloor`がこれをそのまま次のフロアへ引き継ぎます（`inventory`/`equippedWeaponId`と同じ引き継ぎ経路）。移動・待機・攻撃・被弾・インベントリの開閉ではSOLは一切変化しません（これらの処理経路は太陽エネルギーへ触れていません）。範囲外の値が入らないよう、変化させる唯一の処理（太陽の実の使用、後述）は`Math.min(maxSolarEnergy, ...)`でクランプします。最大値5・初期値5は暫定値で、太陽銃実装以降に最終確定するものではありません。

## 太陽の実の回復量と使用条件

`item-def.ts`へ`sun_fruit`を追加し、`ItemDefinition`に`solarAmount`フィールド（HPの`healAmount`と対になる、太陽エネルギー専用の回復量フィールド）を新設しました。`sun_fruit`は`solarAmount: 2`、`category: 'consumable'`、`consumable: true`、`stackable: true`です。

`turn.ts`の`applyItemUse`へ、既存の`healAmount`分岐の直後に`solarAmount`分岐を追加しました。SOLが最大値未満なら`Math.min(maxSolarEnergy, solarEnergy + 2)`まで回復し、所持数を1減らし、`consumed: true`を返します。SOLが最大値なら`sun_fruit_use_failed`イベントを積んで`consumed: false`（所持数不変、ターン不消費）を返します。使用条件・成否のいずれもリンゴ（HP回復）の既存分岐へは一切手を加えていません。

## リンゴとの分離

`sun_fruit`と`apple`はそれぞれ独立した`Inventory`のキーとして管理され、`applyItemUse`の分岐も`healAmount`／`solarAmount`で完全に分かれています。リンゴを使ってもSOLは変化せず、太陽の実を使ってもHPは変化しません（自動テストで両方向を確認済み）。太陽の実専用の新しい操作キーは追加しておらず、`useSelectedInventoryItem`（Enter）が選択中アイテムの`category`で分岐する既存の仕組み（Phase 08.2）がそのまま`sun_fruit`にも適用されます。

## 使用時のターンと敵行動

使用成功時は`applyItemUse`が`consumed: true`を返すため、`processTurn`の既存パイプライン（リンゴ・武器装備と共通）がそのまま走り、敵が1回だけ行動し、ターンが1進みます。使用不能時（SOL満タン）は`consumed: false`のため、ターンも敵行動も一切進みません。専用の分岐は追加していません。

## 第1・第2フロアへの配置

`state.ts`の`buildFloorState`へ、既存の全ground item配置完了後、8番目の独立RNGストリーム`createRng(floorSeed ^ 0xd472e6a9)`で太陽の実を1個配置する処理を追加しました。対象はfloor 1・floor 2のみで、floor 3以降には配置しません。除外リストは`start`・`exit`・全敵座標・その時点までに配置済みの全ground item座標（floor 1なら apple/sword/armor、floor 2なら apple/spear/hammer）です。既存の乱数呼び出し順序（マップ生成→配置→敵種→apple→[floor1: sword→armor]→[floor2: spear→hammer]）は一切変更しておらず、太陽の実の呼び出しは常にその後ろに追加されるのみです。

## 既存seed決定性の維持方法

太陽の実のRNGストリームは既存7ストリームと異なるXOR定数を使う独立した`createRng`呼び出しのため、既存のマップ生成・配置・敵種・apple・sword・armor・spear・hammerの各RNG消費順序・消費回数には一切影響しません。同一run seedを2回`createInitialState`した際の太陽の実座標の一致、既存ground item座標・敵座標・exit座標の不変を自動テストで確認しています。

## HUDとインベントリ表示

`main.ts`の`refreshStaticView`内、既存のHUDテキスト1行目（`FLOOR ... HP: ... Turn: ...`）へ`SOL {現在値} / {最大値}`を追加しました（`SOL 5 / 5`のように数値を主表示、色のみに依存しません）。既存のHP・武器・アーマー・メッセージ表示は変更していません。インベントリ内の識別は、`item-def.ts`のglyph/displayNameが`sun_fruit`（🍋・太陽の実）と`apple`（🍎・リンゴ）で異なるため、既存の`refreshInventoryOverlay`（無変更）がそのまま両者を区別して表示します。

## 絵文字について

太陽の実専用の画像アセットは既存アセット内に見当たらなかったため、既存アイテムと同じ絵文字代用方式を採用しました。当初案の☀️はリンゴ🍎や他アイテムの絵文字との判別性を検討した結果、ユーザーの指示により🍋（レモン）へ変更しています。新しい画像ファイルは生成・追加していません。

## 変更ファイル

- `src/game/types.ts`（`GameState.solarEnergy`/`maxSolarEnergy`追加、`ItemId`へ`sun_fruit`追加）
- `src/game/item-def.ts`（`sun_fruit`定義追加、`solarAmount`フィールド追加、`ITEM_IDS_IN_ORDER`へ追加）
- `src/game/events.ts`（`sun_fruit_used`/`sun_fruit_use_failed`イベント追加）
- `src/game/message-log.ts`（上記イベントの日本語フォーマッタ追加）
- `src/game/turn.ts`（`applyItemUse`へ太陽の実分岐追加）
- `src/game/state.ts`（`CarryOverStats`拡張、SOL初期化・引き継ぎ、太陽の実配置ロジック追加）
- `src/main.ts`（HUDへSOL表示追加）
- 既存テストファイル16件（`GameState`/`Inventory`リテラルへ`solarEnergy`/`maxSolarEnergy`/`sun_fruit`フィールドを追加するのみの機械的な差分。期待値・アサーションの変更は含まない）
- `src/game/__tests__/phase-09-1-solar-energy-foundation.test.ts`（新規、38件）

## 自動テスト・TypeScript・build・diff checkの結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：全38ファイル670件成功（Phase 08.7までの632件 + 新規38件、既存632件に失敗・スキップなし）
- `npx vite build`：成功（`dist/index.html`, `dist/assets/index-*.js`生成、チャンクサイズ警告のみ、エラーなし）
- `git diff --check`：成功（空白関連の問題なし）
- `package.json`/`package-lock.json`：差分なし

## 手動確認結果と未確認項目

`tsx`によるヘッドレス実行で以下を実測しました。

- `createInitialState`直後：`solarEnergy: 5, maxSolarEnergy: 5`
- floor 1の`groundItems`：`apple, sword, armor, sun_fruit`（太陽の実1個、座標は決定的）
- floor 2へ`advanceToNextFloor`後：`solarEnergy: 5, maxSolarEnergy: 5`（維持）、`groundItems`：`apple, spear, hammer, sun_fruit`（太陽の実1個）
- SOL2の状態で太陽の実を使用：`consumed: true`、ログ「太陽の実を使い、太陽エネルギーが回復した。」、使用後`solarEnergy: 4`、所持数`0`

Phaser実行環境（ブラウザ）でのHUD表示・実際のキー操作によるインベントリ取得/選択/使用/満タン時拒否・コンソールエラー有無は、上記のヘッドレス確認と自動テストではカバーしておらず未確認です。

## Phase 09.1で未実装の要素

太陽銃、太陽エネルギーの攻撃消費、日向・日陰マス、移動や待機による自然回復、時間経過による自然回復、天候・時刻・位置情報などの外部連動、最大SOLの成長、複雑なゲージアニメーションはいずれも未実装です。

## Phase 09.2予定

Phase 09.2で太陽銃がこのSOL状態を消費する予定です。SOL最大値5・太陽の実回復量2は、Phase 09.1時点の暫定値であり、実プレイ結果を踏まえて今後変更される可能性があります。

## 完了可否

Phase 09.1は完了。
