# Phase 10.3 命中・回避と共通攻撃判定

## 目的

Phase 10.2で導入した攻撃・防御・ダメージ計算の前段に、命中・回避判定を追加しました。プレイヤーの近接攻撃・太陽銃・敵の近接攻撃を同じ命中判定基盤へ通し、武器ごとの命中補正と敵ごとの回避差（コウモリのみ）を表現します。Phase 10.2のHP・攻撃力・防御力・回復量・SOL追加ダメージのバランス調整は今回の対象外です。

## 開始状態

開始時のHEADは`e5d5d47732287be97d56dccb165ac5b6e8484ccb`（Phase 10.2完了時点、origin/mainと一致、working tree clean、remote URLにPATなし）。baseline：`npx tsc --noEmit`エラーなし、`npx vitest run`42ファイル/853件全成功、`npx vite build`成功。

## 事前調査結果

- プレイヤー→敵のダメージ経路は`applyPlayerAttackToEnemy`（`turn.ts`）ひとつに集約されており、隣接攻撃・スピアのリーチ2マス攻撃・太陽銃の3経路すべてがここを通ることを確認しました。命中判定の挿入位置としてこの関数の先頭（ダメージ計算より前）を選びました。
- 敵→プレイヤーのダメージ経路は3箇所（`tryMeleeAttack`・`resolveSpiderEnemy`の近接分岐・`resolveKrakenEnemy`のtentacle strike）で、いずれも`getIncomingDamage`を呼んでいました。前2つは新設した共通関数`resolveEnemyAttackHit`へ統合しましたが、krakenのtentacle strikeは既存の「照準座標に基づく範囲判定（`hit`変数、プレイヤーがテレグラフされた範囲内にいるか）」という、accuracy/evasion方式とは別種の既存の命中・ミス概念を持っており、これに追加でaccuracy/evasionロールを重ねる設計判断が指示から明確に読み取れなかったため、**今回は対象外としました**（詳細は「未実装項目」参照）。
- 太陽銃とソルエンチャントのSOL消費タイミング：太陽銃は`resolveSolarGunAttack`内でSOLを消費した直後に`applyPlayerAttackToEnemy`を呼ぶ既存構造で、命中判定はこの共有関数の中に自然に組み込めることを確認しました。ソルエンチャントのSOL消費は`applyPlayerAttackToEnemy`内で命中判定より後（命中確定後）に行われるよう配置し、ミス時は一切評価されません。
- ハンマーのノックバックと`hammerRecovery`：ノックバック（`tryKnockback`）は`applyPlayerAttackToEnemy`の外側、呼び出し元（`resolveFacingAttack`）で実行されており、命中判定の結果（`hit`）を見てから呼ぶかどうか分岐できる構造でした。`hammerRecovery`は`result.consumed`のみに依存しており、ミスでも`consumed:true`である限り自動的に発生することを確認しました。
- 攻撃結果の型：既存の`TurnResult`は`consumed`/`attacked`/`defeated`等のboolean群と`events`配列で構成されており、`events`配列へ新規イベント型（`player_attack_missed`/`enemy_attack_missed`、`hitChance`・`roll`付き）を追加する形で、`TurnResult`自体の構造変更なしに対応できると判断しました。
- 乱数経路：`mapgen.ts`の`createRng`はクロージャ型mulberry32で、フロア生成・配置・種族選択・アイテム配置がそれぞれ独立したXOR定数付きストリームを持っています。戦闘用RNGは`GameState`に永続化する必要があるため、同一アルゴリズムを状態を明示的に持ち回す純粋関数として新規`rng.ts`に実装し、`GameState.combatRngState`（plain number）へ保存する方式にしました。
- Enter（同一シード再開）・N（新規シード開始）時の乱数初期化：`main.ts`のEnter処理は`createInitialState(state.runSeed)`を再呼出し、N処理は`createInitialState(randomSeed())`を呼ぶ既存構造を確認しました。`combatRngState`を`runSeed`から導出する設計にすることで、Enterは常に同じ初期状態へ、Nは常に新しい初期状態へ、既存の他の乱数ストリームと同じ挙動になります。

## 採用した命中率式

`src/game/combat.ts`に追加：

```
computeHitChance(attackerAccuracy, weaponHitModifier, defenderEvasion) =
  clamp(attackerAccuracy + weaponHitModifier - defenderEvasion, 5, 95)
```

ロールは`src/game/rng.ts`の`rollPercent`で0〜99の整数を1回取得し、`resolvesAsHit(roll, hitChance) = roll < hitChance`で判定します。この境界規則により、命中率95は0〜94（100通り中95通り）が命中、命中率5は0〜4（100通り中5通り）が命中となることを単体テストで確認済みです。

