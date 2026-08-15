# Phase 24.4e0: 呪い統合監査

production code・既存testは変更していない。本ドキュメントのみが今回の差分。

## precheck

- baseline branch: `phase-24-4d2a-star-curse-rng-isolation`
- expected_head: `4458b11be58195e34fd0f29f4f52de540fe65a3e`
- 実際のHEAD: `4458b11be58195e34fd0f29f4f52de540fe65a3e` — 一致
- local/remote SHA: 一致
- working tree: clean
- 同名work branch: 存在せず（新規作成）
- main: `80596cd` (feat: reveal monster house on first entry) — 監査中に未変更
- full suite: **123 files / 3094 tests — 全pass**
- `npx tsc --noEmit`: エラーなし
- `npx vite build`: 成功（成果物はdocs化のため破棄）
- Phase 20 curse/temperance, Phase 24.1 equipment-instance, Phase 24.3 DP/rank関連（rank部分のみ存在。DP自体は下記の通り未実装）、Phase 24.4b enemy-drop, Phase 24.4d1 identification, Phase 24.4d2/d2a star — 該当testはいずれもfull suiteに含まれ全pass

## 1. EquipmentInstance schema（`src/game/types.ts` / `equipment-instance.ts`）

| field | 型 | 初期値 | 更新関数 |
|---|---|---|---|
| `instanceId` | string | `eq-{n}` | mint時のみ、以後不変 |
| `definitionId` | WeaponId\|ArmorId | mint時指定 | 不変 |
| `refineLevel` | number | 0 | `normalizeEquipmentInstances`が補正のみ（増減ロジックはPhase 20.5b未実装） |
| `cursed` | boolean | false（生成経路依存） | mint時、`clearCurseOnInstance`相当（temperance解呪、`turn.ts:2126`）でのみfalse化 |
| `curseRevealed` | boolean | false | equip時（`applyWeaponEquip`/`applyArmorEquip`）にtrue化。curseなら即true化パスあり（星変換の呪い新規付与時も同様） |
| `rank` | EquipmentRank | 種族デフォルト or 明示指定 | mint時固定、以後不変 |
| `effectState` | EquipmentEffectState (optional) | 全0/空配列 | フロア遷移時に一部リセット |

- **DP/currentDP/maxDP相当field: 存在しない**（`grep`で本文一致0件）。計画書コメント（types.ts:1192）に「rankとDPをどの段階で追加するか」への言及があるが、Phase 24.1でrankのみ実装、DPは未着手。
- definition/instance責務境界: definitionテーブル（weapon-def/armor-def）は種族固定値、instanceは個体属性のみを持つ。責務境界は明確で混在なし。
- clone: `state.ts`のfloor carry時に `{...i}` でshallow copy。effectStateはネストオブジェクトのため、shallow copyでは共有される点に注意（現状effectStateを個別に書き換える箇所は`instance.effectState = {...}`という代入のみで、破壊的mutationではないため実害なし）。
- save/load: 明示的なシリアライズ機構は本監査範囲に発見なし（GameState全体のsave/load機構自体がこのモジュール外）。
- orphan instance防止: `getHeldEquipmentInstances`が`inventory`カウントを正として選別するため、余剰instanceがあってもcandidate化されない設計（`equipment-instance.ts`のdoc comment参照）。

## 2. 現行の呪い意味論

| 項目 | 状態 |
|---|---|
| cursedは単純booleanか複数系統か | 単純boolean。`cursed: boolean`のみで系統区分なし |
| 全cursedが束縛として扱われるか | IMPLEMENTED（束縛のみ）。`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`が唯一のcurse効果 |
| 劣化（degradation）相当のproduction effect | ABSENT |
| 災厄（calamity）相当のproduction effect | ABSENT |
| 装備時のcurseRevealed成立条件 | IMPLEMENTED。`applyWeaponEquip`/`applyArmorEquip`で`instance.cursed`ならその場で`curseRevealed = true`（turn.ts:2719-2724, 2808-2809） |
| 本体鑑定とcurseRevealedの独立性 | IMPLEMENTED。`item-identification.ts`は明示的にcursed/curseRevealedへ触れないとdoc comment済み（同ファイル43-46行） |
| 判明済み呪い装備の事前警告 | ABSENT（装備前の警告UIは本監査で未発見。装備した瞬間に判明する設計） |
| フロア移動・回復後の永続性 | IMPLEMENTED。`resetPerFloorEquipmentEffectState`はeffectStateのみリセットし、cursed/curseRevealedには触れない |
| 節制（temperance）による同一instance解呪 | IMPLEMENTED。`turn.ts:2126`付近の関数が`cursed`のみfalseにし、`curseRevealed`は履歴として残す（doc comment: "curse-knownは判明済みの履歴とし...") |
| 解呪後のslot/refineLevel/DP/rank/identity維持 | IMPLEMENTED（DP以外）。同一instanceを書き換えるのみでinstanceId/definitionId/refineLevel/rankは不変 |

## 3. 操作制限マトリクス

| 操作 | 存在 | 装備中curse-locked個体を拒否 | 未装備cursed個体の操作可否 |
|---|---|---|---|
| equip（同スロット交換） | 存在 | 拒否（`weapon_equip_blocked`/`armor_equip_blocked`, reason: cursed） | 可能（装備自体がcurseRevealedの契機） |
| unequip | 存在 | 拒否（`weapon_unequip_blocked`/`armor_unequip_blocked`, reason: cursed） | N/A |
| weapon/armor交換 | equipと同一経路 | 拒否 | 可能 |
| place | 存在 | 拒否（`resolveEquipmentTargetForRemoval`が装備中個体を常に拒否。curse有無を問わず「装備中」自体がblock条件） | 可能 |
| discard | 存在 | 同上（reason: 'equipped'として一括拒否。curse固有のreasonは出ない） | 可能 |
| solar forge素材化 | 存在 | cursed個体は判明・未判明問わず拒否（`validateForgeMaterials`, reason: 'cursed'） | 拒否（未装備でも） |
| Star変換target | 存在 | 対象選定ロジック依存（curseRevealedの表示はしないがcurse-locked装備中は候補から除外、`card-target-selection.ts:197-205`） | 候補になりうる |
| Temperance対象 | 存在 | cursed && curseRevealedのみが候補（`isDiscoveredCurse`） | 候補外（未判明は対象外） |
| floor transition | 存在 | 影響なし（cursed/curseRevealed不変） | 影響なし |
| death/gameover | 存在（ゲーム状態） | 呪いとの接続なし | NOT_APPLICABLE |
| throw | **未実装操作** | NOT_APPLICABLE | NOT_APPLICABLE |
| sell | **未実装操作** | NOT_APPLICABLE | NOT_APPLICABLE |

