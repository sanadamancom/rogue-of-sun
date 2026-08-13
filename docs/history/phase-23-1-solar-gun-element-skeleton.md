# Phase 23.1: 太陽銃レンズ・属性攻撃判定・スケルトン復活

Phase 23.0の設計監査を実装へ落とし込み、太陽銃を属性攻撃として扱う共通判定を追加した上で、その同じ判定を使ってスケルトンの頭部化・復活を実装した。太陽銃属性基盤とスケルトンは分離せず、スケルトン側に太陽銃専用の特別扱いは書いていない。

## 1. precheck結果

| 項目 | 結果 |
|---|---|
| repository/branch | `phase-23-0-enemy-expansion-design-audit` から分岐、work branch `phase-23-1-solar-gun-element-skeleton` |
| local/origin HEAD | `a4bb0b8fda9dcf2277ee6c37bbba73b320a2b043` で一致 |
| working tree | clean |
| Phase 23.0の変更 | history文書1点のみ（`git diff --stat` で確認） |
| main | 未統合（`git merge-base --is-ancestor` は false） |

Phase 23.0で全2558件が通過済みのため、precheckでの全テスト再実行は行っていない。

## 2. Phase 23.0 history訂正内容

`docs/history/phase-23-0-enemy-expansion-design-audit.md` の以下を訂正した。

- 末尾の「下記コマンド実行後に追記」を実測値へ置換（tsc成功、diff-check問題なし、commit hash `a4bb0b8f...`、push先、main未変更、最終git status clean）
- スケルトンの推奨状態遷移・仮数値の章に「Phase 23.1にて確定・訂正済み」の節を追加し、frost弱点案の撤回、`head`表記の採用、復活8ターン・無制限復活・元座標のまま延期・RNG不要を明記
- 後続順序の章に千里眼の実の対象をステップスのみとする確定方針、ステップスの感知距離Chebyshev1、3ターン本体表示を追記

## 3. 太陽銃の属性決定方法

`turn.ts` に `getSolarGunEffectiveElement(state)` を追加した。

```
selectedEnchantment === 'none' -> sol
selectedEnchantment === 'sol'  -> sol
selectedEnchantment がロック済み（不正fixture） -> sol
それ以外（解放済みの非sol元素） -> その元素
```

太陽銃の標準Solレンズは、近接用`sol_enchantment`（`unlockedEnchantments.sol`）を未取得でも常に使用可能。

## 4. レンズ切替方法

`getSolarGunEnchantmentCandidates(state)` を追加し、`'sol'`（常時候補）＋解放済みの非sol元素のみを返す（`'none'`は含めない）。`toggle_enchantment` アクションを武器種別で分岐：

- 太陽銃装備時：`getSolarGunEnchantmentCandidates` の候補を巡回。標準Solレンズへ戻る際、近接sol解放済みなら`selectedEnchantment='sol'`、未解放なら`'none'`へ設定（近接武器へ持ち替えた際の既存挙動を再現するため）
- それ以外の武器：既存の`getEnchantmentCycleCandidates`をそのまま使用（変更なし）

新しいレンズ専用inventoryやGameStateフィールドは追加していない。太陽銃装備中に選択した非sol属性は、近接武器へ持ち替えた後も`state.selectedEnchantment`にそのまま残る（武器切替時に選択状態をリセットする既存コードが元々存在しないため、追加の実装は不要だった）。

## 5. 太陽銃と近接のSOL消費

- 太陽銃：`resolveSolarGunAttack`が既存どおり`weaponDef.solarCost`（3）を消費。`applyPlayerAttackToEnemy`内では`isSolarGun`のとき`ELEMENT_ENCHANTMENT_SOL_COST`を一切追加消費しない
- 近接：既存の`ELEMENT_ENCHANTMENT_SOL_COST`消費ロジックは完全に不変（`isSolarGun`が偽の場合のみ発動）
- 太陽銃を`ELEMENT_ENCHANT_ELIGIBLE_WEAPONS`へ追加する実装は行っていない（禁止事項どおり）。太陽銃の属性化は`applyPlayerAttackToEnemy`内で完全に独立した分岐として実装した

