# Phase 20 カードコアループ（20.0b / 20.0e / 20.1 / 20.2 / 20.3）

## 今回完了した範囲

- Phase 20.0b：カード専用の鑑定・封印基盤
- Phase 20.0e：重量付き床出現・floor別解禁基盤
- Phase 20.1：永続成長カード5種（女教皇・女帝・戦車・力・運命の輪）
- Phase 20.2：回復・交換カード2種（恋人・吊るされた男）
- Phase 20.3：死神・審判

以上5サブフェーズを、床出現→取得→未鑑定表示→使用または自動発動→鑑定→消費・ターン進行までの縦方向のカードループとして統合実装した。

## 変更前の状態と目的

Phase 20.0a（`docs/history/phase-20-0a-card-foundation.md`）でカード17種の定義（`CardDefinition`、`ITEM_DEFINITIONS`登録、Inventory表示登録）のみが完了しており、効果・使用処理・出現・鑑定・封印はいずれも未実装だった。本フェーズはそのうち9種（通常使用8種＋審判）について、実際にプレイして完結できる状態まで実装した。

## カード定義基盤との接続

`card-def.ts`の`CardDefinition`（`useMode`/`targetScope`/`effectId`/`lootWeight`/`floorDropEnabled`等）をそのまま利用。17種のうち実装対象9種（`high_priestess`, `empress`, `chariot`, `strength`, `wheel_of_fortune`, `lovers`, `hanged_man`, `death`, `judgement`）の`lootWeight`・`floorDropEnabled`を更新し、残り8種（`emperor`, `justice`, `temperance`, `devil`, `tower`, `star`, `moon`, `sun`）は0/falseのまま維持した。

## 鑑定状態identifiedCardIdsとフロア間carry-over

`GameState.identifiedCardIds?: CardId[]`（optionalフィールド）を新設。カードの種別ごとに鑑定状態を保持し、同一run内で共有する。`state.ts`の`buildFloorState`/`advanceToNextFloor`が既存の`carry ? carry.field : default`パターンに倣ってフロア間で引き継ぐ。`advanceToNextFloor`のcarry構築時には`normalizeIdentifiedCardIds`（`state.ts`）を通し、フィールド欠落時は空配列へ補完し、未知のCardIdと重複値を除去する。

**永続save/loadは未実装**である。このリポジトリにはJSON・localStorage・sessionStorageを用いた永続save/load機構が存在せず、`identifiedCardIds`の継続範囲は`advanceToNextFloor`によるフロア間carry-overに限定される。将来永続save/loadが実装される場合、その実際の復元入口への`normalizeIdentifiedCardIds`接続は別途必要になる。

## 封印状態と手動カード使用制限

既存の`activeEffects`/`EFFECT_DEFINITIONS`機構（`effects.ts`）を再利用し、新規`EffectId`として`'sealed'`を追加した。`turn.ts`の`isCardUseSealed(state)`が`getActiveEffect(state, 'sealed')`の有無を判定し、`applyCardUse`が封印中の通常使用を拒否する（非消費・非鑑定・非ターン進行）。**封印状態そのものを付与する新規経路は今回追加していない**（トラップや敵攻撃からの付与は対象外）。judgementの自動発動は封印中でも発動する（手動使用の制限とは独立）。

## 実装した通常カード8種の一覧と効果

| カード | 効果 | 成立条件 |
|---|---|---|
| 女教皇 (high_priestess) | ココロ+1（既存能力計算経路を再利用、maxSolarEnergy等の副作用も既存パターンに準拠） | 常に成立 |
| 女帝 (empress) | カラダ+1（maxHp/現在HPへの副作用も既存パターンに準拠） | 常に成立 |
| 戦車 (chariot) | ハヤサ+1（敵の行動ゲージリセット等の副作用も既存パターンに準拠） | 常に成立 |
| 力 (strength) | チカラ+1 | 常に成立 |
| 運命の輪 (wheel_of_fortune) | 4能力から等確率で1つ選び+2（`state.combatRngState`を1回消費） | 常に成立 |
| 恋人 (lovers) | SOLを最大まで回復 | SOL満タン時は不成立 |
| 吊るされた男 (hanged_man) | LIFEとSOLを整数交換（各最大値でclamp） | 交換結果が完全に無変化なら不成立 |
| 死神 (death) | LIFEを0、SOLを最大に | 常に成立（SOL満タン時も可） |

## judgementの自動発動仕様

通常使用コマンドには接続されない（`useMode: 'automatic'`のため`applyCardUse`が防御的に拒否）。所持中にLIFEが0になった瞬間、死亡確定より先に判定される。1回の死亡につき1枚のみ消費し、LIFEを最大まで回復して`alive`を復旧する。封印中でも発動する。

## resolveDeathIfDefeatedによる共通死亡解決

`turn.ts`に`resolveDeathIfDefeated(state, events)`を新設し、以下すべてのタイミングから同一関数を呼ぶ形で一元化した。

- `applyDeathCardUse`／`applyHangedManCardUse`内、`alive=false`設定の直後
- `processTurn`終端の共通確認点（敵攻撃・毒・飢餓が原因の場合）

死因ごとにjudgement専用処理を複製していない。プレイヤーが既に生存中の呼び出しは即returnする冪等な設計。

## judgement復活後も敵フェーズが続行されること