turn消費: equip/unequip/place/discard/solar_forgeのblockはいずれも`consumed: false`（ターン消費なし）。RNG消費: block時はRNG不使用。message: 各拒否は専用event type（`weapon_equip_blocked`等）経由でmessage-log.tsが文言化。telemetry: 拒否専用のtelemetryカウンタは本監査で未発見（ABSENT、8節参照）。

throw/sellは未実装操作のため、Phase 24.4eで便宜実装しない。

## 4. 生成経路マトリクス

| 経路 | production入口 | mint helper | curse判定率 | RNG stream | S/R/black_armor除外 |
|---|---|---|---|---|---|
| 通常床 | `state.ts` buildFloorState ground-item loop | `mintEquipmentInstance` | `FLOOR_EQUIPMENT_CURSE_CHANCE`(0.1) via `equipmentCurseRng`(`floorSeed ^ 0xc7d4a19e`) | 独立stream、他streamと非干渉 | 除外（`equipment-loot.ts`のNORMAL_RANKSがC/B/Aのみ、black_armor明示除外） |
| monsterHouse報酬 | 同ファイル、報酬loop | `mintEquipmentInstance` | 同じ`FLOOR_EQUIPMENT_CURSE_CHANCE`、同じ`equipmentCurseRng`を継続消費 | 通常床と同一streamを共有（順序契約あり） | 同上 |
| 敵ドロップ | `enemy-drop.ts` / `turn.ts`の終端フック | `createEquipmentInstanceWithCurse` | 同じ`FLOOR_EQUIPMENT_CURSE_CHANCE`、独立salt(`SALT_EQUIPMENT_CURSE`) | 完全独立stream（floorSeed, enemyId由来） | 同上（`resolveEnemyDropEquipmentDefinition`が同じ候補プールを再利用） |
| Star変換 | `turn.ts:2280`付近 | `createEquipmentInstanceWithCurse` | 同じ`FLOOR_EQUIPMENT_CURSE_CHANCE`、`STAR_TRANSFORM_CURSE_SALT`使い捨てstream | 独立、target/chosen identityから導出 | 明示的なS/R/black_armor除外ロジックは本監査で個別確認せず（Phase 24.4d2の対象。Star変換先候補の除外規則は別監査が必要） |
| 太陽鍛冶出力 | `solar-forge.ts` | `createEquipmentInstanceWithRank` | **常にfalse固定**（curseパラメータ自体を取らない実装） | N/A（RNG不使用） | rankはレシピ出力定義依存、curseは常にfalse |
| debug/fixture direct grant | 本監査範囲でproduction経路として未発見 | — | — | — | — |
| solar_gun | 通常床/MH/敵ドロップの候補プールに含まれる（`equipment-loot.ts`, 単一候補family） | 上記いずれか | 同上 | 同上 | S/R/black_armor除外の対象外だが、solar_gun自体はrank C固定のため通常フィルタ内 |
| S/R/black_armor装備 | 通常3経路から構造的除外。Star変換先の扱いは別途要確認 | — | — | — | 除外済み（太陽鍛冶レシピ出力先としてのみ登場しうる） |

検証結果:
- 通常床・monsterHouse・敵ドロップは同じ`FLOOR_EQUIPMENT_CURSE_CHANCE`定数と同じ`mintEquipmentInstance`/`createEquipmentInstanceWithCurse`系ヘルパーを使用しており、率の重複定義はない（1箇所の定数を複数箇所が参照）。
- 星変換の使い捨てcurse streamは他経路のRNG消費順序と非干渉（`createStarTransformRng`が独立seed）。
- 太陽鍛冶出力は意図的にcurse対象外（`cursed: false`固定、パラメータなし）。

本監査ではcurse率の新規決定・変更は行っていない（既存値の重複確認のみ）。

## 5. DP・rank監査

- **DP: 未実装**（1節参照）。計画書上の「DP・rank fieldを追加する」は**rankのみ達成済み**（Phase 24.1）。DPは未達 — 追加が必要ならmigration設計はPhase 24.4e以降の別スコープ。
- rank: `EquipmentInstance.rank`として存在、mint時に種族デフォルトから解決（`definitionRankFor`）。太陽鍛冶のみレシピ出力rankを明示指定可能。
- curse生成率がrankで変化するか: **ABSENT**（`FLOOR_EQUIPMENT_CURSE_CHANCE`は単一定数、rank非依存）。
- curse効果がDPを変更するか / 解呪がDPを変更するか: NOT_APPLICABLE（DP自体が存在しないため接続不可能）。
- 月・太陽・太陽鍛冶・星変換のDP取り扱い: NOT_APPLICABLE（DP不在）。

本監査ではDPの減少式・rank別curse率を新規決定していない。

## 6. 敵・罠ルート監査

- EnemyType（12種）: `bok, cockatrice, spider, bat, mummy, golem, sword, axe, kraken, skeleton, ghost, steps`
- TrapType（2種）: `slow_trap, poison_trap`
- 現在すでに呪いを付与する敵・罠: **ABSENT**（0件）
- 既存敵・罠へ呪いを追加する明示仕様: 本監査のproject_knowledge範囲では未発見（`rogue-of-sun-curse-system-spec.md`等の仕様案は「古い仕様案」に該当する可能性があり、現行実装と衝突しないか個別に照合が必要 — Phase 24.4e1側で要再確認）
- production hook候補: 敵の通常攻撃・固有能力はいずれもplayerのHP/状態異常を変更する既存経路（`turn.ts`内の戦闘解決部）を持つが、equipment instanceへ永続変化を与える共通hookは本監査で未発見。所持品/装備中instanceを安全に選ぶ既存helperとしては`getHeldEquipmentInstances`が転用候補。
- 候補0件時の処理パターン: 既存のtemperance/star実装が「候補0件なら不成立として扱う」という前例を持つ（`card-target-selection.ts`のbegin関数）。
- 敵・罠専用の決定的RNG stream追加可否: 可能（enemy-drop.tsの`deriveEnemyDropSeed`パターンが再利用可能な前例）。