## 6. スケルトンの状態構造

`EnemyActor`に以下のoptionalフィールドを追加（`schemaVersion`は変更なし）。

```ts
skeletonForm?: 'body' | 'head'   // 省略時は'body'相当
skeletonReviveAtTurn?: number
```

`headless`という名称は使用していない。

## 7. 無属性撃破・属性撃破・頭部攻撃の結果

`defeatEnemyIfNeeded`に`attackElement: ElementId | null`引数を追加し、単一の分岐点で全パターンを処理する。

| 現在の状態 | 攻撃属性 | 結果 |
|---|---|---|
| body | 属性あり（5属性いずれか、太陽銃含む） | 完全撃破（`enemy_defeated`、経験値確定） |
| body | 属性なし | 頭部化（`skeleton_headified`、経験値なし、RNG消費なし） |
| head | 属性なし | 無効（`skeleton_head_attack_no_effect`、状態・HP・復活時刻とも不変） |
| head | 属性あり（属性種別を問わない） | 完全撃破（`enemy_defeated`、経験値確定） |

この判定はプレイヤーの近接・太陽銃攻撃だけでなく、justice/devil/towerカードの無属性固定ダメージからも同じ`defeatEnemyIfNeeded`経由で到達する（3箇所の既存呼び出しは`attackElement`省略でデフォルト`null`となり、無属性として扱われる）。SOL不足で近接エンチャントが不発だった場合は`meleeActivatedElement`が`null`になるため、自動的に無属性として扱われる。

## 8. 復活ターン・延期・LIFE・回数

新規関数`resolveSkeletonRevivals`を追加し、`state.turn += 1`の直後（`processTurn`内、`expireWebs`と対になる位置）で世界ターンごとに1回だけ実行する。

- `state.turn >= skeletonReviveAtTurn`で復活可能
- 復活位置は頭部の元座標に固定（RNGによる位置探索は行わない）
- 元座標がプレイヤーまたは生存中のbody状態アクターに占有されている場合は復活を延期し、次の世界ターンで再判定
- 復活時は`hp = maxHp`（最大LIFE）、`skeletonForm = 'body'`、`skeletonReviveAtTurn = undefined`
- 復活回数の上限なし（テストで3サイクル連続復活を確認済み）
- 頭部状態のスケルトン同士は占有判定に含めない（頭部は移動を阻害しないため）。`state.enemies`を固定順で走査し、同一ターン内で先に復活した個体は後続の占有判定に即座に反映される決定的処理

## 9. 経験値重複防止方法

経験値・撃破数・telemetryは`defeatEnemyIfNeeded`が`target.alive = false`にする一箇所でのみ確定する。頭部化時は`return false`で復帰し、`enemy_defeated`/`experience_gained`のいずれも発火しない。同一個体から複数回の経験値取得は起こり得ない構造。

## 10. 通行・攻撃対象・描画の区別

用途別に判定を分離した。

- **攻撃対象**：頭部を含む。既存の`enemies.find(enemy => enemy.alive && ...)`パターンは変更せず維持しているが、頭部と通常状態の敵が同一マスに重なる可能性が生まれたため、新規`findAttackTarget(enemies, pos)`ヘルパーを追加し、同一マス上に複数の生存アクターがいる場合は非head-form（通常状態）を優先して返す。近接隣接攻撃・reach-2攻撃・太陽銃レイの3箇所全てで採用
- **移動阻害**：頭部を含まない。新規`isMovementBlockingEnemy(enemy)`ヘルパーを追加し、プレイヤー移動・敵の8方向/4方向追跡ステップ・コーナークロス判定・コウモリ退避・ナックバック先・クラーケンの引き寄せ先など、既存の全ての移動系占有判定を置き換えた
- **復活阻害**：プレイヤーとbody状態の生存敵のみ（`resolveSkeletonRevivals`内で個別に判定）
- **描画**：頭部を含む。`spriteKeyForEnemy(enemy)`という単一の境界関数を新規追加し、`enemy.type === 'skeleton' && enemy.skeletonForm === 'head'`のときのみ`'skeleton_head'`キーを返す。`main.ts`内の4箇所の描画呼び出し（`rebuildEnemySprites`×2、`snapAllEnemies`、`applyTurnResult`）を全てこの関数経由に統一し、スケルトン専用のif分岐が複数箇所に散在しないようにした
- **敵行動**：body状態のみ。`resolveOneEnemy`の先頭で`skeletonForm === 'head'`を即return

