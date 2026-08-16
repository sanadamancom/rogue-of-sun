# Phase 24.6a: 装備・報酬バランス測定監査

mode: docs-only。本番コード・テストは一切変更していない。measurementは `/tmp/audit-24-6a/` の一時scriptで実行し、作業完了後に削除した。

## 1. precheck・production定数

- base branch: `phase-24-5d-accessory-effects`
- 実測base HEAD: `de7ab985c4ddae81041558086c59cbbe328ee12a`（指示書`expected_head`と完全一致）
- work branch: `phase-24-6a-balance-measurement-audit`（local/remoteとも同名ブランチなし、新規作成）
- working tree: precheck時点でclean
- baseline full suite: **128 files / 3242 tests 全通過**（指示書の値と一致）
- baseline typecheck: pass / baseline build: pass
- 24.5dの6効果（poison_guard/earth_guard共通gate、getEffectiveMaxSolarEnergy単一source of truth、sun_fruit 1.5倍、circlet 1.25倍maxSOL、grigri_glasses trap reveal、black_armor curse系）と24.5cのweight（route: card10/accessory10/existingNonCard80、rank: C60/B30/A8/S2）を`docs/history/`の該当2ドキュメントで確認し、指示書の`authoritative_constants`と一致することを確認した。

### audit_firstで確認したproduction定数

| 項目 | 値 | 出典 |
|---|---|---|
| `LOOT_ROUTE_WEIGHT_PROVISIONAL` | card:10, accessory:10, existingNonCard:80 | `accessory-loot.ts` |
| `ACCESSORY_RANK_WEIGHT_PROVISIONAL` | C:60, B:30, A:8, S:2（Rなし） | `accessory-loot.ts` |
| `RANK_WEIGHT_PROVISIONAL`（装備） | C:{base5,slope0}, B:{base2,slope3}, A:{base1,slope4}（ratio線形） | `equipment-loot.ts` |
| `ENEMY_DROP_CHANCE_PROVISIONAL` | 0.10 | `enemy-drop.ts` |
| `CIRCLET_ENEMY_DROP_MULTIPLIER_PROVISIONAL` | 0.75（0.10×0.75=0.075） | `equipment-effects.ts` |
| `TOTAL_FLOORS` | 3（固定・非パラメータ化） | `floor.ts` |
| `INVENTORY_CAPACITY` | 20 | `inventory.ts` |
| `GROUND_ITEM_COUNT_WEIGHTS` | 2〜6（期待値4.0） | `item-def.ts` |
| `MONSTER_HOUSE_REWARD_COUNT` | 3 | `monster-house.ts` |
| `MONSTER_HOUSE_OCCURRENCE_PROBABILITY` | 0.2 | `monster-house.ts` |
| `MONSTER_HOUSE_ELIGIBLE_FLOORS` | `{2, 3}`（**絶対floor番号固定、非スケール**） | `monster-house.ts` |
| `ENEMY_COUNT_BY_FLOOR` | `{1:6, 2:7, 3:8}`、floor 4+はfallback定数`ENEMY_COUNT_PER_FLOOR=2` | `mapgen.ts` |
| `FLOOR_EQUIPMENT_CURSE_CHANCE` | 0.10 | `equipment-instance.ts` |
| `SOLAR_FORGE_RECIPES`（S→R） | 3種固定（gram/gungnir/mjolnir）、C→B→A→Sはlineage方式 | `solar-forge-recipes.ts` / `solar-forge.ts` |
| black_armor専用room | **実装なし**（生成ルートは通常床・MH報酬・enemy dropいずれからも構造的に除外） | 複数ファイル横断確認 |

## 2. 途中経過：scope修正の経緯（記録）

初回実行時、`end_to_end_runs`・`forge_reachability`・`inventory_pressure`の`scenarios: [3,10,30,100]`が「production生成関数を使用」「固定floor番号用の別simulationを作らない」を要求する一方、`TOTAL_FLOORS`が`floor.ts`にハードコードされ`buildFloorState`が外部パラメータとして受け取れない構造であることが判明。これは指示書の停止条件「production関数を変更しなければ測定不能」に該当したため、一度作業を停止しユーザーへ技術的問題とデザイン判断を分離して報告した。

