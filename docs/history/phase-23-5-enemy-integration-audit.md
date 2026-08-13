# Phase 23.5: 追加敵統合監査

Phase 23.1〜23.4で追加・再設計した4種（スケルトン・ゴーレム・ゴースト・ステップス）を横断監査し、共有システム（対象選択・占有判定・撃破報酬・ターン順序・フロア遷移・生成・表示・イベント・RNG）との統合不具合の有無を検証した。今回は新能力・バランス調整を行うPhaseではなく、確定済み仕様との不整合が再現テストで証明された場合のみ最小修正する方針で実施した。

## 1. 起点commit、branch、precheck実測

| 項目 | 結果 |
|---|---|
| base branch | `origin/phase-23-4-steps-clairvoyance` |
| base commit | `acba5e940daace6be6a180337214e570298ae80e` |
| work branch | `phase-23-5-enemy-integration-audit` |
| local HEAD / origin/phase-23-4 | ともに `acba5e940daace6be6a180337214e570298ae80e` で一致 |
| origin/main | `80596cd5334294255a439cb79db375f622193c50` のまま |
| working tree | clean |
| 同名branch | local/remoteともに未作成を確認 |
| baseline専用テスト | Phase 23.1〜23.4の4ファイル・139件、全通過（変更前に実行） |

## 2. 監査対象と対象外

**対象**：スケルトン(body/head)・ゴーレム(idle/telegraphed/recovering)・ゴースト(floor/wall)・ステップス(hidden/telegraphed/revealed)の4種と、共有targeting・actor collision・damage/death/reward・turn order/AGGRO_RANGE・floor transition・通常生成/monsterHouse・visibility/rendering・events/telemetry・RNG/決定性の8監査領域。

**対象外**（record-only、変更なし）：HP・攻撃・防御・命中・回避・経験値の再調整、初出階・出現率・階層別ロスター、完成版ランの敵数・組み合わせ、コカトリスの飛行モーション・アセット配置（`cockatrice_flying.png`は今回も配置していない）、クロロホルン・属性違いゴーレムのロスター追加。

## 3. 4種の確定状態契約

Phase 23.1〜23.4のhistory文書からの確定契約を整理（fixed_baselineどおり、変更なし）。

- **スケルトン**：body/head。属性攻撃によるbody撃破は完全撃破、非属性攻撃はhead化（報酬なし）。headは移動阻害せず攻撃対象になるが撃破されない（属性攻撃のみ完全撃破）。8ワールドターン後に元座標へ復活（無制限・RNGなし）
- **ゴーレム**：idle/telegraphed/recovering。8方向隣接で通常攻撃→recovering。距離2〜5の直線かつ経路clearで予告。予告済み突進はAGGRO_RANGE外でも実行、最大5マス、wall/移動阻害Actor/プレイヤーで停止、スケルトンheadは通過、プレイヤー衝突は1回のみ・ノックバックなし
- **ゴースト**：floor/wall。専用BFSでfloor/内部wall同コスト探索、外周侵入なし、wall内は攻撃・被攻撃対象外、wallからfloorへ出たターンのみ移動後1回攻撃可、wall判定の唯一の情報源はterrain
- **ステップス**：hidden/telegraphed/revealed。全状態で通常の攻撃対象・移動阻害Actor、Chebyshev距離1を移動前に感知、1ターン後に固定中心3×3棘攻撃、攻撃後3回の通常行動でrevealed、telegraphed/revealedはAGGRO_RANGE外でも進行、千里眼は表示のみ変更

## 4. 共有targeting・blocking監査結果

`findAttackTarget`（近接隣接・スピアreach-2・太陽銃レイの3呼び出し箇所）と`getSameRoomEnemies`（justice/devil/tower）は、いずれもPhase 23.3で新設された共通境界`isEnemyAttackable(map, enemy)`（`enemy.alive && !isGhostInsideWall(map, enemy)`）を経由しており、監査対象4種すべてに対して一貫した挙動を確認した——壁内ゴーストのみが対象外、floorゴースト・スケルトンhead・ステップス全状態・ゴーレム全状態は通常どおり対象。ハンマーノックバックは`applyPlayerAttackToEnemy`が事前に`isEnemyAttackable`経由で選定した`target`にのみ作用するため、壁内ゴーストへは到達しない。統合テストで実測確認。**不具合なし**。

