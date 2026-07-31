# Phase 08.4 防具・被ダメージ減衰基盤と第2フロアのゴーレム

## 目的

防具・防具装備スロット・アーマー値による被ダメージ減衰の基盤を実装します。最初の防具としてアーマー値1の「アーマー」を追加し、シレン系に合わせてアーマー値による最終ダメージ0を許可します。防具装備後も脅威になる敵を早期に確認できるよう、ゴーレムを第2フロアから出現候補に加えます。数値および階層別敵構成は暫定です。

## 開始時のHEAD

`09f3641c55eea2fa6c80972911ab61a277cb3843`（origin/mainと一致、working tree clean、baseline 33ファイル/447件全成功）

## アーマー画像について

ユーザーの指示により絵文字🛡️で代用しました。`item-def.ts`の`ITEM_DEFINITIONS.armor.glyph`に保持しています。

## 調査したアイテム、装備、被ダメージ、ターン進行、敵候補処理

- `turn.ts`：敵からプレイヤーへの直接ダメージ適用箇所は3箇所（`tryMeleeAttack`＝bok/golem/sword/axe共通の8方向近接攻撃、`resolveSpiderEnemy`の隣接攻撃分岐、`resolveKrakenEnemy`のテンタクル命中時）であることを確認しました。いずれも`player.hp = Math.max(0, player.hp - enemy.attack)`という同一パターンでした。コカトリスの石化光線（`cockatrice_gaze_fire`）はダメージを与えず石化のみのため対象外と判断しました。
- Phase 08.3の`equippedWeaponId`（`GameState`直下のスカラー、null許容）のパターンを確認し、`equippedArmorId`も同じ形で独立させられると判断しました。
- `item-def.ts`の`category`（Phase 08.3で追加）に`'armor'`を追加するだけで、既存の`consumable`/`stackable`フラグ設計をそのまま流用できることを確認しました。
- `enemy-def.ts`の`getEnemyPoolForFloor`（Phase 08.1）と`ENEMY_FIRST_APPEARANCE_FLOOR`の累積解禁テーブルを確認しました。golemの初出階を単純に5→2へ変更すると、累積方式のため第3・4フロアにもgolemが波及し、「第3フロアの既存候補集合を維持する」という要求と矛盾することを確認しました。このため、テーブル自体は変更せず、フロア2専用の例外を`getEnemyPoolForFloor`に追加する設計を採用しました。
- `state.ts`の`chooseSpecies`（フロアプールから`rng()`を1回/スロット消費する均等抽選）を確認し、フロア総数（`ENEMY_COUNT_PER_FLOOR = 2`）は変えずに「ゴーレム最大1体」を保証するには、RNG消費後の決定的な後処理（2体目以降のgolemをbokへ置換）が追加RNG消費なしで実現できると判断しました。
- 防具追加前の固定seed（例：runSeed=2780624551等）でのマップ・出口・敵座標・リンゴ座標・ソード座標を、既存テスト（`weapon-and-sword.test.ts`等）実行結果と新規テストの決定性検証で記録・突き合わせました。

## 採用した防具定義

`src/game/armor-def.ts`（新規）に、`ArmorId`（`types.ts`で定義、現状`'armor'`のみ）をキーとする`ARMOR_DEFINITIONS: Record<ArmorId, ArmorDefinition>`を単一の正式な定義として作成しました。`ArmorDefinition`は`id`/`armorValue`を持ちます。被ダメージ計算（`turn.ts`）は`ARMOR_DEFINITIONS[state.equippedArmorId].armorValue`を参照するだけで、防具固有値をハードコードしていません。

`item-def.ts`の`ItemDefinition.category`に`'armor'`を追加し、アーマーを`category: 'armor', consumable: false, stackable: false`として登録しました。

## equippedArmorIdの保持方法

`GameState.equippedArmorId: ArmorId | null`（`types.ts`）を追加しました。`equippedWeaponId`と完全に独立したフィールドであり、一方を変更しても他方は一切変化しません（`applyWeaponEquip`と`applyArmorEquip`はそれぞれ自分のフィールドしか書き換えません）。装備してもインベントリの`armor`カウントは減らず、`player.maxHp`/`player.hp`は一切変更しません。

## アーマーの配置規則と独立決定性

