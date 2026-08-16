# Phase 24.6b0: depth tier・正規化run budget readiness audit

mode: docs-only。production/test/fixtureは一切変更していない。measurementは `/tmp/audit-24-6b0/` の一時script（tsx経由でproduction定義をdumpするだけの読み取り専用script）で実行し、作業完了後に削除する。

## 1. precheck

- base branch: `phase-24-6a-balance-measurement-audit`
- base HEAD: `7b2096f53587e26a2758bf757262ddffa9b33e1f`（一致確認済み）
- work branch: `phase-24-6b0-depth-tier-budget-audit`（local/remoteとも重複なし、新規作成）
- baseline: `npm ci` → `npx tsc --noEmit`（0 error）→ `npx vitest run`（128 files / 3242 tests、全pass）— 指示のbaseline（128 files / 3242 tests）と完全一致
- working tree: precheck時点でclean
- 24.6a production定数・historyとの不整合なし（`docs/history/phase-24-6a-balance-measurement-audit.md`確認済み）

## 2. シレン型availability方針（確定設計）

三軸を明確に分離する。

- **runDepthTier**（`short | standard | deep`）: そのrun全体で出現可能なitem/enemy/eventの**候補集合**の上限。10F/30F/99Fという固定floor数ではなく、run設定として選ばれる列挙値。
- **progress**（`floor / totalFloors`、`floorProgressRatio`として既にequipment-loot.tsに実装済み・floor数非依存）: コース内での相対深度。解禁時期・rank/rarity重み・敵能力・event帯を連続的に制御する。
- **runBudget**: コース全体での累積供給量。floor数への単純比例ではなく、runDepthTierごとのtotalBudgetをprogressで按分する。

**eligibility model**（候補の共通field案）:

```
minimumRunDepth: 'short' | 'standard' | 'deep'
unlockProgress: 0..1
eligible = (runDepthTier >= minimumRunDepth) && (progress >= unlockProgress)
```

`ItemDefinition`共通fieldとして持てるかを監査した結果:
- weapon/armor/accessory/card/consumableのいずれも「1つのdefinitionが1つのminimumRunDepth+unlockProgressを持つ」で表現可能（複数routeで別々の解禁基準を持つ必要は現状の設計に見当たらない）。
- forge recipe・固定報酬・eventは対象外でよい（forgeはplayerの能動的行為であり生成候補ではない。固定報酬・eventは本audit時点で生成route化されたものが存在しない）。
- enemy drop/monsterHouse/Star変換候補は、いずれも既存の`equipment-loot.ts`/`card-loot.ts`/`accessory-loot.ts`が持つ「rank/rarity単位の重みテーブル」をそのまま流用しており、eligibilityは同一モデルで再利用できる。
- `maximumProgress`（深層での除外)は、現行の全item/route監査で**必要な候補が1件も見つからなかった**（深くなるほど供給が減る設計は現状存在しない）。将来対応だけのため、今回は追加しない。

## 3. 全item/route matrix

`ITEM_DEFINITIONS`は78 ItemId（weapon 28・armor 15・accessory 6・card 17・consumable/enchantment 12）。全件を1回ずつ収録。

凡例:
- routes: N=通常floor生成, M=monsterHouse報酬, E=enemy drop, F=solar forge, — =現状route無し
- availability: 3節の分類
- economy: POWER_BUDGET / SUSTAIN_RATE / ENCOUNTER_RATE / STRUCTURAL / NOT_APPLICABLE

### 3.1 武器（weapon, 28件）

