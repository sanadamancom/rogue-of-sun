# Phase 21.3 モンスターハウス初回入室発覚とターン契約

## 目的

hidden状態のモンスターハウス対象部屋へプレイヤーが初めて入った時だけrevealedへ遷移させる。発覚判定を実際に成立したプレイヤー移動へ接続し、そのターン消費・敵行動順を既存ターン処理へ統合する。開始commit：`fe4d49538e55eaa3bbb95b60ad7529f717b162b3`。

## 初回入室の正確な判定条件

すべて成立した場合のみ発覚：
- `map.monsterHouse`が存在し`null`ではない
- `status`が`'hidden'`である
- プレイヤーの移動が実際に成立している（`action.type === 'move'`かつ移動前後で座標が変化）
- 移動前座標が対象部屋（`map.rooms[monsterHouse.roomIndex]`）の外
- 移動後座標が対象部屋の内

## roomとdoorwayの境界

`mapgen.ts`の`roomIndexContaining`と同じ半開区間判定（`x`は`[room.x, room.x+room.width)`、`y`は`[room.y, room.y+room.height)`）を1部屋分だけに適用する形で再利用。既存の`doorway-rule.test.ts`が確認済みの「doorwayタイルは常に部屋矩形の外」という性質により、通路・入口手前のdoorway上では判定上も自動的に「部屋外」となり、発覚しない。新規のroom-membership関数は追加せず、既存関数をそのまま再適用した。

## hiddenからrevealedへの一方向遷移

`monster-house.ts`に`applyMonsterHouseReveal(map, posBefore, posAfter): boolean`を追加。`map.monsterHouse.status`のみを変異し、`roomIndex`は変更しない。新しいモンスターハウスの生成・再抽選は行わない。RNGを一切消費しない。

## 発覚しない操作

対象部屋外での待機・攻撃・face、壁や敵に阻まれて不成立に終わった移動、対象部屋ではない部屋への入室、通路またはdoorway上への移動、hidden状態の対象部屋を視界に入れること、フロア開始時点での状態構築、load/restart、revealed済み対象部屋への再入室、対象部屋内部での移動・待機・攻撃——いずれも`applyMonsterHouseReveal`の判定条件（`wasInside`が真、または`isInside`が偽、または既に`'revealed'`、または`monsterHouse`が存在しない）のいずれかに該当し、`false`を返し状態変化なし。

## 発覚処理のproduction接続地点

`turn.ts`の`processTurn`内、`applyPlayerAction`呼び出し・`consumed`判定通過後、最初の`resolveEnemiesAction(state, events)`呼び出し（敵行動フェーズ）の直前。移動成立判定は既存の「追加敵フェーズ」判定（`actualMoveHappened`）と同型のロジック（`action.type === 'move' && (pos変化)`）をこの接続点用に独立して算出し、真の場合のみ`applyMonsterHouseReveal(state.map, posBeforeAction, state.player.pos)`を呼ぶ。

## プレイヤー移動、発覚、敵行動の処理順

1. `applyPlayerAction`でプレイヤーの移動（または他アクション）を解決
2. `consumed`が真の場合のみ以降を継続
3. 移動成立判定（`moveHappenedForReveal`）
4. 成立していれば`applyMonsterHouseReveal`を呼び発覚を判定・適用
5. `resolveEnemiesAction`で通常の敵行動フェーズを1回実行（既存の呼び出し構造は無変更）

## 1ターン消費、追加消費なし、敵行動1回の契約

発覚は通常の移動アクションの一部として処理されるため、消費ターン数は既存の通常移動と同一（1）。発覚自体による追加のターン消費・確認待ち・追加入力待ちは存在しない（`applyMonsterHouseReveal`は同期的なbooleanを返すのみで、`processTurn`の制御フローに新しい分岐や待機を導入しない）。`resolveEnemiesAction`の最初の呼び出しは発覚の有無に関わらず常に1回のみ実行される（Phase 12.2のslow_trap追加敵フェーズという既存の別契約による2回目の呼び出しは、今回の変更と無関係に既存条件のまま維持）。

## RNG消費0回であること

`applyMonsterHouseReveal`はRNGパラメータを一切持たない純粋な状態変異関数であり、呼び出しても既存のいかなるRNGストリームも消費しない。

## 発覚結果を後続Phaseへ渡す境界

`TurnResult`（`turn.ts`）へ`monsterHouseRevealed: boolean`フィールドを追加。`processTurn`の全ての早期return・最終returnで明示的に設定（新規イベント型・ログ・UI・telemetryは追加していない）。Phase 21.6はこのbooleanを観測してログ・UI・telemetryを実装できる。

## Phase 21.4以降へ延期した事項

モンスターハウス専用敵の配置・敵数・敵種weight・安全距離、報酬アイテム配置、暗いモンスターハウスの特別処理、発覚メッセージ・ログ・UI・演出・効果音、telemetry・schemaVersion変更、revealed状態を敵AIの起動条件にすること。

## 変更ファイル

- 変更：`src/game/monster-house.ts`（`applyMonsterHouseReveal`追加）
- 変更：`src/game/turn.ts`（`processTurn`への接続、`TurnResult.monsterHouseRevealed`追加）
- 変更：`src/game/inventory.ts`（`TurnResult`を生成する別経路に`monsterHouseRevealed: false`を追加、型整合のため）
- 新規：`src/game/__tests__/phase-21-3-monster-house-reveal-turn-contract.test.ts`
- 新規：`docs/history/phase-21-3-monster-house-reveal-turn-contract.md`

## 実行テストと結果

`phase-21-3-monster-house-reveal-turn-contract.test.ts`：25件、全通過（純粋関数の状態遷移12件、processTurn統合11件、既存挙動回帰2件）。全体：97ファイル2445件、全通過（既存2420件＋新規25件、既存テストへの変更なし）。`npx tsc --noEmit`：エラーなし。`npx vite build`：成功（既存の500KB chunk警告のみ）。`git diff --check`：問題なし。
