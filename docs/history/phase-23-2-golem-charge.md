# Phase 23.2: ゴーレム突進

ゴーレムの固有行動を`slow_melee`（隔ターン行動）から`golem_charge`（予告→突進→回復の専用状態機械）へ全面再設計し、実際に遊べるproduction機能として成立させた。

## 1. precheck結果

| 項目 | 結果 |
|---|---|
| branch | `phase-23-1-solar-gun-element-skeleton` から分岐、work branch `phase-23-2-golem-charge` |
| local/origin HEAD | `de4e67ba83e5b11d35e0773d753bad7d1550215d` で一致 |
| working tree | clean |
| main | `80596cd5334294255a439cb79db375f622193c50` のまま |
| Phase 23.1新規37テスト | 全通過 |
| claygolem_rolling.png | `/mnt/user-data/uploads/claygolem_rolling.png`（Phase 23.0受領分）取得元を確認、72×128px・既存規則と一致 |

precheck合格後、work branchを作成した。

## 2. slow_meleeからの変更

`slow_melee`（`(state.turn - spawnTurn) % 2`による隔ターン行動）は golem 以外に使用されておらず、`golem_charge`への置換に伴い全面撤去した（`resolveGolemEnemy`関数、`BehaviorType`の`'slow_melee'`メンバー、`resolveOneEnemy`の対応する`switch case`を削除）。golemの`EnemyDefinition.behaviorType`を`'golem_charge'`へ変更。`spawnTurn`フィールド自体は他種のドキュメントに合わせて維持し、削除していない。

## 3. 状態構造

`EnemyActor`へ以下のoptionalフィールドを追加（`schemaVersion`は変更なし、別Entityは作らず既存の`EnemyActor`拡張パターンを踏襲）。

```ts
golemChargeState?: 'idle' | 'telegraphed' | 'recovering'  // 省略時は'idle'相当
golemChargeDirection?: Direction4                          // N/S/E/Wのみ
golemChargeTargetTile?: Vec2                                // 表示専用（cockatrice/krakenのtelegraph用フィールドと同型）
```

`Direction4 = 'N' | 'S' | 'E' | 'W'`を`types.ts`へ新規追加（`Direction8`の斜め方向は使用しない）。

## 4. 発動条件と優先順位

`resolveGolemChargeEnemy`が`golemChargeState`（省略時'idle'）で分岐する。

**idle時の優先順位**：
1. プレイヤーが8方向隣接 → 既存`tryMeleeAttack`をそのまま再利用して1回攻撃 → `recovering`へ
2. プレイヤーと同一行/列かつChebyshev距離2〜5、直線上に壁・マップ外・移動阻害Actorがない（`isGolemChargeLineClear`で判定：`castGazeRay`による地形チェック＋`isMovementBlockingEnemy`による中間タイルのActorチェック、末端の対象タイル自体は除外）→ 移動も攻撃もせず`telegraphed`へ、方向とtarget tileを固定、予告イベント発火
3. それ以外 → 既存`tryChaseStep`で最大1マス追跡（移動不能ならその場待機）→ `recovering`へ

**telegraphed時**：次のゴーレム自身の敵ターンに、予告時固定した方向へ`executeGolemCharge`が突進を実行。

**recovering時**：移動・攻撃・予告を一切行わず`enemy_recovering`イベントのみ発火、`idle`へ戻る。「idleへ戻った同じターンには追加行動しない」を厳密に満たすため、`resolveGolemChargeEnemy`の`recovering`分岐は即`return`し、`idle`分岐へフォールスルーしない。

## 5. 予告、突進、回復の順序（実際のターン順）

1回のプレイヤーアクション＝1回の`processTurn`呼び出しにつき、ゴーレムは常に1段階のみ進行する（`phase-23-2-golem-charge.test.ts`の「一度に複数段階進まない」テストで確認）。

```
world turn N   : idle -> telegraphed（予告、移動・攻撃なし）
world turn N+1 : telegraphed -> 突進実行 -> recovering
world turn N+2 : recovering -> idle（休止、移動・攻撃なし）
world turn N+3 : idle（再び優先順位判定から開始）
```

## 6. 距離上限・停止条件

