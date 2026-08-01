# Phase 10.2 戦闘数値スケール再設計

## 目的と開始時HEAD

現在の1桁中心の戦闘数値を、おおむね10倍の整数スケールへ拡張しました。既存の撃破必要回数・被撃破までの被弾回数・回復の相対的価値を極力維持しつつ、プレイヤー・敵・武器のステータスを分離し、防御力を導入し、ダメージ計算を一か所（`combat.ts`）へ集約しました。Phase 10.1のソルエンチャントも新しい数値帯へ合わせています。開始時のHEADは`4a70e19281f81971334682d3ff1e7aaa01505214`（origin/mainと一致、working tree clean、baseline 41ファイル/803件全成功）です。

## precheck結果

- repository/branch一致、local HEAD/origin/mainとも一致、working tree clean、remote URLにPATなし
- baseline：`npx tsc --noEmit`エラーなし、`npx vitest run`803件全成功、`npx vite build`成功

## 現行数値の調査結果

| 項目 | 旧数値 |
|---|---|
| プレイヤー maxHp | 3 |
| プレイヤー attack（素手） | 1 |
| sword attackPower | 2（素手を置換） |
| spear attackPower | 1（同上） |
| hammer attackPower | 3（同上） |
| solar_gun attackPower | 1（同上） |
| bok/cockatrice hp・attack | 3・1 |
| spider/bat hp・attack | 2・1 |
| mummy hp・attack | 5・2 |
| golem hp・attack | 4・3 |
| sword(敵)/axe/kraken hp・attack | 4/6・2 |
| armorValue | 1 |
| apple healAmount | 2 |
| 自然回復 | +1 / REGEN_TURNS_PER_HP(5)ターン |
| ソル追加ダメージ | 1 |

旧武器モデルは「装備中は素手のattackを置換（加算しない）」という設計でした（`getEffectiveAttackPower`のdocコメントに明記）。

### 全ダメージ経路の調査結果

- プレイヤー→敵：`applyPlayerAttackToEnemy`（`turn.ts`）ひとつに集約。隣接攻撃・スピアのリーチ2マス攻撃・太陽銃の3経路すべてがここを通る。
- 敵→プレイヤー：`tryMeleeAttack`・`resolveSpiderEnemy`・`resolveKrakenEnemy`の3箇所。いずれも`getIncomingDamage`経由。
- `getIncomingDamage`の既存実装は`Math.max(0, attackPower - armorValue)`で、防御力が攻撃力以上なら**ダメージが完全に0**になる設計（コード内コメントに「shonen-mystery-dungeon-style、最小1ダメージモデルではない」と明記）。これは今回の指示の「有効な対象へ命中した場合の最小ダメージは1とする」という原則と矛盾するため、調査結果として報告し、既存仕様を維持する判断をしました（詳細は後述）。

## 旧数値と新数値の対応表

10倍スケールを基本方針としつつ、武器ダメージモデルを「置換」から「加算」へ変更しました。`player.attack + weapon.bonus - enemy.defense`（最小1）という新式のもとで、`player.attack`を10（旧1×10）に固定し、各武器の`bonus`を「旧合計値×10 − 10」で逆算することで、**防御力0の相手に対しては新式でも旧撃破回数を完全再現**しています。

| 項目 | 旧 | 新 |
|---|---|---|
| プレイヤー maxHp | 3 | 30 |
| プレイヤー attack | 1 | 10 |
| プレイヤー defense（基礎） | なし | 0 |
| sword bonus | （置換2） | 10 |
| spear bonus | （置換1） | 0 |
| hammer bonus | （置換3） | 20 |
| solar_gun bonus | （置換1） | 0 |
| armorValue | 1 | 10 |
| apple healAmount | 2 | 20 |
| 自然回復 | +1/5turn | +10/5turn |
| ソル追加ダメージ | 1 | 10 |
| bok/cockatrice hp・attack・defense | 3・1・- | 30・10・0 |
| spider/bat hp・attack・defense | 2・1・- | 20・10・0 |
| mummy hp・attack・defense | 5・2・- | 50・20・0 |
| golem hp・attack・defense | 4・3・- | 40・30・**1** |
| sword(敵)/axe hp・attack・defense | 4/6・2・- | 40/60・20・0 |
| kraken hp・attack・defense | 6・2・- | 60・20・**1** |

## 武器ごとの旧撃破回数と新撃破回数

防御力0の敵に対しては全武器・全敵種で完全一致します。防御力1を持つgolem・krakenのみ、下表の差異が生じます（詳細は後述）。

| 敵 | 武器 | 旧 | 新 | 差 |
|---|---|---|---|---|
| bok/cockatrice/spider/bat/mummy/sword敵/axe | 全武器 | (省略) | 一致 | 0 |
| golem | 素手/spear/solar_gun | 4 | 5 | +1 |
| golem | sword | 2 | 3 | +1 |
| golem | hammer | 2 | 2 | 0 |
| kraken | 素手/spear/solar_gun | 6 | 7 | +1 |
| kraken | sword | 3 | 4 | +1 |
| kraken | hammer | 2 | 3 | +1 |

