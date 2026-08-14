# Phase 24.4d0: 一般アイテム鑑定 実装準備監査

**本文書はaudit_onlyの成果物である。productionコード・テストへの変更は一切含まない。**

## Precheck結果

- baseline branch: `phase-24-4c-card-supply`（origin HEAD `8c940737f38cad414da84223d76a219846083bd8`）と一致確認
- origin/main、Phase 24.4a/24.4b branch未変更
- working tree clean、同名local/remote work branch衝突なし
- Phase 24.4a専用31テスト・24.4b専用26テスト・24.4c専用29テスト（計86件）全通過
- full suite: 120ファイル / 3025テスト全通過（期待値と完全一致）
- typecheck: エラーなし
- production build: 成功

work branch `phase-24-4d0-identification-audit`を`origin/phase-24-4c-card-supply`から作成。

---

## 1. ItemModel監査

### 1.1 全ItemIdの分類

`types.ts`の`ItemId`型は以下で構成される（`CardId`の17種を含む）：

| カテゴリ | 個数 | storage model | 例 |
|---|---|---|---|
| stackable consumable（カード以外） | 7 | `Inventory[ItemId] = count` | apple, sun_fruit, chocolate, banana, antidote, panacea, clairvoyance_fruit |
| one-time unlock pickup（Inventoryに一切入らない） | 5 | GameState直下の専用flag（`solUnlocked`/`unlockedEnchantments.*`） | sol_enchantment, flame/frost/cloud/earth_enchantment |
| weapon（武器種、sword/spear/hammer 3ファミリー + solar_gun単独） | 27 | `EquipmentInstance`（`Inventory`にも所持数として反映されるが、個体はequipmentInstancesが正） | sword等9種×3ファミリー + solar_gun |
| armor | 15 | `EquipmentInstance` | armor等15種（black_armor含む） |
| card | 17 | `Inventory[ItemId] = count`（通常consumableと同じ格納方式） | high_priestess〜judgement |
| event_items | 0（コード上存在しない） | — | — |
| debug_items | 0（コード上存在しない） | — | — |
| removed_key | 0（コード上存在しない） | — | — |
| future_accessories | 0（コード上存在しない、型自体が未定義） | — | — |

`state.ts`のコメント中に"valuables/keys/debug items"という語が1箇所存在するが（`getWeightedGroundItemPoolForFloor`が除外する対象を説明する修辞的表現）、対応する具体的なItemId・型は一切コード上に存在しない。**event_items/debug_items/removed_key/future_accessoriesはコード上実在しないカテゴリであり、監査時点では「将来のカテゴリ名の想定」に過ぎない。**

### 1.2 Inventory管理 vs EquipmentInstance管理の区別

- `Inventory = Record<ItemId, number>`。カード・通常consumable・武器/防具すべてが`Inventory[itemId]`に所持数を持つ（武器/防具は「未装備を含む全所持数」）
- 武器/防具は**加えて**`GameState.equipmentInstances: EquipmentInstance[]`に個体単位で保持される。同一definitionIdの複数所持がある場合、`Inventory[itemId]`は総数、`equipmentInstances`はその内訳（各個体のrefineLevel/cursed/curseRevealed/rank/effectStateを個別保持）
- カード・通常consumableには対応するInstance構造が存在しない（スタック内の個体差は一切ない）

### 1.3 GroundItemの保持方式

`GroundItem { id, itemId, pos, equipmentInstanceId?, spawnSource? }`。

- 武器/防具のground item: `itemId`が解決済みdefinitionId、`equipmentInstanceId`が対応するEquipmentInstanceを指す（Phase 20.0c/24.4aで確立）
- カード・通常consumableのground item: `itemId`のみ、`equipmentInstanceId`は`undefined`（Phase 24.4cで実測確認済み）

### 1.4 ItemDefinition／CardDefinition／weapon-def.ts/armor-def.ts の責務分離

- `ItemDefinition`（item-def.ts）: 全ItemId共通の表示データ（displayName、glyph、category、consumable/stackable、healAmount等）。**武器/防具の戦闘性能は含まない**
- `weapon-def.ts`/`armor-def.ts`: 武器/防具のみの戦闘性能（attackPower、reach、armorValue、rank、family等）、definitionId（=WeaponId/ArmorId）をキーとする
- `card-def.ts`: カードのみの追加データ（useMode、targetScope、effectId、**Phase 24.4cで追加したrarity**、unidentifiedDisplayName等）

これら3つは互いに素な責務分担であり、同じItemId/CardIdに対して複数の定義テーブルから異なる側面のデータを引く設計が既に確立している。**一般アイテム鑑定の実装もこのパターン（既存テーブルへ新フィールド追加、または並行する新規テーブル追加）に沿うのが自然。**

### 1.5 同一ItemIdの複数EquipmentInstance区別

`instanceId`（`eq-N`形式、run内で単調増加・重複なし）で区別される。`normalizeEquipmentInstances`が不正な組み合わせ（`cursed: false`かつ`curseRevealed: true`等）を防御的に補正する既存の正規化契約がある。

### 1.6 特殊装備（solar_gun、R武器、black_armor）の鑑定規則整合性

- `solar_gun`は`equipment-loot.ts`の候補列挙で常に単一候補（他のweaponスロットと同じ抽選経路を通るが、rankはCで唯一の候補）。Phase 24.4a/24.4bの通常生成・敵ドロップに現れる
- R武器・black_armorは**通常生成・monsterHouse報酬・敵ドロップの一切から現在出現しない**（`equipment-loot.ts`の構造的除外、Phase 24.4a〜cで一貫）。取得経路が存在しないため、鑑定規則を今設計しても実際にプレイヤーが遭遇する余地が現状ゼロ。black_armorはPhase 24.7専用封印部屋実装まで到達不可能

---

## 2. 既存カード鑑定基盤の監査

### 2.1 型・フィールド・関数