## 初期命中・回避・武器補正値

| 項目 | 値 |
|---|---|
| プレイヤー accuracy | 90 |
| プレイヤー evasion | 0 |
| 敵 accuracy（全種共通） | 90 |
| 敵 evasion（bat以外） | 0 |
| 敵 evasion（bat） | 10 |
| sword hitModifier | +5 |
| spear hitModifier | +5 |
| hammer hitModifier | -5 |
| solar_gun hitModifier | +5 |
| 素手 hitModifier | 0（`WeaponDefinition`に存在しないため`getPlayerWeaponHitModifier`が未装備時に0を返す） |

算出される命中率（`computeHitChance`で検証済み）：

- 素手対通常敵：90%
- ソード対通常敵：95%
- スピア対通常敵：95%
- ハンマー対通常敵：85%
- 太陽銃対通常敵：95%
- 素手対コウモリ：80%
- ソード対コウモリ：85%
- スピア対コウモリ：85%
- ハンマー対コウモリ：75%
- 太陽銃対コウモリ：85%
- 通常敵からプレイヤーへの攻撃：90%

いずれも指示のexpected_examplesと一致しています。

## 攻撃処理順

`applyPlayerAttackToEnemy`（プレイヤー→敵）・`resolveEnemyAttackHit`（敵→プレイヤー）とも以下の順で処理します。

1. 対象・射程・攻撃可能条件の確認（呼び出し元、命中判定より前）
2. 必要資源（太陽銃のSOL）の確認（呼び出し元、命中判定より前）
3. 命中率の算出（`computeHitChance`）
4. 命中ロール（`rollPercent`、`combatRngState`を1消費）
5. ミスなら`*_attack_missed`イベントをpushして終了（ダメージ・SOL消費・撃破・ノックバックなし）
6. ヒットなら物理ダメージ計算（`computeAttackDamage`/`getIncomingDamage`、Phase 10.2から無変更）
7. （プレイヤー攻撃のみ）ソル追加ダメージ計算
8. ノックバック等の追加効果（呼び出し元、`hit`かつ`!defeated`のときのみ）
9. 撃破・終了条件の判定

射程外・対象なし・SOL不足など攻撃自体が不成立の場合は、この関数群に到達しないため命中ロールは一切行われません。

## 乱数ストリームの設計

`GameState.combatRngState`（plain number）を新設し、`state.ts`の`createInitialState`で`runSeed ^ 0x4e6d3a17`から初期化、`advanceToNextFloor`で（既に消費済みの状態のまま）持ち越します。マップ生成・配置・種族選択・アイテム配置の各RNGストリームとは完全に独立しており、XOR定数も重複しません。Enterによる同一シード再開は`createInitialState(state.runSeed)`の再呼出しにより`combatRngState`も同じ初期値へ戻り、Nによる新規シード開始は新しい`runSeed`から新しい`combatRngState`が導出されます。無効な攻撃（対象なし・射程外・SOL不足）では`rollPercent`を呼ばないため、`combatRngState`は変化しません。

## ミス時のターン・SOL・追加効果規則

- 近接攻撃のミス：ターンは消費する（`consumed: true`のまま）。SOLは消費しない（命中判定がSOL消費より前にあるため自動的に非消費）。ノックバックは発生しない（呼び出し元で`hit`を確認してから`tryKnockback`を呼ぶ）。
- ハンマーのミス：上記に加え、`hammerRecovery`は発生する（`result.consumed`のみに依存する既存ロジックのため、変更不要で自動的に成立）。
- 太陽銃のミス（有効射撃）：SOLは1消費する（既存のresolveSolarGunAttack構造で、SOL消費は命中判定より前に発生するため）。ダメージ・追加効果は発生しない。
- 太陽銃の不成立（対象なし・射程外・SOL不足）：命中ロールを行わず、SOLも消費しない（既存のPhase 09.2仕様を維持）。
- 敵の近接攻撃のミス：プレイヤーHPは変化しない。その敵の行動はミスでも終了する（`tryMeleeAttack`/`resolveSpiderEnemy`は`hit`の成否に関わらず`true`を返す）。

## 変更ファイル