Phase 08.2/08.3の`chooseGroundItemPosition`（無変更）をそのまま再利用しました。`state.ts`の`buildFloorState`で`floor === 1`のときだけ、ソード配置の直後に追加で1回呼び出し、除外リストへ`start`・`exit`・全敵座標・リンゴ座標に加えてソードの座標も加えています。第2フロア以降は呼び出し自体を行わないため追加配置されません。

配置には第5の独立RNGストリーム`createRng(floorSeed ^ 0x91b6d8e4)`を使用しました。既存の`placementRng`・`speciesRng`・リンゴ用`itemRng`・ソード用`swordRng`とはすべて異なるXOR定数であり、これら4つの呼び出し順・回数を変更していないため、既存の決定性は変わりません。新規テストの「does not perturb existing map/placement/species/apple/sword determinism」で確認しました。

## 表示に使用したアイコン

絵文字🛡️を使用しました（ユーザー指示）。既存のground item描画（`main.ts`の`drawGroundItems`、Phase 08.2実装、`ITEM_DEFINITIONS[item.itemId].glyph`を汎用的に描画する処理）は無変更でアーマーにもそのまま適用されました。

## 取得と装備操作

拾得はPhase 08.2の汎用自動拾得ロジック（`itemId`非依存）がそのまま適用され、変更不要でした。取得は追加ターンを発生させず、自動装備もしません。

装備は`PlayerAction`に`{ type: 'equip_armor'; armorId: ArmorId }`を追加し、`turn.ts`に`applyArmorEquip`を新設しました（`applyWeaponEquip`と同型：未所持なら不消費、既装備なら`armor_already_equipped`イベントで不消費・非クローズ、それ以外は`equippedArmorId`を設定して`armor_equipped`イベント・インベントリクローズ・`consumed: true`）。`inventory.ts`の`useSelectedInventoryItem`は、選択中アイテムの`category`が`'armor'`なら`equip_armor`アクションを、`'weapon'`なら`equip_weapon`を、それ以外は`use_item`を発行するよう分岐を1つ追加しました。これにより、リンゴ・ソード・アーマーは同じ選択・Enter操作で扱えます。

## 装備成功時だけターンを消費する仕様

`equip_armor`アクションは他の`PlayerAction`と全く同じく`processTurn`のパイプラインを通ります。`applyArmorEquip`が`consumed: true`を返した場合のみ、後段の敵行動解決・自然回復・フロア到達判定・ターン加算が実行されます。`processTurn`冒頭の`inventoryOpen`ガードに`equip_armor`を例外として追加しました。防具専用の敵AIは実装しておらず、`resolveEnemiesAction`（既存関数、無変更）がそのまま使われます。

## 最終ダメージ式 max(0, attackPower - armorValue)

`turn.ts`に`getEffectiveArmorValue(state)`（装備中なら`armorValue`、未装備なら0）と`getIncomingDamage(state, attackPower)`（`Math.max(0, attackPower - getEffectiveArmorValue(state))`）を追加しました。プレイヤーへの直接ダメージ適用箇所3箇所（`tryMeleeAttack`、`resolveSpiderEnemy`、`resolveKrakenEnemy`）すべてで、`enemy.attack`を直接使う代わりに`getIncomingDamage(state, enemy.attack)`の結果を使うよう変更しました。攻撃力1の貫通処理や最低ダメージ1の保証は追加していません（アーマー1で攻撃力1は0ダメージになります）。

## 0ダメージ時の処理

- HP変更：`player.hp = Math.max(0, player.hp - damage)`で`damage`が0なら`player.hp`は不変です。
- ゲームオーバー：`if (player.hp === 0) player.alive = false`のガードは既存のまま維持しており、ダメージ0でHPがすでに0でない限り誤発火しません。
- ターン進行・敵行動・特殊周期：ダメージ計算はHP適用の直前に差し込んだだけで、`tryMeleeAttack`/`resolveSpiderEnemy`/`resolveKrakenEnemy`のいずれも「攻撃行動が発生したこと（`acted`/`attacked`）」自体は従来どおり返すため、ダメージが0でも敵の行動・以降の敵の処理・ターン加算・golemの隔ターン停止のような特殊周期は通常どおり進みます。
- ログ：`enemy_attack`イベントは`damage: 0`のとき「◯◯の攻撃！ アーマーで防ぎ、ダメージを受けなかった。」、`kraken_tentacle_strike`イベントは命中かつ`damage: 0`のとき「◯◯の触手が襲いかかったが、アーマーで防いだ。」を表示するよう`message-log.ts`を拡張しました。