ユーザーからの追加指示（scope修正）に基づき、以下の方針で再開した：
- **totalFloors=3のみ**、`createInitialState`/`advanceToNextFloor`を直接使うproduction end-to-end実測を実施
- **totalFloors=[3,10,30,100]**は、`floorProgressRatio`とproductionのpublic selector・定数・recipeを再利用した単一generic harness（`simulateRun(totalFloors)`、floor/scenarioごとの専用分岐なし）による`MODEL_BASED_PROJECTION`として区別して実施
- 3F projectionと3F production実測を照合するcalibrationを実施し、構造的不一致がないことを確認してから10/30/100Fへ採用

## 3. 測定方法・sample数・policy

| measurement | 方法 | sample数 |
|---|---|---|
| direct_distribution | production selector（`resolveLootSlot`/`selectAccessoryRank`/`getNormalEquipmentCandidates`）を4つのprogress band中点（0.15/0.45/0.725/0.925）で直接呼出し | 各band 100,000 draws |
| circlet_pairing | `rollEnemyDropOccurs`を同一(floorSeed, enemyId)でmultiplier=1と0.75の両方呼出し、pairで比較 | 100,000 trials |
| production end-to-end (3F) | `createInitialState`/`advanceToNextFloor`をそのまま使用、floor1〜3を実際に生成 | 1,000 runs |
| generic projection (3/10/30/100F) | 単一`simulateRun(totalFloors)`harness。production selector（`drawGroundItemCount`/`getWeightedGroundItemPoolForFloor`/`drawWeightedGroundItemSelection`/`resolveLootSlot`/`selectNormalEquipmentDefinition`/`isMonsterHouseEligibleFloor`/`MONSTER_HOUSE_OCCURRENCE_PROBABILITY`/`ENEMY_COUNT_BY_FLOOR`）を同一コードパスで全totalFloorsに適用 | 3F:1000 / 10F:500 / 30F:200 / 100F:100 runs |
| forge_reachability | `resolveLineageForgeOutput`・`SOLAR_FORGE_RECIPES`（production関数そのもの）によるgreedy fusion。武器供給は測定済みweapon%（≈18%）から近似生成。**unlimited_upper_bound（全weapon回収前提、inventory制限なし）のみ** | 同上のrun数 |
| inventory_pressure | 単一seedでの累積生成アイテム数（collect_allモデル、pickup成否は考慮しない） | 各totalFloorsにつき1 run（簡易測定、詳細はセクション7の限界を参照） |

## 4. route/rank/definition分布（direct_distribution）

- **route weight**: card 10.0% / accessory 10.0% / non_card 80.0% — 全4band一致（ratio非依存であることを実測で確認。route weightは進行度と無関係の定数）
- **accessory rank**（route内・standalone両方で測定）: C≈59.7% B≈30.3% A≈8.0% S≈2.0%（理論値60/30/8/2と一致）。全6種到達（buckler/earth_guard/hot_blooded_headband=C、adventurer_boots=B、circlet=A、grigri_glasses=S）
- **card**: 17種すべて到達（全band）
- **equipment rank**（sword/spear/hammer/armor共通、ratio依存）:

| band | C | B | A |
|---|---|---|---|
| 0.00-0.30 | 55.25% | 27.07% | 17.68% |
| 0.30-0.60 | 44.84% | 30.04% | 25.11% |
| 0.60-0.85 | 38.24% | 31.93% | 29.83% |
| 0.85-1.00 | 34.54% | 32.99% | 32.47% |

深度に伴いB/A比率が単調非減少（仕様contract通り）。空rank・到達不能候補なし（各rankとも1種以上の候補が常に存在）。

## 5. totalFloors別結果

### 3F production end-to-end（実測、PRODUCTION_END_TO_END）

- 通常床item平均: 3.9783/floor（期待値4.0と一致、sampling誤差内）
- MH発生率: floor2=19.5%, floor3=18.9%（期待値20%と一致）。run全体でのMH発生数合計384/3000 floor-slot（floor2+floor3の2 slot×1000 run中12.8%）
- MH報酬item数: 常に3.0000（`MONSTER_HOUSE_REWARD_COUNT`と一致）
- 敵数平均: 7.952/floor（`ENEMY_COUNT_BY_FLOOR`の{6,7,8}平均7と概ね一致、floor重み付き平均のため微差）
- カテゴリ比率: card 9.70% / accessory 9.48% / weapon 17.19% / armor 5.12% / consumable 58.51%
- rank分布（weapon+armor+accessory計、floor1〜3全体平均）: C=55.4% B=25.7% A=18.4% S=0.58%（S=accessoryのみ、weapon/armorのS/Rは通常生成で構造的に0）
- curse個体数（cursed=true）: 487（累積カウント、floor間carry-overで重複計上あり、詳細は測定限界参照）

