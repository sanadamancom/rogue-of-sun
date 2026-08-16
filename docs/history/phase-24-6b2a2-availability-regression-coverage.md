# Phase 24.6b2a2: Permanent availability regression coverage

24.6b2a1a（provenance audit）が発見した2つのGAP — (1) `phase-24-4a-equipment-loot-supply.test.ts`のコメントが実在しない専用テストの存在を主張していたこと、(2) spear/hammerのprogress 2/3境界・card/accessory/equipmentの不適格候補除外ロジックについて恒久testが一切存在しなかったこと — を解消するため、3本の新規恒久testファイルをリポジトリへ追加した。production変更は0件。

## 1. precheck

- base branch: `phase-24-6b2a1-availability-filter-correction`
- base HEAD: `e3875f91b806752a5b980105de839f67b58d4c44`（一致確認済み）
- work branch: `phase-24-6b2a2-availability-regression-coverage`（local/remoteとも重複なし、新規作成）
- working tree: precheck時点でclean（24.6b2a1aで確認済みの状態を継承）
- remote SHA一致: `origin/phase-24-6b2a1-availability-filter-correction` = `e3875f91...`
- baseline: `npx tsc --noEmit`（0 error）→ `npx vitest run`（128 files / 3242 tests、全pass）→ `npx vite build`（成功）

## 2. 追加した恒久testファイル

| ファイル | test数 | 内容 |
|---|---|---|
| `src/game/__tests__/phase-24-6b2a-item-availability.test.ts` | 20 | registry完全性・progress境界・3F/10F/30F/99F解禁floor |
| `src/game/__tests__/phase-24-6b2a1-candidate-prefilter.test.ts` | 17 | synthetic不適格metadataによる候補事前filter・weight再配分・RNG回数契約 |
| `src/game/__tests__/phase-24-6b2a2-availability-route-regression.test.ts` | 14 | 3ルート間のeligibility一致・3F固定生成結果・runDepthTier非干渉・route weight |
| 合計 | **51** | |

## 3. 一時focused scriptとの差異

24.6b2a・24.6b2a1・24.6b2a1aでの`/tmp/audit-*/focused.ts`等は、いずれも作業完了後に削除される一時scriptであり、リポジトリへcommitされる恒久的なtest resourceではなかった。本Phaseで追加した3ファイルは、同等の検証内容を`src/game/__tests__/`配下の通常のvitestファイルとして実装し、`npx vitest run`の対象に含まれる恒久testとした点が異なる。

## 4. registry/progress境界結果

`phase-24-6b2a-item-availability.test.ts`で以下を恒久test化した:

- `ITEM_DEFINITIONS`と`ITEM_AVAILABILITY`のキー完全一致（78件、missing/extra/duplicate 0）
- 全78件`minimumRunDepth: 'short'`
- `unlockProgress`: spear/hammer/frost_enchantment/cloud_enchantment = 2/3、earth_enchantment = 1、他73件 = 0
- `economyClass`集計: power 71・sustain 6・structural 1・not_applicable 0
- 全`unlockProgress`がfiniteかつ[0,1]
- tier順: short <= standard <= deep（現行registryでは3 tier間の候補集合が任意progressで完全一致することも確認）
- progress 2/3直前（`2/3 - 1e-9`）で対象4種が未解禁、境界（`2/3`）で解禁、`earth_enchantment`はなお未解禁であることを確認
- progress 1直前（`1 - 1e-9`）で`earth_enchantment`が未解禁、境界（`1`）で解禁されることを確認
- `getGroundItemPoolForFloor`が同一progress（2/3、対応するfloor2/3・20/30・66/99）でtotalFloorsによらず同一候補集合を返すことを確認
- 10F floor7/10・30F floor20/30・99F floor66/99の解禁境界を確認
- 3F floor1（12件固定配列）・floor2（floor1+4件）・floor3（floor2+1件）の候補配列と順序を`toEqual`で固定

全20 test PASS。

## 5. synthetic candidate prefilter結果