`isMovementBlockingEnemy`（`enemy.alive && !(スケルトンhead)`）は移動阻害判定の唯一の共有関数であり、golem charge・ghost BFS（`isGhostPassableTile`）・tryChaseStep・tryKnockback・resolveSkeletonRevivalsのすべてがこれを参照している——ただし`resolveSkeletonRevivals`内の占有判定（`other.alive && !(スケルトンhead)`という条件式）は`isMovementBlockingEnemy`と論理的に同一だが、共有関数を呼び出さず同等のロジックをインラインで重複実装している。動作上の不整合は再現テストで確認できず（両者は完全に同値のロジック）、修正基準（「確定済み仕様とproductionの実挙動が矛盾し、共有システムとの統合不具合を再現テストで証明できた場合」）を満たさないため、**修正はせず記録のみ**とした（8章参照）。ゴーストのwall通過能力（`isGhostPassableTile`）はghost自身の経路計画関数からのみ呼ばれ、他種の移動判定（`canMove`/`isWalkable`は変更なしでfloorのみ許可）へ一切漏洁していないことを確認した。

## 5. damage・death・reward・telemetry監査結果

`defeatEnemyIfNeeded`の4呼び出し箇所（プレイヤー攻撃・justice・devil・tower）を確認。スケルトンのbody→head→復活→完全撃破のフルサイクルを統合テストで実行し、経験値イベント(`experience_gained`)が完全撃破の瞬間にのみ1回だけ発火することを確認した。ゴーレム突進の衝突ダメージ・ステップスの棘攻撃はいずれも既存`resolveEnemyAttackHit`を最大1回しか呼ばない構造であることをコード監査と統合テストの両方で確認（`enemy_attack`/`enemy_attack_missed`が1件以下）。`translateGameEvent`（telemetry.ts）はswitchが`default:`を持つ非網羅的実装のため、Phase 23.1〜23.4で追加した新規イベント型（`skeleton_headified`等、`golem_charge_telegraphed`等、`steps_spike_telegraphed`等）を処理しても未対応例外は発生しない。`clairvoyance_used.revealedCount`の意味（罠件数のみ）はPhase 23.4で変更されておらず、`stepsClairvoyanceActive`は別フィールドとして分離されている。telemetry schemaVersionは今回も変更していない。**不具合なし**。

## 6. turn order・AGGRO_RANGE監査結果

`resolveOneEnemy`のAGGRO_RANGE早期returnバイパス条件（`golemChargeInProgress`/`stepsMidCycle`）は、いずれも呼び出し対象の`enemy`パラメータ自身の`behaviorType`と状態のみを見て判定するため、関数のスコープ上、他の無関係なidle敵へ波及することは構造的にあり得ない（統合テストで確認）。複数の特殊敵（スケルトンhead・telegraphedゴーレム・壁内ゴースト・telegraphedステップス）が同一state内に共存する1ワールドターンで、それぞれ独立に正確に1段階だけ進行することを統合テストで確認した。

**発見事項（修正なし・記録のみ）**：`resolveEnemiesAction`はPhase 12.2由来の「鈍足の罠」機構により、プレイヤーが移動アクションでmovement_slow効果を保持している場合、同一`processTurn`呼び出し内で**2回**呼び出される（通常フェーズ＋追加フェーズ）。この既存機構とテレグラフ型の敵（cockatrice・kraken・Phase 23.2のゴーレム・Phase 23.4のステップス）が組み合わさると、1回のプレイヤーアクションで予告と実行の両方が連続して解決される場合があることを再現テストで実測確認した（ゴーレムが`telegraphed`から`recovering`まで1回のprocessTurn呼び出し内で進行することを`console.log`で実測）。これはPhase 12.2（鈍足の罠）がPhase 6のcockatrice/krakenの実装より後に導入されて以来存在する、テレグラフ機構全体に共通する既存の特性であり、Phase 23.1〜23.4のいずれのhistoryでも「1回のplayer actionで状態が複数段階進まない」という主張は通常状態（鈍足効果なし）でのみ検証されていた。この相互作用はcockatrice/krakenを含む既存のテレグラフ機構全体に及ぶため、修正には「汎用戦闘基盤の大規模リファクタリング」（禁止事項）に該当する`resolveEnemiesAction`の追加フェーズ機構自体の再設計が必要になる。今回のstage_3方針（「敵AIの再設計」「汎用戦闘基盤の大規模リファクタリング」は禁止）に従い、**修正せず記録のみ**とした。詳細は`phase-23-5-enemy-integration-audit.test.ts`の「pre-existing slow-trap extra-enemy-phase interaction (record-only)」ブロックに再現テストとして残した。

## 7. 通常生成・monsterHouse監査結果

