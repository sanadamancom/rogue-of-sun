# Phase 15.4: 床落ちアイテムのランダム生成

作成日: 2026-08-05
対象commit: `phase-15-4-random-ground-items`ブランチ（`main` HEAD `a911cb49293f738041f78321d4977a9f701094fa`から分岐）
参照資料: Phase 15.4a事前監査・訂正監査（本docの直接の前提）

## 1. 対象範囲

現行のアイテム別確定配置（apple全階保証・sword/armor floor1保証・spear/hammer floor2保証・sun_fruit/solar_gun保証・各属性解禁品の単一floor保証・antidote/panacea最大1個、など15種類以上の個別ハードコード分岐）を廃止し、各フロアの床落ちアイテム総数を2〜6個の分布から一括抽選する方式へ全面的に置き換えた。敵数（6/7/8体）の変更、罠の仕様変更、個別レアリティ・カテゴリ重みの導入はPhase 15.5以降へ保留し、今回は対象外とした。

## 2. 旧確定配置方式（廃止したもの）

`state.ts`のbuildFloorStateには、アイテムごとに個別の`if (floor === N)`分岐・個別のXOR定数によるRNGストリーム・個別の除外リスト構築コードが15ブロック以上存在していた。廃止した保証は以下のとおり（Phase 15.4a監査で実測済み）。

| 廃止した保証 | 旧内容 |
|---|---|
| appleの全階確定配置 | 毎フロア必ず1個 |
| chocolateの全階確定配置 | 毎フロア必ず1個 |
| bananaの全階確定配置 | 毎フロア必ず1個 |
| sword・armorのfloor1確定配置 | floor1のみ各1個必ず |
| spear・hammerのfloor2確定配置 | floor2のみ各1個必ず |
| sun_fruitのfloor1・floor2確定配置 | 各floorに1個必ず |
| solar_gun・sol_enchantmentのfloor1確定配置 | floor1のみ各1個必ず |
| flame_enchantmentのfloor1確定配置 | floor1のみ1個必ず |
| frost_enchantment・cloud_enchantmentのfloor2確定配置 | floor2のみ各1個必ず（cloudはfrostと別部屋を優先する特別ロジック付き） |
| earth_enchantmentのfloor3確定配置 | floor3のみ1個必ず |
| antidote・panaceaの個別最大1個配置 | 全階、候補があれば最大1個（保証ではないが個別処理として存在） |

旧方式でのfloor別実測アイテム数（Phase 15.4a訂正監査で確定）：floor1=最小9・最大11個、floor2=最小8・最大10個、floor3=最小4・最大6個。

## 3. 新しい2〜6個分布

`item-def.ts`に`GROUND_ITEM_COUNT_WEIGHTS`（[{count:2,weight:10},{count:3,weight:25},{count:4,weight:30},{count:5,weight:25},{count:6,weight:10}]、合計100）を単一の正本として新設した。`drawGroundItemCount(rng)`は`Math.floor(rng()*100)`の結果（0〜99）を累積重みテーブルへ写像し、rng()呼び出しは1回だけ消費する。期待値は2×0.10+3×0.25+4×0.30+5×0.25+6×0.10=**4.00**（`phase-15-4-random-ground-items.test.ts`で20,000回抽選した実測値でも3.9〜4.1の範囲に収まることを確認）。境界値（roll=0,9,10,34,35,64,65,89,90,99）が仕様どおりの個数へ写像されることも固定テストで検証した。

罠（slow_trap・poison_trap）はこの個数抽選の対象外とし、`included_in_item_count: false`のとおり従来どおり別枠・別RNGストリームで生成する（後述）。

## 4. floor別pool全ID（累積式）

`item-def.ts`に以下を新設した（Phase 15.4a訂正監査で確定した内容と完全一致）。

