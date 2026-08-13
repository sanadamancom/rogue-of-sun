# Phase 23.3: ゴースト壁抜け

ゴーストを壁を通って接近する敵としてproductionへ追加した。壁内での攻撃・被攻撃・表示規則を一貫した単一の情報源（terrain判定）に基づかせ、状態停止・情報漏洩・壁内からの一方的攻撃を防いだ。

## 1. precheck結果

| 項目 | 結果 |
|---|---|
| branch | `phase-23-2-golem-charge` から分岐、work branch `phase-23-3-ghost-wall-phasing` |
| local/origin HEAD | `37815e77f302b342b29a434b6122097f2f149b45` で一致 |
| working tree | clean |
| main | `80596cd5334294255a439cb79db375f622193c50` のまま |
| Phase 23.2新規29テスト | 全通過 |
| ghost.png | `/mnt/user-data/uploads/ghost.png`（Phase 23.0受領分）を取得元として確認。72×128px・3列×4行・chroma-key緑を確認 |
| Phase 23.2未commit差分 | なし（working tree clean） |

precheck合格後、work branchを作成した。

## 2. 追加したghost定義と暫定能力値

```yaml
enemy_type: ghost
display_name: ゴースト
sprite_key: ghost
behavior_type: ghost_phase
movement_type: phasing
hp: 6
attack: 6
defense: 0
accuracy: 90
evasion: 0
experience_reward: 2
elemental_affinities: 全属性neutral
```

`BehaviorType`へ`'ghost_phase'`、`MovementType`へ`'phasing'`を新規追加。`ENEMY_TYPES_IN_ORDER`の末尾へ追加し、既存10種（Phase 23.1のスケルトンまで含む）のインデックスは変更していない。

## 3. 暫定初出階

`ENEMY_FIRST_APPEARANCE_FLOOR.ghost = 3`（スケルトンと同じ3F）。現行3フロア試作で動作確認するための暫定値であり、Phase 23.6/27での再調整を前提とする。壁抜け以外の弱点・耐性・状態異常は追加していない。

## 4. 壁内判定の唯一の情報源

`isGhostInsideWall(map, enemy)`をturn.tsへ追加し、`map.terrain[enemy.pos.y][enemy.pos.x] === 'wall'`のみを判定源とした。ghost専用の`insideWall`フラグは`EnemyActor`へ一切追加していない——毎回テレインを直接参照するため、位置とフラグが食い違うことは構造的にあり得ない。`schemaVersion`は変更していない（明示的なセーブ機構がないため）。

main.ts側の描画（alpha計算）でも同じ関数を`export`して再利用し、二重の判定ロジックを作っていない。

## 5. BFSの探索対象・目標・tie-break

**探索対象（`isGhostPassableTile`）**：in bounds、外周境界（x=0/y=0/x=width-1/y=height-1）を除く、terrainがfloorまたはwall、プレイヤーの現在座標ではない、`isMovementBlockingEnemy`が真の別の生存敵の座標ではない。この1関数をBFSのノード通過可否と、実際の1マス移動の最終合法性チェックの両方で共有しているため、両者が食い違うことはない。

**探索目標（`computeGhostAttackTargetCells`）**：プレイヤーの8方向隣接のうちterrainがfloorで、`isDiagonalCornerOpen`（tryMeleeAttackが使う角抜け禁止条件と同一）を満たし、他の移動阻害Actorに占有されていないマスの集合。

**tie-break**：ノード展開は常に`ALL_DIRECTIONS`の固定順で試行し、キューはFIFO——同一(state, ghost.pos)からは常に同じ最短経路が得られる。RNGは一切使用していない。

**結果**：最短経路の最初の1マスの方向だけを返す。経路が存在しなければ`null`を返し、その場で待つ。既存`tryChaseStep`の地形判定（floorのみ通過可）は一切変更していない——ゴースト専用のBFSとして完全に独立実装した。

## 6. 外周侵入防止

`isGhostPassableTile`が`pos.x === 0 || pos.y === 0 || pos.x === map.width - 1 || pos.y === map.height - 1`を明示的に除外しており、BFSのノード集合自体に外周セルが含まれない。マップ外（`isInBounds`）も同様に除外。

## 7. 壁内での攻撃・被攻撃規則

**攻撃（ghost自身の攻撃）**：`resolveGhostEnemy`が`isGhostInsideWall`で開始時の壁内判定（`wasInsideWall`）を取り、壁内なら`tryMeleeAttack`を一切呼ばない（隣接していても直接攻撃しない）。floor上で開始し合法な近接攻撃が可能なら移動せず`tryMeleeAttack`＋`resolveEnemyAttackHit`（既存の他種と共通の関数）で1回攻撃する。