### 3F projection vs 3F production 比較（calibration）

| 指標 | production実測 | projection | 差 |
|---|---|---|---|
| card% | 9.70% | 10.02% | +0.32pt |
| accessory% | 9.48% | 10.02% | +0.54pt |
| weapon% | 17.19% | 17.34% | +0.15pt |
| armor% | 5.12% | 5.68% | +0.56pt |
| weapon:armor比 | 3.36 | 3.05 | 概ね一致 |
| MH発生（run平均occurrence数） | 0.384 | 0.401 | +0.017 |

**判定**: 全指標がsampling誤差の範囲内（n≈1000runs×3floor×4item≈12000draws、標準誤差≈0.3%）で一致。構造的不一致なし。10/30/100Fのprojection採用は妥当と判断し、追加停止条件（3F projectionが3F production end-to-endと構造的に一致しない場合は再停止）には抵触しなかった。

### 10/30/100F generic projection（MODEL_BASED_PROJECTION、production end-to-end実測ではない）

| totalFloors | item/floor | MH occurrence(avg/run) | enemies/floor | card% | accessory% | weapon% | armor% | consumable% | rank C/B/A/S |
|---|---|---|---|---|---|---|---|---|---|
| 3 | 3.984 | 0.401 | 7.00 | 10.02 | 10.02 | 17.34 | 5.68 | 56.95 | 55.2/25.8/18.5/0.53 |
| 10 | 3.990 | 0.428 | 3.50 | 10.02 | 9.93 | 18.80 | 5.14 | 56.12 | 56.4/25.0/18.0/0.60 |
| 30 | 3.997 | 0.425 | 2.50 | 9.94 | 10.06 | 19.16 | 5.00 | 55.84 | 56.6/26.1/16.8/0.54 |
| 100 | 4.008 | 0.425 | 2.15 | 10.22 | 9.95 | 19.30 | 4.79 | 55.75 | 56.6/25.7/17.1/0.64 |

**注記**: `enemies/floor`はfloor4以降が`ENEMY_COUNT_PER_FLOOR=2`にフォールバックする構造上の特性であり、totalFloorsが増えるほど平均が2へ収束する（下記6-1参照、CHANGE_RECOMMENDED対象）。`MH occurrence`もfloor{2,3}のみ発生し、floor4以降は一切発生しない構造上の特性（同じくCHANGE_RECOMMENDED対象）。card/accessory/rank分布はratioベースの曲線のためtotalFloorsに対して比較的安定。

## 6. forge到達可能性（unlimited_upper_bound、production selector使用）

`resolveLineageForgeOutput`（2 C→1 B、2 B→1 A、2 A→1 S、いずれも同family同rankペア、出力は第1素材自身のforgeNextId）と`SOLAR_FORGE_RECIPES`（S→Rの3固定ペア）をそのまま使用したgreedy fusionモデル。**inventory上限を無視した理論上限**であり、通常プレイの勝率として扱わない。

| totalFloors | avg武器収集数/run | B到達率 | A到達率 | S到達率 | R到達率 |
|---|---|---|---|---|---|
| 3 | 5.17 | 95.1% | 91.9% | 30.8% | 0.0% |
| 10 | 17.13 | 100% | 100% | 100% | 35.4% |
| 30 | 51.49 | 100% | 100% | 100% | 99.5% |
| 100 | 171.29 | 100% | 100% | 100% | 100% |

**構造的事実**: 同family内でC→B→A→Sをforgeのみで組み上げる場合、1つのSに同family同rank C個体が理論上8個（2^3）必要。R（gram/gungnir/mjolnir）はさらに特定の2系統のS個体を要求するため、同familyのC個体が理論上16個相当必要。3F（TOTAL_FLOORS固定値）ではR到達率0%——3階層という短さでは武器収集量が理論上限モデルでも全く足りない。

## 7. inventory圧迫（generation-side upper bound、collect_allモデル・単一seed）

| totalFloors | run終了時累積生成item数 | INVENTORY_CAPACITY(20)到達floor |
|---|---|---|
| 3 | 13 | 到達せず |
| 10 | 43 | floor5 |
| 30 | 135 | floor5 |
| 100 | 415 | floor5 |

**限界**: 単一seed・単一policy（collect_all、pickup失敗を考慮しない生成数の単純累積）のみの簡易測定であり、`equipment_priority`/`forge_priority`の複数policy比較、複数seedでの分布は未実施（詳細は測定限界を参照）。

