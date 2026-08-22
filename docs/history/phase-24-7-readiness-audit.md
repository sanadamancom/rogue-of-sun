# Phase 24.7 readiness audit: 黒の鎧専用封印部屋・番人

mode: docs-only。production code、test、fixtureは変更していない。

## 1. precheck

- base/work branch: `phase-24-6b2a2-availability-regression-coverage`
- base HEAD: `c27e454fbf761da1b563ce38bfe5be623e671f6c`
- audit開始時のworking tree: clean
- `npm ci`: 成功（47 packages installed）。既知の監査結果は6 vulnerabilities（moderate 3 / high 2 / critical 1）であり、本docs-only auditでは依存更新を行わない。
- `npx tsc --noEmit`: 成功、error 0
- `npx vitest run`: 145 files / 3550 tests、全件pass

## 2. 既存契約と実装境界

設計正本 [`rogue-of-sun-development-plan.md`](../planning/rogue-of-sun-development-plan.md) §7・§12、および [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §13・§16から、次を確定契約として扱う。

- 対象は`leg === 'descent'`かつdepth 19～25（両端を含む）。ascentおよびdepth 26は対象外。
- 封印部屋は1run最大1室。floor保証、天井、pityは設けない。
- 封印部屋判定には専用RNG streamを使う。
- `black_armor`は通常床落ち、通常敵drop、通常monster house報酬、Star変換、太陽鍛冶へ混ぜず、このevent限定とする。
- 報酬は番人を撃破したときだけ確定する。部屋への侵入、発見、floor離脱では付与しない。
- superseded資料にある「進行度70%以上」は現行26F固定runでは独立gateとして採用しない。正本の固定depth 19～25が現在のavailability契約である（19/26は約73%）。

production側の自然な接続点は、24.6c4c/24.6c4dと同じ`depth`＋`leg`入力を持つfloor構築である。run上限を守るため、GameState/carryへ「このrunですでに封印部屋を生成したか」を保持する必要がある。後続の24.8 saveではこの状態も保存対象に含める。

## 3. 番人設計

### 3.1 repositoryから導ける候補

新規speciesや新規statsを追加せず、既存`golem`を番人として再利用する案を第一候補とする。

- `golem`は既存のconstruct/heavy役で、HP 10、attack 12、defense 1、accuracy 90、evasion 0、EXP 3、`golem_charge`を持つ。封鎖された希少防具の守護役として既存の役割と外見を説明しやすい。
- canonical `ENEMY_DEPTH_DEFINITIONS`上もappearanceは15～26で、封印部屋の全対象depth 19～25に合法である。
- levelは独自固定値を作らず、`getEnemyLevelBandForDepth('golem', depth)`の現行band/weightを使う案が最小である。19FはLv1 100%、20～23FはLv1/Lv2 = 30/70、24～25FはLv2/Lv3 = 70/30となり、`applyEnemyLevelMultiplier`、EXP、既存combat/AIをそのまま通る。
- 通常spawn rosterとは別のdedicated guardian instanceとし、通常敵数や通常spawn RNGを置換・消費しない。`spawnSource`にはguardianを識別できる値を追加し、通常golem撃破と報酬triggerを混同しない。

ただし、正本は番人の種類・戦闘性能をPhase 24.7で決める事項として明記しており、repositoryだけから採用を確定できない。

- **NEEDS_DESIGN_DECISION: guardian species** — 上記の既存`golem`再利用案を採用するか、新規guardian speciesを設計するか。新規speciesを選ぶ場合はHP/attack/defense/accuracy/evasion/EXP、AI、traits、affinity、spriteまで別途決定が必要であり、このauditでは値を捏造しない。
- **NEEDS_DESIGN_DECISION: guardian level policy** — `golem`採用時にcurrent-depth canonical bandから通常weightで1回抽選する案を採用するか、固定level等の専用ruleを持たせるか。後者は新しい戦闘性能の決定になる。

## 4. 封印部屋構造

### 4.1 推奨する最小構造

既存map生成後の通常roomをspecial-roomへ昇格させる方式を推奨する。別map断片の後付けや到達不能な隔離領域を新設せず、既存のconnectivity保証を維持する。

候補roomは次のpure filterで抽出する。

1. start room、exit room、Otenco用reserved room、既にspecial-room tagを持つroomを除外する。
2. room内floor cellがguardian、中央報酬、player侵入を同時に安全配置できる広さを持つものだけにする。実装候補は内寸5×5以上。
3. room connection graph上の次数が1のleaf roomだけにし、唯一の入口を封印部屋の入口とする。全体mapから切り離さず、通常経路の通過必須roomにしない。
4. guardianは入口と報酬の間、報酬`black_armor`はroom奥側へ配置する。room内には通常敵、通常item、罠、stairsを置かず、通常配置側がこのspecial roomを除外する。

通常roomとの違いは専用tag、leaf接続、専用guardian/reward、通常配置除外である。monster houseとの違いは、入室時の複数敵生成・通常loot報酬ではなく、常設の単一guardianを倒すまで専用報酬が成立しない点である。「sealed」の視覚・通行表現は既存doorway規則を壊さず、入口tileまたはroom境界の表示状態として持つのが安全である。

### 4.2 monster houseとの排他

24.6c3a1の現行monster-house候補抽出はstart/exit roomを除外する。repositoryを再確認した時点ではOtenco room/tag自体は24.8待ちでproduction未実装であり、「既存special-room tag除外」の実装はまだ存在しない。したがって24.7では、start/exit除外という既存patternを共通special-room exclusionへ拡張し、24.8のOtenco roomも同じ契約へ参加できるよう選択順を明示する。

- 封印部屋候補を先に専用RNGで判定・選択し、選ばれたroom indexへspecial-room tagを付ける。
- monster houseの`extractMonsterHouseCandidateRooms`は、そのtagを持つroom（および将来のOtenco reserved room）を候補から除外する。
- 封印部屋が生成されなかったfloorでは、既存monster-house候補集合・RNG consumption・生成結果をbyte-identicalに保つ。
- 封印部屋が生成されたfloorだけは、その1室をmonster-house候補から除く。両special roomが同一roomを共有することはない。

- **NEEDS_DESIGN_DECISION: sealed-room geometry/interaction** — 内寸5×5以上の既存leaf room昇格案、入口を実際にblocking doorとして扱うか単なる専用表示にするか、guardian撃破前の報酬pickupを物理的にどう防ぐかは正本未確定である。上記は実装候補であり、承認前にproduction値・挙動として固定しない。

## 5. 発生確率とRNG契約

provisional定数を`p = 0.05`（eligible floorごとに5%）とする。19～25Fの7回すべてを訪れ、まだ生成済みでない場合のrun内出現率は`1 - 0.95^7 = 30.17%`。R rankを標準結果にせず、現行monster houseのfloor確率5%とも整合する出発点である。最終値ではなく、24.7d measurementで到達率・取得率を測って調整する。

判定順は`leg/depth` eligibility → run生成済みflag → 構造候補抽出 → occurrence roll → room selectionとする。対象外、生成済み、候補なしではRNGを消費しない。候補ありのeligible floorでは専用streamからoccurrenceを1回、成功時のみroom selectionを1回消費する。

専用streamは既存のfloor seedから未使用の固定saltをXORして`createRng`する、24.6c4a・monster house・`generation-audit.ts` candidate-checkと同じ方式を使う。saltの衝突検査をtestで固定し、通常map/enemy/item/trap/sunlight/monster-house各streamへ呼出しを追加しない。機能off、対象外floor、抽選失敗時には、24.7前のGameState（新しいmetadata fieldを除く）と既存生成物をbyte-identicalにする。

1run最大1室は、成功したroom選択時にrun-persistent flagを立て、その後の対象depthでは判定しないことで保証する。floor/ceiling/pity、25F強制生成、失敗回数補正は追加しない。

## 6. 報酬契約

guardian instanceのdeath resolutionが成立した1回だけ、対応する封印部屋の予約位置へ`black_armor`のEquipmentInstance/GroundItemを生成する。inventoryへ直接付与せず、pickup前にfloorを離れた場合の救済や再生成は行わない。通常golem等、同speciesの別instance撃破では発火しない。多重death処理、追加damage、再入室でも重複生成しないstateを持つ。

`armor-def.ts`の既存定義は`armorValue: 12`、`rank: 'R'`、`effectId: 'black_armor_curse'`であり、このrouteと競合しない。既存のEquipmentInstance mint、curse/effect、pickup、装備UIを再利用し、通常loot候補からの除外も維持する。保証とは「guardian撃破時に定義済み個体を1個生成する」ことであり、呪いrollの追加抽選や別rankへの変換を意味しない。

## 7. 24.7 implementation slice案

| slice | 内容 | 主なacceptance |
|---|---|---|
| 24.7a | sealed-room data/state、eligibility、run最大1室、専用RNG factoryと判定pure API | depth/leg境界、RNG消費表、salt非衝突、対象外byte-identical |
| 24.7b | special-room候補抽出・選択・map tag、start/exit/Otenco/monster-house排他、通常配置除外 | connectivity、候補なし、leaf/size invariant、多seedで重複・到達不能0 |
| 24.7c | 承認済みguardian species/levelのspawn、専用spawnSource、combat/death連携 | canonical level/stats、通常敵数/RNG不変、guardian識別と一度だけのdeath |
| 24.7d | `black_armor` EquipmentInstance生成・pickup・telemetry、分布audit | 撃破前0、撃破時1、通常route 0、pity 0、seed 1～1000の発生率/取得可能性測定 |
| 24.7e | production統合・回帰・history確定 | 19～25F descentのみ、run最大1、全test/typecheck/build、既存floorのbyte-identical gate |

24.7a着手前に§3・§4の`NEEDS_DESIGN_DECISION`を解消する。`p = 0.05`は本auditの測定開始用provisional値として確定可能で、24.7dの実測結果により定数だけを再調整する。

## 8. readiness結論

既存のdepth/leg availability、EnemyLevel、EquipmentInstance、special-room候補排他、独立RNGの各patternを再利用できるため、architecture上の阻害要因はない。一方、番人species/level policyと封印部屋の最終geometry/interactionはrepositoryから導けないproduct/game-design判断である。これらを解消後、上記slice順でPhase 24.7を開始できる。
