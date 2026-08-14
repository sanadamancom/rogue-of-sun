# Phase 24.4a: 通常装備ドロップとmonsterHouse報酬への装備カタログ接続

## Precheck

- base branch: `phase-24-3-equipment-catalog-effects`（origin HEAD `d5a6c36`）と一致確認
- origin/main、既存Phase branch未変更
- working tree clean、同名local/remote work branch衝突なし
- Phase 24.3 baseline: 117ファイル / 2939テスト全通過

## Stage 0 監査で判明した事実

`development-plan.md`はこのリポジトリには存在しない（`docs/`配下は`rogue-of-sun-game-concept.md`のみ）。ChatGPT側で別途管理されている資料と判断し、リポジトリ内の直近history（Phase 24.0〜24.3）を実装事実の一次情報源とした。

Phase 24.3 history（`phase-24-3-equipment-catalog-effects.md`）は「`reward_candidate_tables`のnormal/special候補表はテストコード内で定義・検証したが、production floor生成へは一切接続していない」と明記しており、実際に`phase-24-3-equipment-catalog.test.ts`を確認しても、通常用・報酬用の重み付き候補表そのもの（definitionId×weightのテーブル）はコード上どこにも存在しなかった（テストは「現行floor生成が旧5種のみを維持している」ことの検証のみ）。

このため、タスク仕様の「Phase 24.3に既に通常用・報酬用候補表が存在する場合は、それを唯一の定義源として利用する」は不成立と判断し、「数値weightが未確定なら、中央集約されたprovisional設定として実装し、Phase 24.6調整対象であることを明記する」の分岐に従い、本Phaseで新規にprovisional候補表を実装した。stop_and_reportの「Phase 24.3 catalog/reward tableに解決不能な重複・欠落がある」には該当しない（欠落はあったが、タスク仕様自体がその場合の対応を規定しており、解決可能だったため）。

既存の生成境界を確認：`state.ts`のbuildFloorState内、通常生成ループとmonsterHouse報酬ループの両方に、`isWeaponOrArmorId(itemId)`が真の場合にのみ`mintEquipmentInstance`を呼ぶ、同一パターンの箇所が2か所存在する。いずれも、`item-def.ts`のプール（`GROUND_ITEM_POOL_FLOOR_*`/`getWeightedGroundItemPoolForFloor`）から選ばれる`itemId`が、旧5種（`sword`/`spear`/`hammer`/`armor`/`solar_gun`）のいずれかである、という前提のまま`itemId`を直接`definitionId`としてmintしていた。

## 実装した階層比率関数

`equipment-loot.ts`の`floorProgressRatio(floor, totalFloors)`：`clamp(floor / max(1, totalFloors), 0, 1)`。floor<=0は0に、floor>totalFloorsは1にclampする。floor===1/2/3のような固定分岐は一切持たず、`floorProgressRatio(7, 10) === floorProgressRatio(70, 100)`であることをテストで直接検証済み。

## 通常生成対象rankと除外対象

- 通常床生成・monsterHouse報酬とも、対象rankはC/B/Aのみ（S/Rは構造的に候補配列へ含まれない）
- `armor`スロットは`ARMOR_IDS_IN_ORDER`からid `!== 'black_armor'`かつrank C/B/Aのものだけを候補化しており、black_armorは通常候補表そのものに存在しない（除外フィルタ漏れによる事故を構造的に防止）
- `sword`/`spear`/`hammer`スロットは各ファミリーのC/B/A種（各2種、計6候補）
- `solar_gun`スロットは常に`solar_gun`単体（Phase 23.1仕様を完全維持、既存供給契約を変更しない）

## 使用した候補表・weight

Phase 24.3に確定済みの数値weightが存在しなかったため、`RANK_WEIGHT_PROVISIONAL`（`equipment-loot.ts`）としてprovisional値を中央集約実装した：

```
C: base 5, slope 0   （常に5、比率に依存せず一定 → 浅い階層でも供給が消失しない）
B: base 2, slope 3   （比率0で2 → 比率1で5）
A: base 1, slope 4   （比率0で1 → 比率1で5）
```

各rankの`weight = base + slope * ratio`を、そのrank内の種数で均等に按分し、単一のflatten済み配列へ結合したうえで、1回のrng()呼び出しで累積重み抽選する。Phase 24.6での再調整はこの3行（`RANK_WEIGHT_PROVISIONAL`）のみを変更すれば足りる設計とし、3F専用の値やfloor分岐は一切含めていない。

## 通常生成とmonsterHouse接続結果

`state.ts`のbuildFloorState内：

