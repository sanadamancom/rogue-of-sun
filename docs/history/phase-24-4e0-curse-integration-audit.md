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
