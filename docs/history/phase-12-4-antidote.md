# Phase 12.4 毒消し草と状態効果の明示解除

## 目的

新しい消耗品「毒消し草」（antidote）を追加する。poison状態のプレイヤーが使用すると、poisonだけを即座に完全解除し、毒消し草を1個消費して1成功ターンを進行させる。poisonでない状態では使用を失敗させ、アイテム・ターン・満腹度・他の効果を一切変化させない。あわせて、効果の自然終了（残りターン0）とは区別された状態効果の明示解除経路をactiveEffects基盤へ追加する。

## Phase 12.4に毒消し草を選んだ理由

タスク仕様で明示的に指定された内容。Phase 12.3で追加したpoisonに対する解毒手段を用意することで、「一時効果は付与・自然終了だけでなく、プレイヤーの能動的な操作でも解除できる」という状態効果基盤の汎用性を検証する狙いがある。

## 毒の数値調整を保留した理由

タスク仕様の`phase_policy.poison_balance`が明示的に「poisonの強度3・持続10成功ターンを変更しない」「毒の最終的な数値調整は後のバランス調整フェーズで行う」としているため。今回の目的は解毒手段と効果解除基盤という仕組み自体の成立確認であり、数値バランスの検証・調整は対象外とした。

## 開始時のrepository、branch、HEAD、working tree

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`
- HEAD: `4068d43b2a9f73f635fd928a8f947669b8e9ab1d`
- working tree: clean

## baseline検証結果

- `npx tsc --noEmit`: 成功
- `npx vitest run`: 54テストファイル・1261件 全成功
- `npx vite build`: 成功

## 既存のアイテム使用、activeEffects、poison tick

- `turn.ts`の`applyItemUse`は`itemId`による明示的な分岐（banana→`applyBananaUse`、hungerAmount設定あり→`applyChocolateUse`、healAmount/solarAmountの汎用分岐）で個別の使用効果を実装するパターンが確立している
- `effects.ts`は`getActiveEffects`/`getActiveEffect`/`getEffectStrength`/`isEffectAtMaxDuration`/`grantOrRefreshEffect`/`advanceEffectDurations`の6関数のみで構成され、**明示的な削除専用API（自然減衰以外での除去）は存在しなかった**
- `applyPoisonTick`（Phase 12.3）は`getEffectStrength(state, 'poison')`を読んで0以下なら即座にreturnする設計であり、poisonがactiveEffects配列に存在しなければ何もしない

## TrapTypeとTrapTileの拡張

（本フェーズでは変更なし。Phase 12.3の`TrapType`/`TrapTile`をそのまま利用）

## antidoteのItemIdとItemDefinition

- `types.ts`の`ItemId`へ`'antidote'`を追加
- `item-def.ts`の`ITEM_DEFINITIONS`へ`antidote: { id: 'antidote', displayName: '毒消し草', glyph: '🌿', category: 'consumable', consumable: true, stackable: true }`を追加。`healAmount`/`solarAmount`/`hungerAmount`のいずれも持たず、`applyItemUse`が`itemId === 'antidote'`を明示的に分岐して`applyAntidoteUse`へルーティングする（banana/chocolateと同じ設計）
- `ITEM_IDS_IN_ORDER`へ`banana`の直後に追加（既存の表示順を維持し、末尾へ追加するという指示どおり）
- 新しいアイテムカテゴリ（`category`の新規値）や新しい画像読み込み機構は追加していない（既存の`'consumable'`カテゴリと絵文字glyph表示をそのまま再利用）

## 配置条件と専用RNG

- `mapgen.ts`へ`chooseRoomFloorPosition(map, rooms, exclude, rng): Vec2 | null`を新設した。当初は既存の`chooseGroundItemPosition`（通路も含む全床タイルが対象、候補なしで例外を投げる）を再利用しようとしたが、antidoteの配置要件「壁、通路、部屋入口、出口へ配置しない」「候補がない場合は配置なしを許可し、例外を投げない」が`chooseGroundItemPosition`の挙動（通路を許容し、例外を投げる）と一致しないことに気づき、専用関数を新設する判断をした
- 既存の`chooseTrapPosition`（部屋内限定、例外を投げない）を流用する案も検討したが、`chooseTrapPosition`は開始地点から距離4以上・出口から距離2以上という罠専用の最小距離制約をハードコードしており、antidoteの配置要件にはこの制約が存在しない（`placement.restrictions`の「poison_trapより手前に必ず配置する保証を追加しない」等、距離制約自体を要求していない）ため、これをそのまま流用すると仕様より過度に配置候補を狭めてしまう。そのため`chooseTrapPosition`から距離制約部分を除いた`chooseRoomFloorPosition`を新設した
- `state.ts`の`buildFloorState`で、poison_trap配置ブロックの直後にantidote配置ブロックを追加。専用RNGストリーム（15番目のXOR定数`0x6d5a91e7`、既存14個のいずれとも重複しないことを確認済み）を使用

## 既存配置への非干渉

antidote配置は既存の全配置処理（map生成、start/exit/敵配置、apple/sword/armor/spear/hammer/sun_fruit/solar_gun/sol_enchantment/chocolate/banana配置、slow_trap/poison_trap配置）が完了した後に実行され、専用の独立したRNGストリームのみを消費する。テストで同一seedでの既存配置結果・`combatRngState`が変化しないことを確認済み。

## 拾得、所持上限、スタック、置く、捨てる

既存の`GroundItem`/`Inventory`/`hasInventoryCapacity`/`applyPlaceItem`/`applyDiscardItem`をそのまま再利用しており、antidote固有のコードは一切追加していない。自動拾得・所持上限20・スタック・置く・捨てるのいずれも既存の汎用機構がそのまま機能する。フロア遷移では`CarryOverStats.inventory`経由で維持され、新規ラン・死亡後再挑戦では`createEmptyInventory()`により0へ戻る。

## 効果解除共通関数

`effects.ts`へ`removeEffect(state: GameState, id: EffectId): 'removed' | 'not_present'`を新設した。`state.activeEffects`から指定した`id`に一致する全レコードを削除し（同一IDのレコードが不正に複数存在していても全て削除する防御的な設計）、対象が存在したかどうかを戻り値で判別できる。`turn.ts`から`state.activeEffects`配列を直接splice/filterすることは一切なく、削除操作はこの関数に一元化した（`implementation_policy`の「効果解除処理はeffects.ts内の共通関数へ集約する」）。

## effect_expiredとeffect_removedの区別

`advanceEffectDurations`（残りターン0による自然終了）と`removeEffect`（明示的な即時解除）は完全に別の関数として維持し、どちらのイベントを発行するかは呼び出し元（`turn.ts`）の責務とした。`removeEffect`自体はイベントを一切発行しない（`effects.ts`はあくまで状態操作のみを担当し、どのイベント・メッセージを出すかを知らない設計は既存の`grantOrRefreshEffect`/`advanceEffectDurations`と一貫している）。`applyAntidoteUse`が明示的に`effect_removed`（`reason: 'antidote'`）を1回だけpushし、`effect_expired`を偽装して発行することはない。

## 成功使用と失敗使用

- **成功条件**：`inventory.antidote >= 1`かつ`poison`が有効
- **成功結果**：`removeEffect(state, 'poison')`でpoisonを即座に完全解除→`inventory.antidote`を1減算→`antidote_used`（`itemId`, `removedEffectId: 'poison'`）と`effect_removed`（`effectId: 'poison'`, `reason: 'antidote'`）を各1回発行→`inventoryOpen = false`→1ターン消費
- **失敗条件（poison未発動）**：`antidote_use_failed`（`itemId`, `reason: 'not_poisoned'`）を発行→`consumed: false`即返却。アイテム・ターン・inventory overlay・他の効果のいずれも変化しない
- **失敗条件（所持数0）**：既存の`owned <= 0`ガード（`item_unavailable`相当の無言no-op、他アイテムと同一パターン）で`consumed: false`を返す

## 毒消し草使用ターンの処理順

`applyPlayerAction`（antidote使用解決：poison即時削除・在庫減算・イベント発行）→`resolveEnemiesAction`（通常1回のみ。`use_item`は`move`アクションではないため、movement_slowが有効であっても追加敵フェーズの対象にならない——`actualMoveHappened`の判定が`action.type === 'move'`を前提にしているため自然に除外される）→`applyHungerProgression`（生存時）→`applyPoisonTick`→`playerDefeated`確定→自然回復（生存時）→`advanceEffectDurations`（attack_up/movement_slowは通常どおり1減算）→通常のターン確定処理

## poison tickを防止した方法

`applyPoisonTick`は`getEffectStrength(state, 'poison')`を読み、0以下なら即座に処理を終える設計（Phase 12.3で既に実装済み）。`applyAntidoteUse`が`resolveEnemiesAction`より前の`applyPlayerAction`内でpoisonを`state.activeEffects`から完全に削除するため、その後`applyPoisonTick`が呼ばれる時点ではpoisonは既に存在せず、`getEffectStrength`が自然に0を返す。これにより、slow_trap/poison_trapの発動ターンで必要だった`skipThisTurn`のような専用フラグを一切追加せずに「使用ターンには毒ダメージを受けない」を実現できた。残り1のpoisonを解除した場合も同様に、削除が先に完了しているため最後のダメージは発生しない。

## attack_up、movement_slow、蜘蛛の糸、石化との互換

- `advanceEffectDurations`の呼び出しは変更しておらず、antidote使用ターンでも`skipIds`は空（poisonは既に配列から消えているため、そもそも減算対象にならない）。attack_up・movement_slowは他の通常アクションと同様に1減算される
- `removeEffect`は`id: EffectId`で厳密に指定した効果のみを削除するため、attack_up・movement_slowを誤って削除することはない
- `Actor.slowed`（蜘蛛の糸）・`Actor.petrified`（石化）はいずれも`applyAntidoteUse`が一切参照・変更しない。石化中に`use_item`アクションを送っても、`applyPlayerAction`冒頭のpetrified最優先チェックが従来どおり先に処理されるため、antidote使用ロジックへは到達しない

## HUD、イベント、メッセージ

- **HUD**：`main.ts`の`effectsHudLabel()`は`getActiveEffects`から汎用的に取得するため、`removeEffect`でpoisonが配列から消えた次の描画で自動的にHUD表示から消える。専用コードの追加は不要だった
- **イベント**：`events.ts`へ`antidote_used`（`itemId`, `removedEffectId`）・`antidote_use_failed`（`itemId`, `reason: 'not_poisoned'`）・`effect_removed`（`effectId`, `reason: 'antidote'`）を追加
- **メッセージ**：`message-log.ts`へ「毒消し草を使った。」（antidote_used）・「今は毒に侵されていない。」（antidote_use_failed）・「毒が消えた。」（effect_removed、`effectId === 'poison'`時）を追加。成功時に既存の`poison_expired`用文言（「毒が抜けた。」）は使用していない

## telemetryのitem_used記録

`translateGameEvent`へ`antidote_used`のcaseを追加し、既存の`item_used`（`itemId`, `effect: string`, `amount: number`）へ`effect: 'poison_cure'`, `amount: 1`として記録する。`amount`は削除した効果レコード数ではなく「解除成功を表す1」という固定値（タスク仕様どおり）。失敗（`antidote_use_failed`）は`default`分岐（未翻訳）に落ちるため、`item_used`として記録されない——これにより「not_poisonedによる失敗を成功したitem_usedとして記録しない」が自動的に満たされる。`computeRunSummary`の`itemsUsedByType`集計は`item_used`イベントを汎用的に処理する既存コードのため、antidote追加による変更は不要だった。

## schemaVersion 4を維持した理由

今回追加した`antidote_used`は既存の`item_used`（`effect: string`という既に拡張可能な設計のフィールド）へ新しい文字列値（`'poison_cure'`）を追加しただけであり、フィールドの型・意味を変更していない。`effect_removed`・`antidote_use_failed`は新規イベント型だが、`telemetry.ts`の`translateGameEvent`は既存の非網羅的switch＋catch-all defaultのため、これらを翻訳対象に含めなくても型エラーにならず、telemetryスキーマへの影響がない。既存のdamageTaken集計・damageTakenByEnemy・endCause判定ロジックにも一切変更を加えていない。以上より「新しいダメージ源や既存集計の意味変更」に該当しないと判断し、schemaVersionは4のまま維持した。

## 決定性と乱数

antidote配置は専用の独立したXOR定数（`0x6d5a91e7`）によるRNGストリームを使用し、既存のmap・placement・species・item・両罠配置RNGの消費順序を一切変更していない。拾得・使用・解除（`removeEffect`含む）はいずれも乱数を使用しない純粋な状態操作。

## 変更ファイル

- `src/game/types.ts`：`ItemId`へ`'antidote'`追加
- `src/game/item-def.ts`：`antidote`の`ItemDefinition`、`ITEM_IDS_IN_ORDER`への追加
- `src/game/effects.ts`：`removeEffect`共通関数追加
- `src/game/events.ts`：`antidote_used`/`antidote_use_failed`/`effect_removed`イベント追加
- `src/game/message-log.ts`：antidote用メッセージ追加
- `src/game/mapgen.ts`：`chooseRoomFloorPosition`関数新設
- `src/game/state.ts`：`buildFloorState`へantidote配置ブロック追加
- `src/game/turn.ts`：`applyItemUse`へantidote分岐追加、`applyAntidoteUse`関数新設
- `src/game/telemetry.ts`：`antidote_used`のitem_used変換処理追加
- `src/game/__tests__/phase-12-4-antidote.test.ts`（新規）：Phase 12.4の全required_testsカテゴリを網羅するテスト
- `src/game/__tests__/armor-and-golem.test.ts`ほか19テストファイル：`Inventory`型が`antidote`キーを必須とするようになったことに伴う既存インラインinventoryリテラルへの`antidote: 0`追加（値は常に0、既存テストの意図・アサーションは一切変更していない）

## 追加・更新テスト

`phase-12-4-antidote.test.ts`（42件、新規）：
- antidote登録（ItemId/ITEM_DEFINITIONS/ITEM_IDS_IN_ORDER、createEmptyInventory、表示順、既存定義の非変更）
- antidote配置（各1個以下、部屋床、非重複、決定性、既存配置への非干渉）
- 拾得・所持（自動拾得、スタック、所持上限、置く、捨てる、フロア間維持、新規ラン初期化）
- `removeEffect`共通API（対象効果のみ削除、他効果への非干渉、not_present判別、不正な複数レコードの全削除、自然終了との区別、absentフィールドの安全な扱い）
- 成功使用（在庫減算、poison即時解除、イベント各1回、1ターン消費、毒ダメージなし、残り1でも最後のダメージなし、HP不変、attack_up/movement_slow通常減算、蜘蛛の糸/石化非解除、敵行動・満腹度・自然回復・効果減算が最大1回）
- 失敗使用（poisonなしで失敗、非消費、非消費ターン、overlay非クローズ、敵行動等の非発生、所持数0での無変化）
- 互換性（poison数値不変、poison_trap/slow_trap発動ターン規則不変、attack_up数値不変、既存消耗品規則不変、物理ダメージ計算不変）

既存19テストファイルへの`antidote: 0`追加はテスト内容・アサーションの変更ではなく、`Inventory`型の完全性維持のための機械的な追加のみ。

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：55テストファイル・1303件（既存1261件＋新規42件）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 既存ゲームバランス値を変更していないこと

poisonの強度3・持続10、attack_up（強度5・持続20）、movement_slow（強度1・持続10）、slow_trap/poison_trapの配置数・条件、所持上限20、満腹度・飢餓・自然回復の数値、プレイヤー・敵の能力値、武器・防具・命中率・回避率・ソル、蜘蛛の糸・石化の既存挙動、フロア生成アルゴリズムはいずれも変更していない。

## Phase 12.5以降を開始していないこと

万能薬・複数状態解除・状態異常耐性、敵への毒消し草使用・毒付与、罠の発見・解除・可視化、睡眠・麻痺・混乱・暗闇・封印、経験値・レベルアップ・能力割り振りのいずれも実装していない。HP回復を毒消し草へ追加しておらず、attack_up・movement_slow・蜘蛛の糸・石化のいずれも解除しない。

## Claudeが判断した実装詳細と理由

- **効果解除共通関数の型と配置**：`effects.ts`へ`removeEffect(state, id): 'removed' | 'not_present'`として追加した。既存の`grantOrRefreshEffect`が`'granted' | 'refreshed'`という判別可能なリテラル型を返す設計だったため、同じ思想を踏襲し、呼び出し元が対象の有無を型安全に判別できるようにした
- **effect_expiredとeffect_removedを分けた方法**：どちらのイベントを発行するかを`effects.ts`側では一切判断させず、常に呼び出し元（`turn.ts`）が明示的にpushする設計にした。`removeEffect`自体はイベントを発行しない純粋な状態操作関数とすることで、「なぜ効果が終了したか」という文脈情報を持たない`effects.ts`が誤った種類のイベントを発行してしまうリスクを構造的に排除した
- **毒消し草使用ターンに毒tickが発生しない理由**：新たな`skipThisTurn`的フラグを追加せず、「poisonの削除を敵行動フェーズより前に完了させる」という順序だけで自然に実現した。Phase 12.3のslow_trap/poison_trap発動ターンでは効果がその場で新規付与されるため専用フラグが必要だったが、antidoteの場合は逆に効果を消す操作のため、`applyPoisonTick`の既存の「現在アクティブでなければ即return」という設計にそのまま乗せられると判断した
- **antidote用RNGを既存乱数順から分離した方法**：banana/slow_trap/poison_trapと同じパターンで、フロアseedに新規の固有XOR定数をXORした専用`createRng`ストリームを使用した
- **antidote配置関数を既存関数へ統合するかの判断**：`chooseGroundItemPosition`（通路許容・例外あり）、`chooseTrapPosition`（部屋限定・距離制約あり・例外なし）のいずれもantidoteの実際の要件と完全には一致しなかったため、`chooseTrapPosition`から距離制約部分だけを除いた新規関数`chooseRoomFloorPosition`を追加する判断をした。既存2関数のいずれかを無理に流用して仕様を歪めるより、要件に正確に合致する薄い専用関数を追加する方が安全と判断した

## 未確認事項

- タスク仕様の`manual_verification_notes`が要求する以下の項目は、Claude側でブラウザを目視できないため未確認：
  - 毒の罠を踏んでHUDに毒が表示されること
  - 所持中の毒消し草を使用できること
  - 使用直後にHUDの毒表示が消えること
  - 使用ターンに毒ダメージが発生しないこと
  - 毒でないときは使用できず、所持数が減らないこと
  - 毒消し草の地面表示とinventory表示が識別できること
  - これらはいずれも自動テスト（`phase-12-4-antidote.test.ts`）でロジックレベルの検証は行ったが、実際のブラウザ描画・操作感の確認はユーザー側での確認待ちとする
- `applyDiscardItem`は単発アクションであり、`discardConfirmItemId`による確認プロンプトはmain.ts側のUI層の関心事であることをテスト作成中に確認した（当初の想定と異なっていたため、テストを実際の仕様に合わせて修正した）
