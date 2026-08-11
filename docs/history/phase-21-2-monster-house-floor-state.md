# Phase 21.2 モンスターハウスの発生判定・フロア状態・決定的選定・保存境界

## 目的

Phase 21.1の候補抽出・選定ロジックを利用し、モンスターハウスの発生可否をフロア生成時に一度だけ決定し、結果を現在フロアの正規状態として保持する。独立RNGストリームを導入し、同じrun seed・floor・mapから同じ結果を再現する。Phase 21.3以降が利用できる状態型と境界を確立する。production未接続部分（発覚・敵配置・報酬・暗所連携・UI・telemetry）はまだ扱わない。開始commit：`117067d75ed703ecbc737db0218b721f4403e7f9`。

## 発生対象階と20%の仮値

`MONSTER_HOUSE_ELIGIBLE_FLOORS = new Set([2, 3])`（`monster-house.ts`）。1階は対象外。現行3フロア試作限定の仮値で、完成版の階層構成はPhase 23で再設計する前提のため、名前付き定数として分離した。`MONSTER_HOUSE_OCCURRENCE_PROBABILITY = 0.2`。対象階かつ候補部屋が存在する場合のみ、この確率で独立に判定する。

## 最低保証・run上限・動的補正がないこと

run内で一度も発生しない場合を許容する。1runにつき最大1回という制限は設けない（2階・3階それぞれ独立判定のため理論上両方で発生しうる）。直前結果や所持状態による動的補正は行わない。

## フロア状態型

`types.ts`に`MonsterHouseState = { roomIndex: number; status: 'hidden' | 'revealed' } | null`を新設。`GameMap`へ`monsterHouse?: MonsterHouseState`を追加（既存`darkRoomIndex?: number | null`と同じ「optionalなフロア固有状態をGameMapへ直接持たせる」パターンを踏襲）。既存のPhase 21.1以前のGameMapリテラル（テスト・fixture）は本フィールドなしのままで有効。

## 発生判定と部屋選定の順序

`buildMonsterHouseFloorState(map, floor, start, exit, rng)`（`monster-house.ts`）：
1. `isMonsterHouseEligibleFloor(floor)`判定（RNG不使用）
2. `extractMonsterHouseCandidateRooms(map, start, exit)`で候補抽出（Phase 21.1の関数、RNG不使用）
3. 候補が空なら`null`を返す
4. 発生ロールを1回行う（`rng() < MONSTER_HOUSE_OCCURRENCE_PROBABILITY`で成立、境界値`roll === probability`は不成立——既存コードの`< probability`判定規約に合わせた）
5. 不成立なら`null`
6. 成立なら`selectMonsterHouseRoom(candidates, rng)`（Phase 21.1の関数）を同じRNGへ呼び、`{ roomIndex, status: 'hidden' }`を返す

## 全分岐のRNG消費回数

| 分岐 | 消費回数 |
|---|---|
| 対象外階 | 0 |
| 対象階・候補0件 | 0 |
| 対象階・発生ロール失敗 | 1 |
| 対象階・発生ロール成功 | 2（発生ロール1回＋`selectMonsterHouseRoom`1回） |

## seed導出式と専用salt

`createMonsterHouseRng(floorSeed, createRng) = createRng(floorSeed ^ 0x6b2f4d97)`。`floorSeed`は`state.ts`の`buildFloorState`が`deriveFloorSeed(runSeed, floor)`で既に算出済みの値をそのまま再利用（floor番号は`floorSeed`自体に既に混合済みのため、個別に追加混合しない——既存の他ストリームと同じ扱い）。

## 既存RNGから独立している根拠

repository内の既存`floorSeed ^ 0xXXXXXXXX`パターンを全数調査した結果、使用中のXOR定数は`0x51ed270b`（placement）、`0x8f3c9d21`（species）、`0x1a6f83c5`（slow trap）、`0x3f9c5e82`（poison trap）、`0xa3c17f05`（item count）、`0x5c2e91d3`（item selection）、`0x91b6d8e4`（item placement）、`0xc7d4a19e`（equipment curse）の8個。新規採用した`0x6b2f4d97`はこのいずれとも重複しない。各ストリームは同じ`floorSeed`から独立したmulberry32ストリームを生成する既存規約に完全準拠しており、モンスターハウス用ストリームの追加・消費が他ストリームの状態や消費順に影響しないことは、この規約の構造上保証される。

