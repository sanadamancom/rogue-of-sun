# Phase 24.2: 太陽鍛冶コア・装備個体変換基盤

## precheck結果

- リポジトリ: `sanadamancom/rogue-of-sun` を確認
- base branch: `origin/phase-24-1-equipment-instance-actions` の HEAD short hash `e10c885` を確認（一致）
- local HEAD と remote branch HEAD の一致を確認
- working tree clean を確認
- 同名 work branch (`phase-24-2-solar-forge-core`) が local/remote いずれにも存在しないことを確認
- Phase 24.1 の新規専用テスト（`phase-24-1-equipment-instance-actions.test.ts`）38件を実行し、全通過を確認
- 上記いずれも不一致なし。precheck通過。

## Phase 24.1から再利用したinstance選択境界

- `equipment-instance.ts` の `getHeldEquipmentInstances`（現在所持中の個体一覧）をそのまま太陽鍛冶の素材候補列挙に再利用した。新規の所持判定ロジックは追加していない。
- 「明示的に指定されたinstanceIdが無効な場合はフォールバックせず拒否する」という Phase 24.1 の stale-action 契約を `validateForgeMaterials` にそのまま踏襲した。
- `PlayerAction` の instanceId 指定パターン（`equip_weapon`/`unequip_weapon` 等の `equipmentInstanceId?`/必須引数）を参考に、`solar_forge` アクションは `materialInstanceIds: [string, string]` を必須のタプルとして持つ形にした（ItemIdだけのactionへは戻していない）。

## 太陽鍛冶recipeモデル

- `SolarForgeRecipe`: `id` / `inputDefinitionIds: [WeaponId, WeaponId]`（順序非依存） / `inputRank` / `outputDefinitionId` / `outputRank` の5フィールド。
- `buildForgeRecipeKey` で入力pairをソートして正規化し、順序を入れ替えても同一レシピとして解決する。
- `validateForgeRecipe` / `validateForgeRegistry`: solar_gun除外、未知definitionId、Rを入力にする遷移、C→B/B→A/A→S/S→R以外の遷移、definitionのrankとレシピの矛盾、重複recipe keyを検出する。
- `findSolarForgeRecipe`: 候補列挙と実際の適用（`turn.ts`の`applySolarForge`）が完全に同じ関数を共有する。

## 素材・呪い・装備状態・出力初期化の確定契約

- 素材は異なる2つの`equipmentInstanceId`で明示指定。同一instanceId二重指定は`duplicate_instance`で拒否。
- 素材は現在所持中(`getHeldEquipmentInstances`)のweapon個体でなければならない。armor・solar_gunは`not_weapon`で拒否。
- cursed個体は判明・未判明を問わず`cursed`理由で拒否。失敗時に`curseRevealed`は変更しない。
- 両方とも所持済み・未装備なら完成品は未装備。片方が装備中weaponだった場合、完成品を同じweapon装備枠へ自動装備する（`applySolarForge`内、`materialWasEquipped`判定）。
- 両方が同時に装備中というweapon枠1つの構造上不可能な状態は`unsafe_equipped_state`として防御的に拒否する。
- 完成個体は`createEquipmentInstanceWithRank`（新規追加関数）で生成。`refineLevel=0`・`cursed=false`・`curseRevealed=false`・`definitionId`/`rank`はレシピの出力定義に従う。素材の状態を暗黙継承しない。
- 消費・生成はすべて`applySolarForge`内で完結し、validation完了前にはinventory/equipmentInstances/equippedWeaponInstanceIdを一切変更しない。途中失敗による半消費状態は発生しない。

## production recipeを空にした理由

- 現在のproduction装備定義（WEAPON_DEFINITIONS/ARMOR_DEFINITIONS）は全5種Cランクのみで、B/A/S/R武器が実在しないため、実際に到達可能なレシピを1件も作成できない。
- 仕様（`current_content`）により、架空のB/A/S/R武器やC→Cの仮レシピをproductionへ追加することを明示的に禁止されている。
- `solar-forge-recipes.ts`の`SOLAR_FORGE_RECIPES`は空配列とし、Phase 24.3が実武器27種とレシピ表を追加する際にこの配列へ追記するだけで、既存のUI/action境界・コアロジックへ変更が不要な構造にした。