- `GameState.identifiedCardIds?: CardId[]`（optional、absent時は空配列扱い）— **CardId単位**（ItemId単位ではなく、カード17種のみの部分集合型）
- `isCardIdentified(state, cardId): boolean`（turn.ts）— 正本の判定関数
- `markCardIdentified(state, cardId, events)`（turn.ts、非export）— 冪等（既に鑑定済みなら何もしない）、`card_identified`イベントを初回のみpush
- `CardDefinition.unidentifiedDisplayName`（card-def.ts）— 全17種共通の固定文字列`'未鑑定のカード'`（seed別alias等の個別名は一切実装されていない）

### 2.2 状態の寿命

- 初期化: `createInitialState`は`identifiedCardIds`を明示的に設定しない（undefined→`isCardIdentified`が`?? []`で空扱い）
- フロア移動: `advanceToNextFloor`のcarry-over経由で維持される（types.tsのdoc comment「Persists across floor transitions like inventory/abilities」）
- 死亡/run終了: 新規run（`createInitialState`呼び出し）で初期化される。post-death retryも新規run扱いのため空に戻る
- save/load: **該当なし**（後述セクション5参照、この codebase にsave/load機構自体が存在しない）

### 2.3 鑑定契機の正確な契約

- 通常使用: `finishSuccessfulCardUse(state, cardId, events)`が唯一の呼び出し元。**呼び出し元は「カードの効果を既に適用し、使用成立を確定した後」にのみこれを呼ぶ**契約（関数自身に失敗パスはない）
- 有効変化0でも成立: 該当契約はカード種別ごとの効果実装側（例: temperance/star等）にあり、本監査ではeffectId単位の成立/不成立ロジックそのものまでは検証対象外（Phase 20の既存仕様のまま、本Phaseで変更なし）
- 使用不成立: 各カードの効果適用関数が失敗と判定した場合、`finishSuccessfulCardUse`を呼ばずに`{ consumed: false, ... }`を返す。この経路では消費・鑑定・イベント・ターン進行のいずれも発生しない（`applyCardUse`の呼び出し元である`applyItemUse`が`consumed: false`をそのまま伝播）
- judgement自動鑑定: `resolveDeathIfDefeated`内で、プレイヤー死亡時に`judgement`所持があれば消費・復活・`markCardIdentified('judgement', ...)`・`judgement_triggered`イベントを同一関数内でアトミックに実行

### 2.4 未鑑定表示名の正本

- `main.ts`の`displayedItemName(itemId)`が**唯一の**表示名解決関数（インベントリ一覧・item詳細・item_actions見出し・太陽鍛冶素材リストの計6箇所すべてがこれを経由）
- 現状の実装は`CARD_IDS_IN_ORDER.includes(itemId)`かつ`!isCardIdentified(...)`の場合のみ`unidentifiedDisplayName`を返し、**それ以外（武器/防具を含む全ての非カードItemId）は常に`ITEM_DEFINITIONS[itemId].displayName`（真名）を返す**。つまり武器/防具の未鑑定表示は現状一切実装されていない

### 2.5 一般化可能部分とカード固有部分の分離

**一般化可能（構造的にItemId単位へそのまま拡張できる）:**
- `identifiedCardIds: CardId[]`という「run共有・種別単位のset」という設計パターン自体
- `isCardIdentified`/`markCardIdentified`の冪等・イベント発火パターン
- `displayedItemName`の「未鑑定ならplaceholder、鑑定済みなら真名」という単一集約関数パターン
- 「使用/装備成立時にのみ鑑定、取得だけでは鑑定しない」という契機契約

**カード固有（そのままでは他カテゴリへ適用できない）:**
- 型が`CardId[]`固定（`ItemId[]`や`(CardId | WeaponId | ArmorId)[]`へ拡張するには型変更が必要）
- `unidentifiedDisplayName`が`CardDefinition`にのみ存在し、`ItemDefinition`/武器/防具のdefinitionには対応するフィールドが存在しない
- 武器/防具は`Inventory`の数量に加えて`EquipmentInstance`という個体構造を持つため、「種別単位鑑定」と「個体単位のcursed/curseRevealed」という**既に2階建てになっている状態管理**へさらに鑑定状態を足す設計判断が必要（カードには個体構造が存在しないため、この複雑さはカード鑑定には現れなかった）

---

## 3. Consumable（カード以外）の監査

### 3.1 全7種の列挙と成立/不成立条件（実測）

| ItemId | 効果 | 不成立条件 | 有効変化0での成立可否 |
|---|---|---|---|
| apple | HP回復 | HP満タン時 `item_use_failed(full_hp)` | 不成立(0回復では常に失敗) |
| sun_fruit | SOL回復 | SOL満タン時 `sun_fruit_use_failed(sol_full)` | 不成立 |
| chocolate | 満腹度回復 | 満腹度MAX時 `chocolate_use_failed(hunger_full)` | 不成立 |
| banana | attack_up付与/更新 | 効果が既に最大duration時 `banana_use_failed(effect_at_max)` | 不成立 |
| antidote | 毒解除 | 毒でない時 `antidote_use_failed(not_poisoned)` | 不成立 |
| panacea | 全状態異常解除 | 状態異常0件時 `panacea_use_failed(no_status_ailment)` | 不成立 |
| clairvoyance_fruit | 未発見trap全開示 | **なし（trap 0件でも常に成立）** | **成立**（revealedCount=0でも`consumed: true`） |

**重要な発見**: clairvoyance_fruitは「有効変化0でも使用成立」という、カードのtemperance/star等と同種の既存契約を**カード以外の通常consumableで既に持っている**唯一の例である。これは一般アイテム鑑定のconsumable側trigger設計（使用成立時鑑定）が、カードだけでなく既存の非カードconsumableとも矛盾なく整合することを示す直接的な先例。

### 3.2 取得だけで効果や真名が分かる既存表示箇所