本監査では発動率・対象種類を決定していない。新規EnemyId/TrapIdも提案していない。

## 7. 表示漏洩監査

- `card-target-selection.ts`の`describeCardTargetCandidate`: Phase 24.4d0監査で指摘された「第2のカード名表示漏れ」は、**Phase 24.4d1で既に修正済み**であることを確認（同ファイル274-280行、`getDisplayedItemName`経由に統一。コミットコメントで24.4d0監査への参照あり）。メモリに残る「未解決事項」は現状のproduction codeでは解消済み — 本監査でRESOLVED_EXISTINGとして記録する。
- star候補表示: curse状態を一切読まない設計（displayName/refineLevel(識別済みのみ)/equipped状態のみ）。
- temperance候補表示: 候補が常にcursed && curseRevealedである構造的保証により、「呪われている」noteの表示は非リークとして扱われている。
- inventory list / item detail / equip confirmation / combat log / solar forge UI: 本監査ではcurse関連の直接表示ロジックを追加発見せず（cursedフィールドを読むのはcard-target-selection.tsとturn.tsのblockロジックのみ）。

## 8. telemetry監査

| event | 状態 |
|---|---|
| curse generated | ABSENT |
| curse discovered | ABSENT |
| cursed equipment equipped | ABSENT |
| curse-locked operation rejected | ABSENT |
| Temperance uncurse | ABSENT |
| cursed equipment acquired | ABSENT |
| cursed equipment discarded while unequipped | ABSENT |
| cursed equipment battle/floor-clear usage | ABSENT |

`telemetry.ts`にcurse関連の専用event/counterは1件も存在しない。schemaVersionは現在7。本監査ではtelemetry欠落の実装を行わない。

## 9. RNG監査

- 呪い関連の全roll（通常床/MH報酬/敵ドロップ/星変換）はそれぞれ独立したXOR定数salt由来のstreamを使用し、他の生成要素（マップ生成、combatRngState、itemSelectionRng等）と非干渉。
- 通常床とMH報酬は`equipmentCurseRng`を意図的に共有（同一floor内の継続消費順序として設計されている、doc comment記載の契約）。
- 敵ドロップと星変換はfloorSeedベースだが完全に独立したderiveシード関数を持つ。

## NEEDS_DESIGN_DECISION

- 1個体に付く呪いは1系統か複数か
- 束縛は全cursed装備共通か独立系統か
- 劣化を実装するか後続へ延期するか
- 災厄を実装するか後続へ延期するか
- 敵攻撃・罠のどの具体的種類が呪いを付与するか、発動率
- 呪い対象が装備中のみか所持品全体か、対象0件時の成功/失敗
- 呪い付与時にcurseRevealedを即時成立させるか
- 敵/罠経由の呪い付与に対するUI事前警告の要否
- telemetry不足をPhase 24.4eへ含めるか
- DP fieldの新規追加（RESOLVED_EXISTINGではなく未達 — 設計要）
- Star変換先候補のS/R/black_armor除外規則の明文化（本監査未確認、要再監査）

## RESOLVED_EXISTING（production/testから確定済み）

- rank fieldはPhase 24.1で追加済み、DPのみ未達
- curse率は3経路（通常床/MH報酬/敵ドロップ）で単一定数を共有、重複定義なし
- 太陽鍛冶出力は常にcurse対象外
- card-target-selectionの第2表示漏れは24.4d1で修正済み
- place/discard操作はcurse固有ではなく「装備中」全般で一括拒否（curse-lock専用の追加ロジックは不要）

## 推奨するPhase分割

**Phase 24.4e1（最小実装候補）:**
- 敵/罠への呪い付与hook接続点の設計確定と最小実装（発動率・対象種類はdesign decision待ち）
- 変更候補ファイル: `turn.ts`（戦闘/罠解決部）、新規`enemy-curse.ts`または`trap-curse.ts`（enemy-drop.tsパターンを再利用）
- 再利用helper: `getHeldEquipmentInstances`, `deriveEnemyDropSeed`パターン, `FLOOR_EQUIPMENT_CURSE_CHANCE`（値そのものは要再検討）
- focused test計画: 新規`phase-24-4e1-*.test.ts`、RNG非干渉テスト（既存4経路のRNG消費順序が変化しないことを確認）

**Phase 24.4e2（追加実装）:**
- telemetry接続（curse generated/discovered/rejected等）
- Star変換先のS/R/black_armor除外規則の明文化・監査

**Phase 24.6または27へ延期:**
- 呪い発動率の数値調整
- rank別curse率
- DP関連の数値設計全般

**Phase 25/26へ延期:**
- 装備前の呪い警告UI
- save/load対応の明文化

stop condition: 敵/罠の具体的発動対象・確率が確定するまでPhase 24.4e1のコード実装には着手しない。

## focused test計画（Phase 24.4e1向け提案）

- 敵/罠curse付与roll用の独立RNG stream非干渉テスト（既存4経路のRNG消費順序が不変であることを回帰確認）
- 対象0件時の不成立テスト
- curseRevealed即時成立/非成立の両分岐テスト（design decision確定後）

## files likely to change（Phase 24.4e1想定・本監査では未変更）

- `src/game/turn.ts`
- 新規 `src/game/enemy-curse.ts` または `trap-curse.ts`（未作成）
- `src/game/telemetry.ts`（24.4e2）
- `docs/history/phase-24-4e1-*.md`（新規）

## production code/test無変更確認

- `git diff main...HEAD -- 'src/**/*.ts'`: 差分なし（本ドキュメントのみ追加）
- test file差分なし
- 一時スクリプトは`/home/claude/work`配下のみで使用、git管理下に一切追加していない

## baseline validation結果

- full suite（123/3094）はbaseline時点で確認済みのため、history作成後の再実行は不要（validation_after_audit要件どおり）

---

# Phase 24.4e0a 補完監査（追記）