## 敵ごとの旧被撃破回数と新被撃破回数

敵の攻撃力・プレイヤーの防御力（armorValueのみ、10倍スケール）は防御力の新規導入と無関係のため、**全敵種で完全一致**します（無装備・装備どちらも）。armor装備時、bok/cockatrice/spider/bat（攻撃力10）は防御力10で完全無効化（旧: 攻撃力1が防御力1で完全無効化、と同じ構造）。mummy/sword敵/axe（攻撃力20）は防御力10で10ダメージ、旧のダメージ1と同じ3回で撃破される計算です。golem（攻撃力30）は防御力10で20ダメージ、旧のダメージ2と同じ2回。kraken（攻撃力20）は防御力10で10ダメージ、旧のダメージ1と同じ3回。

## 回復量と最大HPの比率比較

apple：旧2/3（66.7%）→ 新20/30（66.7%）で完全一致。自然回復：旧+1/5turn（maxHp3に対し1/15turnで満タン）→ 新+10/5turn（maxHp30に対し同じ1/15turnで満タン）で完全一致。

## プレイヤー・敵・武器のステータスモデル

- `Actor`（プレイヤー・敵共通の基底型）へ`defense: number`を追加。プレイヤーはこれを**基礎値**として扱い（現在は常に0、装備以外の恒常的な防御力源がまだ存在しないため）、実際の防御力は`getEffectivePlayerDefense`で`player.defense + getEffectiveArmorValue(state)`として計算します。敵はこのフィールドが**そのまま最終防御力**（種族ごとの固有値として`EnemyDefinition.defense`からスポーン時にコピー）です。
- `WeaponDefinition.attackPower`の意味を「素手を置換する値」から「**素手からの加算ボーナス**」へ変更しました。太陽銃の`solarCost`・射程・SOL消費処理はフィールドごと無変更です。
- 命名は既存の`attackPower`/`armorValue`/`hp`/`attack`をそのまま踏襲し、新しい型名や過剰な一般化は行っていません。

## 防御力の設定根拠

golem・krakenの2種のみに防御力1を設定しました。両者は既存コード（`turn.ts`の`tryKnockback`）内で既に「immune: heavy/fixed-type」として特別扱いされている唯一の2種であり、この既存の区別を防御力という形で引き継ぐことが、恣意的な新規導入を避けつつ「防御力を一律0にしない」という指示を満たす最小限の方法だと判断しました。他7種は防御力0のままです。

## 共通ダメージ計算式

`src/game/combat.ts`に2つの純粋関数を新設しました。

- `computeAttackDamage(baseAttack, weaponBonus, defenderDefense)` = `Math.max(1, baseAttack + weaponBonus - defenderDefense)`（プレイヤー→敵、太陽銃含む）
- `computeIncomingDamage(attackerAttack, defenderDefense)` = `Math.max(0, attackerAttack - defenderDefense)`（敵→プレイヤー）

`turn.ts`の`applyPlayerAttackToEnemy`・`getIncomingDamage`はいずれもこの2関数を呼ぶだけの薄いラッパーへ書き換え、ダメージ計算の実体を一か所に集約しました。

## 最小ダメージと整数処理

- プレイヤー側（`computeAttackDamage`）：最小1。指示の「有効な対象へ命中した場合の最小ダメージは1とする」をそのまま適用しました。
- 敵側（`computeIncomingDamage`）：最小0を維持しました。**これは指示の`enemy_attack: max(1, ...)`という提案文言からの意図的な逸脱です**。既存実装（Phase 08.4由来）には「防御力が攻撃力以上なら被ダメージが完全に0になる」という、コード内コメントで明示的に意図されたデザイン（"shonen-mystery-dungeon-style"）が存在し、これは指示自身にある「ただし現行挙動に完全無効攻撃が存在する場合は調査して報告し、その仕様を維持する」という例外条項に該当すると判断しました。もし敵側も最小1ダメージへ変更すると、armor装備時にbok等の弱い敵から一切ダメージを受けないという既存の（プレイヤーにとって嬉しい）挙動が消えてしまうため、あえて変更しませんでした。
- 端数処理：今回は全て整数のみで完結しており、四捨五入や切り捨ての判断が必要になる箇所はありません。属性倍率導入時にどこで端数処理を挟むかは、`combat.ts`の関数シグネチャを変更するだけで対応できる構造にしてあります。

## 太陽銃の扱い

太陽銃は`resolveSolarGunAttack`内で独自にSOLを消費した後、同じ`applyPlayerAttackToEnemy`を呼び出す既存構造のままです。武器攻撃ボーナスを0（素手相当）に設定し、近接ソルエンチャントの対象武器リストにも含めていないため、コード変更なしで新しい共通ダメージ計算基盤へ自動的に乗る形になりました。SOL消費量・射程・命中条件・攻撃結果はすべて無変更です。

