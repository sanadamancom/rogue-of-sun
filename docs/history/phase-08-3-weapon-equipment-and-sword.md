# Phase 08.3 武器・装備基盤とソード

## 目的

Phase 08.2のインベントリ基盤を利用して、武器を所持・装備できる最小構成を実装します。最初の武器としてソードを実装し、既存の隣接マスへの攻撃を正式な武器攻撃処理へ接続します。将来スピア・ハンマー・太陽銃を追加できるデータ構造にします。

## 開始時のHEAD

`bd5ac04cf3e4fcacea44e1216649abda2e6b328a`（origin/mainと一致、working tree clean、baseline 32ファイル/409件全成功）

## ソード画像について

ユーザーの指示により、既存の`sword.png`（実際には敵種「ソード」のスプライトであり、武器アイコンとしての用途を意図したものではない）は使用せず、絵文字🗡️で代用しました。`item-def.ts`の`ITEM_DEFINITIONS.sword.glyph`に保持しています。

## 調査した既存アイテム、インベントリ、攻撃、ターン進行処理

- `ItemId`/`Inventory`/`ITEM_DEFINITIONS`（`item-def.ts`）：Phase 08.2時点では`apple`のみを登録し、`healAmount`必須フィールドを持つ構造でした。
- `turn.ts`の`applyPlayerAction`：隣接マスへの`move`が敵のいるマスを対象にした場合、`player.attack`（プレイヤーの恒久攻撃力、常に1）をそのままダメージとして適用していました。攻撃対象の特定は「移動先1マス」に限定されており、既存の斜め移動・8方向判定をそのまま利用していたため、武器の射程を変えずに攻撃力だけを差し替える設計が可能と判断しました。
- `processTurn`：`use_item`アクション導入時と同じパターンで、成功時のみ後続の敵行動解決・自然回復・フロア到達判定・ターン加算が走る構造を再確認しました。
- `state.ts`の`buildFloorState`/`advanceToNextFloor`：`CarryOverStats`にインベントリを持たせて次フロアへ引き継ぐ既存パターンを確認し、同じ形で装備状態も引き継げると判断しました。
- ソード画像：`public/assets/sprites/sword.png`は敵種「ソード」用のスプライトシート（3フレーム×4方向、24×32px、緑背景チロマキー）であり、武器アイコンとして流用するには不適切と判断しました。ユーザーの指示により絵文字で代用しました。
- 既存履歴：武器仕様に関する確定事項は見当たりませんでした。

## 採用した武器定義

`src/game/weapon-def.ts`（新規）に、`WeaponId`（`types.ts`で定義、現状`'sword'`のみ）をキーとする`WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition>`を単一の正式な定義として作成しました。`WeaponDefinition`は`id`/`attackPower`/`range`（`{shape:'adjacent', maxDistance:1}`）を持ちます。攻撃ロジック（`turn.ts`）は`WEAPON_DEFINITIONS[state.equippedWeaponId].attackPower`を参照するだけで、武器固有値をハードコードしていません。

`item-def.ts`の`ItemDefinition`には`category: 'consumable' | 'weapon'`・`consumable: boolean`・`stackable: boolean`を追加し、ソードを`category: 'weapon', consumable: false, stackable: false`として登録しました。インベントリ内のソード（所持数）と装備状態（`equippedWeaponId`）は別々の情報源にせず、「所持している前提で装備IDが指すものが有効化される」設計にしました。

## 装備状態の保持方法

`GameState.equippedWeaponId: WeaponId | null`（`types.ts`）を追加しました。`null`は素手、`'sword'`はソード装備中を表します。装備してもインベントリの`sword`カウントは減らず（`stackable: false`だが消費もしない）、`player.attack`（恒久能力値、常に1）は一切変更しません。ダメージ計算は`turn.ts`に新設した`getEffectiveAttackPower(state)`が担い、`equippedWeaponId`があればその武器の`attackPower`を、なければ`player.attack`を返します。同じ武器を複数装備する概念自体が存在しません（`equippedWeaponId`は単一のスカラー値）。

## ソードの配置規則