24.4e0で「未確認」「hook未発見の報告のみ」だった2項目を、現在HEAD（`7634031`起点、production code/test無変更）のcode/testを直接確認して補完する。

## precheck（24.4e0a）

- baseline branch: `phase-24-4e0-curse-integration-audit`
- expected_head_prefix: `7634031` — 実際のHEAD `7634031bc50a2003c240316592d7bee87b558580`と一致
- local/remote SHA一致、working tree clean、同名work branch不存在（新規作成）
- main（`80596cd`）は監査中未変更
- 前工程でfull suite 123/3094・typecheck・build成功済みのため再実行せず

## 1. Star経路 — 確定結果（未確認から置換）

現在HEADの`src/game/turn.ts`（`resolveStarEffect`, `deriveStarTransformSeed`, `createStarTransformRng`）と`src/game/card-target-selection.ts`（`getStarCandidates`, `getTransformCandidatesForItem`, `STAR_INELIGIBLE_ITEM_IDS`, `isStarEligibleRank`）を直接確認し、`phase-24-4d2-star-transformation-alignment.test.ts`・`phase-24-4d2a-star-curse-rng-isolation.test.ts`の該当テストと突き合わせた。**24.4d2/d2aの完了報告と矛盾なし。**

| 検証項目 | 結果 | 根拠 |
|---|---|---|
| S装備がtarget候補から除外されるか | 除外される | `getStarCandidates`が`isStarEligibleRank`でNORMAL_RANKS（C/B/A）のみ許可（card-target-selection.ts:201） |
| S装備がresult候補から除外されるか | 除外される | `getTransformCandidatesForItem`が同じ`isStarEligibleRank`フィルタを適用（同ファイル:157） |
| R装備がtarget/result候補から除外されるか | 除外される | 同上（NORMAL_RANKSはC/B/Aのみ、S/Rを含まない） |
| solar_gunがtarget/result候補から除外されるか | 除外される | `STAR_INELIGIBLE_ITEM_IDS`に明示登録（card-target-selection.ts:90-94） |
| black_armorがtarget/result候補から除外されるか | 除外される | 同上 |
| enchantment系5種がresult候補から除外されるか | 除外される | `STAR_INELIGIBLE_ITEM_IDS`が`ENCHANTMENT_ITEM_IDS`をspread |
| curse-locked装備中instanceがtargetから除外されるか | 除外される | `getStarCandidates`が`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`を個別チェックし、該当instanceのみ除外（未装備の同種cursed個体は候補に残る） |
| 変換結果equipmentが正規helperで新規curse判定されるか | される | `createEquipmentInstanceWithCurse`（通常床/敵ドロップと同じmint helper）を使用、`FLOOR_EQUIPMENT_CURSE_CHANCE`と同じ閾値 |
| 旧curse/curseRevealed/refineLevelが引き継がれないか | 引き継がれない | 元instanceを`splice`で削除後、`createEquipmentInstanceWithCurse`で完全新規mint（refineLevel/cursed/curseRevealedは常にデフォルト値からスタート） |
| 自動再装備時のみ新curseが判明するか | その通り | `wasEquippedWeapon`/`wasEquippedArmor`の場合のみ`if (cursed) newInstance.curseRevealed = true`（turn.ts:2298, 2303）。未装備結果は`curseRevealed`が常にfalseのまま |
| 本体鑑定とcurseRevealedが独立するか | 独立している | 自動再装備は「本体を鑑定する」行為とは別（doc comment: "never conflated with body identification"）、item-identification.tsは触れない |
| combatRngStateおよび他RNGへ干渉しないか | 非干渉 | `createStarTransformRng`は`state.seed`/`floor`/`turn`/`targetIdentity`/`salt`から都度導出する使い捨てstream。`combatRngState`は一切読み書きしない（Phase 24.4d2aで確認済みの契約を現行codeで再確認） |

focused test対応: `phase-24-4d2-star-transformation-alignment.test.ts`の8 describe blockが上記の候補除外・curse-lock除外を、`phase-24-4d2a-star-curse-rng-isolation.test.ts`がRNG分離・fresh curse roll・curseRevealed付与条件をそれぞれ検証しており、production codeの挙動と一致。

**結論: Star経路はRESOLVED_EXISTING。設計判断不要、Phase 24.4e1で新規に触れる必要なし。**

## 2. 敵経路 — 全route一覧と最小hook候補（Phase 24.4e0bで確定済み。旧「推定」表現は下記で置換済み）

production入口は`resolveOneEnemy`（turn.ts:4250付近）。behaviorTypeは`ENEMY_DEFINITIONS[enemy.type].behaviorType`（enemy-def.ts）で静的に1種族1値へ固定されており、実行時に複数behaviorTypeへ揺れることはない（`switch (behaviorType)`、turn.ts:4308-4335）。