既存コード全体で単純な`enemy.alive`条件を一律変更せず、上記の用途別ヘルパーだけを新設・適用した。

## 11. 通常生成・monsterHouse結果

- `enemy-def.ts`にskeleton種を追加し、`ENEMY_TYPES_IN_ORDER`の末尾に追加（既存9種のインデックスは変更なし）、`ENEMY_FIRST_APPEARANCE_FLOOR.skeleton = 3`
- `getEnemyPoolForFloor`は変更なし（ロジックは既存のまま、スケルトン追加により3F以降の候補プールが1種増える——意図した変更）
- monsterHouseの敵種選択（`monster-house.ts`の`chooseMonsterHouseEnemyTypes`）は`getEnemyPoolForFloor`をそのまま使うため、スケルトンは自動的にmonsterHouse候補へ参加する。monsterHouse専用の例外コードは追加していない
- 頭部化・復活処理は通常出現・monsterHouse出現のいずれの個体にも同一に適用される（`spawnSource`フィールドを参照する分岐は追加していない）
- フロア遷移時、次フロアの敵は`createInitialEnemy`で新規生成されるため（前フロアの`EnemyActor`配列を引き継がない既存の仕組みのまま）、頭部状態は自動的に持ち越されない

## 12. RNG消費への影響

- 太陽銃の属性発動：RNG消費なし（既存のhit判定ロールのみ、属性選択自体は決定的）
- スケルトンの頭部化・完全撃破：RNG消費なし
- スケルトンの復活：RNG消費なし（位置固定、探索なし）
- 既存RNGストリームの消費順は一切変更していない

## 13. セーブ形式への影響

明示的なセーブ/ロード機構は引き続き存在しない。追加した`skeletonForm`/`skeletonReviveAtTurn`はいずれも`EnemyActor`の任意（optional）フィールドであり、`schemaVersion`は変更していない。

## 14. アセット配置結果

`public/assets/sprites/skeleton.png`・`public/assets/sprites/skeleton_head.png`として小文字化配置（元の添付ファイル`skeleton.png`/`Skeleton_head.png`は変更していない）。既存の72×128px・4方向×3フレーム・chroma-key緑処理をそのまま利用。リサイズ・再描画・フレーム加工は行っていない。

`main.ts`に`EXTRA_SPRITE_KEYS = ['skeleton_head']`を追加し、`allEnemySpriteKeys()`がpreload/create時のロード対象に含めるようにした（`skeleton_head`はどの`EnemyDefinition.spriteKey`でもないため、素の`allEnemySpriteKeys`では拾えないための対応）。

## 15. 変更ファイル一覧

```
docs/history/phase-23-0-enemy-expansion-design-audit.md   (訂正)
docs/history/phase-23-1-solar-gun-element-skeleton.md     (新規)
src/game/types.ts             (EnemyType/EnemyActor拡張)
src/game/events.ts            (player_attack.element追加、新規4イベント型)
src/game/enemy-def.ts         (skeleton定義、ENEMY_TYPES_IN_ORDER、ENEMY_FIRST_APPEARANCE_FLOOR)
src/game/turn.ts              (太陽銃属性ロジック、スケルトン状態機械、移動/攻撃対象ヘルパー)
src/game/message-log.ts       (新規4イベントの表示ケース)
src/main.ts                   (spriteKeyForEnemy、EXTRA_SPRITE_KEYS、LENSHUD表示)
public/assets/sprites/skeleton.png       (新規配置)
public/assets/sprites/skeleton_head.png  (新規配置)
src/game/__tests__/phase-23-1-solar-gun-element-skeleton.test.ts (新規、37件)
src/game/__tests__/enemy-roster-foundation.test.ts       (9→10種へ更新)
src/game/__tests__/floor-enemy-pools.test.ts             (3F/4Fプールにskeleton追加)
src/game/__tests__/phase-14-4-enemy-affinities.test.ts   (CONFIRMED_TABLEにskeleton追加、9→10)
src/game/__tests__/armor-and-golem.test.ts               (3F候補プールにskeleton追加)
src/game/__tests__/phase-15-5-enemy-count-by-floor.test.ts (roster preview長さ9→10)
src/game/__tests__/phase-09-2-solar-gun.test.ts           (太陽銃が常に属性ダメージを乗せる仕様への追随)
src/game/__tests__/phase-10-1-sol-enchant.test.ts         (同上、solar_gun_element_fired検証へ更新)
```