```
GROUND_ITEM_POOL_FLOOR_1 (11件):
  apple, sword, armor, sun_fruit, solar_gun, sol_enchantment,
  chocolate, banana, flame_enchantment, antidote, panacea

GROUND_ITEM_POOL_FLOOR_2_ADDITIONS (4件):
  spear, hammer, frost_enchantment, cloud_enchantment

GROUND_ITEM_POOL_FLOOR_3_ADDITIONS (1件):
  earth_enchantment
```

`getGroundItemPoolForFloor(floor)`はfloor<=1でfloor1プール（11件）、floor===2でfloor1+floor2追加（15件）、floor>=3でfloor1+floor2+floor3追加（16件＝全登録アイテム）を返す。floor番号が範囲外（0以下・4以上）の場合は、0以下はfloor1プールへ、4以上はfloor3プール（全件）へフォールバックする（`TOTAL_FLOORS=3`のため通常到達しないが、堅牢性のため実装した）。累積包含関係（floor1⊂floor2⊂floor3）と件数（11/15/16）は`phase-15-4-random-ground-items.test.ts`で固定テスト済み。

## 5. 重複規則

`item-def.ts`に`ENCHANTMENT_ITEM_IDS`（sol_enchantment・flame_enchantment・frost_enchantment・cloud_enchantment・earth_enchantmentの5件）を新設し、`drawGroundItemSelection(count, pool, rng)`内で「一度描画したenchantment IDは以後の描画候補プールから除去する」ロジックを実装した。通常アイテム（武器・防具を含む11種）は候補プールから除去されず、同一フロア内で複数回選ばれ得る。全floorのpoolにおいて通常アイテムの数（floor1で9種、floor2で13種、floor3で14種）が最大抽選数（6）を常に上回るため、enchantment候補が枯渇しても通常アイテムで抽選総数を満たせることを保証している（`does not starve later draws when every enchantment candidate has already been drawn`テストで検証）。

## 6. 解禁済み属性品の除外規則

`state.ts`に`getAlreadyUnlockedEnchantmentItemIds(carry)`を新設した。`carry`（前floorからの持ち越し情報）の`solUnlocked`・`unlockedEnchantments`（flame/frost/cloud/earth）を参照し、既に解禁済みのenchantment internal IDの集合を返す。新規ラン開始時（carryなし）は何も解禁されていない前提で空集合を返す。この集合はfloorのpoolから`Array.filter`で事前に除外されたうえで`drawGroundItemSelection`へ渡され、解禁済みの属性品は二度と抽選候補にならない。固定テストで「floor1でsolを解禁済みとしてfloor2へ進むと、floor2の抽選結果にsol_enchantmentが一切含まれない」「全属性解禁済みなら5種のenchantment IDが一切出現しない」ことを検証した。

## 7. RNGストリーム構成

`buildFloorState`内、既存の独立ストリーム設計（`createRng(floorSeed ^ 固定XOR定数)`）を維持しつつ、新設した3ストリームを含め以下の順で消費する。

```
1. placementRng   (0x51ed270b) — choosePlacement（敵配置座標、既存）
2. speciesRng      (0x8f3c9d21) — chooseSpecies（敵種別、既存）
3. slowTrapRng     (0x1a6f83c5) — 罠1（既存、位置のみ変更なし）
4. poisonTrapRng   (0x3f9c5e82) — 罠2（既存、位置のみ変更なし）
5. itemCountRng    (0xa3c17f05) — アイテム個数抽選（新規。旧appleRngの定数を再利用）
6. itemSelectionRng(0x5c2e91d3) — アイテム種類抽選（新規。旧swordRngの定数を再利用）
7. itemPlacementRng(0x91b6d8e4) — アイテム座標抽選（新規。旧armorRngの定数を再利用、選択されたN個すべてに同一ストリームを使い回す）
```

