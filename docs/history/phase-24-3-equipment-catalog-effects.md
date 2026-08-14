# Phase 24.3: 全装備カタログ・個別効果・太陽鍛冶実レシピ一括実装

## Precheck

- base branch: `phase-24-2-solar-forge-core`（origin HEAD `13eb80d`）と一致確認
- working tree clean、同名work branch衝突なし
- Phase 24.2 baseline: 112ファイル / 2839テスト全通過
- Phase 24.2既存責務（EquipmentDefinition、EquipmentInstance、combat、speed、SOL、enemy defeat、visibility、turn scheduler）を監査し、拡張可能な構造であることを確認した上で着手

## Stage分割による段階実施

作業量を理由にPhase自体は分割していない（同一work branch・同一history・最終1コミットで完結）。ただし実装工程は依頼どおり5 Stageへ分け、各Stageで専用テストとtargeted regressionを実施しながら進めた。

## 全42装備の実装一覧

### 近接武器27種＋太陽銃1種（`src/game/weapon-def.ts`）

各系統9種（C×2, B×2, A×2, S×2, R×1）×3系統。

- **sword系統**: sword(C)→short_sword(C)、sword→flamberge(B)→bushido_blade(A)→solar_sword(S)、short_sword→magic_sword(B)→blood_sword(A)→dark_sword(S)、solar_sword+dark_sword→gram(R)
- **spear系統**: spear(C)/glaive(C)、spear→corsesca(B)→grand_lance(A)→white_queen(S)、glaive→ice_glaive(B)→blood_spear(A)→black_queen(S)、white_queen+black_queen→gungnir(R)
- **hammer系統**: hammer(C)/basic_hammer(C)、hammer→maul(B)→battle_axe(A)→dawn(S)、basic_hammer→silver_flail(B)→bloody_mace(A)→twilight(S)、dawn+twilight→mjolnir(R)
- **solar_gun**: Phase 23.1仕様を完全維持（attackPower/reach/solarCost/hitModifier不変）

### 防具15種（`src/game/armor-def.ts`）

armor(C)/chain_mail(C)、plate_mail(B, 効果none)、samurai_armor(A)、mail_of_sol(B)、mail_of_dark(B)、dragon_scale(A)、magic_robe(B)、skull_suit(A)、poison_guard(B)、ninja_suit(A)、light_garb(S)、dark_garb(S)、spike_mail(S)、black_armor(R)。

## 既存definitionIdとの対応

sword/spear/hammer/solar_gun/armorの5 definitionIdとその表示名（グラディウス／ショートスピア／クラブ／太陽銃／クロスアーマー）は完全維持。既存save・テストとの互換性が壊れていないことは既存112ファイル全通過で確認済み。

## 太陽鍛冶レシピと確定仕様の変更点

### 当初案からの変更

`stage_0_contract_audit`は当初「C～Aは同一definitionId 2個」を前提としていたが、実施途中でユーザーからの明示的な上書き指示により以下へ変更した：

- C～A帯は「同一武器系統かつ同rank」の異なる2個体を素材にできる（definitionId完全一致は不要）
- 第1素材（`materialInstanceIds`の1番目、UIでは「1個目選択」）の系譜（`WeaponDefinition.forgeNextId`）を完成品へ引き継ぐ。第2素材は家系・rankが一致していれば具体的な種は問わない
- S→Rの3レシピ（gram/gungnir/mjolnir）のみ、指定2定義の固定ペアで素材順序に依存しない

### 実装方式

`SOLAR_FORGE_RECIPES`（`solar-forge-recipes.ts`）にはS→Rの3件のみを登録。C/B/A帯の18遷移は`WeaponDefinition.family`/`forgeNextId`から`solar-forge.ts`の`resolveLineageForgeOutput`が都度計算する。これは「同じunordered idペアに対して単一の出力しか表現できない」既存の`buildForgeRecipeKey`（sorted-key、order-independent）の構造的制約のためで、新設計は既存Phase 24.2関数（`validateForgeMaterials`/`getSolarForgeCandidates`/`buildForgeRecipeKey`/`findSolarForgeRecipe`）を一切変更せず、`validateForgeMaterialsWithLineage`/`getSolarForgeCandidatesWithLineage`/`getSolarForgeSecondMaterialCandidates`を追加する形で実装した。Phase 24.2の既存テスト（fixture registry・exact-pair前提）は無改変のまま全通過している。

3（S→R固定）＋18（lineage解決）＝21太陽鍛冶レシピが揃う。

## 個別武器・防具効果と処理タイミング

`src/game/equipment-effects.ts`に集約。`turn.ts`のcall siteはdefinitionId比較ではなくこのモジュールの関数を呼ぶ。