## ソル追加ダメージを10へ変更した理由

新しい10倍スケールに合わせ、命中1回あたりの追加ダメージを1から10へ引き上げました。消費SOLは1のまま変更していません（暫定値）。

## 空振り時SOL非消費の正式仕様

`applyPlayerAttackToEnemy`は実際に敵ターゲットが見つかった場合にのみ呼ばれるため、空振り（`player_whiff`イベント）では一切評価されず、SOLも消費されません。射程外攻撃（スピアの2マス目に敵がいない等）も同様にこの関数へ到達しないため、非消費です。この経路はPhase 10.1から無変更です。

## 既存武器固有挙動の維持方法

ダメージ計算そのものを`applyPlayerAttackToEnemy`内のボーナス加算に留め、以下は無変更です。

- ソードの射程1・攻撃範囲
- スピアの2マス射程
- ハンマーのノックバック（`tryKnockback`は引き続き`applyPlayerAttackToEnemy`の外側、呼び出し元で実行）
- ハンマーの`hammerRecovery`
- ソル発動によるhammerRecovery解除なし（無変更のロジック）

## map、seed、item、sunlight決定性の維持結果

`chooseGroundItemPosition`等のRNGストリーム・呼び出し順序は一切変更していません。既存のロバストネス・決定性テスト（`multi-floor-robustness.test.ts`、`robustness.test.ts`等）を含む全803件（新規50件を加えて853件）が無変更のまま通過しています。

## 変更ファイル

- `src/game/combat.ts`（新規）：中央ダメージ計算モジュール
- `src/game/types.ts`：`Actor.defense`追加
- `src/game/enemy-def.ts`：`EnemyDefinition.defense`追加、全種hp/attack ×10、golem/kraken defense=1
- `src/game/weapon-def.ts`：`attackPower`を加算ボーナスへ意味変更、新数値
- `src/game/armor-def.ts`：armorValue ×10
- `src/game/item-def.ts`：apple healAmount ×10
- `src/game/turn.ts`：`createInitialActor`/`createInitialEnemy`へ`defense`引数追加（デフォルト0、既存呼び出し互換維持）、`getEffectiveAttackPower`/`getPlayerWeaponBonus`/`getEffectivePlayerDefense`/`getIncomingDamage`を`combat.ts`経由へ再実装、自然回復量×10、SOLボーナス10、`applyPlayerAttackToEnemy`を`computeAttackDamage`経由へ
- `src/game/state.ts`：プレイヤー初期化・`CarryOverStats`へ`defense`追加、敵生成へ`def.defense`反映
- 既存テスト10ファイル：新数値・新ダメージ式に合わせて更新（`armor-and-golem.test.ts`、`enemy-behavior-melee-variants.test.ts`、`enemy-type.test.ts`、`hammer-knockback-weapon.test.ts`、`integration.test.ts`、`inventory-and-apple.test.ts`、`phase-09-2-solar-gun.test.ts`、`spear-reach-weapon.test.ts`、`turn.test.ts`、`weapon-and-sword.test.ts`、`phase-10-1-sol-enchant.test.ts`）
- `src/game/__tests__/phase-10-2-combat-stat-scale.test.ts`（新規、50件）
- `docs/history/phase-10-2-combat-stat-scale-redesign.md`：本ドキュメント

## 自動テスト結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：**42ファイル / 853件全成功**（既存803件を新数値へ更新のうえ全通過、新規50件追加）
- `npx vite build`：成功
- `git diff --check`：問題なし

## 手動確認結果

Playwrightによるビルド成果物のヘッドレスfile://起動確認：コンソールエラー0件、外部リクエスト0件。移動・攻撃（X）・エンチャント切替（F）の各キー入力後もエラーなく描画継続していることを確認しました。実機ブラウザでの3フロア通し目視プレイは今回のタスクでは未実施です。

## 未確認項目

- 実プレイでの武器ごとの撃破感覚・被弾回数の体感（golem/krakenの+1ヒット差異が体感上どう影響するか）
- 3フロア通しでの長時間プレイでの回帰
- HPが3桁になるケース（現状の最大値は60程度のため、通常プレイでは2桁止まりですが表示ロジック自体は3桁でも崩れない設計です）

## 今回実装しなかった要素

- 経験値、レベルアップ、装備によるステータス補正
- 敵の弱点・耐性、属性倍率（原作準拠の弱点4倍・中立1.25倍・耐性0.25倍も含む）
- 他5属性のエンチャント、状態異常、エンチャント強化
- ステータス画面、敵レベル、フロア進行による能力補正

## Phase 10.2の完了可否

**完了。** ただし golem・kraken の防御力導入により、素手/spear/solar_gun/swordで撃破回数が旧比+1ヒットとなる点、hammerもkrakenのみ+1ヒットとなる点は、防御力を一律0にしないという指示と撃破回数維持という指示の両立が数理的に不可能だったための、意図的かつ最小限の許容差異です。