**被攻撃（プレイヤー由来の攻撃対象として）**：新規`isEnemyAttackable(map, enemy)`を全ての攻撃対象抽出の共通境界として追加し、`enemy.alive && !isGhostInsideWall(map, enemy)`で判定。壁内ゴーストは通常近接攻撃・スピアreach-2・太陽銃・部屋全体カード（justice/devil/tower）・ハンマーノックバックのいずれの対象にもならない——攻撃がwallで自然に届かない経路だけに依存せず、対象抽出そのもので除外している。

## 8. wallからfloorへ出たターンの攻撃

`resolveGhostEnemy`は`wasInsideWall`（移動前）と`nowInsideWall`（移動後）を比較し、`wasInsideWall && !nowInsideWall`のときだけ移動直後に`tryMeleeAttack`を追加で試みる（記録済み方針「床へ出たターンから攻撃可能、追加の猶予ターンなし」を確定実装したもの）。floorからfloorへの通常移動、wallからwallへの移動は、この条件が満たされないため同ターン攻撃を一切発生させない。移動後攻撃は最大1回（`tryMeleeAttack`が1回呼ばれるのみ、複数回攻撃するループ構造はない）。既存の命中・回避・防御・死亡・judgement処理（`resolveEnemyAttackHit`が内部で使う既存経路）をそのまま利用している。

## 9. attack target共通境界の変更

- `findAttackTarget`のシグネチャへ`map: GameMap`を追加し、内部の候補フィルタを`enemy.alive`から`isEnemyAttackable(map, enemy)`へ変更。3つの呼び出し箇所（隣接近接攻撃、スピアreach-2、太陽銃レイ）すべてを更新
- `getSameRoomEnemies`（justice/devil/tower用）も同様に`isEnemyAttackable`経由へ変更
- スケルトンhead/bodyの優先規則（`findAttackTarget`内の`atPos.find(...)`部分）は無変更のまま維持

## 10. visibility、alpha、minimap

- **visibility**：`computeCurrentVisibility`（既存のshadowcasting実装）は壁タイルをその近接面が見える場合の正当な終端として既に含んでいるため、ゴーストの壁内座標が`isCurrentlyVisible`の対象になるのは変更なしで自然に成立する。visibility.ts自体は一切変更していない
- **alpha**：新規pure helper`ghostDisplayAlpha(map, enemy)`をmain.tsへ追加（`isGhostInsideWall`が真なら0.5、それ以外は1）。`snapActor`/`animateMove`双方へ`alpha`引数を追加し、敵描画の全呼び出し箇所（`snapAllEnemies`、`applyTurnResult`内のループ）で計算・適用。他種は常に1のまま
- **移動tweenの視界外漏洩防止**：`applyTurnResult`の先頭で`refreshStaticView()`実行前の`this.currentVisible`をスナップショット（`visibleBeforeTurn`）として保持し、移動元タイルがそのスナップショットで不可視かつ移動先が可視になった場合だけ、tweenを使わず`snapActor`で直接移動先へスナップする。移動元・移動先とも不可視の場合は`extraVisible=false`によりどちらの関数でも非表示のままなので実害はなく、通常どおり`animateMove`を使う
- **minimap**：`drawMinimap`は既存のまま（`enemy.alive && isCurrentlyVisible(enemy.pos)`のみで判定）で変更不要——壁内ゴーストのタイル自体が可視のときだけ自然に表示され、探索済み(exploredTiles)を根拠に表示することはない

## 11. 千里眼対象外

千里眼の実（clairvoyance_fruit）の対象・処理（`applyClairvoyance`系）へゴーストを一切追加していない。既存の罠発見効果は無変更。ステップス連携はPhase 23.4へ延期。

## 12. 通常生成とmonsterHouse統合

`getEnemyPoolForFloor`（無変更のロジック）が`ENEMY_FIRST_APPEARANCE_FLOOR`を参照するため、ghost追加により3F以降の候補プールへ自動的に加わる。monsterHouseの敵種選択（`monster-house.ts`の`chooseMonsterHouseEnemyTypes`）も同じ`getEnemyPoolForFloor`を使うため、`spawnSource`による分岐を一切追加せずに自動的にghostがmonsterHouse候補へ参加する。フロア遷移時は敵配列が毎回`createInitialEnemy`で新規生成されるため（既存の仕組みのまま）、前フロアの壁内位置や状態を持ち越さない。

各階の敵数、monsterHouse発生率、monsterHouse専用敵数、floor2のゴーレム制限、スケルトンの暫定3F初出は一切変更していない。

## 13. RNGへの影響

新規RNGストリーム・XOR定数は追加していない。移動方向・経路・壁出入りの判定はすべて決定的な座標比較とBFSの固定順展開のみで完結する。プレイヤー攻撃時（ghost自身の`tryMeleeAttack`経由の攻撃）だけ、既存の`resolveEnemyAttackHit`が使う命中ロール（`state.combatRngState`）を消費するが、これは他の全ての近接系種族と共有する既存の消費経路であり、新規消費ではない。テストで同一state・同一RNGから同一経路・同一結果が再現することを確認済み。