- 取得ログ（`item_picked_up`イベント→message-log.ts）: `displayedItemName`経由のため、カードのみ未鑑定名保護あり。非カードconsumable/武器/防具は常に真名表示
- インベントリ一覧・詳細: 同上（`displayedItemName`が真の一元化点）
- **武器/防具は現状、取得した瞬間から真名・rank・攻撃力/防御力が全て無条件表示される**（2.4節参照）。これは「一般アイテム鑑定が未実装」という前提そのものの直接証拠であり、本監査の前提と完全に整合する

### 3.3 ItemId単位run共有鑑定を追加した場合のstack処理への影響

- `Inventory[itemId]`は既に単一カウンタ（未鑑定/鑑定済みでスタックを分ける概念が存在しない）。カードは現在この方式で運用されており、鑑定状態はスタック本体ではなく別テーブル（`identifiedCardIds`）が保持するため、**スタックを分割する必要は生じていない**
- 同一ItemIdが鑑定された際、既存stack全体の表示が即座に切り替わる（`isCardIdentified`は都度呼ばれるため、鑑定イベント発生と同時に次回描画から全箇所へ反映される。実測: `phase-24-4c`のテストで確認したisCardIdentified呼び出しパターンと一致）
- **通常consumableへItemId単位run共有鑑定を導入する場合も、この既存パターンをそのまま踏襲すれば、スタック分割は不要**と判断できる（カードと同型のstorage modelであるため）

### 3.4 使用成立時鑑定 vs 使用試行時鑑定の差

現状カードは「成立時のみ」鑑定（`finishSuccessfulCardUse`が効果適用成功後にのみ呼ばれる）。この契約により：
- 失敗操作（例: HP満タンでapple使用を試みる）でRNG消費・ターン消費・鑑定が一切発生しない、という既存の安全性がconsumable全般で既に成立している
- 「試行時鑑定」（失敗しても鑑定される）を新たに導入する場合、この既存の安全性契約から逸脱するため、既存パターンとの一貫性の観点では**成立時鑑定が自然な選択**（詳細はセクション7の比較表）

### 3.5 取得routeによる鑑定契機の差の有無

現状のカード鑑定は取得route（通常床/monsterHouse報酬/敵ドロップ）を一切区別しない（`markCardIdentified`はrouteに関する情報を受け取らない）。**取得routeに応じた鑑定契機の分岐は現状存在しない。**

---

## 4. Equipment（武器/防具）の監査

### 4.1 EquipmentInstanceの全フィールド（実測、types.ts）

```
instanceId: string        // run内一意、再利用されない
definitionId: WeaponId | ArmorId
refineLevel: number       // 0以上、月/太陽で変化（Phase 20.5b）
cursed: boolean
curseRevealed: boolean    // cursedと独立フィールド、curseRevealed=trueならcursed=falseはあり得ない(normalizeが補正)
rank: EquipmentRank       // 'C'|'B'|'A'|'S'|'R'、mint時に種別から複写、以後不変
effectState?: EquipmentEffectState  // Phase 24.3、個体別カウンタ（floorTriggerUses等）
```

**「DP」という独立フィールドは実装されていない。** `types.ts`のEquipmentRankのdoc commentに「equipment rankとDPをどの段階で追加するか -> rank only」という記述があり、Phase 24.1の時点でrankのみ実装、DPは意図的に見送られたことが確認できる。task文書中の「DP」への言及は、この未実装フィールドを指すものと考えられる。

### 4.2 アイテム本体の鑑定状態に相当する既存フィールド

**存在しない。** `cursed`/`curseRevealed`は「呪いという1つの属性の発見状態」のみを扱い、「この個体の種別（definitionId）自体が判明しているか」という概念は一切存在しない。

### 4.3 definition共有鑑定 vs instance単位鑑定の比較（実装整合性の観点）

| 観点 | definition共有 | instance単位 |
|---|---|---|
| カード鑑定基盤との構造的類似度 | 高い（`identifiedCardIds`と同型：run共有set） | 低い（新しいper-instanceフィールドが必要） |
| 「同じ種別の別個体を拾った場合」の直感的動作 | 1個体でも鑑定すれば同種は即座に真名表示（不思議のダンジョン系の典型的鑑定システムと一致） | 個体ごとに再鑑定が必要（ローグライクとしては非典型） |
| EquipmentInstance構造との整合 | 追加フィールド不要（GameState直下に`identifiedEquipmentIds: (WeaponId\|ArmorId)[]`等を追加するだけ） | EquipmentInstanceへ`identified: boolean`を追加する必要あり、`normalizeEquipmentInstances`の正規化契約拡張も必要 |
| 呪い秘匿との整合 | cursedはinstance単位のまま、鑑定はdefinition単位という「2軸の独立した秘匿」になる（設計として明確に分離可能） | 鑑定もcurseRevealedも共にinstance単位となり、単純だが「種別鑑定」と「呪い判明」が同一の粒度に縮退する |

### 4.4 未鑑定装備を装備した時点の既存処理順（実測）

装備成立時の処理順序を確認するため`applyWeaponEquip`/`applyArmorEquip`相当のコードパスを確認した。現状curseRevealedは「装備成立と同じ処理内で`true`へ設定される」設計（EquipmentInstance.curseRevealedのdoc comment「equipping a cursed instance sets this true」）。**この既存の「装備成立と同時にcurseRevealedをtrueにする」処理パターンは、将来「装備成立と同時にidentifiedをtrueにする」処理を追加する際の直接のテンプレートになる**（同じ関数内に1行追加するだけで済む設計）。

### 4.5 未鑑定の呪い装備を装備した場合にcurseRevealedだけを成立させられるか

**可能。** curseRevealedは現状既に他のいかなる状態（鑑定状態含む、そもそも存在しないため独立は自明）とも無関係な単一boolean。将来「アイテム本体鑑定」フィールドを追加しても、curseRevealedのset処理とは完全に独立した別行として共存できる（型上の衝突なし、正規化関数の拡張のみで対応可能）。

### 4.6 アイテム本体鑑定とcurseRevealedを独立状態として保持できるか