| EnemyId | behaviorType | 通常攻撃route | 固有能力route | damage/effect成立境界 | RNG source | curse付与の最小hook候補 | target候補取得位置 | 二重turn消費リスク | status |
|---|---|---|---|---|---|---|---|---|---|
| bok | `generic_melee` | `resolveBokEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit` | なし | `resolveEnemyAttackHit`内`player.hp`更新行（turn.ts:3151） | `state.combatRngState`（命中roll、1回） | `resolveEnemyAttackHit`内のhit成立後 | `getHeldEquipmentInstances(state)` | 低（1攻撃1回のみ呼出） | CONFIRMED |
| sword | `fast_melee` | `resolveSwordEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit` | なし（最大2歩の移動のみ、攻撃自体はbokと同一） | 同上 | 同上 | 同上 | 同上 | 低 | CONFIRMED |
| axe | `recovery_melee` | `resolveAxeEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit` | なし（攻撃後強制待機のみ、攻撃自体はbokと同一） | 同上 | 同上 | 同上 | 同上 | 低 | CONFIRMED |
| golem | `golem_charge` | `resolveGolemChargeEnemy`（idle時）内`tryMeleeAttack`→`resolveEnemyAttackHit`（隣接時） | `executeGolemCharge`（telegraphed実行時の直線突進）。突進経路上でプレイヤーに到達した瞬間、`executeGolemCharge`内で`resolveEnemyAttackHit(state, enemy, events)`を**共通関数として呼び出す**（turn.ts:3304、golemもstepsと同様に専用ロジックを持たずcommon hookを共有） | 近接・突進ともに`resolveEnemyAttackHit`を経由（同一境界） | `combatRngState`（`resolveEnemyAttackHit`経由、近接・突進とも同一）。移動経路の幾何判定自体はNONE | `resolveEnemyAttackHit`内（近接・突進の両方を単一hookで覆える） | `getHeldEquipmentInstances(state)` | 低（突進は1回のtelegraphed消化につき最大1回の`resolveEnemyAttackHit`呼出） | CONFIRMED |
| spider | `spider_cardinal` | `resolveSpiderEnemy`内`resolveEnemyAttackHit`（直交隣接時） | `placeWeb`（web設置、RNG不使用、プレイヤーのslowed状態のみ変更・装備instance非接触） | 攻撃時は`resolveEnemyAttackHit`と同一 | `combatRngState`（攻撃時のみ）。web設置はNONE | `resolveEnemyAttackHit`内（攻撃時のみ、web設置はcurse対象外） | `getHeldEquipmentInstances(state)` | 低 | CONFIRMED |
| bat | `bat_retreat` | `resolveBatEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit` | なし（攻撃後の退避移動のみ） | `resolveEnemyAttackHit`と同一 | `combatRngState` | `resolveEnemyAttackHit`内 | `getHeldEquipmentInstances(state)` | 低 | CONFIRMED |
| mummy | `mummy_shamble` | `resolveMummyEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit` | なし（移動後1ターン休止のみ、`restingAfterMove`フラグでRNG不使用） | `resolveEnemyAttackHit`と同一 | `combatRngState`（攻撃時のみ）。休止判定はNONE | `resolveEnemyAttackHit`内 | `getHeldEquipmentInstances(state)` | 低 | CONFIRMED |
| cockatrice | `cockatrice_gaze` | `resolveCockatriceEnemy`内`tryMeleeAttack`→`resolveEnemyAttackHit`（隣接時、視線未使用時のみ） | 視線攻撃（aim→fire2段階、`castGazeRay`で直線到達判定・幾何のみ）。ヒット時`state.player.petrified = true`を直接設定 | 近接時は`resolveEnemyAttackHit`、視線時は`resolveCockatriceEnemy`内の直接`petrified`代入（turn.ts:3835付近） | `combatRngState`（近接時のみ）。視線判定はNONE（`castGazeRay`はcanMoveベースの幾何判定でRNG不使用） | 近接時は`resolveEnemyAttackHit`内。視線時は`resolveCockatriceEnemy`内の`hit`成立ブロック内に個別追加が必要（petrifyと同じ箇所） | `getHeldEquipmentInstances(state)` | 低（視線と近接は排他分岐のため二重発火なし） | CONFIRMED |
| kraken | `kraken_tentacle` | **なし**（krakenは通常近接攻撃を一切持たない。`tryMeleeAttack`/`resolveEnemyAttackHit`を一度も呼ばない） | 触手予告・発動2段階（`tentacleTarget`未設定→予告、設定済み→発動）。発動時は`tentacleCrossCells`（十字5マス、幾何のみ）で対象範囲を求め、`hit`成立時に`player.hp = Math.max(0, player.hp - damage)`を`resolveKrakenEnemy`内で直接実行（turn.ts:3930-3932）。**`resolveEnemyAttackHit`は使用しない**（個別damage適用の専用ロジック） | `resolveKrakenEnemy`内の`if (hit) { player.hp = ... }`ブロック（turn.ts:3930-3932） | `combatRngState`は**不使用**（命中は`area.some(...)`による範囲内判定のみで確率roll自体が存在しない。`getIncomingDamage`はダメージ量計算のみで、命中可否とは無関係） | `resolveKrakenEnemy`内の`if (hit)`成立後、`player.hp`更新の直後（プル処理より前が安全） | `getHeldEquipmentInstances(state)` | 低（1回の`tentacleTarget`消化につき1回のみhit判定） | CONFIRMED |
| ghost | `ghost_phase` | `resolveGhostEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit` | 壁抜け移動（BFS経路探索、RNG不使用） | `resolveEnemyAttackHit`と同一 | `combatRngState`（攻撃時のみ）。移動判定はNONE | `resolveEnemyAttackHit`内 | `getHeldEquipmentInstances(state)` | 低 | CONFIRMED |
| steps | `steps_spike` | `resolveStepsEnemy`内`tryMeleeAttack`→`resolveEnemyAttackHit`（'revealed'状態時） | 3x3範囲spike攻撃（'telegraphed'→'revealed'遷移時、`getStepsSpikeCells`で範囲確定、ヒット時`resolveEnemyAttackHit(state, enemy, events)`を**共通関数として呼び出す**、turn.ts:4189） | 範囲攻撃・通常攻撃とも`resolveEnemyAttackHit`を経由（steps_spikeは両方とも同じ関数を使う点がkrakenと異なる） | `combatRngState`（`resolveEnemyAttackHit`経由、範囲攻撃・通常攻撃どちらも同一） | `resolveEnemyAttackHit`内（範囲・通常とも同一hookで覆える） | `getHeldEquipmentInstances(state)` | 低（'revealed'/'telegraphed'状態遷移が1ターン1回のみ） | CONFIRMED |
| skeleton | `generic_melee`（enemy-def.ts:385で静的固定、実行時に他behaviorTypeへ揺れることはない） | `resolveOneEnemy`→（`generic_melee`分岐）→`resolveBokEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit`（body形態のみ。head形態は`resolveOneEnemy`冒頭でskeletonForm==='head'なら即`return`し、一切の行動・RNG消費なし、turn.ts:4270-4272） | head化・復活は`defeatEnemyIfNeeded`（プレイヤーがskeletonを攻撃した際の防御側ロジックであり、skeletonがプレイヤーを攻撃するroute自体には無関係）。head→body復活は`resolveSkeletonRevivals`（世界ターン単位の状態遷移、プレイヤーへの直接効果なし） | body形態時は`resolveEnemyAttackHit`と同一。head形態は行動自体が成立しない（NOT_APPLICABLE） | `combatRngState`（body形態の攻撃時のみ）。head形態はNONE（行動しない） | `resolveEnemyAttackHit`内（bokと共有の共通hookで覆える。head形態は行動しないためhook不要） | `getHeldEquipmentInstances(state)` | 低（head形態は`acted: false`で即return、二重処理の余地なし） | CONFIRMED |