## 14. 新規・変更テスト

### 新規テスト
`phase-23-3-ghost-wall-phasing.test.ts`：30件、全通過。

内容：ロスター登録・既存10種のインデックス保持・1F/2F非出現・3F出現、BFS移動（壁侵入、壁内連続移動、壁越え到達、外周非侵入、プレイヤーマス非侵入、生存敵マス非侵入、スケルトンhead通過、複数実行での決定性、袋小路での待機、複数ゴーストの非重複）、攻撃タイミング（floor隣接即時攻撃、壁内での複数ターン非攻撃、壁→floor遷移ターンでの1回攻撃、同ターン複数回攻撃なし、floor→floor移動での非攻撃）、攻撃可能性（近接・スピア・太陽銃・justiceカード・ハンマーノックバックそれぞれからの除外、floor上での通常攻撃可能性、スケルトンhead/body優先の維持）、統合（monsterHouse個体の同一AI、ゴーレム突進のブロック対象になること、フロア遷移での非持ち越し、経験値1回確定）。

### 変更した既存テストと理由
ロスター10→11種の成長に伴う期待値更新のみ（新仕様への直接抵触箇所）：

- `phase-14-4-enemy-affinities.test.ts`：`CONFIRMED_TABLE`へghost行追加、ロスター数10→11
- `enemy-roster-foundation.test.ts`：登録数・roster preview数を10→11
- `floor-enemy-pools.test.ts`：3F/4Fプール集合へghost追加、2Fの非包含チェックリストへghost追加、5F/6Fの「フルロスター」件数コメント更新
- `phase-15-5-enemy-count-by-floor.test.ts`：roster preview長さ10→11
- `armor-and-golem.test.ts`：3F候補プール集合へghost追加

テストの削除・skip・過度な緩和は一切行っていない。

## 15. targeted regression結果

以下の合計37ファイル・1600テストを実行し、全て通過を確認した。

```
phase-23-1-solar-gun-element-skeleton / phase-23-2-golem-charge /
enemy-roster-foundation / enemy-type / floor-enemy-pools /
phase-15-5-enemy-count-by-floor / turn / integration / multi-floor /
multi-floor-robustness / visibility / dark-room-visuals /
phase-18-2-minimap / phase-18-1-trap-discovery / phase-18-2-clairvoyance /
weapon-and-sword / spear-reach-weapon / phase-09-2-solar-gun /
hammer-knockback-weapon /
phase-20-0a/20-0c/20-0d/20-1/20-2/20-3/20-4/20-5a/20-5b/20-core-loop
(カード効果・対象選択関連) /
phase-21-1〜21-8 (monsterHouse関連) /
armor-and-golem / enemy-behavior-bat/cockatrice/kraken/melee-variants/
mummy/spider / message-log / telegraph /
phase-14-4-enemy-affinities / phase-22-immediate-stairs-progression /
phase-10-3-1-telemetry / phase-10-3-2-telemetry-fix /
phase-13-3c-ability-ui-telemetry / phase-18-2-telemetry
(judgement・死亡処理はphase-20-3-defensive-death-cardsで確認)
```

## 16. Phase 25へ延期した表現

- 完成版の半透明・浮遊アニメーション（現在は静的なalpha 0.5固定表示のみ）
- 壁への侵入・出現専用モーション
- 専用SE・エフェクト
- 千里眼によるステップス可視化（Phase 23.4）
- ステップスの3×3攻撃（Phase 23.4）
- 敵ロスター全体の最終調整

---

## Completion Report

**precheck結果**：全項目合格（1章参照）。

**調査した敵対象抽出経路**：`findAttackTarget`の3呼び出し箇所（隣接近接・スピアreach-2・太陽銃レイ）、`getSameRoomEnemies`（justice/devil/tower）、`resolveOneEnemy`のAGGRO_RANGE処理（ghostはバイパス不要と確認）、`tryMeleeAttack`/`resolveEnemyAttackHit`（ghost自身の攻撃で再利用）、`tryChaseStep`（ghost専用BFSとは独立のまま無変更）、`isMovementBlockingEnemy`（無変更で足りることを確認——壁は元々通常アクターに到達不能なため）、`computeCurrentVisibility`（壁境界を正しく含むことを確認、無変更）、`snapActor`/`animateMove`/`drawMinimap`（alpha引数追加、minimapは無変更）、千里眼・罠表示（無変更）。