## 16. 新規テスト一覧

`phase-23-1-solar-gun-element-skeleton.test.ts`（37件）:

**太陽銃（15件）**：none/sol/非sol/ロック時フォールバックの実効属性、候補リストの内容・none非重複、toggle_enchantmentでのsol⇄非sol巡回、melee sol解放有無に応じた標準Solへの復帰、非sol選択が武器持ち替え後も残る、物理+属性ダメージ合算とSOL消費3のみ、affinity/mind bonusの反映（neutral）、ミス時のイベント整合、SOL不足時の不成立、近接エンチャントが完全に無影響であることの確認

**スケルトン（22件）**：無属性撃破での頭部化、5属性それぞれでの完全撃破（body/head双方、`it.each`）、標準Sol太陽銃・非Solレンズ太陽銃での完全撃破、SOL不足近接攻撃が無属性扱いになること、頭部への無属性攻撃が無効であること、頭部化・完全撃破それぞれでの経験値確定タイミング、8ワールドターン後の最大LIFE復活、占有中の延期と解消後の復活、複数回復活の継続、頭部が移動・攻撃・感知を一切行わないこと、頭部が移動を阻害しない一方bodyは阻害すること、頭部と通常敵が同一マスの場合の攻撃対象優先、カード由来の無属性ダメージでの頭部化、スプライトキー選択の状態境界

## 17. 実行した既存テストと選定理由

太陽銃・エンチャント・武器・敵種・敵行動・monsterHouse・visibility・カード・Phase22階段進行に直接関係する41ファイル（1230テスト）を選定し、全て通過を確認した。

```
phase-09-2-solar-gun / phase-10-1-sol-enchant / phase-14-1〜14-5(element関連) /
phase-16-1-solar-gun-rebalance / phase-16-runtime-combat / weapon-and-sword /
spear-reach-weapon / hammer-knockback-weapon / armor-and-golem / enemy-type /
enemy-roster-foundation / floor-enemy-pools / phase-15-5-enemy-count-by-floor /
enemy-behavior-bat/cockatrice/kraken/melee-variants/mummy/spider /
phase-20-0a/20-0d/20-3/20-4/20-5a/20-5b (カード効果、defeatEnemyIfNeeded呼び出し3箇所の回帰確認含む) /
phase-21-1〜21-8 (monsterHouse) / visibility / dark-room-visuals /
phase-22-immediate-stairs-progression
```

## 18. 全テストへ拡大した場合はその理由

拡大していない。対象テストの範囲で広範囲の回帰疑いは見つからなかった（`isMovementBlockingEnemy`/`findAttackTarget`の導入は敵行動系41ファイルで全て確認済み）。

## 19. 型検査・build・diff-check結果

- `npx tsc --noEmit`：成功（エラーなし）
- `npx vite build`：成功（`dist/assets/index-CMTnzQgg.js` 1,630.82 kB、既存のチャンクサイズ警告のみ、エラーなし）
- `git diff --check`：問題なし

## 20. manualまたはheadless確認結果

