# Phase 23.6: 敵ロスター・階層別出現の確定

Phase 23.5で統合確認済みの12種を、現行3フロアを序盤・中盤・終盤の3段階として4種ずつ累積解禁方式で確定した。Phase 15〜16の低整数戦闘バランスとPhase 23.1〜23.4の特殊能力はいずれも数値変更していない。

## 1. 起点commit・branch・precheck

| 項目 | 結果 |
|---|---|
| base branch | `origin/phase-23-5-enemy-integration-audit` |
| base commit | `c4c114e622441c69deec5df1e74cbfcc476f3630` |
| work branch | `phase-23-6-enemy-roster-floors` |
| local HEAD / origin/phase-23-5 | ともに `c4c114e622441c69deec5df1e74cbfcc476f3630` で一致 |
| origin/main | `80596cd5334294255a439cb79db375f622193c50` のまま |
| working tree | clean |
| 同名branch | local/remoteともに未作成を確認 |

## 2. 12種の確定stats・EXP・affinity表

| type | hp | attack | defense | accuracy | evasion | exp | affinity | first floor |
|---|---|---|---|---|---|---|---|---|
| bok | 6 | 3 | 0 | 90 | 0 | 1 | sol weak | 1 |
| spider | 5 | 5 | 0 | 90 | 0 | 1 | all neutral | 1 |
| bat | 4 | 4 | 0 | 90 | 10 | 1 | all neutral | 1 |
| skeleton | 6 | 5 | 0 | 90 | 0 | 2 | all neutral | 1 |
| cockatrice | 8 | 7 | 0 | 90 | 0 | 2 | earth weak | 2 |
| mummy | 10 | 9 | 0 | 90 | 0 | 2 | flame weak | 2 |
| sword | 9 | 8 | 0 | 90 | 0 | 2 | all neutral | 2 |
| ghost | 6 | 6 | 0 | 90 | 0 | 2 | all neutral | 2 |
| golem | 10 | 12 | 1 | 90 | 0 | 3 | cloud weak | 3 |
| axe | 12 | 12 | 0 | 90 | 0 | 3 | all neutral | 3 |
| kraken | 12 | 10 | 1 | 90 | 0 | 3 | flame weak | 3 |
| steps | 6 | 6 | 0 | 90 | 0 | 2 | all neutral | 3 |

いずれもタスク指定の`confirmed_stats.table`と完全一致することを`ENEMY_DEFINITIONS`のproduction値と突き合わせて確認済み（新規テスト`phase-23-6-enemy-roster-floors.test.ts`の「roster」ブロックで自動検証）。数値・属性相性・behaviorType・movementTypeはいずれも変更していない。ghost/stepsのproduction内コメントは「暫定値」「Phase 23.6で再確認」という表現を「確定baseline」へ更新したのみで、数値自体は無変更。

## 3. 1F/2F/3Fの新規解禁種と累積pool

```
1F（序盤・基礎的挙動）: bok, spider, bat, skeleton                         [4種]
2F（中盤・位置取りと行動差）: + cockatrice, mummy, sword, ghost            [累積8種]
3F（終盤・高脅威と範囲制御）: + golem, axe, kraken, steps                  [累積12種]
3F以降: 全12種（累積のため4F以降も追加変更不要）
```

`ENEMY_TYPES_IN_ORDER`の順序・既存indexはPhase 23.1〜23.4時点のまま一切変更していない（`bok, cockatrice, spider, bat, mummy, golem, sword, axe, kraken, skeleton, ghost, steps`）。`ENEMY_FIRST_APPEARANCE_FLOOR`のみをタスク指定の確定表へ差し替えた。

## 4. 4/8/12構成の理由

タスクのconfirmed_spec（`objective`/`fixed_roster.tiers`）で明示された構成をそのまま採用した。1Fは低数値・基本挙動（bok/spider/bat/skeleton）、2Fは中程度の数値または位置制御能力（cockatrice/mummy/sword/ghost：ghostの壁抜けによる位置制御、cockatriceの直線凝視、mummyの隔ターン、swordの2歩追跡）、3Fは高火力・広範囲・強制移動系（golem/axe/kraken/steps：golemの突進、axeの高火力、krakenの引き寄せ、stepsの3×3範囲）という役割分担も指定どおり。これらは記録された確定仕様の適用であり、Phase 23.6独自の主観的判断は加えていない。

