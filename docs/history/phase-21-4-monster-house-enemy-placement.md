# Phase 21.4 モンスターハウス専用敵配置と安全保証（部屋サイズ連動）

## 目的

モンスターハウス発生フロアの対象部屋へ専用敵をフロア生成時に一度だけ配置する。専用敵数は階層番号ではなく対象部屋の配置可能セル数（C）から算出し、階層は敵種poolとweightにのみ影響させる。hidden中は行動させず、発覚ターンから既存の通常敵AIへ参加させる。開始commit：`80596cd5334294255a439cb79db375f622193c50`。

## 固定数方式を撤回した理由

当初「2階5体、3階6体」という階層固定数で実装したが、既存確定テスト`phase-15-5-enemy-count-by-floor.test.ts`（`state.enemies`総数を階層別固定値で検証）と衝突した。この衝突を報告した結果、敵数を部屋サイズ（配置可能セル数C）から算出する可変数方式へ設計変更する指示を受けた。あわせて、既存の「floor 2は必ず7体」等の意図が実際には「通常敵数」であったことを明確化し、Phase 15.5テストの測定対象を通常敵限定へ補正する承認を得た（後述）。

## floor生成処理の監査結果・生成順

`state.ts`の`buildFloorState`：通常敵生成（`buildEnemies`＋`spawnSource: 'normal'`付与）→ダークルーム決定→モンスターハウス状態決定（Phase21.2）→trap生成（slow_trap, poison_trap）→ground item生成（equipment個体化含む）→**専用敵生成（今回追加、全ての通常生成が完了した最後）**→`state`組み立て。専用敵は通常生成物の位置がすべて確定した後にのみ生成され、通常生成用RNGの消費順・結果を一切変更しない。

## Cの定義

`computeMonsterHouseCandidateCells(map, roomIndex, exclusions)`（`monster-house.ts`）：対象部屋矩形内の`floor`タイルから、`computeMonsterHouseEntryCells`が返す全entry cellと、`exclusions`（player位置、exit位置、通常敵位置、trap位置、ground item位置——equipment個体もground item経由で含まれる）を除いた残りのセル集合。座標重複は自動的に1回だけ除外される（`Set`ベース）。この配列の長さがC。

## N=clamp(ceil(sqrt(C)),4,8)の契約

`computeMonsterHouseEnemyCount(candidateCellCount)`（`monster-house.ts`）：`floor`パラメータを持たない純粋関数。`Math.min(8, Math.max(4, Math.ceil(Math.sqrt(C))))`。`C<4`では明示的に`throw`（silent fallback禁止）。単調非減少性・下限4・上限8をテストで確認済み。

## 敵数を階層から独立させた理由・階層の役割

将来階層が増えても敵数算出関数（`computeMonsterHouseEnemyCount`）自体には一切手を加える必要がない設計とするため。階層番号は`chooseMonsterHouseEnemyTypes(count, floor, rng, golemAlreadyPresent)`の`floor`引数として、既存の`getEnemyPoolForFloor(floor)`（合法敵種pool）を選ぶためだけに使われ、敵数計算には一切関与しない。

## entry cellの定義

`computeMonsterHouseEntryCells(map, roomIndex)`：対象部屋矩形内の`floor`タイルのうち、上下左右いずれかに「部屋矩形外の`floor`タイル」が隣接するセル。doorway自体は既存仕様（`doorway-rule.test.ts`で確認済み）により常に部屋矩形外にあるため、entry cell自体には含まれない。

## 配置禁止セルと重複防止方法

専用敵配置候補（C）は既にentry cellと全占有物（player, exit, 通常敵, trap, ground item/equipment）を除外済み。加えて`selectMonsterHouseEnemyPositions`は候補内から重複なくN個をFisher-Yatesシャッフルで選ぶため、専用敵同士の重複も発生しない。

## 専用敵の識別方法

`EnemyActor.spawnSource?: 'normal' | 'monster_house'`（`types.ts`）。通常敵は明示的に`'normal'`を付与、専用敵は`'monster_house'`。既存fixture（フィールド欠落）は`undefined`となり、`turn.ts`のhidden除外判定・全テストの「通常敵」判定（`spawnSource !== 'monster_house'`）で自動的に通常敵扱いとなる。

## 専用RNGの導出と通常RNGからの分離

`createMonsterHouseEnemyPositionRng`・`createMonsterHouseEnemySpeciesRng`（`monster-house.ts`）：`floorSeed`から、既存の全floorSeed派生ストリーム（placement: `0x51ed270b`、species: `0x8f3c9d21`、slow trap: `0x1a6f83c5`、poison trap: `0x3f9c5e82`、item count: `0xa3c17f05`、item selection: `0x5c2e91d3`、item placement: `0x91b6d8e4`、equipment curse: `0xc7d4a19e`、monster house occurrence/selection: `0x6b2f4d97`）のいずれとも重複しない新規2定数（`0x2d84b6f1`, `0x7a19e3c8`）で独立生成。位置・敵種で別ストリームとする既存規約（placementRng/speciesRngの分離）に倣った。モンスターハウス非発生フロアではこれらのストリームは生成も消費もされない。