- `src/game/rng.ts`（新規）：戦闘用RNG（状態を明示的に持ち回すmulberry32）
- `src/game/combat.ts`：`computeHitChance`・`resolvesAsHit`・`MIN_HIT_CHANCE`/`MAX_HIT_CHANCE`追加
- `src/game/types.ts`：`Actor.accuracy`/`Actor.evasion`、`GameState.combatRngState`追加
- `src/game/enemy-def.ts`：`EnemyDefinition.accuracy`/`evasion`追加、全種へ値設定
- `src/game/weapon-def.ts`：`WeaponDefinition.hitModifier`追加、全武器へ値設定
- `src/game/turn.ts`：`getPlayerWeaponHitModifier`追加、`applyPlayerAttackToEnemy`を命中判定込みへ書き換え（戻り値を`{hit, defeated}`へ変更）、`resolveFacingAttack`・`resolveSolarGunAttack`の呼び出し元を対応、`tryMeleeAttack`・`resolveSpiderEnemy`を`resolveEnemyAttackHit`経由へ、`createInitialActor`/`createInitialEnemy`へ`accuracy`/`evasion`引数追加（デフォルト90/0、既存呼び出し互換維持）
- `src/game/events.ts`：`player_attack_missed`/`enemy_attack_missed`イベント追加
- `src/game/message-log.ts`：上記2イベントの日本語フォーマッタ追加
- `src/game/state.ts`：`CarryOverStats`へ`accuracy`/`evasion`/`combatRngState`追加、プレイヤー・敵生成へ反映、`combatRngState`の初期化
- `src/main.ts`：`playMissText`追加（MISS表示）、`applyTurnResult`内でミスイベント検出時に発火
- 既存テスト20ファイル：型完全性維持のための`combatRngState: 304`機械的追加（値の再設計なし）、および2件の攻撃ループテスト・1件のgameoverテストで命中を保証する`combatRngState`を明示指定
- `src/game/__tests__/phase-10-3-stage1-hit-calc.test.ts`（新規、13件）：命中率計算・境界条件・RNG純粋性のテスト
- `src/game/__tests__/phase-10-3-accuracy-evasion.test.ts`（新規、30件）：初期値・命中/ミス・副作用・決定性の統合テスト
- `docs/history/phase-10-3-accuracy-and-evasion.md`：本ドキュメント

## 型チェック・テスト・build結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：**44ファイル / 896件全成功**（既存866件は無変更のまま全通過、新規43件追加（Stage1の13件＋統合30件））
- `npx vite build`：成功
- `git diff --check`：問題なし

## 決定性確認

- 同一シード・同一入力列で命中・ミスの結果列が一致することをテストで確認
- `createInitialState`が同一`runSeed`から同一`combatRngState`を導出することを確認（Enter再開相当）
- 異なる`runSeed`から異なる`combatRngState`が導出されることを確認（N相当）
- 無効な攻撃（対象なし・射程外・SOL不足・空振り）では`combatRngState`が変化しないことを確認
- フロア遷移をまたいで`combatRngState`が（消費済みのまま）持ち越されることを確認
- 戦闘乱数の追加後も同一シードでのマップ生成・敵配置・アイテム配置が一致することを確認（既存の決定性・ロバストネステスト、`multi-floor-robustness.test.ts`・`robustness.test.ts`含む全896件が通過）

## 手動確認

単一HTML（ビルド成果物）をPlaywrightでfile://起動し、以下を確認しました。

- 外部リクエスト0件、コンソールエラー0件
- 攻撃キー（X）を60回連続で入力してもコンソールエラー・クラッシュが発生しないこと（命中率85〜95%の範囲で複数回のミスが実際に発生していると推定される試行回数）
- 起動直後のスクリーンショットとキー入力後のスクリーンショットで、ゲーム画面・HUDが正常に描画されていることを確認

実際のブラウザでの目視プレイ（MISS表示の視認性、ログの文言確認、コウモリとの命中率体感差など）は本タスクでは未実施です。

## Phase 10.2数値が暫定であることの確認

Phase 10.2で導入したプレイヤー/敵のHP・攻撃力・防御力・回復量・SOL追加ダメージ（10）は、本Phaseでは一切変更していません。今回の命中率導入により実質的な期待ダメージ（命中率×ダメージ）は変化しているため、次のPhase（10.4想定）で実プレイ結果をもとにまとめて再調整する前提です。

## 未実装項目

- krakenのtentacle strikeへのaccuracy/evasion適用（既存の照準ベースhit/miss概念との統合方法が指示から明確でないため、今回は見送り）
- クリティカル、ダメージ乱数、状態異常、暗闇による命中補正、ハヤサ能力値
- 経験値・レベルアップ、武器スキル・習熟度・強化値、ランク、太陽鍛冶
- 敵の遠距離攻撃・投擲命中
- 完成版の攻撃演出（MISS表示は簡素なテキストポップアップのみ）
- 実機ブラウザでの3フロア通し目視プレイによる体感バランス評価

## 次のPhase 10.4候補

- Phase 10.2数値（HP・攻撃・防御・回復・SOL）と命中率を合わせた実プレイベースの再調整
- kraken tentacle strikeへの命中判定統合方針の決定
- 構造監査（`applyPlayerAttackToEnemy`/`resolveEnemyAttackHit`のさらなる共通化余地の検討）