- 突進は最大5マス、1マスずつ`canMove`で判定しながら進む
- 壁・マップ外：侵入せず直前の合法セルで停止。最初のセルが塞がれていれば元座標のまま
- 移動阻害Actor（`isMovementBlockingEnemy`が真を返す生存アクター）：その手前で停止、ダメージなし、相手を移動させない
- スケルトンの頭部（`isMovementBlockingEnemy`が偽）：通過可能、頭部へダメージを与えない（既存のPhase 23.1仕様のまま、頭部専用の追加分岐は書いていない）
- プレイヤー：プレイヤーのマスへは侵入せず手前で停止し、既存`resolveEnemyAttackHit`（tryMeleeAttackが使うものと同一関数）で1回だけ攻撃を試みる。命中・回避いずれでも突進は終了する
- ground item・trap・web・階段・monsterHouse entry cell：一切干渉しない（`canMove`は地形のみを見るため、これらは元々ゴーレムの移動判定に影響しない。罠発動の新規仕様も追加していない）

## 7. player衝突処理

`executeGolemCharge`内で、次の移動先がプレイヤーの座標と一致した時点でループを打ち切り、`resolveEnemyAttackHit`を1回だけ呼ぶ。この関数は既存のゴーレムの攻撃力・命中・回避・防御計算をそのまま使う（tryMeleeAttackが使う関数と完全に同一）。ノックバックは行っていない——そもそもこのコードベースに「敵からプレイヤーへのノックバック」機構自体が存在しないため、新規の抑止コードは不要だった。同一突進で複数回ダメージが発生しないことは、ループが攻撃直後に即座に`break`する構造で保証されている。

## 8. 通常追跡を残したこと

idle優先順位3（アライン外・距離外）では、既存`tryChaseStep`をそのまま再利用した。ゴーレムが完全に停止せず、通常の8方向追跡でプレイヤーへ近づき続けられるようにするため——直線条件を満たすまでゴーレムが何もしない「進行不能」状態を避ける目的で、開発方針の「進行不能、状態停止...はこのPhaseで修正する」要件に対応した。

## 9. AGGRO_RANGE外での処理

`resolveOneEnemy`の一般aggro-range early-returnに、ゴーレムが`telegraphed`または`recovering`状態のときだけbypassする分岐を追加した（`golemChargeInProgress`変数）。これにより：

- 予告済みの突進は、プレイヤーがAGGRO_RANGE外へ逃げても必ず実行される
- 回復状態もAGGRO_RANGE外で消化される（距離変化による永久停止を防止）
- `idle`状態のゴーレムは従来どおり、非隣接かつAGGRO_RANGE外では一切行動しない

## 10. RNG消費

新規RNGストリーム・XOR定数は追加していない。方向決定・経路・停止位置はすべて決定的な座標比較のみで完結する。プレイヤー衝突時の攻撃判定のみ、既存の`resolveEnemyAttackHit`が使う命中ロール（`state.combatRngState`）を消費するが、これはtryMeleeAttackの通常攻撃と全く同じ消費経路であり、新規消費ではない。テストで同一state・同一RNGから同一結果が再現することを確認済み。

## 11. monsterHouse統合

`spawnSource`による分岐は一切追加していない。monsterHouse生成のゴーレムも通常生成のゴーレムと全く同じ`resolveGolemChargeEnemy`を通る（テストで`spawnSource: 'monster_house'`を設定したゴーレムが同一に予告することを確認）。敵プール・敵数・monsterHouse発生率・floor2のゴーレム最大1体制限のいずれも変更していない。

## 12. アセット・sprite・telegraph

- `public/assets/sprites/claygolem_rolling.png`へ受領済み画像をそのまま配置（リサイズ・再描画なし）
- `main.ts`の`EXTRA_SPRITE_KEYS`へ`'claygolem_rolling'`を追加し、preload対象に含めた
- `spriteKeyForEnemy(enemy)`の単一境界へ、`enemy.type === 'golem' && enemy.golemChargeState === 'telegraphed'`のときのみ`'claygolem_rolling'`を返す分岐を追加。idleとrecoveringは通常の`claygolem`のまま。描画呼び出し側（4箇所）への個別if追加はしていない（Phase 23.1で確立した単一境界パターンをそのまま踏襲）
- `telegraph.ts`へ`getGolemChargeTelegraph`をpure getterとして追加し、cockatrice/krakenと同型（`{enemy, targetTile}`）で返す
- `main.ts`の`drawTelegraphs()`へ、既存のreticle/attacker markerをそのまま再利用する形でgolem charge分岐を追加（`continue`チェーンで3種を順に判定）。プレイヤー移動後もreticleは動かない（`golemChargeTargetTile`は予告時に固定されるため）。突進経路全体は表示していない
- 複数マス移動時のアニメーションは既存`animateMove`がそのまま処理する（開始位置→最終位置への単純な直線tween、距離に関わらず同じ関数）——複数マス専用の演出はPhase 25へ延期し、今回は追加コードなし
- 丸まり開始・解除モーション、残像、衝突エフェクト、画面揺れ、専用SEはいずれも実装していない（Phase 25延期）

