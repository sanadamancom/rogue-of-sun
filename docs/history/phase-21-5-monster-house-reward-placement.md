# Phase 21.5 モンスターハウス専用報酬配置

## 実装概要

モンスターハウスが発生した階の対象部屋内へ、通常配置とは別枠の報酬アイテムを配置する。既存のground item取得（自動ピックアップ）経路をそのまま利用でき、由来を`spawnSource: 'monster_house'`で識別可能にした。開始commit：`b17b39cb102b9a32cd401d505167cd6d5872a34f`。

## 報酬数の暫定値

`MONSTER_HOUSE_REWARD_COUNT = 3`（`monster-house.ts`）。バランス確定値ではなく、報酬要素を成立させるための暫定値。名前付き定数として定義し、既存の大規模設定機構は新設していない。

## アイテム抽選方法

既存の`getWeightedGroundItemPoolForFloor(floor, excludedIds)`をそのまま再利用。カード（`floorDropEnabled: false`）は既存の仕組みで自動的に候補から除外される。新規の高級報酬テーブルは作っていない。`drawWeightedGroundItemSelection`も既存関数をそのまま利用。

**発見・対応した見落とし**：通常アイテム抽選と専用報酬抽選が別呼び出しのため、既存の「同一フロアでenchantmentは1個まで」契約（`drawWeightedGroundItemSelection`の呼び出し内重複禁止）が呼び出しをまたいで破られる可能性があった。専用報酬の除外リストへ、通常側で既に選ばれたenchantment IDを追加することで対処。

## 配置順

`state.ts`の`buildFloorState`：通常敵→trap→通常item/equipment→**Phase21.4専用敵**→**専用報酬（今回追加、専用敵生成の直後）**。専用報酬の除外リストにはPhase21.4の専用敵位置（`dedicatedPositions`）も含めており、専用敵と専用報酬が互いに占有候補から除外し合う一方向の関係（専用報酬が専用敵の位置を避ける、逆はない）を実現。既存生成物を後から移動・削除することはない。

## 合法セル条件

`computeMonsterHouseCandidateCells`（Phase21.4で実装済み、再利用）：対象部屋矩形内の`floor`タイルから、entry cell・player開始位置・出口・通常敵・専用敵・trap・通常ground itemを除外した集合。同一座標への複数報酬配置は`selectMonsterHouseRewardPositions`が重複なく選ぶことで防止。

## 容量不足時の処理

新規関数`selectMonsterHouseRewardPositions(candidates, count, rng)`：`Math.min(count, candidates.length)`分だけ配置し、`throw`しない。Phase21.4の敵配置（`selectMonsterHouseEnemyPositions`、容量不足でthrow）とは意図的に異なる契約。実測（1000+200seed規模）で容量不足は一度も発生しなかった。

## seed決定論の維持方法

専用報酬用に新規2本の独立RNGストリーム（`createMonsterHouseRewardPositionRng`: `floorSeed ^ 0x4e7bc218`、`createMonsterHouseRewardSelectionRng`: `floorSeed ^ 0x9f1a5d63`）を導入。既存の全11個のfloorSeed派生ストリーム（placement, species, slow/poison trap, item count/selection/placement, equipment curse, monster house occurrence/selection, monster house enemy position/species）のいずれとも重複しない。モンスターハウス非発生フロアではこれらのストリームは生成・消費されない。

## 追加テスト

`phase-21-5-monster-house-reward-placement.test.ts`：14件（`MONSTER_HOUSE_REWARD_COUNT`確認1・容量不足契約5・production配線8）。

**既存テストの測定対象補正**（Phase21.4の前例に倣った同種の必要な補正）：`phase-15-4-random-ground-items.test.ts`・`phase-15-5-enemy-count-by-floor.test.ts`の「groundItems 2-6個」検証を、`spawnSource !== 'monster_house'`でフィルタした通常アイテムのみに限定するよう補正。期待値2-6は無変更。

## seed smoke test結果（200seed×floor2,3）

発生72回、全72回でMONSTER_HOUSE_REWARD_COUNT（3個）を正確に配置。容量不足0件、座標重複0件、部屋外配置0件、entry cell侵入0件、生成例外0件。

## 全テスト、型検査、build結果

全体：99ファイル2496件、全通過（既存2482件＋新規14件）。`npx tsc --noEmit`：エラーなし。`npx vite build`：成功（既存の500KB chunk警告のみ）。`git diff --check`：問題なし。

## 後続Phaseへ延期した事項

報酬数・内容の本格的なバランス調整、モンスターハウス専用の高級報酬テーブル、hidden中の報酬表示制御、暗所・視界システムとの連携、発覚時の専用UI・ログ・SE・演出、モンスターハウス専用telemetry、全要素実装後の通しプレイ調整。