## 第2フロアからゴーレムを候補へ追加したこと

`enemy-def.ts`の`getEnemyPoolForFloor`に、`floor === 2`のときだけ`golem`を候補集合へ追加する例外を実装しました。`ENEMY_FIRST_APPEARANCE_FLOOR`テーブル自体（golem: 5のまま）は変更していないため、この例外は第3・4フロアの累積計算には一切影響しません（第3フロアの候補集合は従来どおりgolemを含みません）。

## 第2フロアの敵総数を変更していないこと

`ENEMY_COUNT_PER_FLOOR`（`mapgen.ts`、無変更、常に2）は変更していません。フロア2の敵は引き続き2体です。

## ゴーレムを最大1体かつ非確定出現にしたこと

`state.ts`の`buildFloorState`で、`chooseSpecies`による通常の均等抽選（floor2のプールは`bok, bat, spider, golem`の4種）の結果に対し、`floor === 2`のときだけ決定的な後処理を追加しました。2体のスロットのうち最初に出たgolemはそのまま残し、2体目以降のgolemは`bok`へ置換します。この後処理は追加の`rng()`呼び出しを伴わないため、既存のRNG消費順序・回数・決定性には影響しません。golemは4種のうち1種でしかないため、通常は出現しない floor も多く、確定出現ではありません。

## フロア遷移時の所持品・装備維持

`state.ts`の`CarryOverStats`に`equippedArmorId: ArmorId | null`を追加し、`advanceToNextFloor`が`state.equippedArmorId`をそのまま次フロアへ渡すようにしました。リンゴ・ソード・`equippedWeaponId`（Phase 08.2/08.3から無変更）と同様に維持されます。

## 新規ゲーム時のリセット

`createInitialState`（`carry`なし）では`equippedArmorId: null`で初期化されます。`createEmptyInventory()`（Phase 08.2実装、`ITEM_IDS_IN_ORDER`をループするだけの汎用実装）は`armor`を追加した`ITEM_IDS_IN_ORDER`に対して無変更で正しく`armor: 0`を含む初期インベントリを返すようになりました。

## 変更ファイル

- `src/game/types.ts`：`ItemId`に`'armor'`追加、`ArmorId`型、`GameState.equippedArmorId`、`equip_armor`アクション追加
- `src/game/armor-def.ts`（新規）：防具定義
- `src/game/item-def.ts`：`'armor'`カテゴリ追加、アーマー登録
- `src/game/events.ts`：`armor_equipped`/`armor_already_equipped`イベント追加
- `src/game/message-log.ts`：0ダメージ時の`enemy_attack`/`kraken_tentacle_strike`ログ、防具装備イベントの日本語フォーマッタ追加
- `src/game/enemy-def.ts`：`getEnemyPoolForFloor`にフロア2ゴーレム例外を追加
- `src/game/turn.ts`：`getEffectiveArmorValue`、`getIncomingDamage`、3箇所のダメージ適用箇所の更新、`applyArmorEquip`、`inventoryOpen`ガードへの`equip_armor`追加
- `src/game/inventory.ts`：`useSelectedInventoryItem`が`armor`カテゴリでも装備分岐するよう追加
- `src/game/state.ts`：フロア1限定のアーマー配置、フロア2ゴーレム数上限の後処理、`equippedArmorId`の引き継ぎ
- `src/main.ts`：インベントリ表示で防具の装備状態と防御値を表示するよう変更
- `src/game/__tests__/armor-and-golem.test.ts`（新規）
- `src/game/__tests__/floor-enemy-pools.test.ts`：フロア2の厳密プール一致・排他・累積性テスト計3件を、フロア2ゴーレム例外に合わせて更新
- `src/game/__tests__/inventory-and-apple.test.ts`／`src/game/__tests__/weapon-and-sword.test.ts`：`inventory`に`armor: 0`、`equippedArmorId: null`を追加
- 既存テストフィクスチャ9ファイル：同上のフィールド追加（挙動は無変更）
- `docs/history/phase-08-4-armor-defense-and-floor2-golem.md`：本ファイル