## 13. テスト結果

### 新規テスト
`src/game/__tests__/phase-23-2-golem-charge.test.ts`：29件、全通過。

内容：距離2/5での予告、距離1での通常攻撃、距離6以上・斜め位置・壁越し・移動阻害敵越しでの予告なし、スケルトン頭部越しでの予告成立、予告ターンの無移動・無ダメージ、方向/target tile固定、プレイヤー移動後の非追尾、AGGRO_RANGE外での予約突進実行、最大5マス停止、壁・外周不侵入、他生存敵手前での停止、頭部通過、プレイヤー手前停止＋1回攻撃、ノックバックなし、複数回ダメージなし、ground item/trap/web/階段の非干渉、突進後・通常行動後の1回休止、fresh golemの初回行動、複数ゴーレムの独立状態、予告中撃破個体の不発、monsterHouse個体の同一挙動、フロア遷移での状態非持ち越し、同一state/RNGでの再現性、telegraph getterの状態連動。

### 変更した既存テストと理由

- `enemy-behavior-melee-variants.test.ts`：「golem (slow_melee) behavior」describe全体を新仕様（golem_charge）向けのテストへ書き換え。旧テストは`spawnTurn`ベースの隔ターン行動を直接検証しており、新仕様と直接抵触するため
- `message-log.test.ts`：「produces enemy_recovering for golem on its resting turn」を、`spawnTurn`/`turn`操作ではなく実際に1回攻撃させてから休止ターンを検証する形に変更（同じく新状態機械と直接抵触）
- `phase-10-2-combat-stat-scale.test.ts`／`phase-13-3a-ability-numeric-effects.test.ts`：Phase 23.1（太陽銃属性攻撃）のtargeted regressionで見落としていた2件を今回のregression実行中に発見・修正。太陽銃が常に属性ダメージを乗せるようになったことで、期待値に属性ボーナス分（bokのsol弱点+3）が必要になっていた。golem突進とは直接関係しないが、`phase-10-2-combat-stat-scale`はゴーレムの防御・ノックバック等と同じ武器ダメージ計算経路を検証するファイルであり、regression実行中に偶然露見したため、放置せず同一タスク内で修正した

### targeted regression結果

以下の合計28ファイル・1226テストを実行し、全て通過を確認した（`phase-23-1-solar-gun-element-skeleton`, `armor-and-golem`, `enemy-behavior-melee-variants`, `hammer-knockback-weapon`, `telegraph`, `message-log`, `turn`, `integration`, `multi-floor`, `multi-floor-robustness`, monsterHouse関連8ファイル(`phase-21-1`〜`phase-21-8`), `visibility`, `dark-room-visuals`, `phase-20-3-defensive-death-cards`（judgement/死亡処理）, `phase-10-2-combat-stat-scale`, `phase-13-3a-ability-numeric-effects`, さらに`enemy-behavior-bat/cockatrice/kraken/mummy/spider`, `enemy-type`, `floor-enemy-pools`, `phase-15-5-enemy-count-by-floor`, `inventory-and-apple`, `weapon-and-sword`, `enemy-roster-foundation`, `phase-22-immediate-stairs-progression`）。

### 全テストへ拡大したかと理由

拡大していない。対象ファイル群で発見された2件の回帰（10-2/13-3a）はいずれも太陽銃の属性ダメージ計算という単一原因に起因しており、golem_charge自体が引き起こした広範囲の回帰ではなかった。golem_charge固有の変更（`isMovementBlockingEnemy`利用箇所の拡張はなし、`findAttackTarget`も変更なし）による影響範囲は上記regressionで十分に確認できたと判断した。

## 14. Phase 25へ延期した表現

- 複数マス突進の専用アニメーション（現在は`animateMove`の単純な直線tweenのみ）
- 丸まり開始・解除の専用モーション
- 残像エフェクト
- 衝突時のエフェクト・画面揺れ
- 専用効果音

---

## Completion Report

**precheck結果**：全項目合格（1章参照）。