| ItemId | family | rank | routes | 現行floor制限 | availability分類 | unlockProgress目安 | economy | reason |
|---|---|---|---|---|---|---|---|---|
| sword | sword | C | N,M,E | floor1〜 | CORE_SHORT | 0.0 | POWER_BUDGET | 基本武器、run成立に必須 |
| short_sword | sword | C | N,M,E | floor1〜 | CORE_SHORT | 0.0 | POWER_BUDGET | 同上 |
| flamberge | sword | B | N,M,E | なし（rank重みのみ） | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | B帯、ratio上昇で出現比増 |
| magic_sword | sword | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | 同上 |
| bushido_blade | sword | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | A帯、ratio依存で終盤偏重 |
| blood_sword | sword | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | 同上 |
| solar_sword | sword | S | F（forge only） | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | 3ルートのランダム生成には現れず、bushido_blade系列のforgeでのみ到達 |
| dark_sword | sword | S | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | 同上（blood_sword系列） |
| gram | sword | R | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | solar_sword+dark_swordのforge専用出力 |
| spear | spear | C | N,M,E | **floor2〜**（現行staged pool） | CORE_SHORT（要是正） | 0.0推奨 | POWER_BUDGET | 基本武器種、floor固定staging（`item-def.ts`のfloor<=1/===2/>=3）が現行のprogress設計と非整合 — NEEDS_DESIGN_DECISION |
| glaive | spear | C | N,M,E | floor2〜（同上） | CORE_SHORT（要是正） | 0.0推奨 | POWER_BUDGET | 同上 |
| corsesca | spear | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| ice_glaive | spear | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| grand_lance | spear | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| blood_spear | spear | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| white_queen | spear | S | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | grand_lance系列forge専用 |
| black_queen | spear | S | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | blood_spear系列forge専用 |
| gungnir | spear | R | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | white_queen+black_queen forge専用出力 |
| hammer | hammer | C | N,M,E | **floor2〜**（同上staging） | CORE_SHORT（要是正） | 0.0推奨 | POWER_BUDGET | 同spear/glaive |
| basic_hammer | hammer | C | N,M,E | floor2〜（同上） | CORE_SHORT（要是正） | 0.0推奨 | POWER_BUDGET | |
| maul | hammer | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| silver_flail | hammer | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| battle_axe | hammer | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| bloody_mace | hammer | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| dawn | hammer | S | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | battle_axe系列forge専用 |
| twilight | hammer | S | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | bloody_mace系列forge専用 |
| mjolnir | hammer | R | F | — | NON_RANDOM_ROUTE | N/A | POWER_BUDGET | dawn+twilight forge専用出力 |
| solar_gun | — | C(単独) | N,M,E | floor1〜 | CORE_SHORT | 0.0 | POWER_BUDGET | 単独候補、既存stats不変 |

### 3.2 防具（armor, 15件）

| ItemId | rank | routes | 現行floor制限 | availability分類 | unlockProgress目安 | economy | reason |
|---|---|---|---|---|---|---|---|---|
| armor | C | N,M,E | floor1〜 | CORE_SHORT | 0.0 | POWER_BUDGET | 基本防具 |
| chain_mail | C | N,M,E | floor1〜 | CORE_SHORT | 0.0 | POWER_BUDGET | |
| plate_mail | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| mail_of_sol | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| mail_of_dark | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| magic_robe | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| poison_guard | B | N,M,E | なし | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| samurai_armor | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| dragon_scale | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| skull_suit | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| ninja_suit | A | N,M,E | なし | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| light_garb | S | — | — | **NEEDS_DESIGN_DECISION** | 未定 | POWER_BUDGET | armorにはweaponのforgeNextId系列が存在せず、現行production全体でどのrouteからも到達不能（意図的留保、development-plan記載の将来フェーズ） |
| dark_garb | S | — | — | NEEDS_DESIGN_DECISION | 未定 | POWER_BUDGET | 同上 |
| spike_mail | S | — | — | NEEDS_DESIGN_DECISION | 未定 | POWER_BUDGET | 同上 |
| black_armor | R | — | — | NEEDS_DESIGN_DECISION | 未定 | POWER_BUDGET | 3ルート全てで既存に候補除外済み。到達手段自体が未実装（将来ソーラーフォージ拡張 or 専用event route想定、development-plan「将来フェーズとして明示的に留保」と一致） |

### 3.3 アクセサリー（accessory, 6件）

| ItemId | rank | routes | availability分類 | unlockProgress目安 | economy | reason |
|---|---|---|---|---|---|---|
| hot_blooded_headband | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| earth_guard | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| buckler | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| adventurer_boots | B | N,M,E | STANDARD_PLUS | 0.2目安 | POWER_BUDGET | |
| circlet | A | N,M,E | DEEP_ONLY | 0.5目安 | POWER_BUDGET | |
| grigri_glasses | S | N,M,E | DEEP_ONLY | 0.6目安 | POWER_BUDGET | weaponのSと異なり、accessoryのS(rank)は`ACCESSORY_RANK_WEIGHT_PROVISIONAL`が既にC/B/A/Sを同一の3ルートで扱っており、到達手段自体は既存 — 分類はrank相当のDEEP_ONLYで足り、NEEDS_DESIGN_DECISIONではない |