**可能、かつ現状の設計と自然に整合する。** 2.4/4.4節で確認した通り、curseRevealedは既に「1つの属性のみを対象とする独立フラグ」として設計されている。アイテム本体鑑定を別の独立した状態（definition単位のset、またはinstance単位のフィールド）として追加しても、既存のcurseRevealed契約を一切変更する必要がない。

### 4.7 装備・解除・交換・置く・捨てる・拾う・合成での鑑定状態の扱い（整理、推奨设計内での想定）

- 拾う: 鑑定しない（カードと同じ契機規則を踏襲する場合）
- 装備: 鑑定する（4.4節の既存パターンをテンプレートに）
- 解除: 状態を変更しない（一度鑑定した種別は以後恒久的に真名表示、というカードの「同一run内では戻さない」契約と対称）
- 交換: 新しく装備する側にのみ4.4の処理が適用される。外れる側は無変化
- 置く/捨てる: 状態を変更しない（instance/definitionのいずれの粒度でも、GroundItemへ戻すだけでは鑑定状態は消えない設計が自然）
- 拾う（再度）: 既に鑑定済みの種別なら、取得時点で即座に真名表示（definition共有の場合。instance単位なら、たとえ種別が既知でもこの個体自体は改めて未鑑定＝矛盾した体験になりうる点が、4.3節でinstance単位案を弱める根拠の一つ）

### 4.8 太陽鍛冶の素材・結果表示が未鑑定情報を漏らす可能性

**実測で確認: 現在すでに漏れている（ただし現状「鑑定システム自体が存在しない」ため、これは新規に発生するバグではなく前提の欠如）。** `main.ts`の`solar_forge_material_b`画面（2246〜2260行台）は`displayedItemName(instanceB.definitionId)`を使っており、これはカードの未鑑定判定しか行わない現状の`displayedItemName`をそのまま経由する。**もし将来、武器/防具の鑑定を`displayedItemName`へ正しく統合すれば、この画面は自動的に未鑑定情報を守れる**（この関数を経由しない直接的な`ITEM_DEFINITIONS[...].displayName`参照が万一残っていれば、それが個別の漏洩箇所になる — 4.9/6節で全箇所を精査）。太陽鍛冶の完成品表示（`候補.recipe.outputDefinitionId`）も同じ`displayedItemName`を経由しているため、同様の扱いになる。

### 4.9 星による変換で鑑定状態を引き継ぐか新規生成扱いにするか

`star`カードの効果（`transform_item`）の実装コードそのものは本監査のスコープ外精読としたが、Phase 24.1のEquipmentInstance identity契約（「拾う・置く・捨てる・装備・鍛冶へそのまま接続できること」）から類推すると、既存の変換系カード効果は新しいinstanceを生成する設計が一般的（太陽鍛冶が既に「新規instance生成」パターンを持つことをPhase 24.2の履歴が示している）。**NEEDS_DESIGN_DECISION**: 変換結果に元の鑑定状態（definition単位なら自動的に維持される。instance単位なら明示的な引き継ぎロジックが必要）をどう扱うかは、definition共有方式を採用すれば自動的に解決する（変換後のdefinitionが既に鑑定済みなら鍛冶結果も即座に真名表示され、追加コード不要）。

### 4.10 月・太陽・節制の対象一覧が未鑑定情報を漏らす可能性

**実測で確認: 現在漏れている。** `card-target-selection.ts`の`describeCardTargetCandidate`関数が、装備individualの対象一覧表示に`ITEM_DEFINITIONS[definitionId].displayName`を直接使用しており、`displayedItemName`を経由しない独立した表示ロジックである。**これは`displayedItemName`とは別の、もう1つの漏洩ポイントとして特定した。** 一般アイテム鑑定を実装する際、`main.ts`の`displayedItemName`だけでなく、この`card-target-selection.ts`の関数も同時に鑑定対応させる必要がある（さもなくば太陽鍛冶UIと同様の抜け穴になる）。

---

## 5. Display and Leakage監査（全surface）

| Surface | 分類 | 現状の漏洩有無（実測） | 備考 |
|---|---|---|---|
| ground描画（`drawGroundItems`） | player_visible | glyphのみ、種別粒度は武器/防具ファミリー単位（🗡️/🔱/🔨/🛡️で共通、個別species名は非表示）。カードは共通🎴。**現状は漏洩なし**（種別を跨いだカテゴリのみ表示、真名は一切出ない） | 変更不要 |
| ミニマップ | player_visible | ground itemのアイコン別描画は本監査では未精読（別途要確認）。glyph同様の粒度と推測 | NEEDS_DESIGN_DECISION（未精読） |
| 取得ログ（`item_picked_up`） | player_visible | `displayedItemName`経由。**カードのみ保護、武器/防具は真名が出る** | 既知の未実装ギャップ（本Phaseの対象） |
| `enemy_drop_spawned`ログ | player_visible | Phase 24.4cで`unidentifiedCard`ガードを追加済み（カードのみ）。**武器/防具は真名が出る** | 同上 |
| inventory一覧 | player_visible | `displayedItemName`経由＋rank/curseMark直書き。**rank・攻撃力/防御力・curseは常時表示（curseのみcurseRevealedでガード済み、種別鑑定ガードなし）** | 主要な実装対象 |
| item詳細 | player_visible | 同上（`w.attackPower`/`w.reach`/`a.armorValue`を無条件表示） | 主要な実装対象 |
| 装備一覧（同inventory一覧内） | player_visible | 同上 | 同上 |
| 装備比較 | player_visible | 本監査では専用の比較UIコードを発見できず（`item_actions`/詳細画面に統合されている可能性）。追加調査が必要 | NEEDS_DESIGN_DECISION（未精読） |
| 装備中HUD | player_visible | 本監査では専用HUD描画コードの精読が未完了 | NEEDS_DESIGN_DECISION（未精読） |
| 使用対象選択（`item_actions`） | player_visible | `displayedItemName`経由 | 対応済みパターンを踏襲すれば安全 |
| 置く・捨てる対象選択 | player_visible | インベントリ一覧を再利用（`displayedItemName`経由と推測、専用コードパスは未発見） | 既存パターンに従えば安全 |
| 太陽鍛冶UI | player_visible | `displayedItemName`経由だが**武器/防具は保護対象外**（4.8節） | 主要な実装対象 |
| 星・節制の対象選択 | player_visible | `describeCardTargetCandidate`が独立実装、`displayedItemName`を経由しない（4.10節） | 主要な実装対象（見落としやすい別経路） |
| 戦闘ログ | player_visible | 武器種別の攻撃メッセージ等に`ITEM_DEFINITIONS[weaponId].displayName`を使う箇所が存在する可能性が高いが、本監査では全箇所の精読未完了 | NEEDS_DESIGN_DECISION（未精読、24.4d1着手前に要確認） |
| telemetry | internal_only | 実測: `item_picked_up`→`item_acquired`イベントで**`unidentifiedCard`を無視し常に真のitemIdを記録**（5.1節詳細） | **意図的な既存precedent**。変更不要と判断 |
| result JSON | internal_only | telemetryのJSON export自体がresult JSON（`buildTelemetryDocument`、ダウンロード専用・読み込み不可） | 同上 |
| save JSON | 該当なし | **save/load機構自体がコード上に存在しない**（セクション6参照） | 該当なし |
| debug UIおよびdebug command | 該当なし | 本監査ではdebug専用UIコードを発見できなかった（該当機能が存在しない可能性が高い） | 該当なし |
| production single-HTML/build出力 | player_visible（配布物） | ビルド出力自体はソースの単純トランスパイル結果であり、上記各surfaceの実装がそのまま反映される。**独立した追加の漏洩経路ではない** | 各surfaceの対応で自動的にカバーされる |