## Phase 24.3で接続する内容

- `SOLAR_FORGE_RECIPES`への実レシピ追加（C→B/B→A/A→S/S→Rの実際の武器species）
- 27武器・15防具のproduction定義追加とrank付与
- `getSolarForgeCandidates`を使った実際のUI選択フロー（1個目選択→2個目候補選択→確認）のmain.ts接続。本Phaseでは`solar-forge.ts`の純関数境界までを整備し、production側にレシピが存在しないため実際のキー入力/画面遷移コードはmain.tsへ追加していない。
- 呪いの本格的な鍛冶接続（Phase 24.4）

## 新規・更新テスト数

- 新規テストファイル: `src/game/__tests__/phase-24-2-solar-forge-core.test.ts`（44テスト、required_groups全区分を網羅）
- 既存テストへの変更: なし（既存テストのアサーション・意図は一切変更していない）

## targeted/full suite/typecheck/build/diff-check結果

- targeted regression: Phase 24.1専用テスト38件を含む影響範囲は、full suite実行に統合して確認（個別再実行は省略、full suiteで全件カバー）
- full suite: 112 files / 2839 tests 全通過（Phase 24.1時点の2795件 + 本Phase新規44件 = 2839件、一致）
- `npx tsc --noEmit`: エラーなし
- `npx vite build`: 成功（44 modules transformed, dist生成後に削除済み）
- `git diff --check`: 問題なし（whitespace error等なし）

## production sanity結果

- fixture catalog/recipeを注入した`applySolarForge`（productionから直接importした同一関数）経由で、C素材2個→B完成個体の生成を確認
- 装備中素材→完成品自動装備を確認（`equippedWeaponId`/`equippedWeaponInstanceId`がforged output側へ正しく引き継がれる）
- 不正instanceId（存在しないid×2）で完全no-op（inventory/equipmentInstancesが一切変化しない）を確認
- cursed素材で消費されず、`curseRevealed`が変化しないことを確認
- production registry（`SOLAR_FORGE_RECIPES`、空配列）では`getSolarForgeCandidates`が候補0件を安全に返すことを確認
- 一時確認用テストファイルは検証後に削除済み

## 変更ファイル一覧

- 新規: `src/game/solar-forge.ts`
- 新規: `src/game/solar-forge-recipes.ts`
- 新規: `src/game/__tests__/phase-24-2-solar-forge-core.test.ts`
- 新規: `docs/history/phase-24-2-solar-forge-core.md`（本ファイル）
- 変更: `src/game/types.ts`（`PlayerAction`へ`solar_forge`追加）
- 変更: `src/game/events.ts`（`solar_forge_completed`/`solar_forge_failed`イベント追加）
- 変更: `src/game/message-log.ts`（上記イベントの日本語メッセージ追加）
- 変更: `src/game/turn.ts`（`applySolarForge`実装・dispatch接続・inventoryOpen許可アクション追加・import追加）
- 変更: `src/game/equipment-instance.ts`（`createEquipmentInstanceWithRank`追加）

## 指示逸脱の有無

- なし。すべてのstop_conditionsに該当する事象は発生せず、out_of_scope項目（近接武器27種・防具15種の追加、production用C/B/A/S/Rレシピ、rank変更、SOL消費、新規RNGストリーム、telemetry schemaVersion変更、main変更・PR作成等）はいずれも実施していない。
- selection_and_ui要件のうち、`getSolarForgeCandidates`によるUI候補列挙の境界までは整備したが、production側にレシピが存在しないため、main.ts側の実際のキー入力・画面遷移コードは追加していない（Phase 24.3でレシピが追加された時点で接続する設計として意図的に留保）。