**common hookで覆える敵（`resolveEnemyAttackHit`内への追加で対応可能）:**
bok, sword, axe, golem（近接・突進の両方）, spider（近接時のみ）, bat, mummy, cockatrice（近接時のみ）, ghost, steps（通常攻撃・範囲攻撃の両方）, skeleton（body形態時のみ）— 12種中11種が最低1つの攻撃routeで`resolveEnemyAttackHit`を共有する

**individual hookが必要な敵（`resolveEnemyAttackHit`を経由しない専用ロジック）:**
- cockatrice: 視線ヒット時（`resolveCockatriceEnemy`内の`petrified`代入ブロック）— 近接時はcommon hookで覆えるが視線時は個別対応が必要
- kraken: 触手ヒット時（`resolveKrakenEnemy`内の`player.hp`直接更新ブロック）— **唯一「通常攻撃route自体が存在しない」種族であり、全ての攻撃がindividual hook対応になる**

**全RNG source一覧（敵経路）:**
- `state.combatRngState`（`rollPercent`経由）: `resolveEnemyAttackHit`を呼ぶ全種族・全route（bok/sword/axe/golem近接+突進/spider近接/bat/mummy/cockatrice近接/ghost/steps通常+範囲/skeleton body）で消費。消費条件は「`resolveEnemyAttackHit`が呼ばれたとき」の1回のみ。
- NONE（RNG不使用）: golem突進経路の到達判定自体（幾何のみ、到達後の命中roll自体は上記combatRngStateに含まれる）、spider web設置、cockatrice視線判定（`petrified`は範囲到達で確定、roll不使用）、kraken触手命中判定（範囲内判定のみ）、ghost移動経路、steps状態遷移、skeleton head形態の行動不成立。

呪いを将来敵経路へ追加する場合、`combatRngState`は既存の命中判定専用ストリームであり、これを流用するとcurse roll自体が命中結果と相関してしまう（例: 同じrollPercent呼び出し回数を共有すると、命中したターンのみcurse判定が走る設計は可能だが、判定確率自体を独立させるには別ストリームが必要）。`enemy-drop.ts`の`deriveEnemyDropSeed`パターン（floorSeed + enemyId + 専用salt、都度使い捨てstream）が、combatRngStateと非干渉な設計の直接の前例として再利用可能。

**required_conclusion:**
- 現在curse付与敵は **0件**（全12種についてcursedフィールドへの書き込みを行うコードパスは本監査で確認されなかった。推定・未確認は残っていない）
- 既存仕様上、curse付与担当として確定済みのEnemyIdは **存在しない**（production/testに実装がない以上、担当EnemyIdは未確定として扱う。これはコード監査不足ではなく、ゲームデザイン未決定に分類する）
- 分類: 「実装不能」ではなく **「接続境界は全12種について特定済みだが、担当EnemyIdと発動条件が未決定」**

## 3. 罠経路 — 全route一覧と最小hook候補

| TrapId | 発見route | 発動route | production入口 | RNG source | 装備instanceアクセス可否 |
|---|---|---|---|---|---|
| slow_trap | `revealTrap`（踏む時 or clairvoyance時） | プレイヤーが該当tileへ移動した瞬間、`applyPlayerAction`内のtrap loop | turn.ts:1164-1195 | RNG不使用（one_shot、確率判定なし） | 可能（同じ関数スコープでstateにフルアクセス） |
| poison_trap | 同上 | 同上（同一loop内、`effectId`分岐のみ異なる） | 同上 | RNG不使用 | 可能 |

- 無効化・回避規則: `isPlayerPoisonImmune`（poison_guard装備時）がpoison_trapの効果付与のみをブロック（trap自体のtriggered化・reveal化は妨げない）。slow_trapには同等の無効化規則は本監査で未発見。
- 再発動規則: `triggered`フラグにより一度発動した罠は恒久的にinert（one_shot、再発動なし）。
- 候補装備0件時の既存失敗契約: 罠自体には装備を対象とする既存契約がないため、この観点でのNOT_APPLICABLE。curse付与を追加する場合は、既存のtemperance/starパターン（候補0件なら不成立として扱う）を踏襲するのが自然だが、これは新規設計であり本監査では決定しない。
- turn二重消費の危険: 現在の罠発動はプレイヤーの移動アクション内で1回のみ処理されるため、同じloop内に追加ロジックを置く限り二重消費のリスクは低い。
- trap RNGとの分離方法: 現在slow_trap/poison_trapはどちらもRNG不使用（確定効果）。curse付与を追加する場合、新たな確率判定が必要になるため、`(floorSeed, trapId or trap.pos, 専用salt)`から独立streamを導出する設計が、他経路の非干渉契約と整合的（trapには現状固有IDフィールドがあるかは`types.ts`の`TrapTile`定義の追加確認が必要 — 本監査では未検証）。

**required_conclusion:**
- 現在curse付与trapは **0件**
- 既存仕様上、curse付与担当として確定済みのTrapIdは **存在しない**
- 担当TrapId・発動率・対象範囲は **NEEDS_DESIGN_DECISION**

## 4. target selection方式の比較（敵・罠共通）

| 方式 | 実装できる既存helper | helper不存在時の最小追加境界 |
|---|---|---|
| 装備中weaponのみ | `state.equippedWeaponInstanceId` → `getEquipmentInstanceById` | 既存helperで完結 |
| 装備中armorのみ | `state.equippedArmorInstanceId` → `getEquipmentInstanceById` | 既存helperで完結 |
| 装備中2slotから選択 | 上記2つを配列化するだけ（専用helperなし） | 数行のラッパー関数で足りる、新規モジュール不要 |
| inventory内の全equipment instance | `getHeldEquipmentInstances(state)`（temperance/starと同一） | 既存helperで完結 |