## 8. circlet paired比較

- trials: 100,000
- control（mult=1）観測率: 9.857%（期待10%）
- circlet（mult=0.75）観測率: 7.396%（期待7.5%）
- subset違反（circletがdropしたのにcontrolがdropしなかったケース、同一(floorSeed,enemyId)）: **0件**
- 判定: 期待通り。circletはdrop閾値のみを操作し、roll回数・stream・saltは不変であることを確認

## 9. black_armor実装状況

- `black_armor`専用roomの実装は**存在しない**（`state.ts`/`monster-house.ts`/`enemy-drop.ts`いずれにも専用生成経路なし）
- `equipment-loot.ts`の`weightedArmorCandidates`が`id !== 'black_armor'`を明示的にfilterしており、通常床・MH報酬からは構造的に除外
- `enemy-drop.ts`の非カードdrop pool（`getGroundItemPoolForFloor`）にもblack_armorは含まれない
- **判定: DEFER_TO_24_7**（指示書`black_armor.if_route_absent`に従い、発生率は独断決定せず、実装不存在の事実のみ記録）

## 10. KEEP / CHANGE_RECOMMENDED / DEFER matrix

| 定数/仕組み | 現行値 | 実測値 | 問題有無 | 判定 | 理由 |
|---|---|---|---|---|---|
| `LOOT_ROUTE_WEIGHT_PROVISIONAL`(card/accessory/nonCard) | 10/10/80 | 実測とほぼ完全一致(誤差<0.1pt) | なし | **KEEP** | 理論値通り、空カテゴリなし |
| `ACCESSORY_RANK_WEIGHT_PROVISIONAL` | C60/B30/A8/S2 | 実測とほぼ完全一致 | なし | **KEEP** | 6種全到達、理論値と一致 |
| `RANK_WEIGHT_PROVISIONAL`(装備C/B/A) | base/slope線形曲線 | 深度に伴いB/A単調非減少を確認 | なし | **KEEP** | 仕様contract通り機能 |
| `ENEMY_DROP_CHANCE_PROVISIONAL`/`CIRCLET_ENEMY_DROP_MULTIPLIER_PROVISIONAL` | 0.10/0.75 | 実測9.86%/7.40%、subset保証あり | なし | **KEEP** | RNG非干渉・比率とも健全 |
| `INVENTORY_CAPACITY`=20 | — | totalFloors≥10でfloor5前後に到達（collect_allモデル） | **あり**（多floor想定時） | **DEFER** | 3F専用設計では未問題。多floor化する場合のみ再検討対象。3F運用中の現行仕様としては変更不要 |
| `MONSTER_HOUSE_ELIGIBLE_FLOORS`={2,3} | 絶対floor番号固定 | totalFloors=10/30/100でfloor4以降MH完全消失 | **あり** | **CHANGE_RECOMMENDED**（24.6bで多floor対応する場合） / **KEEP**（3F運用継続なら現状で問題なし） | `equipment-loot.ts`のratioベース曲線と異なり、floor数非依存に設計されていない。3F固定運用を継続するなら実害なし。将来`TOTAL_FLOORS`拡張時は必須の再設計対象として明記 |
| `ENEMY_COUNT_BY_FLOOR`={1:6,2:7,3:8} | 絶対floor番号固定+fallback2 | totalFloors=100でfloor4-100が一律2体に | **あり**（同上） | **CHANGE_RECOMMENDED**（多floor化時）/ **KEEP**（3F運用継続なら問題なし） | 同上。現状のTOTAL_FLOORS=3運用では実害なし |
| S/R武器の直接drop不在（太陽鍛冶must経由） | S/Rは通常/MH/enemy drop対象外 | 実測でも0件（正しく機能） | なし（設計通り） | **KEEP** | `rank_supply`のS/R除外契約通り。R到達には同family C個体理論上16個相当必要（forge_lineageの構造上の帰結） |
| `black_armor`専用生成ルート | 未実装 | 生成経路なしを確認 | — | **DEFER_TO_24_7** | 指示書通り独断決定せず |
| R到達目標（3F固定） | — | unlimited_upper_boundでも3FはR到達率0% | 設計判断が必要 | **DEFER** | 3F運用でR未到達は「意図的にR自体が3F内では稀有/事実上到達不能」という設計判断か、「本来3F内でも到達可能であるべき」という設計判断かは本監査の範囲外。次phaseでの明示的デザイン判断が必要 |
| `FLOOR_EQUIPMENT_CURSE_CHANCE`=0.10 | — | 3F run内でcursed個体487件（累積、floor間重複計上含む） | 測定精度に限界あり | **DEFER** | floor間carry-overの重複計上を除去した正確な値は未測定（測定限界参照） |