死神・吊るされた男の効果直後にこの共通関数を即座に呼ぶことで、judgementによる復活がそのターンの敵フェーズ（`resolveEnemiesAction`）実行前に完了する。復活した場合は同一ターン内で通常どおり敵が行動する。判定なしで死亡が確定した場合は`resolveEnemiesAction`冒頭のガード（`if (!state.player.alive) return`）により敵行動・毒・飢餓処理を行わず、通常のgameoverへ進む。

## 同一ターン内でも独立した死亡ごとにjudgementが発動すること

「1ターンにつきjudgement1回」という制限ではなく、「1回の死亡判定につきjudgement1枚」が制限単位であることをテストで固定した。judgement2枚所持・死神使用・強敵隣接という状況で、死神による1回目の死亡→judgement1枚消費で復活→同一ターンの敵フェーズで再度致死ダメージ→2回目の独立した死亡→judgement1枚消費で再復活、という2回の独立死亡・2回のjudgement発動を確認している。

## 使用成功時1ターン、拒否時0ターンであること

8種すべての成功時、`processTurn`呼び出し1回につきターンが正確に+1進むことをテストで確認。封印拒否・未実装カード拒否・SOL満タン不成立・吊るされた男の無変化不成立、いずれもターン+0。judgementの自動発動自体は追加ターンを発生させない（トリガーとなった1アクション分のみ）。

## 床アイテムのfloor別weight付き抽選

既存の`ITEM_IDS_IN_ORDER`（Inventory表示順）・`GROUND_ITEM_POOL_FLOOR_*`（床loot候補、既存の非カードitemのみ）とは独立に、`item-def.ts`へ`getWeightedGroundItemPoolForFloor`・`drawWeightedGroundItemSelection`・`CARD_GROUND_POOL_FLOOR_1/2/3_ADDITIONS`を新設した。

床出現対象9種の仮weight：lovers=4, hanged_man=3, judgement=1, high_priestess=1, empress=1, chariot=1, strength=1, death=2, wheel_of_fortune=1（floor1={lovers, hanged_man, judgement}、floor2追加={high_priestess, empress, chariot, strength, death}、floor3追加={wheel_of_fortune}）。既存の非カードitemは各weight10で相対的な均等性を維持。未実装8種はfloorDropEnabled=false、lootWeight=0のまま。敵ドロップは17種すべてenemyDropEnabled=falseで、実装していない。

`state.ts`の実際の床item抽選は`drawWeightedGroundItemSelection`のみを呼ぶ（旧`drawGroundItemSelection`はproduction経路からは呼ばれず、item-def.ts自身とテストにのみ残る互換API）。1個の床item抽選につきRNG消費は正確に1回。同一seedでの決定性、100seed規模での生成失敗なしをテストで確認済み。

## 実装したイベントとメッセージ表示

`events.ts`：`item_picked_up.unidentifiedCard`（未鑑定カード取得時のフラグ）、`card_used`、`card_use_failed`（reason: `sealed`/`not_implemented`/`no_valid_target`/`no_effect`）、`card_identified`、`judgement_triggered`を新設。`message-log.ts`・`main.ts`（Inventory一覧・詳細・item_actions画面）で未鑑定カードの真名を秘匿する表示経路を実装した。

## 変更ファイル概要

**production code**：`card-def.ts`（9種のweight/floorDropEnabled更新）、`effects.ts`（`sealed`追加）、`events.ts`（新規イベント型）、`item-def.ts`（重量抽選機構）、`message-log.ts`（未鑑定表示）、`state.ts`（identifiedCardIds carry-over、weight抽選呼び出し）、`turn.ts`（カード使用トランザクション・審判割り込み・共通死亡解決関数）、`types.ts`（`identifiedCardIds`、`EffectId`拡張）、`main.ts`（Inventory表示の未鑑定対応）

**テスト**：新規`phase-20-core-loop.test.ts`（69件）、既存4ファイルの機械的更新（`item_picked_up`イベント形状変更への追従、Phase20.0a後の状態への追従）

## 最終テスト件数、typecheck、build、git diff --checkの結果

- `phase-20-core-loop.test.ts`：69件全通過
- 全テストスイート：86ファイル、2048件、全通過
- `npx tsc --noEmit`：成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## バージョン

`CURRENT_GAME_VERSION`は`phase-19`のまま、`schemaVersion`は7のまま。Phase 20全体は未完了のため、このcommitではいずれも更新していない。

## 未実装カード8種

`emperor`（皇帝）、`justice`（正義）、`temperance`（節制）、`devil`（悪魔）、`tower`（塔）、`star`（星）、`moon`（月）、`sun`（太陽）。定義（`CardDefinition`/`ITEM_DEFINITIONS`）のみ存在し、効果・使用処理・床出現のいずれも未接続。使用は常に不成立、床には出現しない。

## 未着手の範囲

- Phase 20.0c（装備個体化・refineLevel・呪い最小実装）
- Phase 20.0d（対象選択UI基盤）
- Phase 20.4（部屋範囲効果：正義・悪魔・塔）
- Phase 20.5（対象選択効果：節制・星・月・太陽）

## 後続フェーズで必要な作業

- 20.0c／20.0dの実装（節制・星・月・太陽が依存）
- 上記依存関係が整い次第、20.4・20.5の実装
- 出現率・効果数値の最終調整（Phase 27予定、現在は全て仮値）
- 敵ドロップ経路の実装（現状production未実装のまま）