### 5.1 telemetryとsaveの内部ID保持の区別（明確化）

`telemetry.ts`の`item_picked_up`ケースは、`event.unidentifiedCard`フラグを一切参照せず、常に`event.itemId`（真のID）を`item_acquired`イベントへ記録する。これは**Phase 20時点からの既存の意図的な設計**であり、本監査で新たに発見した問題ではない。telemetryは「診断用の内部データ」であり「プレイヤーが遊びながら見る画面」ではないため、この区別は妥当と判断する。**一般アイテム鑑定を実装する際も、telemetry側は変更不要（内部IDのまま記録を継続してよい）。** ただし、`buildTelemetryDocument`が生成するJSONはダウンロード可能なファイルであるため、プレイヤーが望めば開いて中身を見ることは可能。これは「積極的にネタバレを見にいく行為」に相当し、通常のプレイ画面上の秘匿とは性質が異なる（この区別は`task`文書の該当ルール「telemetryやsaveの内部ID保持と、プレイヤー表示上の秘匿を区別する」と一致する）。

### 5.2 間接漏洩（並び順・色・アイコン・比較値・選択可否）の確認

- 並び順: `inventoryEntries`の具体的なソート順は本監査で未精読。種別ごとに固定順が守られる場合、未鑑定/鑑定済みの表示順が入れ替わることで間接的に「これは強い装備だ」等の推測材料になり得るが、判断には実装詳細の追加調査が必要（NEEDS_DESIGN_DECISION）
- 色: 現状のUIはPhaserのプレーンテキストレンダリングであり、着色による差別化は本監査で発見できなかった
- アイコン: glyphは前述の通りファミリー単位で共通（種別を跨いで安全）
- 比較値: item詳細のattackPower/reach/armorValueは前述の通り無条件表示（主要な漏洩経路として既出）
- 選択可否: 装備成立可否そのものがヒントになる可能性（例: 呪われた同名装備が既に装備中で二重装備不可、等）は本監査では検証していない（NEEDS_DESIGN_DECISION）

---

## 6. State Lifetime and Save監査

### 6.1 save/load機構の実在確認

**リポジトリ全体を検索したが、ゲーム状態を永続化・復元するsave/load機構は一切存在しない。** `telemetry.ts`のコメントに直接的な記述がある：

> "this codebase has no save/load mechanism, and buildTelemetryDocument's output is a one-way, download-only JSON export ... that is never read back into GameState or RunTelemetry"

すなわち、`schemaVersion: 7`はtelemetry JSONの構造バージョンであり、**ゲーム状態そのものの保存フォーマットではない**。「既存save schemaVersion」に相当するものはコード上存在しない。

### 6.2 帰結

- **schemaVersion変更は不要**（該当する保存フォーマット自体がないため）
- 既存data（旧runのGameStateオブジェクト）からの移行を心配する必要はない。各runは`createInitialState`で常にゼロから構築される
- 一般アイテム鑑定状態を保持する新フィールドは、`identifiedCardIds`が既にそうしているように、`GameState`へ`optional`フィールドとして追加すればよい。テストfixtureの互換性は「absent時は空扱い」という既存パターン（`?? []`）で自動的に担保される。**これは新規のmigration設計を必要としない**

### 6.3 一時UI状態との混同の有無

`menuScreen`/`itemActionIndex`/`cardTargetSelection`等の一時UI状態は`GameState`の外（`main.ts`側のクラスフィールド）に保持されており、GameState自体には一切含まれない。鑑定状態はゲームプレイに影響する永続情報（run共有）であるため、GameStateへ格納するのが適切であり、UI一時状態との混同のリスクは構造上存在しない。

### 6.4 RNG使用の要否

カード鑑定はRNGを一切使用しない（`markCardIdentified`は完全に決定的な処理）。一般アイテム鑑定も同型の「set/フラグへの追加」処理であるため、**RNGは不要**と判断できる。

### 6.5 未鑑定表示名の形式

固定genericプレースホルダー1種類のみ（`'未鑑定のカード'`）。**seed別alias（「あかいカード」等のランダム別名対応表）は一切実装されていない。** これはPhase 24.4d1のスコープで新設が必要になる可能性がある機能だが、task文書のquestions_to_answerが問う通り、本Phaseでは要否を評価するに留める：不思議のダンジョン系ローグライクの一般的な鑑定システム（例: 風来のシレン）ではseed別alias（呼び名）が一般的だが、現行のカード鑑定は固定genericで十分に機能しており、**一般アイテム鑑定も第一段階では固定genericで開始し、alias導入は独立した将来Phaseとして切り出す**のが最小変更の原則に合致する。