## 同一seedでの決定性

`buildMonsterHouseFloorState`は純粋関数（`map`変異なし）。`createMonsterHouseRng(floorSeed, createRng)`は同一`floorSeed`から常に同一シーケンスを生成する（mulberry32の性質）。テストで、同一`floorSeed`・同一`map`・同一placementから2回呼び出した結果が一致すること、代表seed群（1, 2, 3, 42, 12345, 999999）×floor(2,3)で確認した。

## フロア構築時に一度だけ決定すること

`state.ts`の`buildFloorState`内、`map.darkRoomIndex = chooseDarkRoomIndex(...)`の直後で`map.monsterHouse = buildMonsterHouseFloorState(...)`を1回だけ呼び出す。描画・入室・ターン進行時の再抽選は一切行わない（そもそも呼び出し箇所がフロア構築時のこの1箇所のみ）。

## save/loadまたは直列化境界への対応

production save/loadシステムはこのrepositoryに存在しない（`localStorage`・`saveGame`・`loadGame`等はいずれもtestファイルにのみ出現し、production srcには無い。`schemaVersion`/`CURRENT_GAME_VERSION`は`telemetry.ts`専用でGameState全体の永続化スキーマではない）。このため`if_no_production_save_system`方針に従い、以下のみ対応した：
- `monsterHouse`の値（`null`または`{roomIndex, status}`）はプレーンなJSON直列化可能データのみで構成
- `JSON.parse(JSON.stringify(...))`往復が値を保持することをテストで確認（`createInitialState`経由で生成した状態に対して実施）
- Phase 26予定の汎用セーブシステムは今回先行実装していない

## 旧データ互換規則

`GameMap.monsterHouse`はoptional。フィールド欠落時は`undefined`となり、呼び出し側は`?? null`で「モンスターハウスなし」として扱う（既存の`darkRoomIndex`と同じ扱い）。

## Phase 21.3以降へ延期した事項

プレイヤー入室による発覚（hidden→revealed遷移）、発覚時のターン進行規則、モンスターハウス専用敵配置・敵数・敵種weight、報酬アイテム配置・数・weight、暗い部屋との連携、UI・ログ・演出・telemetry。

## 変更ファイル

- 変更：`src/game/types.ts`（`MonsterHouseState`型定義、`GameMap.monsterHouse`フィールド追加）
- 変更：`src/game/monster-house.ts`（`isMonsterHouseEligibleFloor`、`MONSTER_HOUSE_ELIGIBLE_FLOORS`、`MONSTER_HOUSE_OCCURRENCE_PROBABILITY`、`createMonsterHouseRng`、`buildMonsterHouseFloorState`を追加）
- 変更：`src/game/state.ts`（`buildFloorState`内で`buildMonsterHouseFloorState`を呼び出し、`map.monsterHouse`へ結果を保存）
- 新規：`src/game/__tests__/phase-21-2-monster-house-floor-state.test.ts`
- 新規：`docs/history/phase-21-2-monster-house-floor-state.md`

## 実行テストと結果

`phase-21-2-monster-house-floor-state.test.ts`：18件、全通過（eligibility 2、no-candidates分岐1、occurrence roll分岐7、`createMonsterHouseRng` 2、生成マップ決定性2、production配線3、production wiring各種）。全体：96ファイル2420件、全通過（既存2402件＋新規18件、既存テストへの変更なし）。`npx tsc --noEmit`：エラーなし。`npx vite build`：成功（既存の500KB chunk警告のみ、Phase 21.1時点から存在）。`git diff --check`：問題なし。

## 既存固定seed生成結果を維持した根拠

`buildFloorState`内の変更は、既存の`map`/`placement`/`species`/`trap`/`item`各RNGストリーム生成コードの前後・呼び出し順を一切変更せず、`darkRoomIndex`設定直後に新規の独立呼び出しを1行追加しただけ。新規ストリーム`createMonsterHouseRng`は他のどの既存ストリームとも異なるXOR定数から生成されるため、他ストリームの消費順・消費回数に影響しない。回帰確認として、`placement.test.ts`・`determinism.test.ts`・`dark-rooms.test.ts`・`mapgen.test.ts`・`seed-restart.test.ts`・`state.test.ts`・Phase 21.1テストを含む全96ファイルが無変更のまま全通過した。