実ブラウザ環境が利用できないため、production関数のheadless確認（vitestによる`processTurn`直接呼び出し）で代替した。太陽銃のレンズ表示ロジック（`enchantHudLabel`内の`LENS：`分岐）、スケルトン本体/頭部のスプライトキー切替（`spriteKeyForEnemy`の状態境界）、頭部化・復活メッセージ（`skeleton_headified`/`skeleton_head_attack_no_effect`/`skeleton_revived`の`formatEvent`出力）は、いずれも新規テストファイル内で対応するイベント・状態値を直接検証した。

## 21. 未確定事項

- Phase 23.0から持ち越し：ゴースト・ステップス・ゴーレムのproduction実装は今回未着手（禁止事項どおり）
- スケルトンのHUD上の見た目上のフィードバック（頭部化アニメーション等）はPhase 25のモーション実装まで最小限のスプライト切替のみ
- `skeleton_head_attack_no_effect`時に`player_attack`イベント自体は通常どおり発火し、`damage`欄には計算上のダメージ値が入る（実際のHP変化は0）。これは既存の他イベントと同様の「計算上のダメージ値と実際のHP変化を分離しない」パターンを踏襲した設計判断であり、仕様上の矛盾ではないが、UI上「ダメージ表示」と「効かなかった」の2行が続けて出る点は今後の表示調整の余地として残る

---

## Completion Report

**precheck結果**：全項目合格（1章参照）。

**Phase 23.0 history訂正内容**：2章参照（実測値埋め、スケルトン仕様確定・訂正、後続方針の確定）。

**太陽銃の属性決定方法**：3章参照（`getSolarGunEffectiveElement`、none/sol両方がsolへ、ロック時フォールバック）。

**レンズ切替方法**：4章参照（`getSolarGunEnchantmentCandidates`、武器種別で分岐する`toggle_enchantment`）。

**太陽銃と近接のSOL消費**：5章参照（太陽銃は既存の3のみ、近接は既存のまま不変、二重消費なし）。

**スケルトンの状態構造**：6章参照（`skeletonForm`/`skeletonReviveAtTurn`のoptionalフィールド、`schemaVersion`不変）。

**無属性撃破・属性撃破・頭部攻撃の結果**：7章参照（`defeatEnemyIfNeeded`一箇所での分岐、カード由来ダメージも同経路）。

**復活ターン・延期・LIFE・回数**：8章参照（8ワールドターン、元座標固定、無制限復活、決定的処理）。

**経験値重複防止方法**：9章参照（`target.alive=false`にする一箇所でのみ確定）。

**通行・攻撃対象・描画の区別**：10章参照（`isMovementBlockingEnemy`/`findAttackTarget`/`spriteKeyForEnemy`の3ヘルパー）。

**通常生成・monsterHouse結果**：11章参照（`getEnemyPoolForFloor`経由で自動参加、専用例外なし）。

**RNG消費への影響**：12章参照（新規RNG消費なし）。

**セーブ形式への影響**：13章参照（永続化機構なし、optional追加のみ）。

**アセット配置結果**：14章参照（小文字化配置、元ファイル非改変）。

**変更ファイル一覧**：15章参照。

**新規テスト一覧**：16章参照（37件、太陽銃15件・スケルトン22件）。

**実行した既存テストと選定理由**：17章参照（41ファイル1230テスト、全通過）。

**全テストへ拡大した場合はその理由**：18章参照（拡大していない）。

**型検査・build・diff-check結果**：19章参照（すべて成功）。

**manualまたはheadless確認結果**：20章参照（headless確認で代替、production関数を直接検証）。

**commit hash**：`ef12b609c6862f72edf1548d596a6b698e9dc11d`

**push先**：`origin/phase-23-1-solar-gun-element-skeleton`

**main未変更**：本タスク中、mainブランチへのチェックアウト・変更は一切行っていない。

**最終git status**：commit後 clean。

**指示に従わなかった点と理由**：なし。ゴーレム・ゴースト・ステップス・コカトリスのproduction実装には進んでいない。太陽銃へ3 SOL以外の追加コストを課していない。スケルトンへ特定の弱点属性は設定していない。復活位置はランダム移動させていない。復活回数を1回に制限していない。頭部化時に経験値を与えていない。頭部を完全撃破済みとして扱っていない。mainは変更せずPRも作成していない。
