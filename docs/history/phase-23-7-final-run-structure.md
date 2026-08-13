# Phase 23.7 — 3フロア完成版ラン構成の確定

## 起点commit・branch・precheck

- base branch: `origin/phase-23-6-enemy-roster-floors`
- base commit: `d21e3893ce4da5045ee77af1e616efd6cd088bb9`
- 作業branch: `phase-23-7-final-run-structure`（base commitから新規作成）
- precheck結果：working tree clean、HEAD/`origin/phase-23-6-enemy-roster-floors`が指定commitに一致、`origin/main`が`80596cd5334294255a439cb79db375f622193c50`に一致、同名branch（local/remote）なし。すべての事前条件を満たして開始した。

## 3フロア正式採用の判断

Phase 23.6で確定した1F/2F/3Fの敵ロスター（4/8/12種累積）を前提に、現行3フロアを短編ローグライクの正式な1ラン構成として確定した。4F以上への延長は、現行`ENEMY_COUNT_BY_FLOOR`外のfallback値（2体）、追加の敵Lv2/Lv3・boss・装備拡張が未実装のまま内容を薄めることになるため見送り、`TOTAL_FLOORS`は変更していない。

## 序盤・中盤・終盤の役割

| フロア | 位置づけ | 役割 |
|---|---|---|
| 1F | 序盤 | 基本操作、基礎戦闘、食料・装備・属性導線の開始 |
| 2F | 中盤 | 位置取り、速度差、壁抜け、予告攻撃への対応 |
| 3F | 終盤 | 高火力、突進、広範囲攻撃を含む全ロスター環境 |

## 敵poolと6/7/8体

- `ENEMY_COUNT_BY_FLOOR`（`mapgen.ts`）：1F=6体、2F=7体、3F=8体（既存値、変更なし）。
- `ENEMY_FIRST_APPEARANCE_FLOOR`/`getEnemyPoolForFloor`（`enemy-def.ts`）：1F=4種、2F累積8種、3F累積12種（Phase 23.6のまま、変更なし）。

## item数・食料保証

- `GROUND_ITEM_COUNT_WEIGHTS`（`item-def.ts`）：2〜6個、weight合計100、期待値4.0（既存値、変更なし）。
- 1Fのchocolate最低1個保証、enchantment再抽選禁止などの既存preserve項目も変更なし。

## trap構成

- slow_trap/poison_trapとも各floor最大1個（Phase 12.2/12.3の既存実装のまま）。1000seed監査でも各floorで最大1個の配置を確認。

## dark room構成

- `chooseDarkRoomIndex`（`dark-rooms.ts`）：開始・出口部屋を除外し、決定的hashで各floor最大1室を選択（Phase 17.2の既存実装のまま、変更なし）。1000seed監査では有効な部屋が存在する限り、全floorで1室が選ばれることを確認。

## monsterHouse正式baseline

- `MONSTER_HOUSE_ELIGIBLE_FLOORS` = {2, 3}（`monster-house.ts`、既存値）
- `MONSTER_HOUSE_OCCURRENCE_PROBABILITY` = 0.2（既存値）
- `computeMonsterHouseEnemyCount`：`N = clamp(ceil(sqrt(C)), 4, 8)`（既存式）
- `MONSTER_HOUSE_REWARD_COUNT` = 3（既存値）
- 上記4つはいずれも数値・式を変更せず、コメントのみ「Phase 21の暫定値」から「Phase 23.7で確定した最終baseline」の説明へ更新した（`monster-house.ts`の`MONSTER_HOUSE_ELIGIBLE_FLOORS`・`MONSTER_HOUSE_OCCURRENCE_PROBABILITY`・`MONSTER_HOUSE_REWARD_COUNT`宣言部）。

## 階段・Victory条件

- 階段はフロア生成時点から使用可能。プレイヤー自身の成立した`move`によって階段以外のマスから階段マスへ入った場合のみ`floor_cleared`（1F/2F）または`victory`（3F）へ遷移する（`turn.ts`の`actualMoveHappened`/`reachedExit`判定、Phase 22の既存実装のまま）。
- 階段到達ターンに死亡した場合は`gameover`が優先される（`turn.ts`の`playerDefeated`優先分岐、既存実装のまま）。
- 全敵撃破・鍵・boss・特定item取得はいずれも要求しない。

## 想定プレイ時間

- 標準探索：20〜30分。階段優先の短縮プレイは15分以内になり得る。
- 実プレイ時間はheadless環境で確定できないため、seed監査では最短経路長・部屋数・配置量を実測し、設計目標としてこのdocへ記録する（下記1000seed監査参照）。実時間の最終評価はユーザーのブラウザ試遊へ引き継ぐ。

## 装備・太陽鍛冶とのPhase境界

- Phase 23.7時点の実装済み武器は`sword`・`spear`・`hammer`・`solar_gun`の4種のみ。太陽鍛冶・同種合成・防具15種・アクセサリー・武器27種は未実装であり、本Phaseでは一切追加していない。
- 1000run監査における各武器の少なくとも1回以上出現したrun割合（run-hit rate）：`sword`=58.6%、`spear`=45.6%、`hammer`=44.3%、`solar_gun`=57.1%（母数1000run）。装備出現率・weightは変更していない。

## 1000seed監査の全実測値

`/tmp`上の一時テストファイル経由でproduction関数（`createInitialState`/`advanceToNextFloor`/`processTurn`）を1000seed分実行した（監査script・出力JSONはrepositoryへ残していない）。

