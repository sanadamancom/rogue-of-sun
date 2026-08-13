# Phase 23.4: ステップスの足跡・3×3棘攻撃・千里眼連携

新敵「ステップス」を追加し、通常時は足跡だけ表示、Chebyshev距離1で感知すると自身中心3×3の攻撃範囲を1ターン予告、次のステップス行動時に棘攻撃を実行、攻撃後3ターンは本体を表示してから足跡状態へ戻る状態機械を実装した。既存の千里眼の実を拡張し、罠発見効果を完全に維持したまま現在フロアのステップス本体を可視化するようにした。

## 1. 起点commitとprecheck

| 項目 | 結果 |
|---|---|
| base branch | `origin/phase-23-3-ghost-wall-phasing` |
| base commit | `899029a4797c98611ca5fd3766864035ca3e2b25` |
| work branch | `phase-23-4-steps-clairvoyance` |
| working tree | clean（fetch後に確認） |
| main | `80596cd5334294255a439cb79db375f622193c50` のまま |
| アセット | `/mnt/user-data/uploads/steps.png`・`steps_see.png` を取得元として確認。両方とも72×128px・3列×4行・chroma-key緑(0,255,0)を確認 |
| 既存branch衝突 | `phase-23-4-steps-clairvoyance` という同名branchは存在せず、新規作成 |

## 2. 確定した状態機械と正確なT0〜T5 timeline

`EnemyActor`へ`stepsState?: 'hidden' | 'telegraphed' | 'revealed'`（省略時hidden相当）、`stepsTelegraphCenter?: Vec2`、`stepsRevealTurnsRemaining?: number`を追加。`resolveStepsEnemy`（turn.ts）が状態を進行させる。

```
T0: hiddenかつ距離1を検知 → telegraphed。移動・攻撃なし
T1: 固定中心で棘攻撃を実行 → revealed、remaining=3。攻撃後の描画は本体
T2: 通常ground行動（隣接なら攻撃、それ以外は追跡） → remaining=2
T3: 通常行動 → remaining=1
T4: 通常行動 → remaining=0 → 行動完了後hidden（同じ行動中に再予告しない）
T5以降: hiddenとして再び感知可能
```

hidden状態での距離1判定は移動前だけに行う——追跡移動によって同ターン中に距離1になっても、そのターンには予告しない（次のステップス行動まで待つ）。これはコードの構造そのもの（検出チェックの後にのみchase step実行、hidden分岐は検出チェックが先で以後の分岐へフォールスルーしない）で保証されている。

`resolveOneEnemy`のAGGRO_RANGE早期returnに`stepsMidCycle`（`stepsState`が`'telegraphed'`または`'revealed'`のとき真）バイパス条件を追加し、golemの`golemChargeInProgress`と同じパターンで、予約済み棘攻撃と revealed中のカウント消化がプレイヤーの距離変化で永久停止しないようにした。hidden状態は通常どおりAGGRO_RANGEゲートに従う。

死亡済みステップスの状態は進めない——`resolveEnemiesAction`の既存`if (!enemy.alive) continue;`により、死亡した個体は`resolveOneEnemy`自体が呼ばれないため、追加コードなしで保証される（golem/ghostと同じパターン）。

## 3. 3×3範囲・wall除外・攻撃解決

`src/game/steps.ts`へ3つのpure helperを新設。

- `isStepsDetectionRange(enemyPos, playerPos)`：純粋なChebyshev距離1判定（角抜けルールなど一切適用しない、斜め方向の両脇が壁でも感知は成立する）
- `getStepsSpikeCells(map, center)`：中心＋周囲8マスの最大9セルを、map内かつterrainがfloorのセルだけ固定順（行優先、y-1..y+1 × x-1..x+1）で返す。この1関数を範囲列挙・実ダメージ判定・telegraph描画のすべてで共有しているため、表示と実際の攻撃判定が食い違うことはない
- `shouldDisplayStepsBody(enemy, clairvoyanceActive)`：表示だけを判定する単一境界

攻撃解決（`resolveStepsEnemy`のtelegraphed分岐）：実行時点のプレイヤー座標が`getStepsSpikeCells`の返す集合に含まれていれば、既存の`resolveEnemyAttackHit`（tryMeleeAttackが使うものと同一関数）を1回だけ呼び、命中・回避・防御・armor・死亡処理・既存`enemy_attack`/`enemy_attack_missed`イベントをそのまま利用する。含まれていなければ攻撃解決自体を呼ばない（ダメージなし）。`steps_spike_executed`イベントは命中・回避・対象なしのいずれでも必ず1回だけ発火し、実ダメージ情報を重複して持たない。ノックバックや追加状態異常は一切付与していない（そもそも既存の`resolveEnemyAttackHit`にノックバック機構自体が存在しない）。RNGは感知・範囲作成・状態遷移では一切使用せず、命中判定でのみ既存の敵攻撃RNG（`state.combatRngState`）を通常どおり消費する。新規RNGストリーム・XOR定数は追加していない。