- 対象0件: 既存にtemperance/starの前例（不成立として扱う）があるが、敵・罠での対応方針は本監査では決定しない。
- 既にcursedな対象: 二重curse付与を許容するか拒否するかは未決定（cursedはbooleanのため、現行スキーマでは「既にcursed」の個体へ再度curse roll をかけても意味が変わらない — この点はスキーマがbooleanのままなら自然にNOT_APPLICABLEになりうるが、複数系統を導入する場合は再考が必要）。
- 未鑑定対象: 現行のcurseRevealed機構は「装備した瞬間に判明」という単一契機のみを持つため、敵/罠経由の新規付与でcurseRevealedをどう扱うかは1節のNEEDS_DESIGN_DECISIONと同一の論点。
- RNG選択が必要になる条件: 複数候補から1つを選ぶ場合（例: 装備中2slotから選択）は既存のenemy-drop.ts/star変換と同じ「独立salt付きRNG stream」パターンが必要になる。単一候補（装備中weaponのみ等）ならRNG不要。

本節では方式を決定・実装していない。

## 5. DP最終結論

- `EquipmentInstance`にDP fieldは存在しない（24.4e0の1節で確認済み、24.4e0aで再確認・矛盾なし）
- `WEAPON_DEFINITIONS`/`ARMOR_DEFINITIONS`（definition側）にも最大DP相当の定義は存在しない（`grep -rn "DP" src/game/weapon-def.ts src/game/armor-def.ts`で本文一致なし、確認済み）
- DP減少・破損・回復処理: 存在しない
- 月・太陽がDPを変更しないという契約: 月・太陽（Moon/Sun）自体がPhase 20.5b時点で未実装のカード効果であり、DPとの接続を論じる対象コードが存在しない（NOT_APPLICABLE、契約自体が形成されていない）

**分類: 単なるfield追加では成立しない。** 装備definition側の最大DP値、DP減少trigger（どの操作で減るか）、DP0時の挙動（装備不能化か、効果喪失か、破壊か）の3点が未確定のため、これらが決まらない限りfield追加だけでは意味のある機能にならない。

**required_conclusion:**
- 数値と寿命規則が未定のため、**DPをPhase 24.4e1へ便乗実装しない**
- DPは独立設計・実装単位が必要と明記する（Phase番号は本監査では指定しない — 呪い統合とは別スコープ）
- 呪いとの接続はDP本体成立後に行う
- rank fieldは既にdefinition側（`WEAPON_DEFINITIONS`/`ARMOR_DEFINITIONS`の`rank`プロパティ）およびinstance側（Phase 24.1）の両方で成立済み — 再実装しない

## 24.4e1 ready / blocked_by_design / defer（最終分割）

**phase_24_4e1_ready（設計判断なしで着手可能）:**
- 現在存在する4生成経路（通常床/MH報酬/敵ドロップ/Star変換）間のcurse契約はすでに統一されている（`FLOOR_EQUIPMENT_CURSE_CHANCE`単一定数・共通mint helper再利用）ため、**契約統一という作業自体は既に完了しており、Phase 24.4e1で新規に行う統一作業はない**
- 明白なoperation restriction欠陥: 本監査では未発見（place/discard/equip/unequip/solar forge/star いずれもcurse-lock契約が一貫）
- identification/curseRevealed漏洩修正: card-target-selectionの表示漏れは24.4d1で既に修正済み（再修正不要）
- 既存仕様だけで確定可能なtelemetry: 現状ABSENT。既存仕様（curse generated等のイベント名）がtelemetry.tsのschemaVersion規約と矛盾なく追加できるかは設計判断を要さない純粋な実装作業だが、優先度・スコープはPhase 24.4e1発行者の判断に委ねる

**blocked_by_design（設計判断待ち）:**
- curseを付与する具体的EnemyId
- curseを付与する具体的TrapId
- 発動率
- 対象選択範囲（装備中のみ/2slot/所持全体）
- 劣化・災厄の具体的効果
- DP全体（独立設計単位）
- rank別curse率

**defer:**
- 数値バランス調整はPhase 24.6または27
- 完成UI（装備前警告等）はPhase 25
- save migrationはPhase 26

## production code/test無変更確認（24.4e0a）

- `git diff main...HEAD -- 'src/**/*.ts'`: 差分なし
- test file差分なし
- 変更は`docs/history/phase-24-4e0-curse-integration-audit.md`（既存ファイルへの追記）のみ
- 一時スクリプトなし

## 指示逸脱の有無

- mummy/steps/skeleton/kraken各resolverの詳細な内部実装（RNG消費箇所の完全な行単位確認）は時間制約により部分確認にとどまり、上表で「要追加確認」と明記した。担当EnemyIdの独断選定は行っていない（指示の"敵・罠については担当種類を独断で選ばない"を遵守）。
- Star経路については24.4d2/d2aの完了報告と現行codeが一致することを確認し、設計判断を新たに求めず確定結果として記録した（指示どおり）。

---

# Phase 24.4e0b 最終確定監査（追記）

24.4e0aで「推定」「要追加確認」と残っていたmummy/steps/skeleton/kraken各routeを、現在HEAD（`0109c8f`起点、production code/test無変更）のcodeを行単位で直接確認し確定した。Star・trap・DPは24.4e0/24.4e0aで既に確定済みのためやり直していない。

## precheck（24.4e0b）

- baseline branch: `phase-24-4e0a-curse-audit-completion`
- expected_head_prefix: `0109c8f` — 実際のHEAD `0109c8f95ef9a9cd9d9d485b6ac2777dba41bda1`と一致
- local/remote SHA一致、working tree clean、同名work branch不存在（新規作成）
- main（`80596cd`）は監査中未変更
- 前工程でfull suite 123/3094・typecheck・build成功済みのため再実行せず

## mummy/steps/skeleton/kraken 確定結果

**mummy**: `resolveMummyEnemy`は`restingAfterMove`フラグによる移動後1ターン休止のみが固有挙動で、攻撃自体は`tryMeleeAttack`→`resolveEnemyAttackHit`を経由する（bokと同一のダメージ確定境界）。RNGは`resolveEnemyAttackHit`内の`combatRngState`命中rollのみ。休止判定自体はRNG不使用。CONFIRMED。