### 3.4 カード（card, 17件）

| ItemId | rarity | routes | availability分類 | unlockProgress目安 | economy | reason |
|---|---|---|---|---|---|---|
| emperor | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | card-loot.tsのrarity weightは全floor固定 — 現行は事実上progress非依存 |
| lovers | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| justice | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| hanged_man | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| devil | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| tower | C | N,M,E | CORE_SHORT | 0.0 | POWER_BUDGET | |
| high_priestess | B | N,M,E | STANDARD_PLUS | 0.15目安 | POWER_BUDGET | |
| empress | B | N,M,E | STANDARD_PLUS | 0.15目安 | POWER_BUDGET | |
| chariot | B | N,M,E | STANDARD_PLUS | 0.15目安 | POWER_BUDGET | |
| strength | B | N,M,E | STANDARD_PLUS | 0.15目安 | POWER_BUDGET | |
| temperance | B | N,M,E | STANDARD_PLUS | 0.15目安 | POWER_BUDGET | |
| wheel_of_fortune | A | N,M,E | DEEP_ONLY | 0.4目安 | POWER_BUDGET | |
| death | A | N,M,E | DEEP_ONLY | 0.4目安 | POWER_BUDGET | |
| star | A | N,M,E | DEEP_ONLY | 0.4目安 | POWER_BUDGET | |
| moon | A | N,M,E | DEEP_ONLY | 0.4目安 | POWER_BUDGET | |
| sun | A | N,M,E | DEEP_ONLY | 0.4目安 | POWER_BUDGET | |
| judgement | S | N,M,E | DEEP_ONLY | 0.6目安 | POWER_BUDGET | rank相当のS、accessoryのgrigri_glassesと同様に既存route到達可 |

card 17件の`unlockProgress`目安列は、現行`CARD_RARITY_WEIGHT_PROVISIONAL`（全floor固定）と矛盾する提案である点に注意 — 3.5節・NEEDS_DESIGN_DECISION参照。

### 3.5 消耗品・enchantment（12件）

| ItemId | routes | 現行floor制限 | availability分類 | unlockProgress目安 | economy | reason |
|---|---|---|---|---|---|---|
| apple | N | floor1〜 | CORE_SHORT | 0.0 | SUSTAIN_RATE | 食料 |
| sun_fruit | N | floor1〜 | CORE_SHORT | 0.0 | SUSTAIN_RATE | SOL回復 |
| chocolate | N（+floor1限定の初期保証, state.ts:422） | floor1〜 | CORE_SHORT | 0.0 | SUSTAIN_RATE | floor===1固定の特別保証あり — progress===0相当への置換候補（4節参照） |
| banana | N | floor1〜 | CORE_SHORT | 0.0 | SUSTAIN_RATE | 食料 |
| antidote | N | floor1〜 | CORE_SHORT | 0.0 | SUSTAIN_RATE | 状態回復 |
| panacea | N | floor1〜 | CORE_SHORT | 0.0 | SUSTAIN_RATE | 状態回復 |
| clairvoyance_fruit | N | floor1〜 | CORE_SHORT | 0.0 | STRUCTURAL | 索敵、power/sustainいずれでもない |
| sol_enchantment | N（一度きり解禁） | floor1〜 | CORE_SHORT | 0.0 | POWER_BUDGET | 属性攻撃解禁、恒久 |
| flame_enchantment | N | floor1〜 | CORE_SHORT | 0.0 | POWER_BUDGET | |
| frost_enchantment | N | **floor2〜** | CORE_SHORT（要是正） | 0.0推奨 | POWER_BUDGET | floor固定staging、NEEDS_DESIGN_DECISION（4節） |
| cloud_enchantment | N | **floor2〜** | CORE_SHORT（要是正） | 0.0推奨 | POWER_BUDGET | 同上 |
| earth_enchantment | N | **floor3〜** | CORE_SHORT（要是正） | 0.0推奨 | POWER_BUDGET | 同上 |