## 4. 足跡版と本体版アセットの役割

`public/assets/sprites/steps.png`（足跡、hidden・telegraphed時）・`steps_see.png`（本体、revealed中または千里眼有効時）として受領済み画像をそのまま配置（リサイズ・切り出し・色変更なし）。`ENEMY_DEFINITIONS.steps.spriteKey`は`'steps'`（通常のロスターアセットとして`allEnemySpriteKeys()`経由で自動ロード）、`steps_see`のみ`EXTRA_SPRITE_KEYS`へ追加（skeleton_head/claygolem_rollingと同じパターン）。`spriteKeyForEnemy`の単一境界へ`shouldDisplayStepsBody`呼び出しを追加し、既存のskeleton_head・claygolem_rolling・ghost alphaの分岐は変更していない。

## 5. 千里眼の罠効果維持とステップス表示の独立性

`GameState`へ`stepsClairvoyanceActive?: boolean`（フロア単位、optional）を追加。`applyClairvoyanceUse`（既存の罠発見処理）の末尾で無条件に`true`へ設定するだけの変更に留め、既存の罠発見ループ・`revealTrap`共有経路・`clairvoyance_used`イベント・`inventoryOpen`クローズ処理・成功/消費/ターン消費の契約は一切変更していない。ステップスが0体の場合でも既存どおり成功・1個消費・1ターン消費となることをテストで確認済み。

`stepsClairvoyanceActive`は`hidden`/`telegraphed`/`revealed`の戦闘状態機械を一切変更しない——`shouldDisplayStepsBody`が読み取るだけの表示専用フラグであり、`resolveStepsEnemy`内のどの分岐からも参照されない。

## 6. world spriteとminimapの情報公開境界

- **world sprite**：`shouldDisplayStepsBody`の結果に応じて`steps`/`steps_see`を切替。既存の`currentVisible`ゲート（`isCurrentlyVisible`）は変更なしでそのまま適用されるため、視界外のステップスは千里眼が有効でも世界描画上には一切表示されない（千里眼はスプライト選択にのみ作用し、可視性そのものには作用しない）
- **minimap**：`src/game/minimap.ts`へ`getMinimapStepsMarkers(enemies, clairvoyanceActive)`を新設（`getMinimapTrapMarkers`と同じ純粋関数パターン）。terrain・exploredTiles・current visibilityのいずれにも依存せず、`clairvoyanceActive`が真のときだけ生存ステップスの座標のみを返す（周囲の床・壁・部屋形状は一切開示しない）。`drawMinimap`内で罠マーカーの直後・通常敵ループの前に描画し、既存の描画順（罠→ステップスマーカー→通常敵→アイテム→プレイヤーの順で、後段が前段を塗り重ねる）を壊していない
- ゴーストは千里眼対象へ一切追加していない（`shouldDisplayStepsBody`は`enemy.type !== 'steps'`のとき常にfalseを返す設計であり、他種の表示ロジックに触れない）

## 7. 通常生成・monsterHouse統合

`ENEMY_TYPES_IN_ORDER`の末尾（ghostの後）へ`steps`を追加し、既存11種のインデックスは変更していない。`ENEMY_FIRST_APPEARANCE_FLOOR.steps = 3`（暫定値）。`getEnemyPoolForFloor`のロジック自体は無変更のため、3F以降の候補プールへ自動的に加わる。monsterHouseの敵種選択も同じ`getEnemyPoolForFloor`を使うため、`spawnSource`による専用分岐を一切追加せずにmonsterHouse候補へ自動参加する。フロア遷移時は敵配列・`stepsClairvoyanceActive`とも新規フロアで再構築されるため（`CarryOverStats`が明示的なallow-listのため、明示的に含めない限り自動的に持ち越されない）、前フロアの状態が漏れることはない。

## 8. RNG消費と決定性

新規RNGストリーム・XOR定数は追加していない。感知・範囲列挙・状態遷移はすべて決定的な座標比較のみで完結する。攻撃解決時のみ、既存の`resolveEnemyAttackHit`が使う命中ロールを通常どおり消費する（他の近接系種族と共有する既存経路であり、新規消費ではない）。`getStepsSpikeCells`の決定性・入力非破壊性をテストで確認済み。

## 9. 新規・更新テスト数と実測結果

### 新規テスト
`src/game/__tests__/phase-23-4-steps-clairvoyance.test.ts`：43件、全通過。