**変更ファイル**：
```
src/game/types.ts             (Direction4型、golemCharge*フィールド追加)
src/game/enemy-def.ts         (BehaviorType golem_charge、golem定義変更)
src/game/turn.ts              (golem_charge状態機械、resolveOneEnemyのaggro bypass)
src/game/events.ts            (golem_charge_telegraphed/executed追加)
src/game/message-log.ts       (2イベントの表示ケース追加)
src/game/telegraph.ts         (getGolemChargeTelegraph追加)
src/main.ts                   (spriteKeyForEnemy拡張、EXTRA_SPRITE_KEYS、drawTelegraphs拡張)
public/assets/sprites/claygolem_rolling.png (新規配置)
src/game/__tests__/phase-23-2-golem-charge.test.ts (新規、29件)
src/game/__tests__/enemy-behavior-melee-variants.test.ts (golem describeブロック更新)
src/game/__tests__/message-log.test.ts (golem recoveringテスト更新)
src/game/__tests__/phase-10-2-combat-stat-scale.test.ts (Phase23.1回帰修正)
src/game/__tests__/phase-13-3a-ability-numeric-effects.test.ts (Phase23.1回帰修正)
docs/history/phase-23-2-golem-charge.md (新規)
```

**状態フィールド**：3章参照（`golemChargeState`/`golemChargeDirection`/`golemChargeTargetTile`、`schemaVersion`不変）。

**発動条件と優先順位**：4章参照（8方向隣接攻撃→距離2-5直線予告→通常追跡の3段階優先順位）。

**実際のターン順**：5章参照（予告・突進・回復が各々独立したworld turnで処理、1アクションで複数段階進まないことをテストで確認）。

**距離と停止条件**：6章参照（最大5マス、壁/Actor/プレイヤーそれぞれの停止規則）。

**player衝突処理**：7章参照（既存`resolveEnemyAttackHit`再利用、1回のみ、ノックバックなし）。

**通常追跡を残したこと**：8章参照（`tryChaseStep`再利用、進行不能回避）。

**AGGRO_RANGE外での処理**：9章参照（telegraphed/recoveringはaggro gateをbypass）。

**RNG消費**：10章参照（新規ストリームなし、既存の命中ロールのみ）。

**monsterHouse統合**：11章参照（`spawnSource`分岐なし、同一状態機械）。

**アセット・sprite・telegraph**：12章参照。

**新規テスト件数**：29件（`phase-23-2-golem-charge.test.ts`）。

**変更した既存テストと理由**：13章参照（golem_charge直接抵触2ファイル＋Phase23.1由来の回帰2ファイル）。

**targeted regressionのファイル数・テスト数・結果**：28ファイル・1226テスト、全通過。

**全テストへ拡大したかと理由**：拡大していない（13章参照）。

**headlessまたはmanual確認**：実ブラウザ環境が利用できないため、`processTurn`を直接呼び出すheadless確認（新規テストファイル内）で、予告・回避（プレイヤー移動後の非追尾）・突進・衝突（壁/Actor/プレイヤー）・回復の全経路を検証した。rolling sprite・固定reticleの実見た目確認はできていないが、`spriteKeyForEnemy`と`getGolemChargeTelegraph`の状態連動をテストで直接確認済み。

**typecheck**：`npx tsc --noEmit` 成功。

**build**：`npx vite build` 成功（`dist/assets/index-D-Fj85gg.js` 1,632.84 kB、既存のチャンクサイズ警告のみ）。

**diff-check**：`git diff --check` 問題なし。

**commit hash**：下記コマンド実行後に追記。

**push先**：`origin/phase-23-2-golem-charge`

**PAT残存なし**：push後に確認。

**main未変更**：本タスク中、mainブランチへのチェックアウト・変更は一切行っていない。

**最終git status**：下記コマンド実行後に追記。

**指示に従わなかった点と理由**：Phase 23.1由来の太陽銃ダメージ回帰2件（`phase-10-2-combat-stat-scale.test.ts`、`phase-13-3a-ability-numeric-effects.test.ts`）を本タスク内で修正した。これらはgolem_chargeとは無関係だが、targeted regressionの実行中に発見された既存テストの失敗であり、放置すれば全体のテストスイートが壊れた状態になるため、「既存テストは新仕様に直接抵触する箇所だけ更新する」の趣旨に沿って最小限の値更新のみで対応した。それ以外の点で指示からの逸脱はない。