**変更ファイル一覧**：
```
src/game/types.ts             (EnemyType 'ghost'追加)
src/game/enemy-def.ts         (BehaviorType/MovementType追加、ghost定義、ENEMY_TYPES_IN_ORDER、ENEMY_FIRST_APPEARANCE_FLOOR)
src/game/turn.ts              (isGhostInsideWall、isEnemyAttackable、findAttackTarget/getSameRoomEnemies更新、ghost BFS一式、resolveGhostEnemy、dispatch追加)
src/main.ts                   (ghostDisplayAlpha、snapActor/animateMoveのalpha対応、視界外tween漏洩防止)
public/assets/sprites/ghost.png (新規配置)
src/game/__tests__/phase-23-3-ghost-wall-phasing.test.ts (新規、30件)
src/game/__tests__/phase-14-4-enemy-affinities.test.ts (ロスター数更新)
src/game/__tests__/enemy-roster-foundation.test.ts (ロスター数更新)
src/game/__tests__/floor-enemy-pools.test.ts (プール集合更新)
src/game/__tests__/phase-15-5-enemy-count-by-floor.test.ts (roster preview数更新)
src/game/__tests__/armor-and-golem.test.ts (3Fプール集合更新)
docs/history/phase-23-3-ghost-wall-phasing.md (新規)
```

**ghostの暫定能力値と初出階**：2-3章参照（hp6/atk6/exp2/全属性neutral、3F初出）。

**movementTypeとbehaviorType**：`'phasing'`/`'ghost_phase'`（2章参照）。

**壁内判定方法**：4章参照（`isGhostInsideWall`、terrain参照のみ、フラグ非保持）。

**BFSの経路探索規則**：5章参照（floor/wall同コスト1、`ALL_DIRECTIONS`固定順、FIFO、RNG不使用）。

**外周侵入防止**：6章参照。

**wallからfloorへ出たターンの攻撃結果**：8章参照（`wasInsideWall && !nowInsideWall`の1条件のみで判定、最大1回攻撃）。

**壁内で除外した攻撃経路**：7章参照（近接・スピア・太陽銃・部屋カード・ハンマーノックバックすべて）。

**findAttackTarget等の共通境界変更**：9章参照（`isEnemyAttackable`新設、`map`引数追加）。

**visibilityとalpha**：10章参照（visibility.ts無変更、`ghostDisplayAlpha`新設、視界外tween漏洩防止追加）。

**minimapでの扱い**：10章参照（既存ロジックのまま変更不要）。

**千里眼対象外の確認**：11章参照（変更なし、対象追加なし）。

**通常生成・monsterHouse統合**：12章参照（`getEnemyPoolForFloor`経由で自動参加、専用分岐なし）。

**RNG消費**：13章参照（新規消費なし、既存命中ロールのみ）。

**新規テスト件数と内容**：14章参照（30件）。

**変更した既存テストと理由**：14章参照（ロスター10→11成長に伴う期待値更新のみ、5ファイル）。

**targeted regressionのファイル数・テスト数・結果**：15章参照（37ファイル・1600テスト、全通過）。

**全テストへ拡大したかと理由**：拡大していない。対象範囲で広範囲の回帰疑いは見つからなかった。

**headlessまたはmanual確認**：実ブラウザ環境が利用できないため、`processTurn`を直接呼び出すheadless確認（新規テストファイル内）で、floor→wall→wall→floor→即時攻撃の遷移、壁内でのカード攻撃対象除外、visibility/alphaのpure helperの状態連動を直接検証した。半透明表示・壁→床への表示復帰・視界外壁内移動の非表示は実見た目確認ができていないが、`ghostDisplayAlpha`関数自体と`isCurrentlyVisible`ゲートの組み合わせをテストで直接検証済み。

**typecheck**：`npx tsc --noEmit` 成功。

**build**：`npx vite build` 成功（`dist/assets/index-B7kqmoID.js` 1,634.78 kB、既存のチャンクサイズ警告のみ）。

**diff-check**：`git diff --check` 問題なし。

**commit hash**：下記コマンド実行後に追記。

**push先**：`origin/phase-23-3-ghost-wall-phasing`

**PAT残存なし**：push後に確認。

**main未変更**：本タスク中、mainブランチへのチェックアウト・変更は一切行っていない。

**最終git status**：下記コマンド実行後に追記。

**指示に従わなかった点と理由**：なし。ステップス・コカトリス飛行は実装していない。ゴーストへ壁抜け以外の属性弱点・耐性・状態異常は追加していない。千里眼対象へゴーストを追加していない。通常敵の`tryChaseStep`/`canMove`は変更していない（ゴースト専用BFSとして完全独立実装）。プレイヤーや他の敵を壁通過可能にしていない。外周壁への侵入を許可していない。壁内からの攻撃を許可していない。壁内ゴーストをカード攻撃対象にしていない。視界外ゴーストをminimapへ表示していない。新規RNGストリームを追加していない。enemy count・monsterHouse設定を変更していない。Phase 23.1・23.2の実装は作り直していない。mainは変更せずPRも作成していない。
