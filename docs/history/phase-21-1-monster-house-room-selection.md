# Phase 21.1 モンスターハウス候補部屋の抽出・選定ロジック

## 目的

Phase 21（モンスターハウス）の最初の実装単位として、既存の`GameMap`・`Room`・`Placement`構造を利用し、モンスターハウス候補部屋を抽出する純粋ロジックと、候補集合から1部屋をseed決定的に選ぶ純粋ロジックを実装する。production未接続。開始commit：`401425df654c379a5175711760aca8ceb0dbef83`。

## 候補部屋の定義

`map.rooms`のうち、開始座標(`start`)を含む部屋と、出口座標(`exit`)を含む部屋を除いた残り全部屋を候補とする。部屋面積・start/exitからの距離・敵配置可能数・暗い部屋か否か・発生階層・発生確率による除外は21.1では行わない（これらは21.2〜21.5の対象）。

## 開始部屋・出口部屋の除外方法

`mapgen.ts`の既存関数`roomIndexContaining(rooms, pos)`を再利用（半開区間：`x`は`[room.x, room.x+room.width)`、`y`は`[room.y, room.y+room.height)`）。新規の部屋判定ロジックは追加していない。`start`または`exit`がどの部屋にも含まれない場合は`roomIndexContaining`が`-1`を返すため、これを検知して明示的に`throw`する。

## 候補順序

`map.rooms`のindex昇順。開始部屋・出口部屋のindexをスキップしてそのまま配列へ積む。

## RNG消費契約

- `extractMonsterHouseCandidateRooms`：RNGを一切使用しない。
- `selectMonsterHouseRoom`：候補が空なら`null`を返しRNG消費0回。候補が1件以上なら`Math.floor(rng() * candidates.length)`で正確に1回だけ消費する。
- 21.1では`floorSeed`からのRNGストリーム導出、新規XOR定数の追加は行わない。呼び出し元が任意の`rng`関数を注入する。独立RNGストリームの配線は21.2で決定する。

## production未接続であること

`src/game/monster-house.ts`はPhaser非依存の純粋関数2個のみで構成し、`state.ts`のフロア構築、`GameState`、save schema、telemetry、UI、敵・アイテム・ターン処理のいずれからも呼び出していない。

## 21.2以降へ延期した事項

- 発生階層・頻度の判定（どの階でモンスターハウスを発生させるか）
- 独立RNGストリームの導出とXOR定数の決定
- 未発覚・発覚済み状態、初回入室による発覚（21.3）
- 専用敵配置・安全保証（21.4）
- 既存通常品による報酬配置（21.5、カード・貴重品・鍵・デバッグ専用品は候補外）
- 暗所連携・UI・telemetry（21.6）
- GameStateフィールド追加・save schema変更

## 変更ファイル

- 新規：`src/game/monster-house.ts`
- 新規：`src/game/__tests__/phase-21-1-monster-house-room-selection.test.ts`
- 新規：`docs/history/phase-21-1-monster-house-room-selection.md`

## 専用テストの完全な名称と結果

`phase-21-1-monster-house-room-selection.test.ts`：19件、全通過（`extractMonsterHouseCandidateRooms`7件、`selectMonsterHouseRoom`9件、生成マップ統合3件）

## 全通常テストの結果

95ファイル、2402件、全通過（既存2380件＋新規19件＋α、既存テストへの変更なし）

## typecheck・build・git diff --check結果

`npx tsc --noEmit`：エラーなし。`npx vite build`：成功（既存の500KB chunk sizeに関する警告のみ、変更前から存在）。`git diff --check`：問題なし。

## 既存seed決定性を維持した根拠

`monster-house.ts`はproductionのフロア生成・配置処理（`mapgen.ts`の`generateMap`・`choosePlacement`等）を一切変更していない。新規テストでも、代表seed群（1, 2, 3, 42, 12345, 999999）で`generateMap`→`choosePlacement`という既存の呼び出し列をそのまま実行し、その結果に対して候補抽出・選定を後段で適用するのみで、既存RNG消費順への割り込みがないことを確認した。既存の95ファイル中94ファイル（mapgen・placement・determinism関連テストを含む）はすべて無変更のまま全通過している。