**総数確認**: 武器28 + 防具15 + アクセサリー6 + カード17 + 消耗品/enchantment12 = **78件**、`ITEM_DEFINITIONS`のキー数（78）と一致。分類matrixの総和一致を確認した。

## 4. 固定floor依存一覧（`floor === N` / `floor >= N` / `TOTAL_FLOORS`直接参照）

grep対象: `src/game/*.ts`（`__tests__`除く）。

| 箇所 | 内容 | 種別 | 3F互換への影響 |
|---|---|---|---|
| `floor.ts:4` `TOTAL_FLOORS = 3` | run全体のfloor数の唯一の正 | 定数 | RunConfig導入の起点 |
| `state.ts:646` `totalFloors: TOTAL_FLOORS` | GameState.totalFloorsへ既に反映済み | 既存field | 24.6b1の土台として利用可（型は既に`number`） |
| `state.ts:461` `floorProgressRatio(floor, TOTAL_FLOORS)` | progress算出、floor数非依存の式 | 既存ロジック | 変更不要、そのまま流用可 |
| `turn.ts:5457` `state.floor >= state.totalFloors` | victory判定 | 既存ロジック | 既にstate値参照、floor数非依存 |
| `item-def.ts:647-650` `getGroundItemPoolForFloor`（floor<=1/===2/>=3の3段staging） | 通常floor生成の候補pool | **構造的固定floor依存** | 是正対象。spear/hammer/frost/cloud/earth_enchantmentがfloor2/3待ちになっている |
| `item-def.ts:709-716` `getCardGroundPoolForFloor`（floor<=1/===2/>=3） | Phase 20.0e旧カード機構、card-loot.ts側コメントで「意図的に不活性（floorDropEnabled:false）」と明記済み | 死んだコード（無害） | 実質未使用、削除は本Phaseの対象外だが24.6b1以降の整理候補として記録のみ |
| `state.ts:422` `floor === 1 && !selectedItemIds.includes('chocolate')` | floor1限定の初期chocolate保証 | 固定floor依存 | `progress === 0`（またはfloor === 1相当の「run最初のfloor」概念）への置換候補、NEEDS_DESIGN_DECISION |
| `sunlight.ts:205-207` `floor === 1/2/3 → generateFloor1/2/3` | **手作りmap生成そのもの**がfloor番号直結 | 構造的（item availabilityの範囲外） | 10F/30F/99F化には別途map生成phaseが必須。本audit（item/route経済のみ）の対象外だが、runDepthTier実運用のための**前提条件**として明記（4節末尾参照） |

固定floor依存の**網羅数: 6箇所**（TOTAL_FLOORS直接定義1件を含む）。うち構造的に是正が必要なのは`item-def.ts`の2段staging（spear/hammer/frost/cloud/earth系）と`state.ts:422`のfloor===1保証。`sunlight.ts`のfloor直結map生成は本audit範囲外の別問題として切り分けた。

## 5. 三軸分類（2節のモデルに対する現行実装の適合性）

- **runDepthTier**: 現行実装に対応する概念は存在しない（TOTAL_FLOORS=3の単一値のみ）。24.6b1で`RunConfig.runDepthTier`として新規導入する。
- **progress**: `floorProgressRatio`として既に実装済み・floor数非依存。equipment-loot.tsのrank重み（C/B/A）、enemy-drop.tsのequipment解決で使用中。card/accessoryのrarity/rank重みは現状**progress非依存の固定テーブル**（3.4節参照）— 三軸のうちprogress軸を現状使っていない。
- **runBudget**: 現行実装に対応する概念は存在しない。ドロップ確率・rank重みはfloor単位の瞬間的な確率制御のみで、run全体での累積供給量を管理する仕組みはない。24.6b2以降の新規設計。

## 6. 3F互換方式比較

| 方式 | production複雑度 | test/RNG互換性 | 将来削除可能性 |
|---|---|---|---|
| A. 既存itemを当面全てCORE_SHORTとして維持 | 低（RunConfig.runDepthTierを`'short'`固定で追加するだけ、eligibility判定は常にtrue） | 高（既存rng()消費順・候補列挙が一切変わらないため3242 testsに影響なし） | 高（後続phaseでunlockProgress/minimumRunDepthを実データに差し替えるだけで、3F側のコードパスを消す必要がない） |
| B. 3F専用legacy sample configを設ける | 中〜高（3F専用分岐が本線ロジックに残り続ける） | 高（3F側は変更しないため） | 低（legacy分岐がずっと残る、将来の削除がコストになる） |
| C. 3Fをshortとして既存pool差分を許容する | 低〜中 | **低**（差分を許容する時点で既存3242 testsの一部が変わる前提になり、24.6b1が要求する「3F完全互換」に反する） |