## 5. 通常生成とmonsterHouseの共有契約

`chooseSpecies`（state.ts、通常生成）と`chooseMonsterHouseEnemyTypes`（monster-house.ts、monsterHouse専用ロスター）は、いずれも同一の`getEnemyPoolForFloor(floor)`から一様独立抽選（`Math.floor(rng() * pool.length)`を1枠につき1回）を行う——両関数の実装ロジックは完全に同一パターンを共有しており、抽選後の個体差し替え・重み付け・確定出現・専用除外種はいずれも存在しない。重複種の抽選は禁止せず、各種の1体保証も追加していない。1000seedの実測で複数golemが同一ロスター内へ抽選されるケースを確認済み（後述10章）。

## 6. floor 2 golem例外削除

Phase 08.4由来の「floor 2でgolemが複数回抽選された場合、2体目以降をbokへ差し替える」処理は、確定テーブルでgolemがfloor 3解禁となったことで、floor 2のpool自体にgolemが含まれなくなり到達不能になったため削除した。

- `enemy-def.ts`の`getEnemyPoolForFloor`から`if (floor === 2 && !pool.includes('golem')) pool.push('golem');`を削除
- `state.ts`の`buildFloorState`から、floor===2限定のgolem重複差し替えブロック（`sawGolem`を使った`types.map`処理）を削除
- `monster-house.ts`の`chooseMonsterHouseEnemyTypes`から`golemAlreadyPresent`引数と、floor===2限定の同種差し替え処理を削除（引数は3つになった：`count, floor, rng`）
- `state.ts`の呼び出し側から`types.includes('golem')`という第4引数を削除

削除によりRNG消費回数は変更されていない（差し替え処理自体が追加の`rng()`呼び出しを一切行わない純粋な後処理だったため）。floor 2のpoolにgolemが元々存在しないため、floor 2の実際の生成結果（species構成）は変更前後で完全に不変であることを変更前後snapshot比較（9章）で確認した。floor 3ではgolemは他の11種と全く同じ扱いの通常候補になり、monsterHouseで複数golemが抽選されても差し替えは一切発生しない（10章の実測で確認）。

## 7. 鈍足追加敵フェーズの維持判断

タスクの`slow_trap_resolution.decision`（「既存仕様として維持」）に従い、Phase 12.2のmovement_slow機構自体は一切変更していない。Phase 23.5の監査時点では、この機構とテレグラフ型敵（golem/steps含む）との相互作用を「record-only」として記録するに留めていたが、Phase 23.6でこれを正式な既存契約として確定した：

> telegraphは「次の敵フェーズで実行」する状態機械なので、鈍足中の1回のプレイヤー移動内で1回目の敵フェーズに予告、追加敵フェーズに実行されることはこの契約と整合する。

`phase-23-5-enemy-integration-audit.test.ts`内の曖昧な`expect(['telegraphed', 'recovering']).toContain(...)`アサーションを削除し、以下の厳密なテストへ置き換えた：

- movement_slowが行動前から有効な状態での成立移動で、golemが同一processTurn内で`telegraphed`→`executed`→`recovering`まで確実に進むことを厳密に確認（`recovering`のみを期待）
- 同じ契約がPhase 23より前から存在するcockatriceでも成立することを確認（`gazeDirection`が同一呼び出し内で設定→解除まで進む）
- 通常速度（movement_slowなし）では、golemの予告と実行が別々のprocessTurn呼び出しに分かれることを維持確認

telegraph専用の追加フェーズ抑止フラグは追加していない。`processTurn`/`resolveEnemiesAction`の再設計は行っていない。movement_slowの効果は弱体化していない。予告状態の判定基準をプレイヤー入力回数基準へ変更していない。

## 8. RNG消費と決定性

