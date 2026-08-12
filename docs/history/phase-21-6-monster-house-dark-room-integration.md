# Phase 21.6 モンスターハウスと暗所システムの連携

## 事前調査で確認した暗所・視界・描画・発覚経路

- `dark-rooms.ts`の`chooseDarkRoomIndex`（floorSeed/floor由来の自己完結ハッシュ、開始/出口部屋を除く候補から選定）と`monster-house.ts`の`buildMonsterHouseFloorState`（Phase21.2専用RNG、同じく開始/出口部屋を除く候補から選定）は完全に独立した処理。互いを参照・除外する仕組みは元々存在しない。
- `visibility.ts`の`computeCurrentVisibility`：プレイヤーが`map.darkRoomIndex`と一致する部屋にいる場合のみ`DARK_ROOM_VISIBILITY_RADIUS`（3）のshadowcasting FOVを返し、それ以外の部屋では全体可視（`roomVisibleTiles`）。`map.darkRoomIndex`はフロア生成時（`state.ts`の`buildFloorState`）に一度設定されて以降、他のどのコードからも変更されない。
- `monster-house.ts`の`applyMonsterHouseReveal`：`visibility.ts`を一切import・参照せず、プレイヤーの移動前後座標の部屋所属のみで発覚を判定する純粋関数。`darkRoomIndex`にも触れない。
- `main.ts`の`snapAllEnemies`・`drawGroundItems`：いずれも`isCurrentlyVisible(pos)`（`computeCurrentVisibility`の結果をSet化したもの）で一律フィルタしており、`spawnSource`による特別扱いは存在しない。
- `turn.ts`：`computeCurrentVisibility`・`darkRoomIndex`への参照は皆無。敵AIの行動決定は視界・暗所と無関係。
- 既存の部屋単位の暗所解除（照明）手段：`clairvoyance_fruit`は罠発見専用でありdarkRoomIndexには作用しない。本リポジトリに部屋を照らす機能は未実装。

## production変更が必要だったか

**不要**。上記の調査により、既存実装は本Phaseの仕様（暗い部屋もmonsterHouse候補になり得る／発覚は視界と無関係／発覚が暗所を自動解除しない／専用敵・専用報酬が既存visibility規則にそのまま従う）を、追加コードなしで既に満たしていることを直接確認した。テストとhistory文書のみを追加した。

## 暗い部屋がmonsterHouse候補になる条件

追加条件なし。既存のroomIndex選定（Phase21.1〜21.2）と`chooseDarkRoomIndex`が完全独立であるため、両者のroomIndexが偶然一致すれば暗いモンスターハウスとなる。実測（2000seed、floor2/3）で785件のモンスターハウス発生中156件（約20%）が暗い部屋との一致だった。

## 入室発覚と暗所維持の処理

追加処理なし。`applyMonsterHouseReveal`は座標のみで判定し`darkRoomIndex`を変更しないため、発覚後も暗所状態は自動的に維持される。実際に`processTurn`経由の移動で発覚させた後、`map.darkRoomIndex`が変化しないことをテストで直接確認。

## 専用敵と専用報酬のvisibility経路

追加処理なし。`main.ts`の既存描画コードが`spawnSource`を一切見ずに全敵・全アイテムへ同一の`isCurrentlyVisible`フィルタを適用するため、専用敵・専用報酬も自動的に既存の暗所視界規則（半径3のshadowcasting）に従う。game層のテストでは`computeCurrentVisibility`を直接呼び、暗いモンスターハウス内でプレイヤーから半径3を超えた専用敵・専用報酬が可視集合に含まれないこと、半径内のものは含まれることを確認した。

## 照明手段との連携状況

既存に部屋単位の暗所解除（照明）手段は存在しない。仕様の「対応する既存照明手段が未実装または部屋単位でない場合は、新規システムを作らず現状を報告する」に従い、新規システムは作らず、この事実のみを記録する。

## 追加テスト

`phase-21-6-monster-house-dark-room-integration.test.ts`：15件
- 暗いモンスターハウスの到達可能性（既知fixture: seed3/floor2、2000seedスイープでの到達確認）
- 発覚の視界非依存性（`applyMonsterHouseReveal`が`darkRoomIndex`を変更しない、移動不成立で発覚しない、二重発覚しない）
- production配線での`darkRoomIndex`維持確認（実際の`processTurn`経由）
- 光るモンスターハウスが暗所状態を新規取得しないこと
- 専用敵・専用報酬の可視性漏れ防止（半径内外の直接確認）
- 光るモンスターハウスの全体可視性（通常の明るい部屋と同じ）
- 暗いモンスターハウスでもPhase21.4/21.5の敵数・報酬数規則が維持されること
- 暗いモンスターハウスでの報酬自動取得
- 回帰（floor1にモンスターハウスが発生しないこと、通常の暗い部屋の既存挙動）

## seed smoke test結果（300seed×floor2,3）

モンスターハウス発生106件、暗い114（内訳: 暗い23、明るい83）、発覚失敗0件、発覚後の暗所状態消失0件、専用敵数不整合0件、専用報酬不足0件、部屋外配置0件、座標重複0件。暗いモンスターハウスは0件ではなく実際に到達可能であることを確認済み。

## 全テスト、型検査、build結果

全体：100ファイル2511件、全通過（既存2496件＋新規15件、既存テストへの変更なし）。`npx tsc --noEmit`：エラーなし。`npx vite build`：成功（既存の500KB chunk警告のみ）。`git diff --check`：問題なし。

## 後続Phaseへ延期した事項

暗いモンスターハウスの発生率調整、モンスターハウス専用の暗転・警告・フラッシュ演出、専用SE、敵・報酬を一斉表示する特殊演出、暗所における敵能力の追加調整、モンスターハウス全体の難度・報酬バランス、全要素実装後の通しプレイ調整。
