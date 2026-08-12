# Phase 21.7 モンスターハウス発覚通知

## 事前調査した既存メッセージ、ログ、ターン結果の経路

- `events.ts`の`GameEvent`：discriminated unionで、`turn.ts`だけが構築し`message-log.ts`の`formatEvent`だけが日本語文字列へ変換する既存の一方向経路。`formatEvent`はexhaustiveness checkにより新規イベント追加時は必ずcaseを実装しないとコンパイルエラーになる。
- `message-log.ts`の`formatEvents`：`GameEvent[]`から表示行配列を生成、連続同一行のみdedupする。
- `main.ts`の`applyTurnResult`：`processTurn`結果を受け取る唯一の箇所で、`this.pushMessages(formatEvents(result.events))`を1回だけ呼ぶ（`MessageLog`という固定容量FIFOへpush、既存HUDのログパネルに表示）。1回の`processTurn`につき1回しか呼ばれないため、`events`配列へ1回だけpushすれば表示側で自動的に重複なく処理される。
- `TurnResult.monsterHouseRevealed`（Phase21.3で既存）：boolean一つのみで、通知文言や表示処理には使われていなかった。
- 既存のモンスターハウス発覚通知：存在しなかった（docsおよびコード検索で確認）。
- production save/load：Phase21.2調査時から不在のまま変わらず（`localStorage`等はtestのみ）。ロード時の誤通知を防ぐ専用処理は不要（そもそもロード処理自体が存在しない）。

## 採用した通知文言

`"モンスターハウスだ！"`（仕様の`preferred_text`をそのまま採用）。敵数・報酬数・部屋座標など未視認情報は一切含まない。

## hiddenからrevealedへの遷移検出方法

`turn.ts`の`processTurn`内、Phase21.3で既に確立された`applyMonsterHouseReveal`呼び出しの戻り値（`monsterHouseRevealed: boolean`）をそのまま利用。この呼び出しは移動成立判定の直後・敵行動フェーズの前という既存の1箇所だけで行われる。UI側が`map.monsterHouse.status`を独自に監視・推測する方式は採用していない。

## ターン処理から表示層への伝達方法

`monsterHouseRevealed === true`のとき、その場で`events.push({ type: 'monster_house_revealed' })`を1回追加（新規`GameEvent`ケース）。`message-log.ts`の`formatEvent`に`case 'monster_house_revealed': return 'モンスターハウスだ！';`を追加。既存の`TurnResult.events`→`formatEvents`→`pushMessages`という確立済み経路をそのまま再利用し、`main.ts`側のコード変更は不要だった。

## 重複通知防止方法

`events`配列は`processTurn`呼び出しごとに新規生成され、`monsterHouseRevealed`が`true`になるのは`applyMonsterHouseReveal`が実際に`status`を`hidden→revealed`へ変更した、その1回の呼び出し内のみ。次のターン以降は`status`が既に`'revealed'`のため`applyMonsterHouseReveal`は必ず`false`を返し、`events.push`は呼ばれない。永続的な「通知済みフラグ」をGameStateへ追加する必要はなく、既存の`status`そのものが冪等性を保証する。

## 暗いモンスターハウスでの通知挙動

暗いモンスターハウスと明るいモンスターハウスで発覚条件・通知処理に一切分岐を設けていない（`applyMonsterHouseReveal`は元々`darkRoomIndex`を参照しない）。実際に既知の暗いモンスターハウス発生（seed3/floor2）で通知が正しく1回発火し、`darkRoomIndex`が変化しないことを直接確認した。

## セーブ・ロード時の扱い

production save/loadが存在しないため、変更なし。`monsterHouse.status`の既存保存規則（Phase21.2で規定：production save/load不在のためJSON直列化可能性のみ保証）は無変更。

## production変更ファイル

- `src/game/events.ts`（`GameEvent`へ`monster_house_revealed`ケース追加）
- `src/game/message-log.ts`（`formatEvent`へcase追加）
- `src/game/turn.ts`（`processTurn`内、発覚成立時に`events.push`）

`main.ts`（表示層）は無変更——既存の`applyTurnResult`→`formatEvents`→`pushMessages`経路がそのまま新規イベントを処理する。

## 追加テスト

`phase-21-7-monster-house-reveal-feedback.test.ts`：19件
- イベントのフォーマット・未視認情報非包含の確認2件
- `processTurn`での発火条件（発火/非発火の全パターン）9件
- ターン挙動（1ターン消費、敵行動1回、状態遷移）3件
- production配線（実際の暗いモンスターハウスでの1回発火、`darkRoomIndex`不変、決定論維持）2件
- 既存イベント処理への回帰確認2件

## seed smoke test結果（200seed×floor2,3）

モンスターハウス発生72件、entry cell到達可能72件、正常revealed遷移72件、通知1件発生72件、通知欠落0件、重複通知0件、再入室誤通知0件、発覚失敗0件、発覚後dark状態消失0件、例外0件。

## 全テスト、型検査、build結果

全体：101ファイル2530件、全通過（既存2511件＋新規19件、既存テストへの変更なし）。`npx tsc --noEmit`：エラーなし。`npx vite build`：成功（既存の500KB chunk警告のみ）。`git diff --check`：問題なし。

## manual check相当の確認（headless実行による代替）

実際のブラウザ操作は本環境で実施不可のため、production関数を直接呼び出すシミュレーションで代替確認した。seed3/floor2（既知の暗いモンスターハウス）で：入室前`monsterHouse.status === 'hidden'`、entry cellへの移動で`consumed: true`・着地座標一致、`formatEvents`の出力が`['モンスターハウスだ！']`の1件のみ、移動後`status === 'revealed'`、`darkRoomIndex`が移動前後で不変（4のまま）、専用報酬が存在することを確認した。

## Phase 21.8へ残した統合監査事項

Phase21.2〜21.7の総合監査、実際のモンスターハウス1件の通しプレイ（発生→入室→発覚→敵行動→戦闘→報酬取得→退出→再入室の一連確認）、Phase21完了判定。

## 後続の演出・バランス調整へ延期した事項

専用SE、画面フラッシュ、カメラ演出、高品質なメッセージ演出、モンスターハウス専用BGM、発生率・専用敵数・敵構成・報酬数・高級報酬テーブル・暗いモンスターハウスの比率・難度と報酬の釣り合いの最終調整。