`phase-24-6b2a1-candidate-prefilter.test.ts`は`vi.doMock('../item-availability', ...)`でfile-local・test-localにitem-availability.tsの判定関数を差し替え、実際の`ITEM_AVAILABILITY`registryは一切mutationしていない。各testは`vi.resetModules()`→`vi.doMock`→動的`await import(...)`の順で対象モジュールを再読込し、共有`afterEach`で`vi.doUnmock`+`vi.resetModules()`を実施して他testへのmock漏れを防いでいる（6節で検証）。

| 経路 | 検証内容 | 結果 |
|---|---|---|
| equipment | 一部C/B/A definition（`flamberge`）を不適格化 → `getNormalEquipmentCandidates`から完全除外 | PASS |
| equipment | filterが`flattenByRank`より前に適用され、残存B-rank種（`magic_sword`）が全B-rank weightを引き継ぐ（2種→1種でweightが2倍になることを確認） | PASS |
| equipment | 全C-rank種（`sword`・`short_sword`）を不適格化 → C-rank候補が消え、B/A-rankは正の重みのまま残存 | PASS |
| equipment | slotの全candidateを不適格化 → `selectNormalEquipmentDefinition`がrng消費前（最大1回）に明示的Errorをthrow | PASS |
| card | 1件（`emperor`, rarity C）を不適格化 → `selectCardWithinRarity('C', ...)`が決して`emperor`を返さない | PASS |
| card | rarity C全6件を不適格化 → `selectCardRarity`が'C'を一切返さず、他3 rarityは引き続き到達可能（重み再正規化を確認） | PASS |
| card | 部分的不適格状態で`resolveLootSlot`のcategory roll結果が常に`category: 'card'`のまま（`non_card`への棄却が発生しない） | PASS |
| accessory | 1件（`hot_blooded_headband`, rank C）を不適格化 → `selectAccessoryWithinRank('C', ...)`が決して返さない | PASS |
| accessory | rank C全2件を不適格化 → `selectAccessoryRank`が'C'を一切返さず、他rankは到達可能 | PASS |
| accessory | 部分的不適格状態で`resolveLootSlot`が常に`category: 'accessory'`のまま | PASS |
| Star | `flamberge`を不適格化 → `getTransformCandidatesForItem('sword', 'deep', 1)`が含まない | PASS |
| Star | mockなしで`getStarCandidates(state)`が実state（`state.runDepthTier`・`floorProgressRatio(state.floor, state.totalFloors)`）由来の値を使い、例外なく動作する | PASS |
| forge | `solar-forge-recipes.ts`がitem-availability.tsを一切importしていないため、mockの影響を受けない（モジュール読込自体が成功することを確認） | PASS |

全13 test（uniqueな`it`ブロック数、上記表とRNG節4件で17件）PASS。

## 6. mock漏れ防止の確認

`phase-24-6b2a1-candidate-prefilter.test.ts`単独実行に加え、隣接する既存test（`phase-24-4a-equipment-loot-supply.test.ts`・`phase-24-4c-card-supply.test.ts`・`phase-24-5c-accessory-generation.test.ts`）と同時実行し、計106 test全pass・mockの影響が他ファイルへ波及しないことを確認した。

## 7. route/RNG回帰結果

`phase-24-6b2a2-availability-route-regression.test.ts`で以下を確認:

- **3F固定生成結果**: seed `[1, 2, 4, 42, 999, 4294967295]`それぞれについて、floor1〜3の`groundItems`・`equipmentInstances`・`combatRngState`・`map.terrain`を、現在の（24.6b2a1適用後の）production挙動から一度取得し、それを恒久的な期待値として`it.each`でcommitした。将来の変更がこの結果を1つでも変えれば、この6 seed×3 floorのいずれかが確実に検出する
- **3ルート間eligibility一致**: `getGroundItemPoolForFloor`（通常/MH route共有）と`getNormalEquipmentCandidates`（equipment definitionの候補列挙）が、同一`(floor, totalFloors, runDepthTier)`でspear/hammerの解禁/未解禁について完全に一致することを確認。`selectEnemyDropItemId`も同一条件で低progress時にspear/hammer/frost/cloud/earthを一切返さないことを300サンプルで確認
- **10/30/99F境界**: `getGroundItemPoolForFloor`ベースでfloor7/10・floor20/30・floor66/99の境界を確認（registryテストと合わせ、route層でも重複確認）
- **runDepthTier非干渉**: `short`/`standard`/`deep`で同一seed・同一totalFloorsの生成結果（groundItems・equipmentInstances・combatRngState・map）が完全一致することを確認
- **route weight維持**: `rollLootCategory`を6000サンプル引き、card/accessory/non_cardの出現比率が既存の10%/10%/80%（許容誤差込み）に収まることを確認 — 24.6b2a1のeligibility接続が`rollLootCategory`自体の重みを一切変更していないことの裏付け

