# Phase 08.7 ハンマーと反動付きノックバック

## 目的と開始時HEAD

第4の近接手段としてハンマーを追加します。高威力・射程1・1マスノックバックを特徴とし、無制限の連続ノックバックを防ぐため使用後に1ターンの反動を設けます。開始時のHEADは`7140cfeab48e51bdedaada029d2a29b24360a97f`（origin/mainと一致、working tree clean、baseline 36ファイル/577件全成功）です。

## ハンマーの性能

- 攻撃力3、射程1（前方1マスのみ、2マス先は攻撃不可）
- 生存した敵を攻撃方向へ1マスノックバック
- ゴーレム・クラーケンはノックバック無効（通常ダメージ3は与える）
- 使用後（命中・撃破・ノックバック失敗・空振りのいずれでも）1ターンの反動が発生

## 無制限連続ノックバックを採用しなかった理由

隣接敵を押し、敵が1マス戻る動きを無反動で繰り返すだけで近接敵をほぼ無傷で倒せてしまうため、ユーザーの指示により反動（1回使用ごとに1ターンの構え直しが必要）を導入しました。原作『続・ボクらの太陽』のハンマーは高威力・隙が大きい・木箱を壊せる武器として説明されており、吹き飛ばし特化ではないことを踏まえ、今回のローグライク版オリジナルの差別化要素として「高威力・制御能力は高いが連打できない」という役割を持たせました。

## 反動と構え直しの規則

`GameState.hammerRecovery: boolean`を新設しました。ハンマー装備中にXで攻撃（命中・撃破・ノックバック失敗・空振りのいずれか）すると`hammerRecovery = true`になります。この状態でハンマー装備中にXを押すと、対象解決を一切行わず「ハンマーを構え直した。」ログとともに1ターン消費し、`hammerRecovery`をfalseへ戻します（攻撃・ノックバックは発生しません）。

反動の解除は以下の場合にのみ発生します。

- 移動成功（`consumed: true`の`move`）
- Space待機（常に`consumed: true`の`wait`）
- 別武器（ハンマー以外）でのX攻撃（命中・空振り問わず）
- ハンマーでの構え直し自体（Xで反動解除）

以下の場合は反動を解除しません。

- Shift＋方向入力（`face`、ターン非消費）
- インベントリの開閉（ターン非消費）
- 装備の付け替え（`equip_weapon`/`equip_armor`。ハンマーを外して別武器を装備し、後で再度ハンマーを装備しても、反動状態はそのまま保持されます）
- 壁などで失敗した移動（`consumed: false`のため）

フロア遷移時・新規ゲーム開始時は、`hammerRecovery`を常にfalseへ初期化します（`webs`や`groundItems`と同様にフロアごとの状態として扱い、`equippedWeaponId`や`inventory`のように引き継ぐ対象には含めていません）。反動は武器の耐久度・使用回数としては実装しておらず、ハンマー自体が破損・消滅することもありません。

## 配置・取得・装備・持ち越し

`state.ts`の`buildFloorState`で、第2フロアに限り、既存のapple・spear配置が完了した後に、7番目の独立RNGストリーム`createRng(floorSeed ^ 0x6a1f38b2)`でハンマーを1個配置します。除外リストはstart・exit・全敵座標・apple座標・spear座標です。既存の乱数呼び出し順序（配置・敵種・apple・sword・armor・spear）は一切変更していません。

取得はPhase 08.2の汎用自動拾得ロジック（`itemId`非依存）がそのまま適用され、追加ターンなし・自動装備なしです。装備は既存の`equip_weapon`アクション・`applyWeaponEquip`関数（Phase 08.3実装、無変更）をそのまま利用しました。`equippedWeaponId`は単一のスカラー値のため、ソード・スピア・ハンマーは自動的に同じ武器スロットを共有します。武器スロットとアーマースロットは引き続き完全に独立しています。フロア遷移時の所持・装備状態の維持は、`inventory`・`equippedWeaponId`の既存の引き継ぎ経路（`CarryOverStats`、無変更）がそのまま機能します。

## ダメージとノックバックの解決順

`turn.ts`の`resolveFacingAttack`（Phase 08.6実装）内、隣接対象への`applyPlayerAttackToEnemy`呼び出し直後に、対象が生存していれば`tryKnockback(state, target, direction, events)`を呼ぶよう変更しました。ダメージは常に先に確定し、ノックバックの成否に関わらず取り消されません。ノックバック失敗時に追加ダメージが発生することもありません。

`WeaponDefinition`に`knockbackDistance`フィールドを追加し（sword/spear: 0、hammer: 1）、`tryKnockback`はこの値を参照するだけで、武器固有の分岐をハードコードしていません。1回のX入力で対象になる敵は常に1体のみ（`resolveFacingAttack`が`enemies.find`で最初に一致した1体だけを返す既存構造）で、敵の連鎖的な押し出しは実装していません（`tryKnockback`は直接命中した対象のみを動かします）。

## 移動可能判定と斜め角判定

`tryKnockback`は既存の`canMove(map, target.pos, direction)`（Phase 02実装、無変更）を再利用し、壁・マップ範囲外・斜め角抜け禁止を、通常移動と全く同じ規則でノックバック先にも適用します。加えて、移動先が他actor（プレイヤーまたは別の生存中の敵）に占有されていないことを個別にチェックします。ground itemとexitは地形情報に影響しないため、ノックバックを妨げません。

ノックバック後の敵は、移動後の座標から通常どおりその敵自身のターン（`resolveEnemiesAction`、無変更）を行います。手動確認・自動テストの双方で、ノックバックされた敵（例：追跡型のボク）が押し出された直後に自身の行動でプレイヤーへ再接近するケースを確認しました。これはPhase 08.7の要求「ノックバック後の敵は移動後の座標から同じターンの敵行動を行う」どおりの挙動です。