- **攻撃開始スナップショット**: SOL最大判定・LIFE1/3判定・夜間/暗い部屋判定は、いずれも属性SOL消費前に評価（`applyPlayerAttackToEnemy`冒頭で1回だけ計算し、以後は使い回す）
- **属性ボーナス**（flamberge/ice_glaive/grand_lance）: 実際に発動した属性と一致した場合のみ+1、既存affinity/mind計算の後に加算
- **magic_sword**: 確定SOLコストが2以上の場合のみ-1、最低1。既存のELEMENT_ENCHANTMENT_SOL_COST定数自体は変更せず、消費直前に補正
- **corsesca**: 命中・生存時のみ、既存combat RNGストリームで10%判定。成立した対象へ`EnemyActor.corsescaStunTurns=1`をセットし、`resolveOneEnemy`の先頭で1resolve分をskip（telegraphed/recovering等の他状態は一切変更しない）
- **blood系（blood_sword/blood_spear/bloody_mace）**: `defeatEnemyIfNeeded`が真（スケルトンhead化ではない、真の完全撃破）を返した場合のみ発動。個体ごとの`effectState.floorTriggerUses`で1フロア2回まで
- **battle_axe**: 同様の真の完全撃破フックで、その個体の`effectState.defeatedEnemyTypes`へ記録。以後同じ階・同じ個体・同じ敵種の攻撃へ+1
- **maul/silver_flail**: `EnemyDefinition.traits`（新規追加、construct/undead）で判定。外見・AI・stats・生成順は無変更
- **防具の実効値系**（samurai_armor/black_armor/ninja_suit/light_garb）: 基礎Player値・`state.maxSolarEnergy`は一切書き換えず、共有helper（`getArmorEffectiveAttackBonus`/`getArmorEffectiveSpeedBonus`/`getEffectiveMaxSolarEnergy`）で都度計算
- **poison_guard**: production毒付与の唯一の経路（毒罠）に免疫チェックを追加、既存毒は非治療
- **skull_suit**: `isWithinAggroRange`の初回感知判定にのみ-2/下限2を適用（golem/steps中サイクルバイパスは対象外のため無影響）
- **magic_robe**: 実際に支払った近接属性SOLのみ`effectState.solSpentRemainder`へ加算、5ごとに1還元
- **spike_mail**: `resolveEnemyAttackHit`（隣接攻撃のみ到達するchoke point）で正ダメージ・生存条件を満たした場合のみ1反射。`defeatEnemyIfNeeded`を直接呼ぶため、反射キルはblood/battle_axeの撃破効果を発動しない
- **black_armor**: `state.turn += 1`直後の1箇所で`tickBlackArmorEquippedTurn`を呼び、装備中の完了ワールドターンのみ加算。20到達でLIFE-1・カウンタ0リセット、RNG非消費
- **dark_garb**: `isNightOrDarkRoom`の強制true化と、`wait`アクションの日向自動チャージ分岐を無効化する形で実装

### 「夜間」概念についてのスコープ決定

このコードベースには昼夜サイクルは存在せず、フロアごとの単一「暗い部屋」（`map.darkRoomIndex`）のみが実装されている。dark_sword/black_queen/twilight/gram/gungnir/mjolnirの「夜間または暗い部屋」条件は、「暗い部屋に立っている、またはdark_garb装備中」として実装した。新規に昼夜サイクルを追加することは本Phaseのスコープ外と判断した。

### mail_of_darkについてのスコープ決定

`mail_of_dark`の効果「DARK属性追加ダメージ-1」はカタログ・effectId（`dark_element_reduction`）として登録したが、このゲームのElementIdにはDARK属性そのものが存在しない（sol/flame/frost/cloud/earthの5属性のみ）。既存の属性エンチャント体系を拡張して新属性を追加することは本Phaseのスコープ外と判断し、この防具は装備・カタログ・防御値としては完全に機能するが、属性軽減としては実質no-opとした。

## effectStateとfloor reset/carry-over

`EquipmentInstance.effectState`（`floorTriggerUses`/`solSpentRemainder`/`equippedTurnCounter`/`defeatedEnemyTypes`）を追加。`mintEquipmentInstance`/`createEquipmentInstanceWithRank`（太陽鍛冶出力）双方でデフォルト値を設定。`normalizeEquipmentInstances`で欠落・不正値を補正。`advanceToNextFloor`で`resetPerFloorEquipmentEffectState`を呼び、`floorTriggerUses`/`defeatedEnemyTypes`のみリセットし、`solSpentRemainder`/`equippedTurnCounter`は保持する。

## 報酬候補表と未接続の生成経路

`reward_candidate_tables`のnormal/special weapon・armor候補表はテストコード内で定義・検証したが、production floor生成（`GROUND_ITEM_POOL_FLOOR_*`）へは一切接続していない。現行floor生成は従来のsword/spear/hammer/solar_gun/armorのみを維持しており、`phase-24-3-equipment-catalog.test.ts`でこれを検証済み。黒の鎧は通常生成経路へ絶対に入らない（定義・効果のみ実装）。

## DPを追加しなかった理由

DPフィールド・耐久度・破損処理は、DPの意味・増減・破損・修理仕様が未確定であり、本Phaseの個別効果実装に不要なため見送った。将来仕様確定後にbacklogとして再検討する。

## solar_forge_failedの確定契約