内容：ロスター登録・暫定stats・全neutral・末尾追加確認、1F/2F非出現・3F出現、sprite key切替、monsterHouse同一AI（roster_and_assets）／T0〜T5タイムライン全段階の個別検証（distance2非予告、8方向での距離1予告、追跡後の同ターン非予告、T0の無移動無ダメージ、T1でのremaining=3確定、固定中心の非再計算、AGGRO_RANGE外での予約実行、T2〜T4の正確な3ターン、off-by-oneなしのhidden復帰、T5での即再予告なし）（state_machine）／9セル全開、map端除外、wall除外、実際の攻撃解決1回のみ、範囲外での無ダメージ、既存命中/防御/死亡経路の利用、ノックバックなし、決定性と入力非破壊（spike_geometry）／罠発見維持・0体成功・combat状態非変更・shouldDisplayStepsBody切替・ghost非干渉・次フロア無効・minimapマーカーの座標のみ返却・死亡個体除外（clairvoyance）／getStepsTelegraphの正しい固定center・cell集合返却となし判定・予告実行イベント各1回・重複近接イベントなし（telegraph_and_events）／実ゲーム相当のフルフロー1件（production sanity）。

### 変更した既存テストと理由
ロスター11→12種の成長に伴う期待値更新のみ（新仕様への直接抵触箇所）：

- `phase-14-4-enemy-affinities.test.ts`：`CONFIRMED_TABLE`へsteps行追加、ロスター数11→12
- `enemy-roster-foundation.test.ts`：登録数・roster preview数を11→12
- `floor-enemy-pools.test.ts`：3F/4Fプール集合へsteps追加、1F/2Fの非包含チェックリストへsteps追加、5F/6Fの「フルロスター」件数コメント更新
- `phase-15-5-enemy-count-by-floor.test.ts`：roster preview長さ11→12
- `armor-and-golem.test.ts`：3F候補プール集合へsteps追加
- `phase-23-3-ghost-wall-phasing.test.ts`：ロスター長さの厳密一致assertionを`toBeGreaterThanOrEqual(11)`へ緩和（ghost自身のindexは変わらないため、後続phaseによる純粋な追加成長は許容する形にした）

テストの削除・skip・過度な緩和は一切行っていない。

## 10. typecheck、build、diff-check結果

- `npx tsc --noEmit`：成功（エラーなし）
- `npx vite build`：成功（`dist/assets/index-D-nv7qdI.js` 1,637.54 kB、既存のチャンクサイズ警告のみ）
- `git diff --check`：問題なし

## targeted regression結果

以下の合計43ファイル・2110テストを実行し、全て通過を確認した（新規テストと更新した既存テスト自体も含む）。

```
telegraph / phase-18-2-clairvoyance / phase-18-2-minimap /
inventory-actions / inventory-and-apple / inventory-capacity / turn /
visibility / dark-room-visuals /
phase-21-1〜21-8 (monsterHouse関連) /
enemy-behavior-bat/cockatrice/kraken/melee-variants/mummy/spider /
message-log / phase-10-3-1-telemetry / phase-10-3-2-telemetry-fix /
phase-18-2-telemetry / phase-13-3c-ability-ui-telemetry /
phase-23-1-solar-gun-element-skeleton / phase-23-2-golem-charge /
phase-23-3-ghost-wall-phasing /
weapon-and-sword / spear-reach-weapon / hammer-knockback-weapon /
phase-09-2-solar-gun / phase-10-1-sol-enchant / phase-10-2-combat-stat-scale /
phase-20-0a/20-0c/20-0d/20-3/20-4/20-5a/20-5b (カード効果・対象選択、
judgement/死亡処理はphase-20-3で確認) /
integration / multi-floor / multi-floor-robustness / enemy-type /
phase-22-immediate-stairs-progression /
enemy-roster-foundation / floor-enemy-pools / phase-15-5-enemy-count-by-floor /
armor-and-golem / phase-14-4-enemy-affinities
```

全テストへの拡大は行っていない。対象範囲で広範囲の回帰疑いは見つからなかった。

## 11. Phase 23.5以降へ残した範囲

- コカトリス飛行モーション
- Phase 23.5の追加敵統合監査
- Phase 23.6の本格的なロスター・階層バランス調整（ステップスの数値・初出階の再調整含む）
- Phase 23.7の完成版ラン構成
- Phase 25の棘アニメーション・画面揺れ・完成版VFX（丸まり演出等）
- ステップスの透明化・無敵化・テレポート・状態異常付与（一切実装していない）
- 千里眼によるゴースト・他敵・地形・アイテムの可視化拡張

## 12. 指示逸脱の有無

指示に従わなかった点はない。ステップス0体でも千里眼が既存どおり成功・消費・ターン進行することを確認済み。ゴーストへの千里眼拡張は行っていない。新規RNGストリームは追加していない。telemetry schemaVersionは変更していない（`clairvoyance_used`イベントの既存フィールド意味も変更なし）。Phase 23.1〜23.3の実装は作り直していない。mainは変更せずPRも作成していない。
