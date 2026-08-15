# Phase 24.4d2: 星カード変換の差分監査・整合

## 開始時の完全なHEAD

`8ab8157a0e0eb8d1f9ead633c29d89a43d8a67df`（`phase-24-4d1-general-item-identification`）

## 当初の未実装前提が誤りだったこと

当初の工程指示書（phase-24-4d2-star-transformation-completion）は「星カードの実変換効果が未実装」という前提で書かれていたが、precheck段階でこれは事実誤認であることが判明した。

`turn.ts`の`resolveStarEffect`（`CARD_TARGET_EFFECT_RESOLVERS.star`として登録済み）、`card-target-selection.ts`の`getTransformCandidatesForItem`/`getStarCandidates`、および`applyTargetedCardUse`（`use_targeted_card`アクション経路）はPhase 20.5aで既に実装済みで、`phase-20-5a-targeted-card-effects.test.ts`のstar関連30テストも全通過していた。

この事実を受け、工程は「星カード新規実装」から「既存の星変換実装の差分監査・整合」（phase-24-4d2-star-transformation-alignment）へ再定義された。本ドキュメントはこの再定義後の工程の記録である。

## 既存production routeの特定結果

- `resolveStarEffect`（turn.ts）— 星の`CardTargetEffectResolver`本体
- `CARD_TARGET_EFFECT_RESOLVERS.star = resolveStarEffect`（turn.ts）— resolver登録
- `applyTargetedCardUse`（turn.ts）— `use_targeted_card`アクションの検証・commit・鑑定・ターン進行
- `getTransformCandidatesForItem`/`getStarCandidates`/`isCardTargetStillValid`（card-target-selection.ts）— 候補列挙・再検証

これらを唯一のproduction routeとして維持し、並行実装や別RNG経路は一切追加していない。

## 契約別監査表

| 契約 | 判定 |
|---|---|
| target: 通常consumable/weapon/armor許可 | COMPLIANT |
| target: card除外 | COMPLIANT |
| target: solar_gun/black_armor/S/R除外 | **GAP → 修正** |
| target: 変換元と同一定義除外 | COMPLIANT |
| target: 呪いで固定された装備中equipment除外 | **GAP → 修正** |
| result: 同カテゴリ限定 | COMPLIANT |
| result: 通常consumable7種のみ（enchantment除外） | **GAP → 修正** |
| result: Phase 24.4a C/B/A選択基盤の再利用 | **GAP → 修正**（rank除外のみ導入。重み付き選択自体は星独自の均等抽選を維持——後述） |
| candidate_count 0/1/multiple | COMPLIANT |
| success: target1個除去・result1個生成・stack1個減 | COMPLIANT |
| success: Star消費・鑑定・1ターン進行 | COMPLIANT |
| failure/cancel: 完全no-op | COMPLIANT |
| equipment_identity: instance再生成・非継承 | COMPLIANT |
| equipment_identity: 装備中targetの同slot自動置換 | COMPLIANT |
| curse: 新規結果の呪いを正規helperで新規判定 | **GAP → 修正** |
| curse: curseRevealedとfresh curse装備成立の連動 | **GAP → 修正**（旧実装は常時uncursed固定のため非該当だったが、curse抽選導入に伴い新規実装） |
| identification: 変換だけでは本体鑑定しない | COMPLIANT |
| identification: Star自身は成功時のみ鑑定 | COMPLIANT |
| display: 未鑑定target/resultの真名非漏洩 | COMPLIANT |
| rng: 候補0/1でRNG非消費、2+で1回のみ（候補選択） | COMPLIANT |
| rng: 既存card-effectストリーム再利用（combatRngState） | COMPLIANT |
| rng: 他stream非干渉 | COMPLIANT |

## 発見したGAPと修正内容

すべて設計判断不要、既存ヘルパーの再利用のみで解決した。

### GAP1: S/R・solar_gun・black_armorの候補・結果混入

`getTransformCandidatesForItem`はcategory一致のみでrank/id除外がなかった。

- `card-target-selection.ts`に`isStarEligibleRank`を新設。`equipment-loot.ts`の`NORMAL_RANKS`（既存のC/B/A限定リスト、export化のみ実施）を再利用し、weapon/armorのrankをC/B/Aに限定。
- `STAR_INELIGIBLE_ITEM_IDS`に`'solar_gun'`と`'black_armor'`を明示追加（black_armorはrank Rでもあるため二重に除外される）。

### GAP2: enchantment系5種の結果混入

`sol_enchantment`等5種は`category: 'consumable'`だが一回限りの解禁アイテムであり、`STAR_INELIGIBLE_ITEM_IDS`が空集合だったため候補・結果に混入しうる状態だった。

- 既存の`ENCHANTMENT_ITEM_IDS`（item-def.ts、Phase 15.4bの正本）を`STAR_INELIGIBLE_ITEM_IDS`へ追加。新規リストは作成していない。

### GAP3: 束縛中装備中targetの除外漏れ

