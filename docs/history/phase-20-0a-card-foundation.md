# Phase 20.0a カード定義基盤

## 実施内容

Phase 20のカード実装に先立ち、愚者を除く大アルカナ17種を、効果未実装のカード定義および既存アイテム定義として登録した。

この単位ではカードの使用・消費・自動発動・鑑定・封印・呪い・精錬・loot出現を実装していない。

## 型と定義

- `CardId`を17件のリテラルunionとして追加し、`ItemId`へ統合した。
- `CardDefinition`とカードregistryを`src/game/card-def.ts`へ追加した。
- `effectId`、`targetScope`、`consumeCondition`、`usableConditionId`は有限のunion型とした。
- `CardTelemetryCategory = 'card'`を追加し、`telemetryCategory`を無制限の`string`にしなかった。
- 17種を既存の`ITEM_DEFINITIONS`へ`consumable`、stack可能なitemとして登録した。
- カード固有情報はcard registryに置き、item定義との不要な二重管理を避けた。
- 未実装のeffect handlerやthrow専用のダミー処理は追加していない。

## 登録カード

- 仕様書でPhase 20.0aの対象とされた17種を登録した。
- 16種を`manual`、審判だけを`automatic`とした。
- 愚者は登録していない。
- 月の対象は`equipped_armor`、太陽の対象は`equipped_weapon`とした。
- 節制と星だけが選択対象を持つ。
- 審判だけを死亡保留時の自動定義とし、turn costを0とした。manualカードのturn costは1とした。
- 各ID、表示名、使用方式、対象、効果IDはカード仕様書との完全一致をテストしている。

## Inventory表示とlootの分離

- `ITEM_IDS_IN_ORDER`はInventory UIの表示対象および表示順を担うことを実コードから確認した。
- `CARD_IDS_IN_ORDER`を`ITEM_IDS_IN_ORDER`末尾へ展開し、所持数が1以上のカードを既存Inventory UIから表示・操作対象にできるようにした。
- 既存itemの相対順序は変更していない。
- 床loot候補である`GROUND_ITEM_POOL_FLOOR_1`、`GROUND_ITEM_POOL_FLOOR_2_ADDITIONS`、`GROUND_ITEM_POOL_FLOOR_3_ADDITIONS`にはカードを追加していない。
- 全カードの`lootWeight`は0、`floorDropEnabled`と`enemyDropEnabled`はfalseとした。
- Inventoryへ表示可能であることと、床・敵から出現可能であることを別の責務として維持した。

## 既存テストへの影響

`Inventory = Record<ItemId, number>`であるため、既存テスト30ファイルのInventoryリテラルへカード17キーを0で追加した。監査の結果、これら30ファイルにはカードキー追加以外の変更がなく、既存item値・fixture条件・assertionは変更していない。

`phase-15-4-random-ground-items.test.ts`では、`Object.keys(ITEM_DEFINITIONS)`の件数を床loot poolの全件数と同一視していた前提を除去した。床loot pool自体の長さおよび重複なしの検証は維持した。

## 検証結果

- Phase 20.0a対象テスト: 25件すべて成功
- 全テストスイート: 85ファイル、1978件すべて成功
- `npx tsc --noEmit`: 成功
- `npx vite build`: 成功
- `git diff --check`: 問題なし

最後のtelemetry category型補正は型定義とテストのみで、runtimeの値・分岐・処理は変更していない。そのため補正後は対象25件を再実行し、直前の全1978件成功結果を維持した。

## 維持事項

- `CURRENT_GAME_VERSION`: `phase-19`のまま
- `schemaVersion`: 7のまま
- `package.json`、`package-lock.json`: 無変更
- dependency追加なし

## 対象外

- カード効果処理
- カード使用コマンド、消費、ターン進行
- 審判の死亡時自動発動
- 未鑑定、鑑定、封印、呪い
- 装備個体化、`refineLevel`
- 対象選択UI
- floor別解禁、実loot weight、床落ち・敵ドロップ登録
- telemetry event送信
- schema migration
- カード画像・演出
- Phase 20.0b以降