Phase 24.2で定義された`solar_forge_failed`イベントは、失敗時にinventory・equipmentInstances・装備参照・turn・RNGを一切変更しないstate mutationフリーな通知として維持した。取消（UI側の`solar_forge_material_b`画面キャンセル）はイベント自体を発行しない完全no-opとして実装した。

## 太陽鍛冶UI

`main.ts`のインベントリ「行動」メニューへ、弾正対象武器個体に対する「太陽鍛冶」アクションを追加。選択すると素材2の候補一覧（`getSolarForgeSecondMaterialCandidates`）を表示する新画面`solar_forge_material_b`へ遷移し、確定時に候補を再取得してから`solar_forge`アクションをdispatchする（実行直前の状態変化を再検証）。候補0件時は「合成できる武器がない」と表示、取消は完全no-op。装備中の素材・rank・判明済み呪いを表示し、未判明呪いは表示しない。

大規模なinventory UI再設計や専用アニメーションは行っていない。Phaserの実際の描画結果はこのプロジェクトのテストスイート対象外のため、`vite build`によるコンパイル成功のみで型・構文面を検証した（視覚的な確認は別途手動プレイが必要）。

## 新規・更新テスト数

- `phase-24-3-equipment-catalog.test.ts`: 18件（新規）
- `phase-24-3-solar-forge-recipes.test.ts`: 22件（新規）
- `phase-24-3-weapon-effects.test.ts`: 28件（新規）
- `phase-24-3-armor-effects.test.ts`: 26件（新規）
- `phase-24-3-solar-forge-recipes-ui.test.ts`: 6件（新規）
- 既存テストの更新: `phase-20-0a-card-definition-foundation.test.ts`（ITEM_IDS_IN_ORDER拡張反映）、`phase-20-0d-card-target-selection.test.ts`・`phase-20-5a-targeted-card-effects.test.ts`（防具種が15種になったことでstarカード代替対象の期待値反転）、`phase-24-2-solar-forge-core.test.ts`（production catalogがC限定ではなくなったことを反映）、31ファイルのInventoryリテラルフィクスチャへ`...createEmptyInventory()`スプレッドを機械的に追加（新規42 itemId分の型エラー解消）

新規テスト合計: 100件

## targeted/full suite/typecheck/build/diff-check

- targeted regression: 各Stageごとに関連テストファイルを個別実行し、問題をそのStage内で解消（Stage1: catalog系、Stage2: solar-forge系、Stage3: combat/weapon系、Stage4: armor/turn系、Stage5: UI/main.ts型検証）
- full suite: `npx vitest run` — 117ファイル / 2939テスト全通過
- typecheck: `npx tsc --noEmit` — エラーなし
- build: `npx vite build` — 成功（distは検証後削除）
- diff-check: `git diff --check` — 問題なし

## production sanity

一時スクリプトで以下を確認後、削除済み：

- 通常生成sword2個 → UI相当の`applySolarForge`経由でフランベルジュへ鍛冶成功
- 太陽の剣＋暗黒の剣 → グラム鍛冶成功
- ポイズンガード装備中は毒罠の毒付与がブロックされる
- 黒の鎧を装備した状態で20ターン経過後、LIFEが1減少する
- 同一seed（1, 42, 999）で3フロア分の敵配置・罠・アイテム座標・出口座標が2回の生成で完全一致（決定性維持）

## 変更ファイル一覧（主要production）

`types.ts`, `weapon-def.ts`, `armor-def.ts`, `item-def.ts`, `equipment-instance.ts`, `solar-forge.ts`, `solar-forge-recipes.ts`, `equipment-effects.ts`（新規）, `enemy-def.ts`, `turn.ts`, `ability.ts`, `state.ts`, `events.ts`, `message-log.ts`, `main.ts`, および31件のテストフィクスチャ・5件の新規テストファイル。

## Phase 24.4/24.6/24.7への引き継ぎ

- Phase 24.4: 報酬候補表の通常床落ち・敵ドロップ・monsterHouseへの実接続
- Phase 24.6: rank別出現weight・正規化進行帯のproduction接続、R到達率と追加解禁条件の要否再検討
- Phase 24.7: 黒の鎧専用部屋・番人・生成判定

未接続のまま残した既知の設計課題:
- 昼夜サイクル未実装のため「夜間」条件は暗い部屋のみで代替（上記スコープ決定参照）
- mail_of_darkの属性軽減は実質no-op（DARK属性がElementIdに存在しないため）
- magic_robeのSOL消費追跡は近接属性攻撃のみ対象（太陽銃のSOL消費は追跡対象外）

## 指示逸脱の有無

- forge_lineageの実装方式について、ユーザーからの明示的な上書き指示（同一definitionId不要・第1素材系譜継承）に従い、当初のstage_0_contract_audit案から変更した。この変更はユーザー自身の指示によるものであり、逸脱ではない
- 上記「夜間」概念・mail_of_dark・magic_robe太陽銃除外の3点は、既存コードベースに存在しない概念の新規追加を避けるためのスコープ限定であり、指示外の新機能追加は行っていない。装備カタログ・効果・レシピ・UIとも、指定された範囲内で完結させた