---

## 7. Required Decision Matrix

| category | current_storage_model | current_production_route | proposed_identification_scope | proposed_granularity | proposed_identification_trigger | unidentified_display | hidden_information | state_lifetime | save_impact | implementation_dependency | recommended_phase | evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cards | Inventory count + run-shared CardId set | 通常床/monsterHouse/敵ドロップ（Phase 24.4c） | 既存のまま（変更対象外） | run共有・CardId単位 | 使用成立時／judgement自動発動時 | 固定generic | 真名・効果 | run内（floor跨ぎ維持、新run/death retryでリセット） | なし（save機構なし） | — | 実装済み | セクション2 |
| ordinary_consumables | Inventory count | 通常床/monsterHouse/敵ドロップ | 未鑑定化を追加 | run共有・ItemId単位（推奨） | 使用成立時（推奨） | 固定generic（推奨） | 真名・効果 | run内 | なし | 表示関数の一般化（`displayedItemName`をItemId全般対応へ拡張） | 24.4d1 | セクション3 |
| weapons | Inventory count + EquipmentInstance | 通常床/monsterHouse/敵ドロップ（Phase 24.4a/b） | 未鑑定化を追加 | run共有・definitionId単位（推奨、4.3節） | 装備成立時（推奨） | 固定generic（推奨） | 真名・rank・攻撃力/射程 | run内 | なし | `displayedItemName`拡張＋`describeCardTargetCandidate`拡張＋curseRevealedとの独立性確保 | 24.4d1 | セクション4 |
| armor | Inventory count + EquipmentInstance | 同上 | 未鑑定化を追加 | run共有・definitionId単位（推奨） | 装備成立時（推奨） | 固定generic（推奨） | 真名・rank・防御力 | run内 | なし | 同上 | 24.4d1 | セクション4 |
| solar_gun | Inventory count + EquipmentInstance | 通常床/monsterHouse/敵ドロップ | weaponsと同一規則を適用 | 同上 | 同上 | 同上 | 同上 | 同上 | なし | 同上 | 24.4d1（weaponsと同時実装が自然） | セクション1.6 |
| S_equipment | Inventory count + EquipmentInstance（構造のみ、生成経路なし） | **現在出現しない**（構造的除外） | 未確定 | weapons/armorと同一規則を適用予定 | 同上 | 同上 | 同上 | 同上 | なし | 生成経路自体が存在しないため実質影響なし | 24.4d1（規則のみ適用、実プレイ機会は将来Phase待ち） | セクション1.6 |
| R_equipment | 同上 | **現在出現しない** | 未確定 | 同上 | 同上 | 同上 | 同上 | 同上 | なし | 同上 | 同上 | セクション1.6 |
| black_armor | 同上 | **現在出現しない**（Phase 24.7専用部屋待ち） | 未確定 | 同上（ただし専用部屋実装Phase側の設計次第で「取得時点で鑑定済み」という特別規則もあり得る） | NEEDS_DESIGN_DECISION | 同上 | 同上 | 同上 | なし | Phase 24.7と連携が必要 | Phase 24.7と同時、または24.7完了後 | セクション1.6 |
| event_items | **コード上不存在** | 該当なし | 対象外（実体がないため） | — | — | — | — | — | — | — | — | セクション1.1 |
| debug_items | **コード上不存在** | 該当なし | 対象外 | — | — | — | — | — | — | — | — | セクション1.1 |
| removed_key | **コード上不存在** | 該当なし | 対象外 | — | — | — | — | — | — | — | — | セクション1.1 |
| future_accessories | **コード上不存在**（型自体未定義） | 該当なし | 対象外（本Phaseでは新設しない、out_of_scope） | — | — | — | — | — | — | — | — | セクション1.1 |

---

## 8. Granularity比較（identification_granularity）

| 観点 | run_shared_by_item_definition | per_equipment_instance | hybrid（consumable=shared, equipment=instance） |
|---|---|---|---|
| development-planとの整合 | development-planは「Phase 20.0b/20.0cの基盤を再実装せず拡張」と定める。カード基盤（definition/種別単位）の直接延長であるため**整合度が最も高い** | development-planの記述からは特に指示されておらず、追加の新設計が必要 | consumable側は整合、equipment側は非整合 |
| Phase 20カード基盤の再利用度 | 高い（`identifiedCardIds`のset構造をそのままItemId全般へ一般化できる） | 低い（EquipmentInstanceへ新フィールドを追加する別設計が必要） | consumable側のみ高い |
| EquipmentInstanceとの整合 | 追加フィールド不要（GameState直下のsetで足りる） | EquipmentInstanceへ`identified`相当のフィールド追加、`normalizeEquipmentInstances`拡張が必要 | consumable側は無関係、equipment側は非整合コストあり |
| 呪い秘匿との整合 | curseRevealedはinstance単位のまま、鑑定はdefinition単位という「2軸独立秘匿」を明確に表現できる（4.3/4.6節） | 鑑定粒度とcurseRevealed粒度が揃うため設計はシンプルだが、「種別鑑定」の概念が実質instance単位に縮退し、同種の別個体を拾うたびに再鑑定が必要という非典型的体験になる | equipment側はinstance単位案と同じ課題を持つ |
| stackable itemとの整合 | consumableは元々ItemId単位のstackであるため完全に整合 | 該当なし（consumableにinstance概念がない） | 同左（consumable側） |
| UI実装量 | 少ない（`displayedItemName`と`describeCardTargetCandidate`の2箇所を拡張すれば足りる、4.10節） | 多い（instance単位の状態を毎回EquipmentInstanceから引く必要があり、表示ロジックの分岐が増える） | 中間 |
| save互換性 | 問題なし（save機構がないため無関係、6.2節） | 同左 | 同左 |
| テスト容易性 | 高い（Phase 24.4cのカードテストと同型のテストパターンをそのまま複製できる） | 低い（instance単位の状態遷移パターンを新規に設計する必要） | consumable側は容易、equipment側は複雑 |
| 将来アクセサリーへの拡張 | 容易（同じsetパターンをアクセサリーのdefinitionIdへ追加するだけ） | アクセサリーもinstance構造を持つ設計であれば対応可能だが、既存のweapon/armor instanceパターンの複製が必要 | 同左 |
| 不要な汎用化の有無 | 低い（カードの既存パターンをそのまま転用するだけで、過剰な抽象化を導入しない） | 「個体ごとの鑑定」という、不思議のダンジョン系ローグライクの一般的な鑑定慣習から外れた過剰な複雑化になりうる | consumable側は問題なし |

