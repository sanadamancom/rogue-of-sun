# Phase 10.1 ソルエンチャント基礎

## 目的と開始時HEAD

近接武器（ソード・スピア・ハンマー）へ適用するエンチャントシステムの基礎を実装しました。最初の属性としてソルだけを実装し、プレイヤーが任意にON/OFFできるようにします。ソル選択中に近接攻撃が敵へ命中した場合だけ、太陽銃と共通のSOLゲージを1消費し、ダメージへ1加算します。開始時のHEADは`522c53e3b31abe82ae0db0b566cd3242400a685c`（origin/mainと一致、working tree clean、baseline 40ファイル/778件全成功）です。

## precheck結果

- `git remote get-url origin`が対象リポジトリと一致
- ブランチ`main`、local HEAD/origin/mainとも`522c53e3b31abe82ae0db0b566cd3242400a685c`で一致
- working tree clean
- baseline全テスト778件成功

## 調査結果（実装前）

- 攻撃命中が確定する処理は`turn.ts`の`applyPlayerAttackToEnemy`ひとつに集約されており、隣接1マス攻撃・スピアのリーチ2マス攻撃・太陽銃の射撃ヒットの3経路すべてがここを通ることを確認しました。SOL消費と追加ダメージの挿入位置としてこの関数を選びました。
- 太陽銃は`resolveSolarGunAttack`内で独自にSOLを消費したのち、同じ`applyPlayerAttackToEnemy`を呼んで命中処理を行っています。近接エンチャントの対象武器リストに`solar_gun`を含めないことで、この共有関数を変更しても太陽銃の既存SOL消費・ダメージには一切影響しないことを確認しました。
- ハンマーのノックバック（`tryKnockback`）と反動（`hammerRecovery`）は`applyPlayerAttackToEnemy`の外側（呼び出し元の`resolveFacingAttack`・Xアクション分岐）で処理されており、ダメージ計算の変更から独立していることを確認しました。
- アイテム取得は`turn.ts`の移動処理内、`state.groundItems`から自動取得する既存経路（`item_picked_up`イベント＋`inventory[itemId]++`）を確認しました。ソルエンチャントはスタック型アイテムではなく一度きりの解禁アイテムであるため、この経路を`sol_enchantment`のみ分岐させ、インベントリへは積まず`GameState.solUnlocked`を直接trueにする方式にしました。
- HUDは`main.ts`の`hudText.setText`一箇所に集約されており、SOL表示の隣に追加できる余地を確認しました。
- 未使用キーの調査：w/a/s/d/矢印/q/e/z/c/x/Space/Tab/Escape/Enter/n/Shiftがすべて使用中であることを確認し、`f`キーが未使用であることを確認しました。
- フロア遷移（`advanceToNextFloor`）時に持ち越される状態（`inventory`、`equippedWeaponId`、`solarEnergy`など）と、常にリセットされる状態（`groundItems`、`hammerRecovery`など）を確認し、`solUnlocked`・`selectedEnchantment`は前者（持ち越し）に分類しました。
- 敵HPと既存武器ダメージ：フロア1〜2の雑魚敵は複数ターンで倒せる程度のHPがあり、ソード基礎2＋ボーナス1＝3ダメージのような差分をテストで検証可能であることを確認しました。

## エンチャント状態モデル

- `GameState.solUnlocked: boolean`：ソルエンチャントを取得済みか。初期値`false`、フロア遷移で持ち越し、新規ラン開始時は常に`false`。
- `GameState.selectedEnchantment: 'none' | 'sol'`：プレイヤー共通（武器ごとではない）の選択状態。初期値`'none'`、フロア遷移で持ち越し。
- 未解禁時は`'sol'`を選択できません（切替操作自体が無効化されます）。

## ソル取得方法と配置規則

- アイテムID`sol_enchantment`（表示名「ソル」、グリフ🔆）を新規登録しました。
- 配置は既存のground item配置方式（`chooseGroundItemPosition`＋専用RNGストリーム`floorSeed ^ 0x9f4a1e63`）を再利用し、フロア1限定で1個配置します。3フロアの試作を通じて必ず取得・検証できるよう、最初のフロアに置くことで確実な到達性を確保しました。開始位置・出口・敵・他の既存アイテム（りんご・ソード・アーマー・太陽の実・太陽銃）と重複しません。
- 取得は既存の自動取得（移動して乗る）と同じ操作感です。取得すると`solUnlocked`が`true`になりますが、`selectedEnchantment`は自動的に`'sol'`へは変わりません（`'none'`のまま）。
- スタック型インベントリには追加しません（`inventory.sol_enchantment`は常に`undefined`のままです）。既にtrueの状態で再度拾うことは通常発生しませんが、念のため冪等（二重解禁・二重イベントを起こさない）に実装しています。

## 採用した切替キーと競合確認

`f`キーを採用しました。既存の全キー（方向キー・Shift・X・Space・Tab・Escape・Enter・n/N）を洗い出し、いずれとも重複しないことを確認済みです。`f`は`toggle_enchantment`という新しい`PlayerAction`にマップされ、`solUnlocked`が`true`の間だけ`'none'`⇄`'sol'`を循環します。未解禁時は無反応（イベントも状態変化も発生しません）。

## 発動条件

`applyPlayerAttackToEnemy`（隣接攻撃・スピアのリーチ2マス攻撃・太陽銃の共有ヒット処理）内で、以下をすべて満たした場合のみ発動します。