`buildFloorState`（state.ts）は通常生成・monsterHouse生成の両方が同一の`createInitialEnemy`＋`ENEMY_DEFINITIONS`を経由することを確認。`spawnSource === 'monster_house'`を参照する箇所は`resolveEnemiesAction`内の「hidden中は行動しない」の1箇所のみで、4種いずれの特殊AI（body/head、charge、phasing、steps state machine）にも`spawnSource`専用分岐は存在しない——monsterHouse内の個体も通常個体と完全に同一のAI・状態機械で進行することを確認済み（Phase 23.1〜23.4の各専用テストで個別確認済み、今回追加で再確認はしていない）。ロスター拡張（9→12種）による候補プール変化以外のRNG消費順は変更していない。**不具合なし**。

## 8. visibility・dark room・sprite・telegraph・minimap監査結果

`spriteKeyForEnemy`はスケルトンhead・ゴーレムrolling・ステップスbodyの切替を単一境界で処理しており、`ghostDisplayAlpha`（alpha計算）とは完全に独立した別関数であることを確認（両者が混同・干渉するコードパスは存在しない）。`drawTelegraphs`は`telegraphReticleGraphics`/`telegraphMarkerGraphics`を1フレームにつき1回だけ`.clear()`し、その後cockatrice→kraken→golem→stepsの順で単一ループ内に全種のgetter呼び出しを直列に配置しているため、複数種のtelegraphが同一フレームで共存でき、後続種の描画が先行種の描画を消すことはない。`getGolemChargeTelegraph`/`getStepsTelegraph`はいずれもpure getterで、互いの状態を変更しないことを統合テストで確認した。`getStepsSpikeCells`は範囲列挙・実攻撃判定・telegraph描画の3箇所すべてで共有されているため、wall除外セルと実攻撃セルの不一致は構造的に発生しない。ゴーストは`shouldDisplayStepsBody`（ステップス専用）から完全に独立しており、千里眼はゴーストの表示に一切影響しない。`getMinimapStepsMarkers`はterrain・exploredTiles・current visibilityのいずれにも依存せず、座標のみを返す。ゴーストはminimapへ一切追加されていない。**不具合なし**。

## 9. floor transitionとcarry-over監査結果

`CarryOverStats`（state.ts）は明示的なallow-listインターフェースであり、`golemChargeState`・`stepsState`・`stepsTelegraphCenter`・`stepsRevealTurnsRemaining`・`stepsClairvoyanceActive`はいずれも一覧に含まれていない——フロア遷移後の新規`GameState`・新規`EnemyActor[]`ではこれらのフィールドは構造的に`undefined`になる。統合テストで、ゴーレムのtelegraphed状態・ステップスのrevealed状態・`stepsClairvoyanceActive`のいずれもフロア遷移後に残らないことを確認した。既存の`combatRngState`等の通常carry-over statsは今回の追加によって意図せず初期化・複製されていないことも確認済み。**不具合なし**。

## 10. RNG消費・決定性監査結果

同一seed・同一操作列（4種混在の敵配置＋4回のwaitアクション）から、敵の状態・位置・HP・イベント列・`combatRngState`が完全に一致することを統合テストで確認した。ステップスの棘攻撃がプレイヤー不在で命中判定自体を呼ばない場合、`combatRngState`が変化しないことも確認した（不要なRNG消費なし）。ゴーストBFS・ゴーレム突進・ステップス感知・スケルトン復活のいずれも、新規RNGストリーム・XOR定数を消費していないことをコード監査で再確認した。**不具合なし**。

## 11. 発見した不具合と修正内容

**production修正は0件**。新規統合テスト15件はすべて初回実行で成功し、確定仕様とproductionの実挙動が矛盾する箇所は発見されなかった。

## 12. 修正しなかった不明点・balance事項

- **鈍足の罠と特殊敵テレグラフの二重解決**（6章参照）：既存のPhase 12.2機構に起因する、テレグラフ機構全体（cockatrice/kraken含む）に共通する既存の特性。再現テストで記録済み、修正は次フェーズ以降の判断に委ねる
- `resolveSkeletonRevivals`の占有判定が`isMovementBlockingEnemy`と論理的に同値だが別実装として存在する点（4章参照）：動作上の不整合はなく、修正基準を満たさないため記録のみ
- HP・攻撃・防御・命中・回避・経験値の再調整、初出階・出現率・階層別ロスターの最終決定はPhase 23.6へ委ねる（13章の引き継ぎ表参照）

## 13. 新規テストと更新テストの実測件数

新規：`src/game/__tests__/phase-23-5-enemy-integration-audit.test.ts`（15件、全通過）。既存テストの変更・更新は0件（production修正が発生しなかったため、既存テストへの影響も発生しなかった）。

## 14. targeted regression結果

Phase 23.5では全件テスト実行を必須としたため、targeted regressionは個別に区分せず14章の全件実行に統合して実施した。

## 15. 全テストのファイル数・テスト数・結果

