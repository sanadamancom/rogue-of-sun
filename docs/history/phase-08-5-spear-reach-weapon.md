# Phase 08.5 スピアと2マス攻撃

## 目的

2マス先の敵を攻撃できる武器基盤を実装します。第2フロアに新しい武器「スピア」を配置し、ソードの高攻撃力とスピアの射程という選択を成立させます。既存の移動入力式を維持し、新しい照準モードや攻撃キーは追加しません。

## 開始時のHEAD

`b310ff1692244379e77bd6b1e7ec09fee4986d3c`（origin/mainと一致、working tree clean、baseline 34ファイル/492件全成功）

## 調査した武器定義、入力、移動、攻撃、角抜け、ターン進行処理

- `weapon-def.ts`：`WeaponDefinition`は`id`/`attackPower`/`range`（`{shape:'adjacent', maxDistance:1}`）を持っていました。`range`フィールドは`turn.ts`から一切参照されておらず、実質未使用のドキュメント用フィールドだったことを確認しました。
- `turn.ts`の`applyPlayerAction`：`destination = destinationOf(player.pos, action.direction)`で隣接1マス先を求め、そこに生存中の敵がいれば攻撃、いなければ`canMove`で移動可否を判定する、という単純な2分岐構造でした。方向入力自体は`move`アクション1種類のみで、専用の攻撃キーは存在しませんでした。
- `map.ts`の`canMove(map, from, direction)`：目的地の壁・範囲外判定に加え、斜め移動時は`sideA`/`sideB`（両側の直交マス）が両方歩行可能でなければ角抜けとして拒否する実装で、これは「1区間の移動可否」を判定する再利用可能な純粋関数であることを確認しました。2マス攻撃の各区間にもそのまま使えると判断しました。
- `state.ts`の`buildFloorState`：apple用・sword用・armor用の独立RNGストリーム（それぞれ異なるXOR定数）で、既存の乱数消費順を一切変えずにground itemを追加していくパターンを確認しました。フロア2にはこれまでapple以外のground itemがなかったため、スピア配置に必要な除外座標はstart/exit/敵座標/apple座標のみで済むことを確認しました。
- スピア追加前の固定seed（例：runSeed=2780624551）でのフロア2のマップ・出口・敵座標・敵種・リンゴ座標を、新規テストの決定性検証で記録・突き合わせました（ソード・アーマー座標はフロア1限定のため、フロア2には最初から存在しません）。

## 採用したスピア定義

`weapon-def.ts`の`WeaponDefinition`から`range: WeaponRange`（未使用だった構造体）を削除し、`reach: number`という単純なスカラーフィールドに置き換えました。`WEAPON_DEFINITIONS`に`spear: { id: 'spear', attackPower: 1, reach: 2 }`を追加し、既存の`sword`にも明示的に`reach: 1`を設定しました。素手は`WeaponDefinition`を持たないため、`turn.ts`側で「装備武器がなければreach 1」として扱っています。攻撃処理内にspear専用の攻撃力・射程の値はハードコードしていません。

## 攻撃力1と射程2が暫定値であること

`provisional_weapon_definition`のとおり、`attackPower: 1`・`reach: 2`は暫定値です。最終的な武器バランスが成立したとは断定しません。

## 第2フロアへの配置規則

`state.ts`の`buildFloorState`で、`floor === 2`のときだけスピアを1個配置するブロックを追加しました。第1フロアには配置せず、第3フロア以降にも新規配置しません。同一seedでは同じ座標に配置されます（`chooseGroundItemPosition`、Phase 08.2実装、無変更を再利用）。

## 独立した決定性の維持方法

スピア配置には第6の独立RNGストリーム`createRng(floorSeed ^ 0x3d7a4c19)`を使用しました。既存の`placementRng`・`speciesRng`・apple用`itemRng`・sword用`swordRng`・armor用`armorRng`とはすべて異なるXOR定数であり、これら5つの呼び出し順・回数を変更していないため、既存の決定性（マップ・出口・敵座標・敵種・リンゴ座標）は変わりません。新規テストの「does not perturb existing floor-2 map/enemy/apple determinism」で確認しました。

## 表示に使用した暫定アイコン

絵文字🔱を使用しました（ユーザー指示）。`item-def.ts`の`ITEM_DEFINITIONS.spear.glyph`に保持しています。既存のground item描画（`main.ts`の`drawGroundItems`、Phase 08.2実装、`ITEM_DEFINITIONS[item.itemId].glyph`を汎用的に描画）は無変更でスピアにもそのまま適用されました。攻撃アニメーションや専用エフェクトは追加していません。

## 取得と装備操作

拾得はPhase 08.2の汎用自動拾得ロジック（`itemId`非依存）がそのまま適用され、変更不要でした。取得は追加ターンを発生させず、自動装備もしません。