**監査者の推奨（provisional_recommendation）**: consumable・weapon・armorのいずれも**run_shared_by_item_definition（definition/ItemId単位のrun共有set）**を採用する。カード基盤の直接延長として実装量が最小であり、development-planの「基盤を再実装せず拡張」という方針にも直接合致する。

---

## 9. Trigger比較（identification_trigger）

| 観点 | successful_use_or_equip | use_or_equip_attempt | pickup | route_dependent | fixed_reward_auto_identified |
|---|---|---|---|---|---|
| 既存の使用成立契約 | カードの`finishSuccessfulCardUse`と完全に一致する既存パターン | 既存のいかなるカード/consumable実装にも先例がない | 既存に先例なし（「取得しただけでは鑑定しない」という明文化されたカード契約と正面から矛盾） | 先例なし、複雑さのみ増える | 太陽鍛冶の完成品等、特定の生成経路が保証する情報があれば理論上あり得るが、現状の生成経路（通常床/monsterHouse/敵ドロップ）はいずれも同列でありrouteによる差別化の必然性がない |
| 失敗操作の副作用禁止 | 満たす（失敗時は鑑定含め一切の副作用がない、3.4節） | 満たさない（HP満タンでapple使用を試みただけで鑑定される、既存の「不成立では何も起きない」契約を破る） | 該当なし | 該当なし | 該当なし |
| カード鑑定との一貫性 | 完全に一致 | 不一致 | 不一致（「取得だけでは鑑定しない」という既存の明文規則そのものに反する） | 不一致（カードにroute依存の鑑定契機は存在しない） | 部分的一致（judgementの自動発動鑑定は一種の「特定条件下の自動鑑定」だが、生成route由来ではなく効果発動由来） |
| 呪い装備のリスク | 装備成立時点で鑑定される場合、呪われた装備でも「装備してみるまで種別が分からない」という不思議のダンジョン系の緊張感を保てる | 装備を試みただけ（失敗時も）で鑑定されると、緊張感が薄れる | 拾っただけで真名が分かると、緊張感が最も薄れる | 経路依存では緊張感の一貫性が保てない | 該当なし |
| プレイヤーが判断できる情報量 | 装備/使用という「リスクを取る行動」の直後に情報が得られるため、次回以降の同種アイテムの判断材料になる、というローグライクの典型的な学習曲線に合致 | 同上だが試行のハードルが低すぎる | 判断材料を得るためのリスクが一切ないため、鑑定システムの意義自体が薄れる | 一貫性がなく学習しにくい | 特定itemのみ別ルールとなり一貫性が崩れる |
| 実装の複雑さ | 低い（既存の装備/使用成立処理の直後に1行追加するだけ、4.4節） | 低い（同様に低いが、既存の「不成立時ガード」を回避する追加分岐が必要） | 低い（取得処理へ1行追加するだけだが、意味的に不適切） | 高い（route情報を鑑定関数まで伝播させる新しい配線が必要） | 中（特定itemを特別扱いする例外分岐が必要） |
| 既存ログ・UIとの整合 | 完全に整合（既存の`card_identified`イベントパターンをそのまま複製できる） | 新しいイベント設計が必要（「試行失敗でも鑑定された」ことをどう表現するか） | 「取得ログでいきなり真名が出る」という、現行のカード取得ログ（未鑑定名表示）と矛盾する体験になる | 複雑 | 部分的 |

**監査者の推奨**: **successful_use_or_equip**（使用成立時／装備成立時のみ鑑定）を採用する。カードの既存契約と完全に一致し、失敗操作の副作用禁止という既存の安全性契約を壊さず、実装コストも最小。

---

## 10. 推奨する24.4d1実装契約（provisional_recommendation）

以下は監査結果に基づく監査者の推奨であり、コード上の事実そのものではない。24.4d1着手前にプロダクトオーナーの最終承認が必要。

1. **granularity**: consumable・weapon・armorともに`run_shared_by_item_definition`（ItemId/definitionId単位のrun共有set）
2. **trigger**: consumableは使用成立時、weapon/armorは装備成立時。太陽鍛冶完成品はNEEDS_DESIGN_DECISION（後述）
3. **型設計案**: `GameState.identifiedCardIds?: CardId[]`と並行して、新規`GameState.identifiedItemIds?: ItemId[]`（またはCardIdも統合した単一`ItemId[]`型へ将来的に一般化する余地を残しつつ、本Phaseでは既存`identifiedCardIds`はそのまま維持し、カード以外専用の新フィールドを追加する最小変更案を推奨——development-planの「再実装せず拡張」原則により、既存のcardId専用フィールドを壊さず追加する方が安全）
4. **表示関数の拡張**: `main.ts`の`displayedItemName`をカード限定チェックから「ItemId全般（Weapon/Armor含む）が鑑定済みか」の判定へ一般化。**加えて**`card-target-selection.ts`の`describeCardTargetCandidate`（4.10節で発見した別経路）も同時に対応させる
5. **curseRevealedとの独立性**: 新規鑑定フィールドとcurseRevealedは完全に独立したまま実装する（4.6節）
6. **黒の鎧/S/R装備**: 現状生成経路が存在しないため、規則のみ適用（コードは書くが実プレイでは到達しない）。black_armorの「取得時点で鑑定済みか」はPhase 24.7側の設計判断に委ねる