- 新規RNGストリーム`equipmentDefinitionRng`（`floorSeed ^ 0xd4e8a273`、既存の全ストリームと重複しない専用XOR定数）を追加し、`equipmentCurseRng`と同じ相対順序で、装備が選ばれた床アイテム1件につき1回だけ消費する
- 通常生成ループ・monsterHouse報酬ループの双方が、`isNormalEquipmentSlot(itemId)`が真の場合に`selectNormalEquipmentDefinition(itemId, equipmentFloorRatio, equipmentDefinitionRng)`を呼び、解決済みdefinitionId（例: `flamberge`）を`mintEquipmentInstance`と`GroundItem.itemId`の両方へ使用する
- 両ループは`equipment-loot.ts`の同一関数を呼ぶだけで、装備リストそのものはどちらのファイルにも再記述していない
- 既存の床アイテム総数・配置座標・カテゴリ抽選契約（何個アイテムが出るか、weapon/armor/consumable/cardのどれが選ばれるか）は無変更。本Phaseで変わるのは「weapon/armorカテゴリが選ばれたあと、どの具体的definitionIdになるか」だけ
- monsterHouse報酬の既存発生判定・部屋選択・敵配置・報酬位置・報酬数（`MONSTER_HOUSE_REWARD_COUNT`）は無変更。報酬候補プール自体（`getWeightedGroundItemPoolForFloor`）も無変更で、そこから選ばれた`sword`等のスロットIDを同じ`selectNormalEquipmentDefinition`で解決するのみ

`GroundItem.itemId`が旧来「プールのスロットID」から「解決済みの実際のdefinitionId」に変わったため、この前提に依存していた既存テスト1件（`phase-20-0c-equipment-instance.test.ts`の「consumable and card ground items never receive a curse determination」）を、ハードコードされた5種リストとの一致判定から、Phase 24.3で既に42種フルカタログ対応済みの`isWeaponOrArmorId`（`equipment-instance.ts`）を使う判定へ最小修正した。アサーションの意図（consumable/cardはequipmentInstanceIdを持たない）は変更していない。

## 除外保証

- `getNormalEquipmentCandidates`は`armor`スロットについて`black_armor`を候補配列へ一度も含めない（フィルタ漏れではなく構造的除外）
- 新規テストで、通常床500seed×floor1-3と、monsterHouse報酬発見seedの両方について、`black_armor`および rank S/Rが一度も出現しないことを直接検証済み

## seed/snapshot監査結果

- `selectNormalEquipmentDefinition`は同一(slot, ratio, rngシーケンス)に対し常に同一出力を返す純粋関数であることを確認
- 装備definitionId解決の追加によって、terrain/rooms/start/exit/敵座標/罠座標/ground item座標/monsterHouse発生・部屋・報酬座標が変化しないことを、既存`generateMap`直接呼び出しとの比較、および同一seedの2回生成一致比較の両方で確認
- TOTAL_FLOORS 3/10/100の3構成すべてで、代表floor（1・中間・最深）×代表seed（1, 42, 999）の組み合わせで例外・不正rank出現が0件であることを確認
- production sanity（一時スクリプト、検証後削除）: 深い比率（ratio=1.0）でのB/A出現数が、浅い比率（ratio=0.0）より明確に多いこと（2000回抽選でshallowBA=729 vs deepBA=1331）、black_armorが500seed×3フロアで一度も出現しないこと、7/10と70/100が完全に同一の候補配列を返すことを確認

## 新規・更新テスト数

- `phase-24-4a-equipment-loot-supply.test.ts`: 31件（新規）
- 既存テストの更新: `phase-20-0c-equipment-instance.test.ts`の1件（ground.itemIdが解決済みdefinitionIdになったことに伴う判定ロジックの最小修正、アサーション意図は不変）

## full suite/typecheck/build/diff-check

- full suite: `npx vitest run` — 118ファイル / 2970テスト全通過
- typecheck: `npx tsc --noEmit` — エラーなし
- build: `npx vite build` — 成功（dist は検証後削除）
- diff-check: `git diff --check` — 問題なし

## 24.4b〜24.4dへの引き継ぎ

- 24.4b（敵通常ドロップ）: 本Phaseの`equipment-loot.ts`（`floorProgressRatio`/`getNormalEquipmentCandidates`/`selectNormalEquipmentDefinition`/`RANK_WEIGHT_PROVISIONAL`）はそのまま再利用可能。敵ドロップ専用の候補表・確率は別途必要になる可能性が高い
- 24.4c（未鑑定・鑑定）: 本Phaseは鑑定状態に一切触れていない
- 24.4d（呪い・解呪・カード床供給・統合監査）: `equipmentCurseRng`による呪い抽選は本Phaseで変更していない（既存のまま）。統合監査時、`equipment-loot.ts`のprovisional weightがPhase 24.6で確定値へ差し替えられる前提であることに留意
- Phase 24.6: `RANK_WEIGHT_PROVISIONAL`の3行のみを対象に再調整可能な設計にしてある
- Phase 24.7: 黒の鎧専用部屋は引き続き未着手。`getNormalEquipmentCandidates('armor', ratio)`がblack_armorを構造的に除外しているため、24.7実装時もこの関数を変更せず、専用部屋側の別経路でのみblack_armorをmintすること

## 指示逸脱の有無

- 「Phase 24.3に既に通常用・報酬用候補表が存在する場合は、それを唯一の定義源として利用する」という前提は、監査の結果、実際には候補表が存在しなかったため成立しなかった。タスク仕様自身が明記する代替経路（provisional設定として中央集約実装し、Phase 24.6調整対象と明記する）に従っており、これは指示からの逸脱ではなく、監査結果に基づく想定内の分岐である
- 既存テスト1件（`phase-20-0c-equipment-instance.test.ts`）を最小修正した。修正理由は上記「通常生成とmonsterHouse接続結果」の節に明記した通りで、アサーションの意図・検証対象は変更していない
- それ以外の逸脱なし