装備は既存の`equip_weapon`アクション・`applyWeaponEquip`関数（Phase 08.3実装）をそのまま利用しました。`equippedWeaponId`は単一のスカラー値（`WeaponId | null`）のため、`WeaponId`ユニオンに`'spear'`を追加しただけで、ソードとスピアが同じ武器スロットを共有する（一方を装備するともう一方は自動的に非装備になる）動作が、コード変更なしに実現されました。`inventory.ts`の`useSelectedInventoryItem`もカテゴリベースの分岐（`category === 'weapon'`）のままで、スピアにも無変更で対応しています。

## ソードとスピアが同じ武器スロットを使うこと

`equippedWeaponId`が単一フィールドであるため、スピアを装備すると`equippedWeaponId`が`'spear'`に上書きされ、直前まで`'sword'`だった場合は自動的にソードが非装備になります（逆も同様）。新規テスト「equipping spear un-equips sword」「equipping sword un-equips spear」で確認しました。所持数（`inventory.sword`/`inventory.spear`）はどちらも装備切り替えで変化しません。

## アーマーとは同時装備できること

`equippedArmorId`は`equippedWeaponId`と完全に独立したフィールド（Phase 08.4実装、無変更）であるため、武器の切り替えは防具装備に一切影響しません。新規テスト「equipping spear does not affect equippedArmorId」で確認しました。

## 隣接敵を優先する対象決定規則

`turn.ts`の`applyPlayerAction`で、まず既存どおり隣接マス（`destination`）の敵を検索し、見つかればそれを攻撃して即座にreturnします。2マス先の判定はこの後、かつ通常移動の判定より前に追加しました。隣接に敵がいる場合は2マス先の判定コード自体に到達しないため、「隣接と2マス先の両方に敵がいる場合は隣接敵を攻撃する」が構造的に保証されます。

## 2マス攻撃時に移動しないこと

2マス先攻撃の分岐では`player.pos`を一切変更せず、`player.facing`のみ更新します。ダメージ適用・撃破処理は隣接攻撃と同じ`applyPlayerAttackToEnemy`ヘルパー（新規抽出、隣接攻撃と2マス攻撃の両方から呼び出す）を使うため、スピア専用の敵撃破処理は存在しません。

## 壁、actor、斜め角による遮蔽規則

2マス攻撃は次の手順で判定します。

1. `canMove(map, player.pos, direction)`（区間1：プレイヤー→中間マス）が真であること。壁・範囲外・斜め角抜けを含む既存の判定をそのまま再利用します。
2. 区間1が偽なら2マス攻撃を行いません（中間マスが壁、または斜め角が塞がれている場合）。
3. 区間1が真なら、`canMove(map, destination, direction)`（区間2：中間マス→奥のマス）を判定します。斜め角抜け禁止は区間2にも独立して適用されます。
4. 区間2が真の場合のみ、奥のマスに生存中の敵がいるか検索し、いれば攻撃します。

中間マスに敵がいる場合は、隣接攻撃の判定（既存コード、最優先）で先に検出されるため、2マス先へは届きません。中間マスのground itemやexitは`canMove`が参照する`map.terrain`（壁/床の区別のみ）に影響しないため、攻撃を妨げません。奥のマスがマップ外の場合は`canMove`内の`isWalkable`が`isInBounds`を含むため、自動的に攻撃不成立となります。

## 攻撃成功時のターン消費

隣接攻撃・2マス攻撃のいずれも、既存の`applyPlayerAction`の戻り値（`consumed: true, attacked: true, defeated`）をそのまま返すため、`processTurn`の後段（敵行動解決・自然回復・フロア到達判定・ターン加算）は無変更で実行されます。スピア専用のターン処理・敵AIは実装していません。

## フロア遷移時の所持品・装備維持

`equippedWeaponId`（`WeaponId | null`、Phase 08.3実装）と`inventory`（`Inventory`、`ITEM_IDS_IN_ORDER`に`'spear'`を追加しただけで`createEmptyInventory`は無変更のまま`spear: 0`を含むようになる）は、いずれも型が拡張されただけで、`CarryOverStats`・`advanceToNextFloor`のロジック自体は無変更です。スピア所持・装備状態は自動的に他のアイテムと同じ経路でフロア間を維持します。

## 新規ゲーム時のリセット

`createInitialState`（`carry`なし）は`equippedWeaponId: null`・`createEmptyInventory()`（`spear: 0`を含む）で初期化されます。無変更のコードパスがそのまま新しい`ItemId`/`WeaponId`に対応しました。

## 変更ファイル