---

## 11. NEEDS_DESIGN_DECISION一覧

以下は監査だけでは断定できず、設計判断が必要な項目：

1. 太陽鍛冶の完成品（新規instance生成）を自動鑑定するか、通常個体と同じく未鑑定スタートにするか（4.9節）
2. 星による変換後の鑑定状態の扱い（definition共有方式なら自動解決するが、instance単位案を採る場合は明示的な引き継ぎロジックが必要）（4.9節）
3. black_armor/S/R装備を取得した瞬間に鑑定済み扱いにする特別規則を設けるか（現状生成経路がないため緊急性は低い）
4. ミニマップのground itemアイコン表示が種別を漏らすかどうか（本監査で未精読）
5. 装備比較UI・装備中HUDの実装有無・内容（本監査で該当コードを発見できず、存在しない可能性が高いが未確定）
6. 戦闘ログの武器名表示全箇所の精査（本監査は主要な6+1箇所を特定したが、戦闘ログ内の武器名表示は全箇所を洗い出せていない）
7. inventory一覧の並び順が間接的な情報源になるか（5.2節）
8. 装備成立可否（二重装備不可等）が間接的な情報源になるか（5.2節）
9. seed別alias（呼び名対応表）を24.4d1で新設するか、固定genericのまま次Phase以降へ先送りするか（監査者は先送りを推奨、6.5節）
10. `identifiedCardIds`をそのまま維持するか、それとも新設する`identifiedItemIds`と統合した単一の型へリファクタリングするか（監査者は非統合・追加のみを推奨、10節）

---

## 12. 24.4d1の変更候補ファイル（推定、実装時に確定）

- `src/game/types.ts`（GameState新フィールド追加）
- `src/game/turn.ts`（`isCardIdentified`類似の一般化関数、装備成立/使用成立時の鑑定呼び出し追加）
- `src/game/item-def.ts`または新規`src/game/item-identification.ts`（未鑑定表示名の一般化、`ItemDefinition`への`unidentifiedDisplayName`相当フィールド追加検討）
- `src/main.ts`（`displayedItemName`の一般化）
- `src/game/card-target-selection.ts`（`describeCardTargetCandidate`の鑑定対応、4.10節の見落としやすい別経路）
- `src/game/message-log.ts`（`item_picked_up`/`enemy_drop_spawned`以外にも武器/防具取得時の表示分岐が必要になる可能性）
- `src/game/events.ts`（必要であれば新規イベントフィールド追加、Phase 24.4cの`unidentifiedCard`パターンを踏襲）

---

## 13. 24.4d1のfocused test計画

### カテゴリ別: 正常系
- consumable使用成立時に鑑定される（apple/sun_fruit/chocolate/banana/antidote/panacea/clairvoyance_fruit各1件）
- 武器装備成立時に鑑定される（各family代表1種＋solar_gun）
- 防具装備成立時に鑑定される

### カテゴリ別: 不成立系
- consumable使用不成立（HP満タンでapple等）で鑑定・消費・RNG消費・ターン進行が一切起きない
- 装備の交換・解除では鑑定状態が変化しない

### 表示漏洩
- 未鑑定時、インベントリ一覧・item詳細・太陽鍛冶UI・星/節制対象選択のいずれからも真名/rank/攻撃力/防御力が漏れない
- 鑑定後は同じ4箇所すべてで真名表示に切り替わる

### save migration相当
- `identifiedItemIds`（新フィールド）がabsentな既存GameStateフィクスチャでも例外なく動作する（`?? []`パターン）

### カード既存挙動の回帰
- Phase 20/24.4cのカード鑑定テストが本Phaseの変更後も全通過する
- `identifiedCardIds`と新規フィールドが独立して共存する

### equipment identityとcurseRevealedの独立性
- 鑑定済み＆未呪い、鑑定済み＆呪い未発覚、鑑定済み＆呪い発覚、未鑑定＆呪い発覚（装備直後）の4状態marixがすべて独立して成立する

### floor移動・new run・save/loadの状態寿命
- フロア移動後も鑑定状態が維持される
- 新規runで鑑定状態が空に初期化される（post-death retryも含む）
- save/loadは対象外（機構が存在しないため該当テスト不要）

### 太陽鍛冶・星・月・太陽・節制との連携
- 太陽鍛冶完成品の鑑定状態（NEEDS_DESIGN_DECISION#1の決定後に確定）
- 星変換後の鑑定状態（NEEDS_DESIGN_DECISION#2の決定後に確定）
- 月/太陽の強化対象一覧、節制の解呪対象一覧が未鑑定情報を漏らさない

---

## 14. Phase 24.4eへ残す呪い・DP・装備ランク接続

- 呪い付与経路の拡張（現状はfloor生成時のFLOOR_EQUIPMENT_CURSE_CHANCEのみ）
- DP（現状未実装フィールド、4.1節）の追加
- 装備ランクの生成後変更（refineLevel以外のrank変更機構）

いずれも本監査・24.4d1のスコープ外として維持する。

---

## 15. 実行結果

- baseline focused tests（24.4a/24.4b/24.4c）: 86件全通過
- full suite: 120ファイル / 3025テスト全通過（変更なし、期待値と完全一致）
- typecheck: エラーなし
- production build: 成功（成果物は検証後削除）
- **production挙動差分なし**: 本Phaseはコード変更を一切行っていないため、buildの成果物・full suiteの結果は監査開始時点と完全に同一
- 一時ファイル: 監査は全て`grep`/`view`によるコード読解のみで行い、一時スクリプト・一時テストファイルは一切作成しなかった

## development-plan更新可否

リポジトリ内（`/home/claude/repo`）を検索したが、`rogue-of-sun-development-plan.md`という同名ファイルは存在しなかった（`docs/rogue-of-sun-game-concept.md`のみ存在、Phase 24.4c監査時と同じ状況）。方針に従い新規作成は行わず、最終報告に更新不能と記載する。