`getEnemyPoolForFloor`のfloor-2 golem push処理削除は`rng()`呼び出しを含まない純粋な後処理の削除であり、RNG消費回数・順序に影響しない。`chooseSpecies`/`chooseMonsterHouseEnemyTypes`はいずれも1枠につき正確に1回`rng()`を呼ぶことを新規テストで確認済み。既存のspeciesRng・placementRng・monsterHouse用RNGストリームのXOR定数はいずれも変更していない。

## 9. 変更前後snapshot比較

base commit（変更前）とwork branch（変更後）それぞれで、代表10seed（1, 2, 3, 5, 8, 13, 21, 42, 100, 12345）×floor 1〜3について、以下を`/tmp`上のスクリプト経由でJSON比較した（repositoryへsnapshotファイルは追加していない）。

- map terrain
- rooms
- start / exit
- 通常敵の配置座標（種別は含めず座標のみ）
- trap配置
- ground item配置
- monsterHouse発生判定・対象部屋（roomIndex, status）
- monsterHouse敵の配置座標
- monsterHouse報酬

**結果：変更前後のJSON出力は完全にバイト単位で一致（`diff`で差分0）**。座標系・地形生成・トラップ・アイテム・monsterHouse発生判定・全ての座標決定は今回の変更（floor-2 golem例外削除、`ENEMY_FIRST_APPEARANCE_FLOOR`変更）から一切影響を受けていないことを実測確認した。変化するのは通常敵・monsterHouse敵の**species**のみであり、これは意図した変更（`expected_to_change`）どおり。

## 10. 1000seed以上の分布実測

seed 1〜1000で、floor 1〜3それぞれの通常生成・monsterHouse生成の敵種構成を集計した（`/tmp`上のスクリプト経由、repositoryへ追加ファイルなし）。

**受け入れ基準結果**：
- illegal species（そのfloorのpoolに含まれない種の出現）：**0件**
- 生成例外：**0件**
- 各legal speciesが測定範囲内で少なくとも1回出現：**達成**（下表参照）

**通常生成の出現個体数（floor 1〜3合計、3000floor分）**：
```
bok: 3030, cockatrice: 1534, spider: 2971, bat: 3129, mummy: 1561,
golem: 650, sword: 1524, axe: 706, kraken: 670, skeleton: 3005,
ghost: 1555, steps: 665
```

**各種が出現したfloor番号の集合**（通常生成）：
```
bok/spider/bat/skeleton: {1,2,3}（1F解禁のため1Fから出現）
cockatrice/mummy/sword/ghost: {2,3}（2F解禁のため2Fから出現、1Fには一切出現せず）
golem/axe/kraken/steps: {3}（3F解禁のため3Fのみ出現）
```

**monsterHouse生成でも同一パターン**を確認（floor 1にはmonsterHouseが出現しない既存仕様のため、monsterHouseの出現floorは{2,3}または{3}のみとなる点を除き、通常生成と完全に同じfirst-floor境界を守っている）。

**同一floorロスター内の重複数分布**（通常敵、複数floor合算）：1体のみ8801件、2体重複3998件、3体重複1094件、4体重複195件、5体重複27件、6体重複1件——重複種の抽選を制限なく許可していることを確認（各種の1体保証を追加していない要件どおり）。

出現率の統計値そのものを厳密な単体テスト期待値にはしていない（実測値の記録のみ、確率の許容幅判定は行っていない）。

## 11. 新規・更新テスト

### 新規テスト
`src/game/__tests__/phase-23-6-enemy-roster-floors.test.ts`：25件、全通過。ロスター（stats/EXP/affinity/first-floor確定表との一致）、floor pool（0以下は空、1F=4種、2F=8種、3F=全12種、4F以降も12種、累積性、各種のfirst-floor境界）、一様抽選（境界写像、重複許容、golem非差し替え、RNG消費1回/枠、決定性）、通常生成（敵数6/7/8、pool内包、floor1での中終盤種非出現、floor3での全種出現）、monsterHouse契約（同一pool、golem非差し替え、RNG消費1回/枠、引数3つへの整理確認）をカバー。