| Floor | 平均室数 | 通常敵数（全seed一致） | 平均item数（monsterHouse報酬除く） | dark room発生 | monsterHouse発生 | mh敵数 min/max | mh報酬 max | slow trap合計 | poison trap合計 | 座標衝突 | 生成例外 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1F | 7.19 | 6（1000/1000） | 4.00 | 1000/1000 | 0/1000 | - | - | 1000 | 1000 | 0 | 0 |
| 2F | 7.20 | 7（1000/1000） | 3.98 | 1000/1000 | 188/1000 | 6〜8 | 3 | 1000 | 1000 | 0 | 0 |
| 3F | 7.15 | 8（1000/1000） | 3.97 | 1000/1000 | 205/1000 | 5〜8 | 3 | 1000 | 1000 | 0 | 0 |

- run単位のmonsterHouse発生回数分布：0回=648run、1回=311run、2回=41run、少なくとも1回=352run（35.2%）。理論値（none=64%相当・at_least_one=36%相当）と近似した実測分布。
- 不正座標（マップ範囲外・非floorタイル上の配置）：全1000run×3floorを通じて0件。
- 全1000seedで生成例外0件。

## 200run通し進行結果

同じ一時監査スクリプトで、200seedについて敵を全滅させずに`processTurn`/`advanceToNextFloor`のproduction経路のみを使い1F→2F→3F→Victoryまで進行させた。

- `floor_cleared`遷移：400/400（200run × 2回）
- Victory到達：200/200
- 生成・進行例外：0件
- 1回の階段進入で2フロア以上進む不具合（multi-floor jump）：0件
- floor遷移時の同一`GameMap`参照流用（state leak）：0件検出
- 同一seedの2回生成が完全一致しない再現性失敗：0件

## 新規・更新テスト

- 新規：`src/game/__tests__/phase-23-7-final-run-structure.test.ts`（17テスト）
  - run_constants（8アサーション相当）、generated_floor_structure、three_floor_progression、optional_exploration、monster_house_run_probability、determinismの各グループを実装。
  - production公開関数（`createInitialState`/`advanceToNextFloor`/`processTurn`）のみを使用し、テスト専用のproduction分岐は追加していない。skip/todo/onlyなし。
- 既存テストの変更：なし（新規ファイルのみ追加）。

## targeted regression

以下を対象に個別実行し、すべて成功を確認した。

- `phase-23-7-final-run-structure.test.ts`（新規、17 tests）
- `phase-23-6-enemy-roster-floors.test.ts`
- `phase-22-immediate-stairs-progression.test.ts`
- `multi-floor.test.ts` / `multi-floor-robustness.test.ts` / `floor-seed.test.ts`
- Phase 21.1〜21.8 monsterHouse関連ファイル一式
- Phase 17 dark-room関連（`dark-rooms.test.ts`、`dark-room-visuals.test.ts`）
- Phase 18 clairvoyance・minimap関連
- Phase 23.1〜23.4特殊敵関連
- determinism / robustness / integration関連
- inventory / equipment carry-over関連
- message-log / telemetry関連

いずれも個別実行時点で失敗なし（最終的にはfull suiteに包含されて再確認済み）。

## full suite

`npx vitest run`：**110ファイル / 2757テスト、全通過**（失敗0、skip/todo 0）。

## typecheck・build・diff-check

- `npx tsc --noEmit`：エラーなし（clean）。
- `npx vite build`：ビルド成功（42 modules transformed、`dist/`は確認後削除しrepositoryへ含めていない）。
- `git diff --check`：問題なし（whitespace error等の検出0）。

## Phase 23全体の完了判定

`phase_completion.criteria`をすべて満たした。

- 3フロア構成が`docs/rogue-of-sun-game-concept.md`・production定数・新規テストで一致していることを確認済み。
- 配置系の暫定コメント（`monster-house.ts`のeligible floors・occurrence probability・reward count）を、値を変えずPhase 23.7確定baselineの説明へ更新済み。
- 1000seed監査で生成異常（座標衝突・不正配置・例外）0件。
- 200run通し進行でVictory 200/200、進行例外0件。
- 全テスト・typecheck・build・diff-check成功。
- 未解決の進行不能不具合なし。

よって、Phase 23全体を完了と判定する。人間の実プレイ時間・主観的難度は自動監査で確定できない事項だが、これのみを理由にPhase 23全体をBLOCKEDとはしない（`run_time_target.validation_limit`のとおり、実時間の最終評価はユーザーのブラウザ試遊へ引き継ぐ）。

## 後続Phaseへ残した事項

- 太陽鍛冶・同武器種/同ランク合成・R到達率・武器27種＋太陽銃・防具15種・アクセサリー（Phase 24以降の装備実装と最終バランスPhaseで扱う）。
- 敵レベルアップシステム（前提条件未整備のため将来フェーズへ延期、Phase 22時点から継続）。
- カードの`floorDropEnabled`（全17種`false`のまま、Phase 21以降のルート設計待ち、継続）。
- 同種装備を複数所持時にアンエクイップできない既知バグ（バックログ記録済み、本Phaseでは対象外につき未修正）。
- 将来的な4F以上への延長やboss追加は、装備・敵Lv2/Lv3実装後の別Phase判断とする。

## 指示逸脱の有無

なし。定数値・配置アルゴリズム・telemetry schema・runtime timerはいずれも変更していない。`git add`はファイル名を明示して実行し、`git add .`は使用していない。