Phase 08.2の`chooseGroundItemPosition`（`mapgen.ts`、無変更）をそのまま再利用しました。`state.ts`の`buildFloorState`で`floor === 1`のときだけ、リンゴ配置の直後に追加で1回呼び出し、除外リストへ`start`・`exit`・全敵座標に加えてリンゴの座標も加えています。第2フロア以降は呼び出し自体を行わないため、追加配置されません。新しいゲームを開始すると第1フロアが再生成されるため、必ず再配置されます。ソードのランダム出現率や敵ドロップは実装していません。

## 既存乱数順とseed決定性を維持した方法

ソード配置には第4の独立RNGストリーム`createRng(floorSeed ^ 0x5c2e91d3)`を使用しました。既存の`placementRng`（`^ 0x51ed270b`）・`speciesRng`（`^ 0x8f3c9d21`）・リンゴ用`itemRng`（`^ 0xa3c17f05`）とはすべて異なるXOR定数であり、これら3つの呼び出し順・回数を変更していないため、既存のマップ生成・配置座標・敵種決定・リンゴ配置の乱数消費順序とseed決定性は変わりません。`weapon-and-sword.test.ts`の決定性テスト、および既存の`multi-floor-robustness.test.ts`をはじめとする全ての既存決定性テストが無変更のまま成功していることで確認しました。

## ソードの取得処理

Phase 08.2で実装済みの自動拾得ロジック（`turn.ts`の`applyPlayerAction`内、移動成功直後に`groundItems`から一致するタイルを検索・削除し`inventory[itemId]`を+1する処理）は`itemId`に依存しない汎用実装だったため、変更なしでソードにもそのまま適用されました。取得は通常の1回の移動に付随し、追加ターンは発生しません。取得しただけでは`equippedWeaponId`は変化せず、自動装備されません。

## インベントリからの装備操作

`PlayerAction`に`{ type: 'equip_weapon'; weaponId: WeaponId }`を追加し、`turn.ts`に`applyWeaponEquip`を新設しました。所持数が0以下なら不消費で終了（未所持の武器は装備不可）。既に同じ武器を装備中なら`weapon_already_equipped`イベントをpushして不消費・インベントリを開いたままにします（ターンを進めず、閉じません）。それ以外の場合は`equippedWeaponId`を設定し、`weapon_equipped`イベントをpush、`inventoryOpen`を閉じ、`consumed: true`を返します。

`inventory.ts`の`useSelectedInventoryItem`は、選択中アイテムの`ITEM_DEFINITIONS[itemId].category`を見て、`'weapon'`なら`{type:'equip_weapon', weaponId: itemId}`を、それ以外（`'consumable'`）なら従来どおり`{type:'use_item', itemId}`を`processTurn`へ渡すよう分岐しました。これにより、リンゴとソードは同じ選択・Enter操作で扱えます。UI側（`main.ts`）の入力処理（Tab/Escape/矢印/Enter）はPhase 08.2から無変更です。

## 装備成功時だけターンを消費する仕様

`equip_weapon`アクションは`processTurn`の中で他の`PlayerAction`と全く同じ扱いを受けます。`applyWeaponEquip`が`consumed: true`を返した場合のみ、その後段の敵行動解決・自然回復判定・フロア到達判定・ターン加算が実行されます。既装備への再装備（`consumed: false`）の場合はそれ以降の処理は一切実行されません。装備専用の敵AI実装は行っておらず、`resolveEnemiesAction`（既存関数、無変更）がそのまま使われます。`processTurn`冒頭の`inventoryOpen`ガードは、`use_item`に加えて`equip_weapon`も例外として通すよう1箇所拡張しました。

## 素手攻撃力1とソード攻撃力2