### 更新した既存テスト
- `floor-enemy-pools.test.ts`：pool期待値を確定4/8/12構成へ全面更新、floor-2 golem例外を前提とした記述を削除、floor0以下の空pool確認を追加
- `armor-and-golem.test.ts`：「floor 2 golem availability」ブロックを「floor 3 golem availability」へ全面書き換え（golemの新しいfirst-appearance floorに合わせて2フロア分advanceする形に変更、複数golem許容の確認を追加）
- `phase-21-4-monster-house-enemy-placement.test.ts`：`chooseMonsterHouseEnemyTypes`の4引数呼び出し（`golemAlreadyPresent`）を3引数へ更新し、golem非差し替えを確認するテストへ書き換え
- `phase-23-3-ghost-wall-phasing.test.ts`：ghostの2F出現テストを「1Fに出ない・2Fに出る」の確定期待値へ更新
- `phase-23-5-enemy-integration-audit.test.ts`：曖昧な鈍足追加フェーズテストを厳密な確定契約テストへ置換（7章参照）

テストの削除・skip・only・曖昧な包含アサーションへの緩和は一切行っていない。

## 12. targeted regression

`phase-23-6-enemy-roster-floors.test.ts`、`phase-23-5-enemy-integration-audit.test.ts`、`floor-enemy-pools.test.ts`、`enemy-roster-foundation.test.ts`、`phase-15-5-enemy-count-by-floor.test.ts`、monsterHouse Phase 21.1〜21.8、Phase 12.2 slow trap、enemy-behavior全種、Phase 23.1〜23.4専用テスト、determinism/robustness/multi-floor、affinity/combat stat/experienceを個別実行し全通過を確認した上で、全件テストへ統合した（13章）。

## 13. 全テスト結果

`npx vitest run`：**109ファイル・2740テスト、全通過**。

## 14. typecheck・build・diff-check

- `npx tsc --noEmit`：成功
- `npx vite build`：成功（`dist/assets/index-Rbp7f1CY.js` 1,637.32 kB、既存のチャンクサイズ警告のみ）
- `git diff --check`：問題なし

## 15. Phase 23.7への実測引き継ぎ

- 3フロア通しで各種へ遭遇したrun割合：1000seedの実測で全12種が測定範囲内で最低1回出現（10章）。1回のランで全種が必ず出現する保証はない
- 各floorの平均重複数：dupDistribution実測（10章）で1体のみが最多（8801件）、6体重複も1件観測——重複許容の分布傾向として記録
- monsterHouse込みの平均敵数：通常敵6/7/8体（`ENEMY_COUNT_BY_FLOOR`、変更なし）＋monsterHouse発生時のみ追加（発生率・敵数4〜8・報酬3個は今回変更なし）
- 1F/2F/3Fの役割構成：2章・4章の確定表のとおり（序盤=基本挙動、中盤=位置取りと行動差、終盤=高脅威と範囲制御）
- 現行6/7/8体が完成版ランに適切か：Phase 23.6では判断していない（Phase 23.7で決定）
- 20%・4〜8体・報酬3個のmonsterHouse暫定値：今回変更なし、実測のみ10章に記録
- 暗所・罠・アイテムとの配置密度：今回調査・変更していない
- 現行TOTAL_FLOORS=3：変更していない

Phase 23.6では上記の実測値と判断材料のみを残し、完成版ランの最終フロア数・総敵数の再調整・monsterHouse発生率/敵数/報酬数・暗所/罠/アイテムの階層別配置率・クリア条件・想定プレイ時間のいずれも決定していない（Phase 23.7の範囲）。

## 16. 指示逸脱の有無

指示に従わなかった点はない。TOTAL_FLOORSは変更していない。敵数6/7/8は変更していない（`ENEMY_COUNT_BY_FLOOR`無変更）。敵stats・EXP・affinityは変更していない（2章の確定表と完全一致）。敵AI・状態機械は変更していない。敵出現重み・確定出現・重複禁止は追加していない。新規敵・敵Lv2/Lv3・boss・eliteは追加していない。monsterHouse発生率・敵数・報酬は変更していない。鈍足システムは再設計していない（既存仕様として維持、7章）。コカトリス飛行・Phase25のVFXは実装していない。新規RNGストリームは追加していない。telemetry schemaVersionは変更していない。アセットは変更していない。無関係なリファクタリング・コメント掃除は行っていない。mainは変更せずPRも作成していない。