## ゴーレムとクラーケンのノックバック無効

`tryKnockback`冒頭で`target.type === 'golem' || target.type === 'kraken'`を明示的にチェックし、該当すれば即座にreturnします（通常ダメージは`tryKnockback`呼び出し前に確定済みのため、そのまま適用されます）。ゴーレム・クラーケンの敵AI・通常移動性能自体は一切変更していません。

## 既存seed決定性の維持方法

ハンマー配置には既存の6つのRNGストリーム（配置・敵種・apple・sword・armor・spear）のいずれとも異なる7番目のXOR定数を使用し、既存ストリームの呼び出し順序・回数を変更していません。新規テストの「does not perturb existing floor-2 map/enemy/apple/spear determinism」「does not perturb existing floor-1 item coordinates」で確認しました。

## 変更ファイル

- `src/game/types.ts`：`WeaponId`/`ItemId`に`'hammer'`追加、`GameState.hammerRecovery`追加
- `src/game/weapon-def.ts`：`WeaponDefinition`に`knockbackDistance`/`hasRecoil`フィールド追加、hammer定義追加、sword/spearに明示的な0/false設定
- `src/game/item-def.ts`：hammer登録（絵文字🔨、category:'weapon'）
- `src/game/events.ts`/`src/game/message-log.ts`：`enemy_knocked_back`/`hammer_recover`イベントと日本語ログ追加
- `src/game/turn.ts`：`tryKnockback`新設、`resolveFacingAttack`の攻撃成功時にノックバック呼び出し追加、`action`分岐にハンマー反動チェック（構え直し／反動セット）追加、`wait`・`move`成功・`slowed`解除時に反動クリア追加
- `src/game/state.ts`：第2フロア限定のハンマー配置、`hammerRecovery`を常にfalse初期化
- `src/main.ts`：インベントリ表示で武器の型注釈にhammerを追加、ハンマー装備中の反動状態表示
- `src/game/__tests__/hammer-knockback-weapon.test.ts`（新規、55件）
- 既存テストフィクスチャ11ファイル：`inventory`に`hammer: 0`、`hammerRecovery: false`を追加（挙動は無変更）

## 自動テスト結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：**37ファイル / 632件**、全成功（既存577件＋新規55件）
- `npx vite build`：成功。既知の「チャンクサイズ500kB超」警告以外に新規警告なし
- `git diff --check`：成功
- `package.json`／`package-lock.json`：差分なし
- 既存seed期待値（マップ・敵・exit・既存ground item座標）に変更はありません（`multi-floor-robustness.test.ts`等の決定性テストは無変更のまま全て成功）

テスト実装時、最初に書いたノックバック関連の一部テストが「ノックバック直後の座標」を直接アサートしていたため誤って失敗しました。実際にはノックバックされた敵はその後同じターン内で自身の行動（追跡移動など）も行うため、押し出された直後の座標がそのまま最終座標になるとは限りません（仕様どおりの正しい挙動）。テストを`enemy_knocked_back`イベントの発生有無で検証する形に修正し、本番コードの変更は行っていません。

## 手動確認結果

Playwright（キャッシュ済みChromium revision 1194 + playwright-core 1.56.0）を用い、ビルド済みプレビューをヘッドレスブラウザで操作して確認しました。確認のため一時的なデバッグ用フック（`window.__debugState`、`window.__debugTeleportAndRefresh`、`window.__debugAdvanceFloor`）をmain.tsに追加しましたが、確認後に完全に削除し、commit対象には含めていません。

確認できた項目（状態JSONで検証）：

- 第1フロアの地面にハンマーが存在しないこと
- 第2フロアに実際に移動すると、地面に`apple`/`spear`/`hammer`が存在すること
- ハンマーを取得・装備できること（`equippedWeaponId`が`'hammer'`になる）
- 前方（東）の隣接敵へのX攻撃でHPが10→7（攻撃力3）に減少し、`hammerRecovery`が`true`になること
- 反動中にXを押しても敵HPが変化しない（構え直しのみ）こと、押した後`hammerRecovery`が`false`に戻ること
- 構え直し後、再度Xを押すと実際に攻撃が成立し、HPが7→4に減少すること
- 上記いずれの操作でもブラウザコンソールに新規エラーが出ないこと

未確認項目（自動テストのみでカバー、実画面では未確認）：

- 壁際の敵がノックバックされず通常ダメージのみ受けることの実画面確認（自動テストの`tryKnockback`/`canMove`検証では確認済み）
- 斜めの壁角越しのノックバック阻止の実画面確認（自動テストでは確認済み）
- ゴーレム・クラーケンがノックバックされないことの実画面確認（自動テストでは確認済み）
- 移動・待機による反動解除、装備し直しでは反動が解除されないことの実画面確認（自動テストでは確認済み）
- ソード・スピア・アーマー・リンゴが従来どおり動くことの実画面での網羅確認（自動テストの回帰テストでは確認済み、手動では時間の都合上ハンマー関連の操作のみ確認）

長時間のバランステストは実施していません。

## 未実装要素

木箱などの新規fixture、地形破壊、敵同士のダメージ、壁衝突による追加ダメージ、複数敵への同時攻撃・貫通攻撃、敵の連鎖押し、プレイヤー自身の移動を伴う効果、武器の耐久度・使用回数、新しい画像アセット、攻撃エフェクト・効果音は実装していません。

## バランスについて

攻撃力3・射程1・ノックバック1マス・反動1ターンという数値は暫定値です。最終的な武器バランスが成立したとは断定しません。