`getStarCandidates`は`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`（Phase 20.0c、既存の装備解除/交換禁止判定）を参照していなかった。

- 装備分岐に、現在装備中でかつcurse-lockedなinstanceIdを除外する条件を追加。既存関数をそのまま再利用し、新規判定ロジックは追加していない。

### GAP4: 変換結果equipmentの呪い抽選が存在しなかった

`resolveStarEffect`は常に`createEquipmentInstance`（`cursed: false`固定）を使用しており、新規individualへの呪い付与が一切発生しなかった。

- `createEquipmentInstanceWithCurse`（enemy-drop.tsが既に使う正規helper）に置き換え。
- 呪い判定は既存の`FLOOR_EQUIPMENT_CURSE_CHANCE`しきい値を、`resolveStarEffect`が候補選択で既に使っている`workingState.combatRngState`+`rollPercent`ストリーム上でもう1回抽選する形で実装（新規RNGストリーム設計は行っていない）。
- 自動再装備先が新規呪いを引いた場合のみ`curseRevealed = true`を設定。本体（definitionId）の`identifiedGeneralItemIds`への追加は一切行わない——curse revealと本体鑑定を独立に保つ既存契約どおり。

## production変更の有無

**変更あり**（上記4 GAP）。

## RNG・identity・identification・curse検証結果

- 候補選択・呪い抽選ともに`workingState.combatRngState`（既存card-effectストリーム、`wheel_of_fortune`と同一パターン）のみを使用。map/combat/enemy/floor item/monsterHouse/enemy-drop RNGへの干渉なし（`structuredClone`によるisolationは既存のまま維持）。
- 同一seed・同一操作列で結果definitionと呪い結果の両方が再現されることをfocused test・production sanityの双方で確認。
- 装備identity（新規instanceId発行、refineLevel/DP/curse/curseRevealed非継承、orphan instanceなし）は既存実装のまま変更なし、再検証のみ実施。
- 一般アイテム鑑定（Phase 24.4d1）との接続: 変換成功だけでは`identifiedGeneralItemIds`に追加されないことを確認。curseRevealedと本体鑑定が独立であることをfocused test・sanity双方で確認。

## 追加した回帰テスト

`src/game/__tests__/phase-24-4d2-star-transformation-alignment.test.ts`（新規、15件）:

- 結果候補からのS/R/solar_gun/black_armor除外（weapon/armor双方）
- enchantment5種の結果除外
- S/R装備・solar_gunが所持されていてもtarget候補に出ないこと
- 束縛中装備中targetの候補除外・stale拒否時の完全no-op
- 束縛されていない所持中cursed個体は引き続き変換可能であること（過剰除外がないことの確認）
- 呪いが実際にcursed/uncursed両方の結果を生むこと（60 seed走査）
- 同一seedでの呪い結果再現性
- 自動再装備されたfresh cursed結果のcurseRevealed成立と本体非鑑定
- 未装備fresh cursed結果はcurseRevealedを立てないこと
- 変換成功だけでは一般アイテム鑑定が発生しないこと

## 検証結果

- **focused tests（新規）**: 15件全通過
- **既存Phase 20 star/temperance回帰**（phase-20-5a-targeted-card-effects.test.ts、phase-20-0d-card-target-selection.test.ts）: 104件全通過
- **Phase 24.4c card-supply回帰**: 29件全通過
- **full suite**: 122ファイル・3081テスト（baseline 121ファイル・3066テスト + 新規1ファイル・15テスト）全通過
- **typecheck**（`npx tsc --noEmit`）: 成功（エラーなし）
- **production build**（`npx vite build`）: 成功
- **diff-check**: `card-target-selection.ts`・`equipment-loot.ts`・`turn.ts`の3ファイルのみ変更、新規テストファイル1件追加。unrelated差分なし。
- **production sanity**: 13項目（stack変換、equipment再生成、装備slot維持、fresh curse+curseRevealed独立性、cancel/stale/0候補no-op、成功時の消費/鑑定/ターン契約、seed再現性、C/B/A限定、black_armor/solar_gun非出現、floor非依存候補、束縛target除外）全通過。一時スクリプト（`tmp-star-sanity.ts`）は検証後削除済み。

## Phase 20の星gapを解消したこと

Phase 20完了記録自体は正確だった（星は実装済み）。今回解消したのは、Phase 20完了時点では存在しなかったPhase 24.3（全装備カタログ拡張）・Phase 24.4a（equipment-loot rank/black_armor除外）・Phase 24.4d1（一般アイテム鑑定）の後から追加された契約と、星の既存実装との間に生じていた整合ギャップである。

## 次工程

Phase 24.4e（development-planに記載があれば呪い追加接続、以降の番号は変更していない）。

## 指示逸脱の有無

なし。監査で発見したGAPはすべて設計判断不要の最小修正で対応し、テスト期待値の緩和は行っていない。既存Phase 20の正常処理・仕様は再設計していない。development-plan.mdはrepository内に存在しないため更新していない（後述）。