全14 test PASS。

## 8. production変更0件

本Phaseで変更したファイルはtestファイルのみ:

- 新規3ファイル（上記2節）
- 既存1ファイルのコメント訂正のみ（`phase-24-4a-equipment-loot-supply.test.ts`、9節参照）

`src/game/*.ts`（`__tests__`を除く）への差分は**0件**（`git diff --stat`で確認済み）。`item-availability.ts`のavailability実値（`ITEM_AVAILABILITY`の内容）も一切変更していない。

## 9. 既存testコメント訂正

`phase-24-4a-equipment-loot-supply.test.ts`の「sword/spear/hammer slots return exactly that family's C/B/A species」テスト内のコメントを、実在しなかった「covered by its own dedicated tests below」という主張から、実際に本Phaseで追加した`phase-24-6b2a-item-availability.test.ts`の「progress 2/3 boundary」describeブロックと`phase-24-6b2a2-availability-route-regression.test.ts`の「10F/30F/99F unlock-floor boundaries」describeブロックへの正確な参照へ訂正した。progress 0.5→1のassertion値自体・gameplay期待値は変更していない（24.6b2a1で行った変更のまま維持）。

## 10. 24.6b2a1 provenance history更新

`docs/history/phase-24-6b2a1-availability-filter-correction.md`の12節（「指示逸脱・停止事項: なし」）を訂正し、13節として以下を追記した:

- 開始時dirty treeだった事実
- 未commit変更の作成者・生成プロセスはUNKNOWN
- dirty-tree停止条件に反して継続した指示逸脱の明記
- 技術的妥当性は停止条件を無効化しない旨の注記
- 24.6b2a1a監査で恒久test不足を発見した経緯
- 24.6b2a/24.6b2a1の最終採否（e3875f91を、13節の訂正を前提として正式採用）

詳細は当該historyファイル自体を参照。

## 11. 全検証結果

| gate | 結果 |
|---|---|
| `npx tsc --noEmit` | 0 error |
| 新規51 test（単独実行） | 全PASS |
| mock漏れ確認（隣接3ファイルとの同時実行、106 test） | 全PASS |
| `npx vitest run`（full suite） | 131 files / 3293 tests、全pass（既存128/3242 + 新規3/51） |
| `npx vite build` | 成功 |
| production diff | 0件 |
| availability実値変更 | 0件 |

## 12. 指示逸脱・停止事項

なし。stop_conditionsのいずれにも該当しなかった（mockなしでのproduction変更は不要だった、module mockは`afterEach`のunmock+resetModulesおよび隣接ファイルとの同時実行検証により他testへ漏れていないことを確認した、実装は抽選前filter契約を満たしていることを17件のsynthetic testで確認した、RNG呼出回数は既存契約と完全一致することを確認した、3F結果は変化していない、dirty tree/baseline不一致/branch衝突のいずれも発生しなかった）。

## 13. 最終採否

24.6b2a（`d3fdc5c33e38473ef05ccfdbf0b4952687c60bca`）・24.6b2a1（`e3875f91b806752a5b980105de839f67b58d4c44`）・本24.6b2a2の3コミットを合わせて、item availability機構の実装として正式採用する。24.6b2a1開始時のdirty-tree停止条件違反というプロセス上の指示逸脱は事実として`docs/history/phase-24-6b2a1-availability-filter-correction.md`13節に記録した。技術内容（16 API required化・抽選前filter・RNG契約・恒久test化）は本Phaseまでの3段階の監査（24.6b2a1a provenance audit・本Phaseのcontent audit）を経て妥当性を確認済み。