`getEffectiveAttackPower(state)`が`state.equippedWeaponId ? WEAPON_DEFINITIONS[weaponId].attackPower : state.player.attack`を返し、`turn.ts`の攻撃分岐（既存の隣接マス移動＝攻撃の判定はそのまま）でこれを使うよう変更しました。攻撃対象の特定ロジック自体は変更していないため、ソードの射程（隣接1マス）は既存の斜め移動を含む8方向攻撃可否と完全に一致します。武器耐久値・ノックバック・範囲攻撃は実装していません。攻撃ログは`player_attack`イベントに`weaponId`（装備時のみ）を追加し、`message-log.ts`で「ソードで◯◯に2ダメージ。」のように武器名を含めて表示するようにしました（未装備時は従来どおり武器名なしの表示）。

## フロア遷移時の所持品と装備の維持

`state.ts`の`CarryOverStats`に`equippedWeaponId: WeaponId | null`を追加し、`advanceToNextFloor`が`state.equippedWeaponId`をそのまま次フロアの`carry.equippedWeaponId`として渡すようにしました。リンゴ所持数（Phase 08.2から無変更）と同様に維持されます。

## 新規ゲーム時のリセット

`createInitialState`（`carry`なし）では`equippedWeaponId: null`で初期化されます。`createEmptyInventory()`（Phase 08.2実装、`ITEM_IDS_IN_ORDER`をループするだけの汎用実装）は`sword`を追加した`ITEM_IDS_IN_ORDER`に対して無変更で正しく`sword: 0`を含む初期インベントリを返すようになりました。

## 変更ファイル

- `src/game/types.ts`：`ItemId`に`'sword'`追加、`WeaponId`型、`GameState.equippedWeaponId`、`equip_weapon`アクション追加
- `src/game/weapon-def.ts`（新規）：武器定義
- `src/game/item-def.ts`：`category`/`consumable`/`stackable`フィールド追加、ソード登録
- `src/game/events.ts`：`player_attack`に`weaponId?`追加、`weapon_equipped`/`weapon_already_equipped`イベント追加
- `src/game/message-log.ts`：武器名を含む攻撃ログ、装備イベントの日本語フォーマッタ追加
- `src/game/turn.ts`：`getEffectiveAttackPower`、`applyWeaponEquip`、攻撃分岐の武器対応、`inventoryOpen`ガードに`equip_weapon`を追加
- `src/game/inventory.ts`：`useSelectedInventoryItem`がアイテムのcategoryに応じて使用/装備を分岐
- `src/game/state.ts`：フロア1限定のソード配置、`equippedWeaponId`の引き継ぎ
- `src/main.ts`：インベントリ表示で武器の装備状態（「（装備中）」「（未装備）」）を表示するよう変更
- `src/game/__tests__/weapon-and-sword.test.ts`（新規）
- `src/game/__tests__/inventory-and-apple.test.ts`：アイテム全種登録前提だった2件・ground items数固定だった1件を、sword追加に合わせて更新
- 既存テストフィクスチャ9ファイル：`inventory`に`sword: 0`、`equippedWeaponId: null`を追加（挙動は無変更）
- `docs/history/phase-08-3-weapon-equipment-and-sword.md`：本ファイル

## 追加または更新したテスト

新規`weapon-and-sword.test.ts`（38件）に以下を含みます。

- 武器定義（ID、表示名、category、consumable/stackable、攻撃力2、射程）
- ソード配置（フロア1限定・正確に1個・重複禁止・第2/3フロア非配置・決定性・既存RNG無変更・出現率導入なしの確認）
- 拾得（所持数増加、地面から削除、自動装備されないこと、追加ターンなし、イベント）
- 装備（所持中のみ装備可、装備成功時のequippedWeaponId設定・1ターン消費・敵行動発生・インベントリクローズ・非消費、既装備への再装備が不消費・非クローズ・専用イベント、リンゴ使用への非干渉）
- 武器対応戦闘（素手1・装備時2、斜め隣接攻撃の維持、武器名を含む/含まないイベント、golemの隔ターン停止周期維持、ゴーレムHP4がソード1発で倒れないこと、ノックバックなし、装備が消費されないこと、撃破処理の維持）
- 永続化とリセット（フロア遷移での所持・装備維持、新規ゲームでの所持数0・装備null化、リンゴのリセットも回帰確認）
- インベントリ操作（リンゴとソードを同じ選択処理で扱えること、開閉のターン非消費、空インベントリの安全性）
- 回帰（リンゴの回復・満タン失敗の既存挙動）

