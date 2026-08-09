# Phase 20.1 永続成長カード

## 実施内容

女教皇・女帝・戦車・力・運命の輪の5カードについて、productionの通常カード使用経路での動作を監査し、専用テスト36件を新規作成した。基点commitは`5e79042f9bf4431b603dbefc9b328e4f2c7185ee`。

## 既存production実装の監査と流用

監査の結果、5カードの効果resolverは**前セッションの作業で既にproduction実装済み**であることが判明した（`turn.ts`の`applyCardUse`ディスパッチ、`applyAbilityGrowthCardUse`、`applyWheelOfFortuneUse`）。仕様（`rogue-of-sun-card-effects-spec.md`）と実装の間に差分はなく、test専用resolverも存在しなかった。この既存実装が要求される全ての契約を満たしていたため、production codeへの新規変更・再実装は行わず、監査結果の確認とテスト整備のみを行った。

## 5カードの効果

| カード | 効果 |
|---|---|
| 女教皇 (high_priestess) | ココロを1上げる |
| 女帝 (empress) | カラダを1上げる |
| 戦車 (chariot) | ハヤサを1上げる |
| 力 (strength) | チカラを1上げる |
| 運命の輪 (wheel_of_fortune) | カラダ・ココロ・チカラ・ハヤサから1つを等確率で選び2上げる |

いずれも常に成立し、失敗経路を持たない。

## 運命の輪のcanonical orderとRNG仕様

canonical order：`['body', 'mind', 'power', 'speed']`（カラダ/ココロ/チカラ/ハヤサ）。`state.combatRngState`（既存の共有戦闘RNGストリーム）から`rollPercent`を正確に1回呼び、0-99の結果を`Math.floor(roll/25)`で25%ずつ4分割して能力を選択。不成立時（未所持・封印）はRNGを消費しない。

## 成功時の消費、鑑定、1ターン進行

`finishSuccessfulCardUse`が対象カードを1枚消費し、`CardId`を鑑定済みにし、`card_used`イベントを発行。既存の`processTurn`パイプラインが正確に1ターン進行させる。同一`CardId`を複数所持していても消費されるのは1枚のみ（カードはstack数管理のみで個体識別を持たない）。

## stale、封印、未所持時の不成立契約

- 未所持：`applyItemUse`冒頭で`owned<=0`のため拒否
- 封印中：`isCardUseSealed`が`card_use_failed(reason:'sealed')`を発行し拒否

いずれも能力値・所持数・鑑定状態・ターン・RNGを変更しない。5カードには resolver failure（効果自体の失敗）経路が存在しない。

## 能力値と既存派生値計算の接続

能力値の正本は`state.abilities`（`getAbilities`、`ability.ts`）。カラダ上昇は`BODY_MAX_HP_PER_RANK=2`により既存の最大LIFE計算（`applyCardAbilityIncrease`内）へ、ココロ上昇は`MIND_MAX_SOL_PER_RANK=2`により既存の最大SOL計算へ反映。チカラ上昇は既存の`getPowerDamageBonus`、ハヤサ上昇は既存の`getPlayerSpeed`へ反映される。カード専用の派生値計算式は新設していない。最大値上昇は現在値の全回復を意味しない（既存のclamp規則に従う）。

## 全17カードを床・敵ドロップから除外したこと

`card-def.ts`にて、これまで`floorDropEnabled: true`だった9カード（high_priestess, empress, chariot, strength, wheel_of_fortune, lovers, hanged_man, death, judgement）を含む全17カードを`floorDropEnabled: false`へ変更した。`enemyDropEnabled`は元々全17カードで`false`のまま。`lootWeight`・`unlockFloor`（存在しない）等のアイテム出現バランス設計はPhase21以降へ延期し、今回は変更していない。

`phase-20-core-loop.test.ts`の床出現テスト3件を、いずれのカードも床候補へ出現しないことを検証する内容へ更新した。

## Phase 20.1専用テストのカテゴリ別件数

`phase-20-1-persistent-growth.test.ts`（36件、全てproduction公開API `processTurn`経由、カード効果の再実装なし）：

| category | 件数 |
|---|---|
| individual_effects | 5 |
| wheel_rng | 7 |
| persistence | 8 |
| success_contract | 9 |
| production_integration | 7 |
| **合計** | **36** |

## 全検証結果

- Phase 20.1専用36件：全通過
- Phase 20.0c専用62件：全通過
- Phase 20.0d専用74件：全通過
- phase-20-core-loop 69件：全通過
- 全通常テストスイート：89ファイル、2220件、全通過
- `npx tsc --noEmit`：成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## アイテム出現設計をPhase 21以降へ延期したこと

ランダム床アイテムのカテゴリ抽選、カテゴリ割合、カテゴリ内個別weight、カードの`unlockFloor`・`lootWeight`確定、`floorDropEnabled`の有効化、敵ドロップ実装は、いずれもPhase21以降の責務として今回実装していない。

## Phase 20.2以降へ未着手であること

恋人・吊るされた男・皇帝・死神の効果、節制・星のresolver登録、月・太陽の強化処理、正義・悪魔・塔の部屋効果、審判の死亡連動処理は、いずれも今回接続・実装していない。