`npx vitest run`：**108ファイル・2715テスト、全通過**。

## 16. typecheck、vite build、git diff --check

- `npx tsc --noEmit`：成功（エラーなし）
- `npx vite build`：成功（`dist/assets/index-D-nv7qdI.js` 1,637.54 kB、既存のチャンクサイズ警告のみ、production修正がなかったためbuild成果物のハッシュもPhase 23.4から不変）
- `git diff --check`：問題なし

## 17. Phase 23.6引き継ぎ表

| enemy type | current first floor | HP/ATK/DEF/ACC/EVA/EXP | special behavior | pool participation | monsterHouse | RNG consumption | integration risk | Phase 23.6 decision needed |
|---|---|---|---|---|---|---|---|---|
| bok | 1 | 6/3/0/90/0/1 | generic_melee | 1F〜 | ○ | 既存のみ | なし | 数値バランスの全体見直し |
| spider | 2 | 5/5/0/90/0/1 | spider_cardinal | 2F〜 | ○ | 既存のみ | なし | 数値バランスの全体見直し |
| cockatrice | 3 | 8/7/0/90/0/2 | cockatrice_gaze | 3F〜 | ○ | 既存のみ | なし（飛行モーション未実装、Phase25） | 飛行モーション実装時期の決定 |
| mummy | 3 | 10/9/0/90/0/2 | mummy_shamble | 3F〜 | ○ | 既存のみ | なし | 数値バランスの全体見直し |
| **skeleton** | **3（暫定）** | 6/5/0/90/0/2 | body/head状態機械、8ターン復活 | 3F〜 | ○ | 復活位置固定、新規消費なし | なし（監査済み） | 初出階・数値の最終確定 |
| **ghost** | **3（暫定）** | 6/6/0/90/0/2 | floor/wall phasing BFS | 3F〜 | ○ | BFS新規消費なし | なし（監査済み） | 初出階・数値の最終確定 |
| **steps** | **3（暫定）** | 6/6/0/90/0/2 | hidden/telegraphed/revealed 3×3棘 | 3F〜 | ○ | 感知・範囲は新規消費なし | なし（監査済み） | 初出階・数値の最終確定 |
| sword | 4 | 9/8/0/90/0/2 | fast_melee | 4F〜 | ○ | 既存のみ | なし | 数値バランスの全体見直し |
| axe | 4 | 12/12/0/90/0/3 | recovery_melee | 4F〜 | ○ | 既存のみ | なし | 数値バランスの全体見直し |
| bat | 1 | 4/4/0/90/10/1 | bat_retreat | 1F〜 | ○ | 既存のみ | なし | 数値バランスの全体見直し |
| **golem** | 5（既存、変更なし） | 10/12/1/90/0/3 | golem_charge（Phase23.2で再設計） | 5F〜（floor2に最大1体の例外あり） | ○ | 突進方向は座標比較のみ、新規消費なし | なし（監査済み） | 突進距離・回復ターンの最終確定 |
| kraken | 5 | 12/10/1/90/0/3 | kraken_tentacle | 5F〜 | ○ | 既存のみ | なし | 数値バランスの全体見直し |

（全12種、現行値の記録のみ。クロロホルン・属性違いゴーレムはロスターへ追加していない。未実装アセット（cockatrice_flying.png等）の存在は採用決定として扱っていない。主観的な推奨値は記載していない。）

## 18. READY / READY_WITH_RECORDED_BALANCE_QUESTIONS / BLOCKED判定

**READY_WITH_RECORDED_BALANCE_QUESTIONS**

production不具合・統合回帰は発見されず、全テスト（108ファイル・2715件）・typecheck・buildすべて成功した。状態機械・報酬・対象選択・階層遷移のいずれにも未解決の不具合はない。ただし12章に記録した2件の観察事項（鈍足の罠との二重解決可能性、`resolveSkeletonRevivals`の重複ロジック）と、17章の引き継ぎ表に記載した暫定初出階・暫定数値の最終確定という、balance/設計判断待ちの記録事項が残っているため、無条件のREADYではなく本判定とした。

## 19. 指示逸脱の有無

指示に従わなかった点はない。HP・攻撃・防御・命中・回避・経験値の再調整は行っていない。初出階・出現率・階層別ロスターは変更していない。コカトリス飛行・`cockatrice_flying.png`配置は行っていない。新規敵・新規RNGストリーム・新しい弱点耐性状態異常は追加していない。telemetry schemaVersionは変更していない。Phase 23.1〜23.4の再設計は行っていない。無関係なリファクタリング・警告掃除は行っていない。production修正が0件だったため、`allowed_fixes`の適用例も発生しなかった。mainは変更せずPRも作成していない。