既存`inventory-and-apple.test.ts`の2件は、Phase 08.2時点で「登録アイテムはリンゴのみ」を前提にしていたため、ソード追加という仕様変更に直接付随する形で更新しました（無関係な失敗ではなく、今回の変更が意図的に生んだ差分です）。もう1件はフロア1のground itemsが「リンゴ1個だけ」という前提だったものを、リンゴだけを対象にフィルタする形に修正しました。

## 検証結果（自動）

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：**33ファイル / 447件**、全成功（既存409件＋新規38件）
- `npx vite build`：成功。既知の「チャンクサイズ500kB超」警告以外に新規警告なし
- `git diff --check`：成功
- `package.json`／`package-lock.json`：差分なし

## 手動確認結果

Playwright（キャッシュ済みChromium revision 1194 + playwright-core 1.56.0）を用い、ビルド済みプレビューをヘッドレスブラウザで操作して確認しました。確認のため一時的にデバッグ用フック（`window.__debugState`、`window.__debugTeleportAndRefresh`）をmain.tsに追加しましたが、確認後に完全に削除し、commit対象には含めていません。

確認できた項目：

- 通常画面でゲームが起動すること
- 第1フロアの床上にソードが実際に配置されていること（`groundItems`から座標を取得して確認）
- ソードのマスへ移動すると自動取得され、`inventory.sword`が1増え、`groundItems`から消えること。取得は`turn`を1だけ進めること（追加ターンなし）
- 取得しただけでは`equippedWeaponId`が`null`のままであること（自動装備されない）
- Tabでインベントリを開き、ソードのエントリが表示されること
- 矢印キーでソードを選択し、Enterで装備できること。装備成功時に`equippedWeaponId`が`'sword'`になり、インベントリが閉じ、ターンが1だけ進むこと
- 装備後、隣接する敵への攻撃で実際に2ダメージが適用されること（テスト用に敵HPを5に設定し、攻撃後3になることを確認）
- 上記いずれの操作でもブラウザコンソールに新規エラーが出ないこと

確認できなかった項目（自動テストのみでカバー、実画面では未確認）：

- 装備成功後、実際に敵が1ターン行動する見た目のアニメーションのタイミング・視認性（自動テストの`enemyActed`/`enemyAttacked`検証では確認済み）
- フロア2・3への遷移後もソードの所持・装備状態が維持される画面上の見え方（自動テストの`advanceToNextFloor`検証では確認済み）
- 新しいゲーム（Nキー）でソード所持・装備状態がリセットされる画面上の見え方（自動テストでは確認済み）
- インベントリ画面での「（装備中）」「（未装備）」表示の実際の見た目（スクリーンショットは取得したが、テキスト内容の目視確認は状態JSONの検証で代替）

長時間のバランステストは実施していません。ソード追加による最終的な難易度の判定は行っていません。

## 敵性能・敵数・敵候補集合・マップ生成について

いずれも変更していません。`ENEMY_DEFINITIONS`、`ENEMY_COUNT_PER_FLOOR`、`ENEMY_FIRST_APPEARANCE_FLOOR`（Phase 08.1）、`choosePlacement`、`generateMap`は無変更です。Phase 08.1・08.2の全既存テストは無変更のまま成功しています。

## 未実装であること

太陽銃、太陽エネルギー、スピア、ハンマー、防具は今回実装していません。攻撃エフェクト（新規画像・演出）は今回の対象外です。武器耐久値、武器強化・レベル、ランダム付与効果、クリティカル、命中率、攻撃速度、複数装備スロット、装備解除操作は実装していません。

## 今回の位置づけ

今回は武器・装備基盤とソード（攻撃力2、隣接射程、非消費、装備成功時のみターン消費）の実装であり、武器システム全体の完成ではありません。ソードの追加により最終的なゲームバランスが成立したとは断定しません。次候補としてはスピア、ハンマー、または太陽銃の基盤（太陽エネルギー要素を除く土台部分）のいずれかが考えられますが、今回のcommitには含めていません。