**steps**: hidden→telegraphed→revealed の3状態サイクルを持つが、telegraphed→revealed遷移時の3x3範囲spike攻撃も、revealed中の通常近接攻撃も、**どちらも`resolveEnemyAttackHit`を共通関数として呼び出す**（turn.ts:4189付近、範囲攻撃時は`playerWasInArea`判定後に`resolveEnemyAttackHit`を呼び、通常攻撃時は`tryMeleeAttack`経由で同じ関数へ到達）。RNGは両ルートとも`resolveEnemyAttackHit`内の`combatRngState`のみ。状態遷移自体（hidden/telegraphed/revealedのカウントダウン）はRNG不使用。CONFIRMED。

**skeleton**: `ENEMY_DEFINITIONS.skeleton.behaviorType`は`'generic_melee'`に静的固定（enemy-def.ts:385）。`resolveOneEnemy`のswitch文は`ENEMY_DEFINITIONS[enemy.type].behaviorType`という1回の同期的プロパティアクセスで分岐するため、同一EnemyIdが実行時条件によって複数behaviorTypeへ割り当てられる余地はない（stop_conditionの「静的確認不能」ケースには該当しない）。body形態はbokと同じ`resolveBokEnemy`→`tryMeleeAttack`→`resolveEnemyAttackHit`経路で攻撃する。head形態は`resolveOneEnemy`冒頭の`if (enemy.type === 'skeleton' && enemy.skeletonForm === 'head') return { acted: false, attacked: false };`（turn.ts:4270-4272）により、行動判定・RNG消費・攻撃のいずれも一切発生しない（NOT_APPLICABLE）。head化・body復活（`defeatEnemyIfNeeded`内のskeleton分岐、`resolveSkeletonRevivals`）はプレイヤーがskeletonを攻撃した結果、またはターン経過による状態遷移であり、「skeletonがプレイヤーを攻撃するroute」とは無関係な別軸。CONFIRMED。

**kraken**: `resolveKrakenEnemy`は`tryMeleeAttack`・`resolveEnemyAttackHit`のどちらも一度も呼ばない。触手予告（`tentacleTarget`未設定時、Chebyshev距離1-5かつ視線不要で予告)→発動（`tentacleTarget`設定済み時、`tentacleCrossCells`で十字5マスを計算し`area.some(...)`で命中判定)の2段階で完結し、命中時は`resolveKrakenEnemy`内で`player.hp = Math.max(0, player.hp - damage)`を直接実行する（turn.ts:3930-3932）。命中判定自体に確率roll・RNGは一切使われない（範囲内に居るか否かの幾何判定のみ）。**krakenは12種中唯一「通常攻撃route」を持たない種族**であり、curse付与hookを追加する場合は個別対応が必須。CONFIRMED。

## 全12種matrix完成確認

上記「## 2. 敵経路」の表を本工程で更新し、12種すべてを`CONFIRMED`または`NOT_APPLICABLE`のみで記載した。「推定」「要確認」「未確認」「おそらく」「likely」「unknown」に該当する表現は表中に残っていない。

## common hook対象（最終）

bok, sword, axe, golem（近接・突進とも）, spider（近接時）, bat, mummy, cockatrice（近接時）, ghost, steps（通常・範囲とも）, skeleton（body形態時）— 12種中11種が`resolveEnemyAttackHit`という単一の共通関数で最低1つの攻撃routeを覆える。

## individual hook対象（最終）

- cockatrice: 視線ヒット時（近接時は共通hookで足りるが、視線発動時は`resolveCockatriceEnemy`内の`petrified`代入ブロックへの個別追加が必要）
- kraken: 全攻撃（`resolveKrakenEnemy`内の`player.hp`直接更新ブロックへの個別追加が必要。共通hookでは一切カバーできない）

## 全RNG source（敵経路、最終）

- `state.combatRngState`（`rollPercent`経由）: `resolveEnemyAttackHit`が呼ばれた時点で必ず1回消費。11種の攻撃ルート（golem突進含む、steps範囲含む、skeleton body含む）がここに集約される。
- NONE: golem突進の到達判定、spider web設置、cockatrice視線の到達判定、kraken触手の範囲内判定、ghost移動経路、steps状態遷移カウントダウン、skeleton head形態の行動不成立。

呪いを敵経路へ将来追加する場合、`combatRngState`は命中判定専用ストリームとして既に共有されているため、curse roll確率を命中確率と独立させたいなら`enemy-drop.ts`の`deriveEnemyDropSeed`パターン（floorSeed + enemyId + 専用salt、都度使い捨てstream）を新設する必要がある。これは24.4e0の時点で既に記録済みの結論であり、本工程で変更はない。

## 技術的未確認事項

**0件。** mummy/steps/skeleton/kraken全4種について、production入口・RNG消費箇所・damage/effect成立境界・target候補取得位置を現在HEADのcodeを直接読んで確定した。golemについても24.4e0aの時点で「近接時は`resolveEnemyAttackHit`」とのみ記載され突進側が未確認だったため、本工程で`executeGolemCharge`内部を確認し、突進命中も`resolveEnemyAttackHit`を共有することを確定した（表を訂正済み）。

## 残るゲームデザイン判断（コード監査不足と混在させない）

以下はコードから確認可能な技術事実ではなく、ゲームデザインとして未決定のまま残す事項:
- curseを付与する具体的EnemyId（接続境界は全12種について特定済みだが、どの種族が担当するかは未決定）
- curseを付与する具体的TrapId
- 発動率・対象選択範囲（装備中のみ/2slot/所持全体）
- curseRevealedを敵/罠付与時にも即時成立させるか
- 二重curse付与（既にcursedな対象への再付与）の扱い

## production code/test無変更確認（24.4e0b）

- `git diff main...HEAD -- 'src/**/*.ts'`: 差分なし
- test file差分なし
- 変更は`docs/history/phase-24-4e0-curse-integration-audit.md`（既存ファイルへの追記・訂正）のみ
- 一時スクリプトなし

## 指示逸脱の有無

- 担当EnemyId/TrapIdの独断選定は行っていない
- 同一EnemyIdが実行時条件によって複数behaviorTypeへ割り当てられるケース（stop_condition該当）は発見されなかった（`ENEMY_DEFINITIONS[enemy.type].behaviorType`は静的1対1マッピング）
- production/testと既存testの矛盾は発見されなかった
- 新しい設計提案・production実装は行っていない