種類抽選（6）と座標抽選（7）は完全に別ストリームであり、個数抽選（5）にも別ストリームを使う。既存の敵配置・敵種別・罠のストリームは変更していない。**罠の生成順序を変更した**：旧実装では大半のアイテムより後・一部のアイテム（antidote等）より前という中途半端な位置にあったが、新実装では「罠を先に生成し、アイテムは罠を含めて除外する」という順序に統一した（アイテム側の除外リストが罠を含む、という仕様どおりの実装）。罠自身の除外リストはstart/exit/敵位置のみとなり、アイテムを除外しなくなった（アイテムがまだ存在しない時点で罠を生成するため）。

## 8. 多数seed試験結果

- `robustness.test.ts`の既存1000シードチェック：候補不足によるthrowなし、全件成功。
- `multi-floor-robustness.test.ts`の既存100シード×3フロア（300フロア）チェック：形状検証・決定性検証とも成功。
- 新規追加した`phase-15-4-random-ground-items.test.ts`の300シード生成ループ（`generation never throws`）：候補不足によるthrowなし。
- 同ファイルの150シード×3フロアループ：groundItemsが常に2〜6個、start/exit/敵/他アイテムと非重複であることを確認。
- 同一seedでのgroundItems完全一致（個数・種類・座標）、異なるseed間での非一致（生成が固定化されていないこと）も確認。

## 9. 決定性への影響

既存の「floorSeedからXOR定数で独立ストリームを導出する」設計をそのまま踏襲しているため、同一実装・同一seedでの再現性は維持される。順序を変更したのは罠とアイテムの相対関係のみで、それぞれのストリーム自体は`floorSeed`から独立に導出されるため、罠の座標抽選結果（生成順序が変わったことで除外リストの中身が変わった影響を除く）自体の決定性メカニズムに変更はない。

## 10. 更新・削除した既存テスト

以下の11ファイルで、アイテム別確定配置を前提としたアサーション（`toHaveLength(1)`等）を「存在すれば正しい位置にある」「累積poolに含まれる」「複数seedにわたって出現有無が変動する」という形へ書き換えた。いずれもテストの検証対象を弱めたり決定性検証を削除したりせず、新しい生成モデルの実際の仕様に合わせて再定義した。

- `weapon-and-sword.test.ts`（sword）
- `armor-and-golem.test.ts`（armor）
- `hammer-knockback-weapon.test.ts`（hammer）
- `spear-reach-weapon.test.ts`（spear）
- `hunger-food-starvation.test.ts`（chocolate）
- `inventory-and-apple.test.ts`（apple）
- `phase-09-1-solar-energy-foundation.test.ts`（sun_fruit）
- `phase-09-2-solar-gun.test.ts`（solar_gun）
- `phase-10-1-sol-enchant.test.ts`（sol_enchantment）
- `phase-12-1-temporary-effect-banana.test.ts`（banana）
- `phase-14-2-element-acquisition-selection.test.ts`（flame/frost/cloud/earth_enchantment）

`phase-14-2-element-acquisition-selection.test.ts`の「frost/cloudを別部屋に優先配置する」テストは、その基盤となる特別ロジック自体を新実装（統一されたchooseGroundItemPositionの繰り返し呼び出し）で意図的に持ち越さなかった（Phase 15.4bの仕様がこの特別扱いを要求していないため）ので削除した。

新規追加：`phase-15-4-random-ground-items.test.ts`（26件、個数分布境界値・pool件数と累積関係・重複規則・解禁済み除外・多数seed生成検証）。

## 11. 敵数変更をPhase 15.5へ保留したこと

`out_of_scope`のとおり、敵数の6/7/8体化・`ENEMY_COUNT_BY_FLOOR`の追加・敵種別poolの変更は本フェーズで一切行っていない。`mapgen.ts`の`ENEMY_COUNT_PER_FLOOR = 2`（全floor共通）は無変更のまま維持した。Phase 15.4a監査報告のとおり、敵数の正本化は別フェーズ（Phase 15.5想定）で`mapgen.ts`へ追加することを提案済みだが、今回は実装していない。
