# Phase 20.4 正義・悪魔・塔

## 目的

部屋範囲攻撃カード3種（正義・悪魔・塔）を通常カード使用経路へ接続する。開始commit：`9567126f140d1aab9b9587c06a7165af5b1665bc`（Phase20.3 commit1）。

## 正義・悪魔・塔の採用仮値

| カード | 効果 |
|---|---|
| 正義 | `max(1, maxLife - currentLife)`固定ダメージを同室敵全体へ |
| 悪魔 | SOL3消費、固定5ダメージを同室敵全体へ |
| 塔 | `3 × 現在レベル`固定ダメージを同室敵全体＋使用者自身へ |

いずれも防御・属性相性・命中判定を介さないカード固定ダメージ、RNG不使用。数値はPhase27で最終調整する仮値。

## current roomの正確な定義

`state.map.rooms`（ダンジョン生成時の矩形領域配列）に対し、`roomIndexContaining(rooms, pos)`（既存`mapgen.ts`関数）で所属room indexを判定。9×7カメラ表示範囲は一切使用しない。

## corridor規則

`roomIndexContaining`が-1を返す場合（通路・doorway上）、正義・悪魔は対象敵0体、塔は使用者自身のみを対象とする。

## 対象0体時の成功契約

3カードとも対象0体でも使用成立（消費・鑑定・1ターン進行）。塔は使用者自身が常に対象となるため実質的に「0体」状態は存在しない。正義・悪魔はログで対象なしを明示する（`card_room_effect_resolved { targetCount: 0 }`）。

## 複数対象のsnapshotと決定的処理順

対象一覧は効果開始時に`state.enemies`の既存配列順で1回だけ取得し（`getSameRoomEnemies`）、以後再クエリしない。途中の敵撃破が未処理対象へ影響しないことをテストで確認済み。

## 敵撃破共通経路との接続

`applyPlayerAttackToEnemy`から`defeatEnemyIfNeeded`という共通関数を抽出し（Phase20.3のcommitで実施）、正義・悪魔・塔もこの同一関数を呼ぶ。経験値付与・レベルアップは共通処理。鍵・drop処理は現状production未実装のため接続対象なし。

## 塔の自傷・死亡・judgement処理順

対象一覧・ダメージ値を使用開始時にsnapshot→同室敵全体へダメージ適用（`defeatEnemyIfNeeded`経由）→使用者自身へ同ダメージ適用→LIFE0なら`resolveDeathIfDefeated`（既存の共通死亡境界、複製なし）。使用者のLIFEが0になっても、既にsnapshot済みの敵ダメージ適用は省略しない。

## RNG契約

3カードともRNGを消費しない（テストで確認、敵の並行行動によるRNG消費と分離した検証方法を採用）。

## 専用テストの完全な名称と結果

`phase-20-4-room-card-effects.test.ts`：36件、全通過

**justice（9件）**：LIFE減少量ダメージ、満タン時1ダメージ、同室全敵、別室除外、通路上除外、0体成立、通路上成立、共通撃破経路、RNG非消費

**devil（7件）**：SOL3消費、SOL不足時no-op、同室全敵へ5ダメージ、0体でも資源消費、通路上成立、共通撃破経路、RNG非消費

**tower（9件）**：レベル3倍ダメージ、通路上使用者のみ、0体でも成立、皇帝軽減されない自傷、使用者0到達後も全敵処理完了、judgementあり復活、judgementなし死亡、共通撃破経路、RNG非消費

**shared_room（7件）**：カメラ非依存room判定、矩形境界外除外、snapshot処理順、seed決定性、3カード共通の0体成立契約、封印時no-op、未所持時no-op

**regression（4件）**：床loot非出現、100seed実測、フロア移動後の整合、既存Phase20.0c-20.3機構の非影響

## focused検証結果

8ファイル、357件、全通過

## 変更ファイル一覧

- 変更：`src/game/turn.ts`（`getSameRoomEnemies`共通ヘルパー、`applyJusticeCardUse`/`applyDevilCardUse`/`applyTowerCardUse`、ディスパッチ登録、`getLevel`/`roomIndexContaining`のimport復元）、`src/game/events.ts`（`card_use_failed`への`insufficient_resource`理由、`card_room_damage`/`card_room_effect_resolved`/`card_self_damage`イベント型）、`src/game/message-log.ts`（対応する`formatEvent`ケース）
- 新規：`src/game/__tests__/phase-20-4-room-card-effects.test.ts`

## Phase 27で数値再調整対象であること

正義・悪魔・塔のダメージ式係数（悪魔のSOL消費量・固定ダメージ、塔のレベル倍率）はいずれもPhase20仮値であり、Phase27で最終バランス調整する。