**推奨: 方式A**。`RunConfig.runDepthTier = 'short'`をTOTAL_FLOORS=3の間デフォルト固定し、`unlockProgress`は2節のeligibility式へ供給するが、`minimumRunDepth`を全item`'short'`のまま据え置けば、実質的に現行の「floor2/3 staging」以外は完全に既存の重み抽選ロジックのまま動く。既存の`item-def.ts`のfloor staging（4節）だけは、`unlockProgress`ベースへ置き換えるか現状維持かのNEEDS_DESIGN_DECISIONが残る（7節）。

## 7. 必要state/schema/RNG

### state/type

- `RunConfig.totalFloors`: 既に`GameState.totalFloors: number`として実在（`state.ts:646`）。RunConfig型として明示的に切り出すか、GameStateのfieldをそのまま流用するかはNEEDS_DESIGN_DECISION（実装都合、経済設計には影響しない）。
- `RunConfig.runDepthTier`: 新規field。`'short' | 'standard' | 'deep'`のunion。**seed/configから導出可能**（run開始時に決定される設定値であり、GameState側で毎floor再計算する必要はない）。
- progress正本統一: `floorProgressRatio`を唯一の正とし、card-loot.ts/accessory-loot.tsのrarity/rank重みも将来的にこの関数を受け取れる形へ寄せる（現状は受け取っていない、6節参照）。
- カテゴリ別budget counter: 6節方式Aの範囲では**不要**（budget導入は24.6b2のスコープ）。24.6b2で導入する場合、floor跨ぎの累積値になるため永続state（save/load対象）が必要になる。
- event発生済みflag: 本audit範囲に該当item/eventなし（3節参照、固定報酬・event route自体が未実装）。
- difficulty multiplier: 将来の独立multiplierとして2節のeligibility/budget式には含めない（axes.rulesの明記通り）。

### save/load・telemetry影響

- `RunConfig.runDepthTier`をGameStateへ追加する場合、フィールド追加のみであり削除・意味変更を伴わないため、telemetry `schemaVersion`（現行8）のバンプ**不要**（bump基準は「フィールド削除・意味変更」のみ、union拡張は対象外 — 既存の合意通り）。
- save機構の要否は24.6b1のRunConfig設計次第だが、`totalFloors`は既に非save永続（毎回定数から再構築）であり、`runDepthTier`も同様の非永続run設定として扱える可能性が高い。ここもNEEDS_DESIGN_DECISION（save/load機構自体の有無は本Phaseで未確認）。

### RNG

- eligibility判定（`runDepthTier >= minimumRunDepth && progress >= unlockProgress`）は比較演算のみで**RNG非消費**。
- budget計算（`targetAtFloor = floor(totalBudget * progress)`）も算術のみで**RNG非消費**。
- 既存stream（`combatRngState`・`itemSelectionRng`・`equipmentDefinitionRng`・`equipmentCurseRng`・enemy-drop.tsの5 salt付きstream・card-loot/accessory-lootの5 stream）はいずれも今回のeligibility/budget設計と非干渉 — 新規streamを追加する場合も、既存パターン（floorSeed + enemyId + 専用salt）を踏襲すれば独立性を保てる。
- 6節方式Aを採用する限り、3F時点でのRNG消費順・回数は**完全に不変**（eligibility判定が常にtrueに評価されるため、既存の候補列挙・重み計算コードパス自体に変更が要らない）。

## 8. 24.6b1/b2/b3 payload

### 24.6b1（今回のaudit結果を踏まえた実装スコープ）

- `RunConfig.totalFloors`・`RunConfig.runDepthTier`の型導入（6節方式A、`runDepthTier`は`'short'`固定運用）
- progress正本統一（`floorProgressRatio`を変更せず、呼び出し側の整理のみ）
- victory/final floor判定の現状維持確認（既にfloor数非依存であることをtestで固定化）
- 3F完全互換の担保（3242 tests全pass維持）
- **除外**: item eligibility変更、budget変更（4節の`item-def.ts`floor staging是正はb1では着手しない — 7節のNEEDS_DESIGN_DECISION解消が前提）