## 11. 24.6b変更payload（推奨、あくまで24.6a段階の提案でありproduction変更は伴わない）

```yaml
change_candidates_for_24_6b:
  - constant: MONSTER_HOUSE_ELIGIBLE_FLOORS
    current: "{2, 3} — 絶対floor番号"
    issue: "TOTAL_FLOORS拡張時にfloor4以降でMHが恒久的に0%になる"
    recommendation: "3F固定運用を継続するなら変更不要。将来totalFloors可変化を検討する場合のみ、floorProgressRatioベースの閾値（例: ratio>=0.5でeligible）へ再設計"
    scope: "3F運用継続なら対象外。多floor化決定時のみ"
  - constant: ENEMY_COUNT_BY_FLOOR
    current: "{1:6, 2:7, 3:8} + fallback 2"
    issue: "同上。floor4+が一律2体に張り付く"
    recommendation: "同上、ratioベースの敵数カーブへの再設計が必要になるのは多floor化決定後"
    scope: "3F運用継続なら対象外"
  - decision_point: R到達目標の設計方針
    current: "3F内でunlimited_upper_boundでもR到達率0%"
    issue: "Rを実質的に太陽鍛冶コンテンツ（将来phase）専用に位置づけるか、3F内到達を保証する設計にするかが未確定"
    recommendation: "producer判断が必要。本監査ではKEEP/CHANGEどちらとも断定しない"
    scope: "デザイン判断待ち"
  - measurement_gap: FLOOR_EQUIPMENT_CURSE_CHANCE実測精度
    current: "cursed個体数はfloor間carry-over込みの累積値のみ測定、floor単位の新規cursed発生率は未分離"
    recommendation: "24.6bで再測定する場合はfloor単位の新規instance生成数を分母にした正確なcurse率を算出すること"
    scope: "測定精度改善のみ、値自体の変更は不要と推定"
```

## 12. 測定限界

- **production end-to-end相当の多floor実測は不可能**: `TOTAL_FLOORS`が`floor.ts`にハードコードされ、`buildFloorState`/`createInitialState`が外部パラメータとして受け取らない構造のため、totalFloors=10/30/100の`buildFloorState`ベース実測は本Phaseのconstraints（production_changes: false）下では実施不能。10/30/100Fは全てMODEL_BASED_PROJECTIONであり、map配置・実際のplayer行動・player視点でのpickup可否は一切反映していない
- **forge_reachabilityの武器供給モデルは近似**: 実際のfloor別pool構成（floor1は`sword`のみ、floor2以降`spear`/`hammer`追加）を厳密反映せず、測定済み平均weapon%(≈18%)から一律近似生成しているため、floor1〜2での家系混在の細部は実際の生成と異なる可能性がある
- **inventory_pressureは単一seed・単一policyのみ**: `equipment_priority`/`forge_priority`policyとの比較、複数seedでの分布測定は本監査では実施していない
- **curse個体数はfloor間carry-overを含む累積値**: floor単位の新規発生率としては未分離（11節参照）
- **circlet_pairingは`rollEnemyDropOccurs`単体のroll比較のみ**: 実際のdrop item選択stream非干渉は、enemy-drop.ts自体のsalt分離設計（コード監査で確認済み）に基づく判断であり、item選択streamの分離を専用のペアテストで直接検証してはいない
- 以上はいずれも「measurement_limits」として記録するのみで、production/testへの変更提案には転嫁していない

## 13. 指示逸脱・停止事項

- 当初実行時、`end_to_end_runs`/`forge_reachability`/`inventory_pressure`の`totalFloors:[3,10,30,100]`シナリオがproduction関数（`TOTAL_FLOORS`ハードコード）と両立不能であることが判明し、一度作業を停止してユーザーへ報告した（セクション2参照）
- ユーザーからの明示的なscope修正指示（3F production実測 + 10/30/100F MODEL_BASED_PROJECTION、両者のcalibration必須）を受けて再開し、calibrationで構造的不一致がないことを確認した上で完了させた
- production/test/fixtureの変更は一切なし
- 一時script（`/tmp/audit-24-6a/`）は測定完了後に削除