- `src/game/types.ts`：`ItemId`/`WeaponId`に`'spear'`追加
- `src/game/weapon-def.ts`：`range`オブジェクトを`reach: number`に置き換え、`spear`を追加
- `src/game/item-def.ts`：スピア登録（絵文字🔱、category:'weapon'）
- `src/game/turn.ts`：`applyPlayerAttackToEnemy`ヘルパーの抽出（隣接攻撃・2マス攻撃で共有）、2マス攻撃の判定ロジック追加
- `src/game/state.ts`：フロア2限定のスピア配置
- `src/main.ts`：インベントリ表示で武器の攻撃力・射程を表示するよう拡張
- `src/game/__tests__/spear-reach-weapon.test.ts`（新規）
- `src/game/__tests__/weapon-and-sword.test.ts`：`range`参照テストを`reach`参照へ更新（Phase 08.5のフィールド名変更に伴う意図した更新）
- `src/game/__tests__/inventory-and-apple.test.ts`：フロア2のground items数を「apple 1個のみ」固定していたテストを、apple個数のフィルタ確認へ更新（スピア追加という意図した仕様変更に伴う）
- 既存テストフィクスチャ11ファイル：`inventory`に`spear: 0`を追加（挙動は無変更）
- `docs/history/phase-08-5-spear-reach-weapon.md`：本ファイル

## テスト結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：**35ファイル / 538件**、全成功（既存492件＋新規46件）
- `npx vite build`：成功。既知の「チャンクサイズ500kB超」警告以外に新規警告なし
- `git diff --check`：成功
- `package.json`／`package-lock.json`：差分なし

`weapon-and-sword.test.ts`と`inventory-and-apple.test.ts`の各1件は、今回の仕様変更（`reach`フィールドの導入、フロア2へのスピア追加）に直接起因するため、実装理由を明示した上で更新しました。無関係な理由での変更ではありません。

## 手動確認結果

Playwright（キャッシュ済みChromium revision 1194 + playwright-core 1.56.0）を用い、ビルド済みプレビューをヘッドレスブラウザで操作して確認しました。確認のため一時的にデバッグ用フック（`window.__debugState`、`window.__debugTeleportAndRefresh`、`window.__debugAdvanceFloor`）をmain.tsに追加しましたが、確認後に完全に削除し、commit対象には含めていません。

確認できた項目：

- 通常画面でゲームが起動すること
- 第1フロアの地面にスピアが存在しないこと（`groundItems`が`apple`/`sword`/`armor`のみ）
- 第2フロアに実際に移動すると、地面に`apple`と`spear`が1個ずつ存在すること
- スピアのマスへ移動すると自動取得され、`inventory.spear`が1増え、自動装備されない（`equippedWeaponId`が`null`のまま）こと。取得は`turn`を1だけ進めること
- Tabでインベントリを開き、スピアのエントリが表示されること
- Enterでスピアを装備でき、`equippedWeaponId`が`'spear'`になり、インベントリが閉じ、ターンが1だけ進むこと
- 2マス先（間に空きマスがある）の敵への攻撃で、プレイヤー座標が変化せず、敵のHPが5→4（スピア攻撃力1）に減少すること
- 上記いずれの操作でもブラウザコンソールに新規エラーが出ないこと

確認できなかった項目（自動テストのみでカバー、実画面では未確認）：

- 壁越し・斜め角越しの2マス攻撃阻止の実画面確認（自動テストの`canMove`ベースの判定検証では確認済み）
- 隣接敵優先ルールの実画面確認（自動テストでは確認済み）
- フロア遷移・新規ゲームでのスピアリセットの実画面確認（自動テストでは確認済み）
- ソード・アーマー・リンゴの既存動作が壊れていないことの実画面での網羅確認（自動テストの回帰テストでは確認済み、手動では時間の都合上スピア関連の操作のみ確認）

長時間のバランステストは実施していません。

## 敵性能・敵数・マップ生成・第2フロアのゴーレム規則について

いずれも変更していません。全敵の性能、`ENEMY_COUNT_PER_FLOOR`、`choosePlacement`、`generateMap`、Phase 08.4のフロア2ゴーレム候補・最大1体規則は無変更です。

## 未実装であること

ハンマー、太陽銃、太陽エネルギーは実装していません。武器強化・耐久値、二刀流、複数武器スロット、装備解除、防御無視、クリティカル、命中率、属性攻撃、状態異常、projectile/弾速表現は実装していません。単一HTMLの再生成は今回のスコープ外のため行っていません。

## 今回の位置づけ

今回は2マス攻撃武器基盤とスピア（攻撃力1、射程2、非消費、装備成功時のみターン消費、ソードと同一武器スロット）の実装です。攻撃力1・射程2はいずれも暫定調整であり、最終的な武器バランスが成立したとは断定しません。次候補としてはハンマー、または太陽銃の基盤（太陽エネルギー要素を除く土台部分）が考えられますが、今回のcommitには含めていません。