### 24.6b2（分割実装）

- item availability（4節のfloor staging是正含む、`unlockProgress`/`minimumRunDepth`の実データ投入）
- power budget（3節POWER_BUDGET項目のrunBudget設計）
- sustain rate（3節SUSTAIN_RATE項目のfloor/turn消耗連動rate設計）
- encounter probability（monsterHouse・black_armor room等ENCOUNTER_RATE項目の`q = 1 - (1 - targetRunProbability) ** (1 / eligibleFloorCount)`式の実適用）

### 24.6b3（10F/30F/99F再測定）

- 10F/30F/99F再測定（24.6a同様の一時script測定）
- 到達不能item検出（本audit時点でNON_RANDOM_ROUTE/NEEDS_DESIGN_DECISIONに分類したS/R weapon・S/R armorの扱い確定後）
- R到達率
- 供給・inventory圧迫
- 共通定数調整

## 9. NEEDS_DESIGN_DECISION（本audit終了時点での未確定事項）

1. **spear/hammer/frost_enchantment/cloud_enchantment/earth_enchantmentのfloor2/3 staging**（4節）: CORE_SHORTへ是正し`unlockProgress: 0.0`にするか、意図的な「基本武器の2種目/属性の後半解禁」という現行の設計判断を維持するか。前者ならshort courseでも基本武器2種・全属性が早期から揃う。後者なら`minimumRunDepth`とは独立に、short course内でも「floorの浅い/深い」で段階解禁する仕組み（=progress軸の閾値をCORE_SHORT内でも使う）が必要になる。
2. **state.ts:422のfloor===1 chocolate保証**: `progress === 0`相当（run開始floor）への置換か、現状維持か。
3. **S armor（light_garb/dark_garb/spike_mail）とR armor（black_armor）の到達経路**: weaponのようなforgeNextId系列がarmorには存在せず、現状どのrouteからも到達不能。将来のsolar forge拡張でarmor版lineageを追加するのか、専用event/固定報酬routeを新設するのか未確定（development-plan上も「将来フェーズとして明示的に留保」とあるのみで方式は未指定）。
4. **card/accessoryのrarity/rank重みをprogress軸に連動させるか**: 現行`CARD_RARITY_WEIGHT_PROVISIONAL`/`ACCESSORY_RANK_WEIGHT_PROVISIONAL`はfloor非依存の固定テーブル（producer_decisions「全階層・全routeで同じ固定値を使う」という既存合意）。3節で提案した`unlockProgress`目安列（card/accessoryのB/A/S帯）はこの既存合意と矛盾する。progress連動化するか、card/accessoryは意図的にprogress非依存のまま据え置くかは製品判断が必要。
5. **RunConfigをGameStateから独立した型として切り出すか、既存`GameState.totalFloors`フィールドをそのまま拡張するか**（7節）。
6. **save/load機構の要否**（7節）: `runDepthTier`・将来のbudget counterを永続化する必要があるかは、save/load機構自体が現行production未確認のため判断できない。
7. **`sunlight.ts`の`floor === 1/2/3 → generateFloor1/2/3`手作りmap生成**: runDepthTierの実運用（10F/30F/99F）には、この固定floor直結map生成の拡張が別途必須の前提条件になる。本Phaseのitem/route経済設計そのものはこれと独立に進められるが、24.6b3の「10F/30F/99F再測定」を実行するには、測定用の一時的なfloor数拡張手段（本番map生成を変更しない一時script側でのfloor数水増しなど）が必要になる可能性がある。

## 10. 指示逸脱・停止事項

なし。stop_conditionsのいずれにも該当しなかった（単一availability modelで全ItemIdを扱える、3F完全互換とRunConfig導入は方式Aで両立、生成routeごとの矛盾するeligibilityは発見されなかった、budget導入はcombatRngState非依存で設計可能、save/schemaは「要否不明」というNEEDS_DESIGN_DECISIONに留まり設計判断の強制ではない）。production/test/fixtureへの変更は行っていない。