## テスト結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：**34ファイル / 492件**、全成功（既存447件＋新規45件）
- `npx vite build`：成功。既知の「チャンクサイズ500kB超」警告以外に新規警告なし
- `git diff --check`：成功
- `package.json`／`package-lock.json`：差分なし

`floor-enemy-pools.test.ts`の3件（「2F is exactly bok, bat, spider」「2F never includes species unlocked from 3F onward」「is cumulative」）は、フロア2ゴーレム例外という今回の意図した仕様変更に直接起因するため、実装理由を明示した上で更新しました。無関係な理由での変更ではありません。

## 手動確認結果

Playwright（キャッシュ済みChromium revision 1194 + playwright-core 1.56.0）を用い、ビルド済みプレビューをヘッドレスブラウザで操作して確認しました。確認のため一時的にデバッグ用フック（`window.__debugState`、`window.__debugTeleportAndRefresh`）をmain.tsに追加しましたが、確認後に完全に削除し、commit対象には含めていません。

確認できた項目：

- 通常画面でゲームが起動すること
- 第1フロアの床上にアーマーが実際に配置されていること（`groundItems`から座標を取得して確認）
- アーマーのマスへ移動すると自動取得され、`inventory.armor`が1増え、自動装備されない（`equippedArmorId`が`null`のまま）こと。取得は`turn`を1だけ進めること
- Tabでインベントリを開き、アーマーのエントリが表示されること
- Enterでアーマーを装備でき、`equippedArmorId`が`'armor'`になり、インベントリが閉じ、ターンが1だけ進むこと
- アーマー装備後にソードも装備でき、両方が同時に有効（`equippedWeaponId`と`equippedArmorId`が両方セットされる）であること
- 攻撃力1の敵（ボク）からの攻撃で、アーマー装備中はHPが変化しないこと。かつターンは通常どおり1だけ進むこと
- 上記いずれの操作でもブラウザコンソールに新規エラーが出ないこと

確認できなかった項目（自動テストのみでカバー、実画面では未確認）：

- 第2フロアで実際にゴーレムが出現する画面の見た目（自動テストの`getEnemyPoolForFloor`/`advanceToNextFloor`検証では確認済み。手動確認では時間の都合上、固定seedでゴーレムが実際に出現する画面までは到達確認していません）
- アーマー装備中にゴーレム（攻撃力3）から2ダメージを受ける場面の実画面確認（自動テストの`getIncomingDamage(state, 3) === 2`検証では確認済み）
- フロア2・3への遷移後もアーマーの所持・装備状態が維持される画面上の見え方（自動テストでは確認済み）
- 新しいゲーム（Nキー）でアーマー所持・装備状態がリセットされる画面上の見え方（自動テストでは確認済み）

長時間のバランステストは実施していません。

## 敵性能・敵数・敵候補集合・マップ生成について（ゴーレムの第2フロア追加を除く）

いずれも変更していません。golem自体のHP4・攻撃力3・隔ターン停止、他の全敵の性能、`ENEMY_COUNT_PER_FLOOR`、`choosePlacement`、`generateMap`は無変更です。第1フロアと第3フロアの既存敵候補集合も維持されています。

## 未実装であること

スピア、ハンマー、太陽銃、太陽エネルギーは実装していません。防具強化・耐久値、複数防具スロット、装備解除、防具の重ね着、回避率、確率防御、属性耐性、状態異常耐性は実装していません。最大HP・現在HPの装備時変更は行っていません。

## 今回の位置づけ

今回は防具・被ダメージ減衰基盤とアーマー（アーマー値1、非消費、装備成功時のみターン消費）、および第2フロアへのゴーレム候補追加（最大1体、非確定、既存の階層別候補・敵総数・敵性能は維持）の実装です。アーマー値・ゴーレムの第2フロア追加はいずれも暫定調整であり、最終的なゲームバランスが成立したとは断定しません。次候補としてはスピア、ハンマー、または太陽銃の基盤（太陽エネルギー要素を除く土台部分）、あるいは防具強化のいずれかが考えられますが、今回のcommitには含めていません。