- 装備武器がソード・スピア・ハンマーのいずれか（太陽銃・素手は対象外）
- `selectedEnchantment === 'sol'`
- `solUnlocked === true`
- 攻撃解決直前の`solarEnergy >= 1`

この関数は実際に敵ターゲットが見つかった場合にのみ呼ばれるため、空振りでは一切評価されません。

## SOL消費タイミング

命中が確定した瞬間（ダメージ計算の直前）に1消費します。太陽銃自身のSOL消費（`resolveSolarGunAttack`側、既存のまま）とは完全に独立しており、同じ攻撃で二重に消費されることはありません（太陽銃は対象外武器のため近接エンチャント側の消費条件を満たしません）。

## SOL不足時のフォールバック

`selectedEnchantment`が`'sol'`のままSOLが0の場合、選択状態を維持したまま通常ダメージ（武器本来の`attackPower`のみ）で攻撃します。SOL消費・追加ダメージ・`sol_enchantment_used`イベント・専用ログ・発光演出のいずれも発生しません。SOLが（太陽の実や日照チャージで）回復すれば、再選択なしで次の命中から自動的に再発動します。

## 素手と太陽銃を対象外にした扱い

対象武器リストに`sword`/`spear`/`hammer`のみを含め、`solar_gun`と素手（`equippedWeaponId === null`）は最初から対象外としました。太陽銃は既存のSOL消費・射程・ダメージ・演出・ログを一切変更していません（自動テストで確認）。

## ソード・スピア・ハンマー固有挙動の維持方法

ダメージ計算そのものを変更せず、`applyPlayerAttackToEnemy`内でボーナスを加算するだけに留めたため、以下は無変更です。

- ソードの射程・攻撃範囲
- スピアの2マス射程（アダプター先取り優先の既存ルールも含む）
- ハンマーのノックバック（`tryKnockback`は`applyPlayerAttackToEnemy`の外側、呼び出し元で従来どおり実行）
- ハンマーの`hammerRecovery`（Xアクション分岐の`result.consumed`判定は無変更）

## 暫定効果と数値

- SOL消費：命中1回につき1（`SOL_ENCHANT_COST`）
- 追加ダメージ：命中1回につき+1（`SOL_ENCHANT_BONUS_DAMAGE`）
- 武器ごとの基礎ダメージ・射程・ノックバック・反動仕様は一切変更していません。
- これらの数値は操作感を確認するための最小値であり、今後のバランス調整で分離・変更される想定です。

## 変更ファイル

- `src/game/types.ts`：`ItemId`へ`sol_enchantment`追加、`EnchantmentId`型追加、`GameState`へ`solUnlocked`/`selectedEnchantment`追加、`PlayerAction`へ`toggle_enchantment`追加
- `src/game/item-def.ts`：`sol_enchantment`のアイテム定義追加
- `src/game/events.ts`：`sol_enchantment_acquired`/`enchantment_toggled`/`sol_enchantment_used`イベント追加
- `src/game/message-log.ts`：上記3イベントの日本語メッセージ追加
- `src/game/turn.ts`：ソル対象武器・コスト・ボーナス定数、`applyPlayerAttackToEnemy`への発動ロジック追加、`toggle_enchantment`ハンドリング追加、自動取得処理での`sol_enchantment`特殊扱い
- `src/game/state.ts`：フロア1へのソル配置、`solUnlocked`/`selectedEnchantment`のフロア間持ち越し対応
- `src/game/input.ts`：`f`キーで`toggle_enchantment`
- `src/main.ts`：HUDへのENCHANT状態表示、操作案内更新、発動時の簡易フラッシュ演出
- `src/game/__tests__/phase-10-1-sol-enchant.test.ts`：Phase 10.1専用テスト（25件、新規）
- 既存テストファイル19本：`GameState`/`Inventory`の型完全性維持のため、フィクスチャへ`solUnlocked: false`・`selectedEnchantment: 'none'`・`sol_enchantment: 0`を機械的に追加（値の再設計や既存アサーションの変更は一切なし）
- `docs/history/phase-10-1-sol-enchant-foundation.md`：本ドキュメント

## 自動テスト結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：41ファイル / 803件全成功（既存778件は無変更のまま全通過、新規25件追加）
- `npx vite build`：成功（既存の警告のみ、エラーなし）
- `git diff --check`：問題なし

## 手動確認結果

- ビルド成果物のヘッドレス起動確認（Playwrightによるfile://起動、コンソールエラー・テクスチャエラーなしを確認）
- 実際のダンジョン内でのソル取得〜切替〜発動の目視確認は今回のタスクでは未実施（headlessブラウザでの起動確認のみ）

## 未確認項目

- 実プレイでの操作感（キー入力の押しやすさ、演出の視認性）
- 3フロア通しでの長時間プレイでの回帰
- 他の属性（フレイム・フロスト・クラウド・アース・ダーク）追加時の拡張性

## 今回実装しなかった要素

- 素手・太陽銃へのエンチャント
- ソル以外の5属性
- 属性相性・状態異常
- 敵の属性耐性・弱点
- エンチャントのレベル・強化・合成・売買
- 複数属性の同時装備、武器ごとの個別エンチャント保存
- 新規画像アセット
- SOL最大値の変更、日照配置・チャージ仕様の変更
- 4階以降のコンテンツ