## hidden中の行動抑止

`turn.ts`の`resolveEnemiesAction`ループ内、`if (!enemy.alive) continue;`の直後に`if (enemy.spawnSource === 'monster_house' && state.map.monsterHouse?.status === 'hidden') continue;`を追加。RNG消費前・行動処理前にスキップするため、他の敵の行動回数・順序・RNG消費に一切影響しない。

## 発覚ターンからの行動開始・二重行動しない根拠

Phase 21.3の`applyMonsterHouseReveal`は`resolveEnemiesAction`呼び出し前に実行される既存の接続を維持（今回変更なし）。発覚した同じターンの`resolveEnemiesAction`単一パス内で、`monsterHouse.status`が既に`'revealed'`になっているため、上記のスキップ条件に該当せず通常どおり1回だけ行動対象に含まれる。追加の敵フェーズは作っていない。

## golem上限を初期敵全体で維持したこと

`chooseMonsterHouseEnemyTypes`に`golemAlreadyPresent: boolean`引数を追加。`state.ts`側で通常敵種選択結果（`types.includes('golem')`）を渡すことで、通常敵側に既にgolemがいる場合は専用敵側で一切golemを選ばない。専用敵側で新規にgolemを選んだ場合も、同じ専用配置内の2体目以降は`'bok'`へ自動変換。テストで200seed×2パターン（`golemAlreadyPresent`true/false）を検証。

## Phase 15.5テストの測定対象補正（承認済み）

`phase-15-5-enemy-count-by-floor.test.ts`：`state.enemies`全体ではなく`spawnSource !== 'monster_house'`でフィルタした通常敵のみを`ENEMY_COUNT_BY_FLOOR`と比較するよう補正。期待値7・8は無変更。`armor-and-golem.test.ts`の同種テスト（"2F total enemy count matches..."）も同じ理由で追加承認を得て同様に補正（テスト名も"2F normal enemy count..."へ変更）。承認外の既存期待値・テストは変更していない。

## 1000seedずつの部屋面積・C・N分布

| floor | 発生回数/1000 | C最小 | C最大 | C中央値 | N分布 |
|---|---|---|---|---|---|
| 2 | 187 | 32 | 104 | 59 | {6:31, 7:60, 8:96} |
| 3 | 205 | 30 | 104 | 60 | {5:2, 6:28, 7:53, 8:122} |

全1000seed×2階層でC<4の発生：0件。

## C>=4の理論保証

最小部屋は6×5=30セル（`MAP_GEN_PARAMS.roomWidth/roomHeight`の最小値）。理論上の最悪ケース除外数：entry cell最大6（基本4方向接続＋`extraConnections`最大2）、通常敵最大8体（`choosePlacement`はマップ全体の`floor`タイルから一様抽選するため理論上全敵が単一部屋に集中しうる）、trap最大2、ground item最大6。合算しても30−6−8−2−6=8となり、C=4を下回る具体的機構は存在しない。実測でもC<4は0件であり、理論・実測双方でC≥4を確認した。

## Phase 21.5以降へ延期した事項

報酬アイテム配置、暗いモンスターハウスの特別処理、hidden中の専用敵表示、発覚メッセージ・ログ・UI・演出・効果音、telemetry・schemaVersion変更。

## 変更ファイル

- 変更：`src/game/types.ts`（`EnemyActor.spawnSource`追加）
- 変更：`src/game/monster-house.ts`（`computeMonsterHouseEnemyCount`, `computeMonsterHouseEntryCells`, `computeMonsterHouseCandidateCells`, `selectMonsterHouseEnemyPositions`, `chooseMonsterHouseEnemyTypes`, `createMonsterHouseEnemyPositionRng`, `createMonsterHouseEnemySpeciesRng`追加）
- 変更：`src/game/state.ts`（`chooseSpecies`・`buildEnemies`をexport化、専用敵生成を全通常生成完了後に接続）
- 変更：`src/game/turn.ts`（hidden専用敵の行動除外）
- 変更：`src/game/__tests__/phase-15-5-enemy-count-by-floor.test.ts`（承認済み測定対象補正）
- 変更：`src/game/__tests__/armor-and-golem.test.ts`（承認済み測定対象補正、該当1件のみ）
- 新規：`src/game/__tests__/phase-21-4-monster-house-enemy-placement.test.ts`
- 新規：`docs/history/phase-21-4-monster-house-enemy-placement.md`

## 実行テストと結果

`phase-21-4-monster-house-enemy-placement.test.ts`：37件、全通過（N公式12・candidate cells/entry safety5・position selection4・golem cap3・production配線8・hidden/reveal2・その他）。全体：98ファイル2482件、全通過。`npx tsc --noEmit`：エラーなし。`npx vite build`：成功。`git diff --check`：問題なし。
