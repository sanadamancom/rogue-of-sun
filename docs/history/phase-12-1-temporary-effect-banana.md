# Phase 12.1 共通状態効果基盤とバナナによる一時攻撃力上昇

## 目的

Phase 11.3までに成立したターン制・戦闘数値・所持品・満腹度・フロア間状態維持を保ったまま、将来の毒・防御上昇・封印などを追加できる必要最小限の一時効果基盤を実装した。今回はこの共通基盤を実際のゲームプレイで検証するため、バナナを使用すると一定ターンだけ物理攻撃力が上昇する「攻撃力上昇」効果のみを追加した。毒・一般的な鈍足・暗闇・封印・SOL回復不能・敵への状態異常・状態異常耐性は今回実装していない。

## Phase 12を小区分へ分割した理由

タスク仕様が「共通基盤の実装」と「バナナという1つの具体的効果での検証」を明確に切り分けており、将来の毒・防御上昇等（Phase 12.2以降）を同時実装しないことをrestrictionsで明示していたため。基盤設計の妥当性を単一の具体例で先に確認してから拡張する方針。

## 開始時のrepository、branch、HEAD、working tree

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`
- HEAD: `ad5d9147fd373bdd6ca581db7d6f8bfa6e8b8065`
- working tree: clean

## baseline検証結果

- `npx tsc --noEmit`: 成功
- `npx vitest run`: 51テストファイル・1131件 全成功
- `npx vite build`: 成功

## 実装前のActor、GameState、ターン確定経路

- `Actor`（`types.ts`）は`slowed`/`petrified`のような専用bool一時状態フィールドを個別に持つ設計。プレイヤー・敵で共通のstats（attack/defense/accuracy/evasion等）を持つが、一時効果を汎用的に保持する仕組みは存在しなかった
- `GameState`はrun全体状態（inventory、equippedWeaponId、solarEnergy、hunger等）をoptionalフィールドとして持ち、`state.ts`の`CarryOverStats`/`buildFloorState`/`advanceToNextFloor`でフロア間の維持・新規初期化を管理するパターンが既に確立していた
- `processTurn`（`turn.ts`）の確定順序：`applyPlayerAction`（consumed判定）→（consumed時のみ）`resolveEnemiesAction`→`applyHungerProgression`（生存時）→playerDefeated確定→自然回復（生存時）→フロア到達判定→`turn`インクリメント→`expireWebs`→phase更新

## 実装前の物理ダメージ計算

- `combat.ts`の`computeAttackDamage(baseAttack, weaponBonus, defenderDefense)`が`max(1, baseAttack + weaponBonus - defenderDefense)`を返す純粋関数
- `turn.ts`の`applyPlayerAttackToEnemy`が唯一の呼び出し元で、素手・ソード・スピア・ハンマー（`resolveFacingAttack`経由）と太陽銃（`resolveSolarGunAttack`経由）の両方から共有される単一の攻撃解決関数だった

## 状態効果の状態所有

- `GameState`へ`activeEffects?: ActiveEffect[]`をoptionalフィールドとして追加（`discardConfirmItemId`と同じ前例に倣う。既存GameStateフィクスチャを壊さないため）
- map・terrain・fixture・groundItemへは一切保持していない
- `effects.ts`の各ヘルパーは`state.activeEffects ?? []`で読み取り、未設定でも安全に空配列として扱う

## 効果データの型と中央定義

- `types.ts`：`EffectId`（現在は`'attack_up'`のみ）、`ActiveEffect`（`id`/`strength`/`remainingTurns`）を追加
- `effects.ts`（新規モジュール、`web.ts`と同じ「専用モジュールとして分離」パターン）：
  - `EFFECT_DEFINITIONS`：id・displayName・strength・durationを一箇所に集約する唯一の定義元
  - `getActiveEffects`/`getActiveEffect`/`getEffectStrength`/`isEffectAtMaxDuration`：読み取り専用ヘルパー
  - `grantOrRefreshEffect`：付与または更新（強度は常に定義値で上書き、重複レコードを作らない）
  - `advanceEffectDurations`：全アクティブ効果を1減算し、0以下を除去、期限切れ`EffectId`一覧を返す
- ItemDefinition・戦闘処理・HUDのいずれにも数値を重複記述せず、すべて`EFFECT_DEFINITIONS`を参照する

## attack_upの強度、持続時間、重複規則

- strength: 5、duration: 20（成功ターン数）
- 未発生時に使用 → 新規付与、remainingTurns 20
- 残り1〜19で使用 → 強度はそのまま、remainingTurns 20へ更新（重複加算しない、レコードは常に1件のみ）
- 残り20（既に最大）で使用 → 失敗、何も変更しない

## バナナの定義、配置、使用条件

- `item-def.ts`：`banana`を`category: 'consumable'`、`glyph: '🍌'`として登録。`healAmount`/`solarAmount`/`hungerAmount`のいずれも持たず、`turn.ts`の`applyItemUse`が`itemId === 'banana'`を明示的に分岐して`applyBananaUse`へルーティングする（chocolateの`hungerAmount`分岐と同じ考え方）
- `ITEM_IDS_IN_ORDER`へ追加（一覧表示・取得対象に含まれる）
- `state.ts`：`buildFloorState`内でchocolateと同じパターン（毎フロア1個、既存の全アイテム位置を除外、`chooseGroundItemPosition`を再利用、独立した12番目のXOR定数`0x4c8d29f6`による専用RNGストリーム）で配置。既存の10個以上のRNGストリームの消費順序には一切影響しない
- 取得・所持上限20・置く・捨てるは既存の汎用機構（`item_picked_up`経路、`hasInventoryCapacity`、`applyPlaceItem`/`applyDiscardItem`）をそのまま再利用し、banana固有のコードは一切追加していない

## バナナ使用ターンを持続時間から除外する方法

`processTurn`内で`advanceEffectDurations`を呼ぶ直前に、`action.type === 'use_item' && action.itemId === 'banana' && consumed`を`isBananaGrant`として判定し、真の場合はその呼び出し自体をスキップする。`applyBananaUse`は成功時のみ`consumed: true`を返すため、この条件だけで「このターンにバナナ使用が成功したか」を一意に識別できる。これにより、`applyBananaUse`内で`remainingTurns`を20へ設定した直後、同じ`processTurn`呼び出し内で1減算されることがない。

## 成功・失敗・メニュー操作のターン境界

- `advanceEffectDurations`は`processTurn`内で消費ターンが確定した経路（`applyPlayerAction`が`consumed: true`を返した場合のみ到達するコードパス）に1箇所だけ接続。各`PlayerAction`種別へ個別に減算処理を複製していない
- 壁移動失敗、SOL不足の太陽銃攻撃、アイテム使用失敗（例：満HPでのリンゴ使用）、装備・置く・捨て失敗、所持品開閉・カーソル移動・確認開始・キャンセル、`face`アクションは、いずれも既存規則で`consumed: false`または`processTurn`冒頭のinventoryOpen guardで弾かれるため、`advanceEffectDurations`まで到達せず、残りターンは変化しない

## 素手・各近接武器への適用

- `turn.ts`に`getPlayerAttackUpBonus(state, weaponId)`を追加：`weaponId === 'solar_gun'`なら0、それ以外は`getEffectStrength(state, 'attack_up')`を返す
- `applyPlayerAttackToEnemy`内の`computeAttackDamage`呼び出しを`state.player.attack + getPlayerAttackUpBonus(state, weaponId)`へ変更。`Actor.attack`自体、`WeaponDefinition`のいずれも書き換えていない
- 命中判定（`computeHitChance`/`resolvesAsHit`）や`combatRngState`の消費順序には一切手を加えていない

## 太陽銃とソル追加ダメージを対象外にした処理

- `applyPlayerAttackToEnemy`は太陽銃の攻撃（`resolveSolarGunAttack`）とも共有される唯一の攻撃解決関数だったため、`getPlayerAttackUpBonus`内で`weaponId === 'solar_gun'`を明示的に除外することで、太陽銃のダメージ計算にattack_upが混入しないようにした
- ソル追加ダメージ（`SOL_ENCHANT_BONUS_DAMAGE`）は`baseDamage`確定後に加算される既存の別経路であり、attack_upの計算には一切関与しない（変更不要）

## フロア遷移、新規ラン、再挑戦

- `state.ts`の`CarryOverStats`へ`activeEffects: ActiveEffect[]`を追加。`advanceToNextFloor`で`state.activeEffects ?? []`をcarryへ渡す
- `buildFloorState`の返り値で`activeEffects: carry ? carry.activeEffects.map((effect) => ({ ...effect })) : []`とし、carryがある場合は各要素をコピー（次フロアの状態変更が前フロアのcarryオブジェクトへ波及しないように新規配列・新規オブジェクトとして生成）
- carryがない場合（新規ラン・`createInitialState`）は常に空配列で開始
- 死亡後再挑戦（同一`runSeed`での`createInitialState`呼び出し）も同様に空配列で開始される

## HUD表示

- `main.ts`へ`effectsHudLabel()`メソッドを追加。アクティブな効果がなければ空文字列（表示セグメントなし）、あれば`"   効果: 攻撃↑ +5 (20)"`形式の文字列を返す
- 既存の1行構成のHUDテキスト（`FLOOR ... HP ... SOL ... 満腹度 ... ENCHANT ...`）の末尾、`Turn:`表示の直前へ`${this.effectsHudLabel()}`として挿入。既存のFLOOR/HP/SOL/満腹度/Turn表示は削除・変更していない
- 内部ID`attack_up`をそのまま表示せず、`EFFECT_DEFINITIONS`の`displayName`（攻撃力上昇）とは別に、HUD用の短縮ラベル「攻撃↑」を`effectsHudLabel`内で組み立てている

## イベントとメッセージ

- `events.ts`へ`effect_granted`/`effect_refreshed`/`effect_expired`/`banana_use_failed`を追加
- `message-log.ts`へ対応する日本語メッセージのcaseを追加（バナナを使用し攻撃力が5上がったこと／効果を更新して残り20ターンになったこと／攻撃力上昇が切れたこと／すでに最大時間有効で使用できないこと）
- `telemetry.ts`の`translateGameEvent`は既存の非網羅的`switch`＋`default`（他の未知カテゴリと同様に無視するcatch-all）を持つため、新規イベント追加によるtelemetryスキーマへの影響はない。`telemetrySchemaVersion`は3のまま変更していない
- 効果継続中の毎ターンメッセージは出さず、grant/refresh/expire/use_failedそれぞれ1回のみイベントを発行する

## 決定性と乱数

- バナナ配置は専用の独立したXOR定数（`0x4c8d29f6`）によるRNGストリームを使用し、既存のmap・placement・species・item配置RNGの消費順序を一切変更していない
- 状態効果の付与・更新・減算（`grantOrRefreshEffect`/`advanceEffectDurations`）はいずれも乱数を使用しない純粋な配列操作
- バナナ使用失敗時は効果・所持数・ターン・満腹度・敵・環境・乱数状態（`combatRngState`含む）を一切変更しない

## slowed、petrifiedを移行しなかったこと

- `Actor.slowed`/`Actor.petrified`は既存のまま変更・改名・削除していない。spider webによる次move失敗・1ターン消費、cockatriceの次有効行動の強制skipという挙動もそのまま維持されている
- 一時効果の汎用基盤（`activeEffects`/`effects.ts`）への統合は行わず、slowed/petrifiedは引き続き専用のActorフィールドとして独立している

## 変更ファイル

- `src/game/types.ts`：`EffectId`/`ActiveEffect`型、`GameState.activeEffects`、`ItemId`へ`'banana'`追加
- `src/game/effects.ts`（新規）：状態効果の中央定義・操作関数
- `src/game/item-def.ts`：`banana`の`ItemDefinition`、`ITEM_IDS_IN_ORDER`への追加
- `src/game/events.ts`：`effect_granted`/`effect_refreshed`/`effect_expired`/`banana_use_failed`イベント型追加
- `src/game/message-log.ts`：上記イベントの日本語メッセージ追加
- `src/game/turn.ts`：`getPlayerAttackUpBonus`追加、`applyPlayerAttackToEnemy`のダメージ計算修正、`applyBananaUse`追加、`applyItemUse`へのbanana分岐追加、`processTurn`への`advanceEffectDurations`呼び出し追加
- `src/game/state.ts`：`CarryOverStats.activeEffects`追加、`buildFloorState`のbanana配置ブロックとactiveEffects返却、`advanceToNextFloor`のcarry構築
- `src/main.ts`：`effectsHudLabel()`追加、HUDテキストへの組み込み
- `src/game/__tests__/phase-12-1-temporary-effect-banana.test.ts`（新規）：Phase 12.1の全required_testsカテゴリを網羅するテスト
- `src/game/__tests__/armor-and-golem.test.ts`ほか17テストファイル：`Inventory`型が`banana`キーを必須とするようになったことに伴う既存インラインinventoryリテラルへの`banana: 0`追加（値は常に0、既存テストの意図・アサーションは一切変更していない）

## 追加・更新したテスト

`phase-12-1-temporary-effect-banana.test.ts`（45件、新規）：
- effects.ts中央定義・ヘルパーの単体テスト（定義値、absent時のフォールバック、grant/refresh、advance）
- banana定義・配置（登録内容、毎フロア1個、到達可能床、重複なし、決定性、既存アイテムへの非干渉、拾得）
- banana使用（新規付与、更新、最大時失敗、複数レコード非生成、失敗時の無変化・乱数不変）
- attack_up攻撃力ボーナス（素手/ソード/スピア/ハンマーの計算例、太陽銃除外、ソルエンチャント非干渉、最低ダメージ1維持、Actor.attack不変）
- 持続ターン進行（move/wait成功で-1、失敗系操作で不変、19回後に残1、20回目に適用後解除、複数回減らないこと、乱数不変）
- ライフサイクル（新規ラン空、フロア遷移維持、コピー独立性、フロア移動時に0になった効果を持ち越さないこと）

既存17テストファイルへの`banana: 0`追加はテスト内容・アサーションの変更ではなく、`Inventory`型の完全性維持のための機械的な追加のみ。

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：52テストファイル・1176件（既存1131件＋新規45件）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 所持上限20を変更していないこと

`INVENTORY_CAPACITY`（`inventory.ts`）は変更していない。banana追加によりInventory型のキーが1つ増えたのみで、合計上限のロジック（`totalInventoryCount`）自体は変更していない。

## 既存アイテム効果を変更していないこと

apple（HP+20）、太陽の実（SOL+2）、チョコレート（満腹度+30）のいずれの`ItemDefinition`も値・処理を変更していない。

## 満腹度・飢餓・自然回復を変更していないこと

`hunger.ts`の`HUNGER_MAX`/`HUNGER_DECREASE_INTERVAL`/`STARVATION_INTERVAL`/`STARVATION_DAMAGE`、`turn.ts`の`REGEN_TURNS_PER_HP`および自然回復ロジックは一切変更していない。

## telemetry schemaVersionを変更していないこと

`telemetry.ts`の`telemetrySchemaVersion`は3のまま。既存の非網羅的switch＋default構造により、新規イベント型の追加はtelemetryへ影響しない。

## Phase 12.2以降を開始していないこと

毒・防御力上昇・一般的な鈍足・暗闇・封印・SOL回復不能・敵への状態効果・状態異常耐性・睡眠麻痺混乱のいずれも実装していない。`effects.ts`の`EffectId`型は`'attack_up'`のみを含む。

## Claudeが判断した実装詳細と理由

- **バナナ使用ターンのスキップ判定方法**：`applyPlayerAction`/`applyBananaUse`の戻り値型に新規フィールドを追加せず、`action.type === 'use_item' && action.itemId === 'banana' && consumed`という既存の戻り値のみから判定する方式を採用した。`applyBananaUse`は成功時のみ`consumed: true`を返す設計のため、これだけで一意に識別できると判断し、戻り値型の拡張という影響範囲の広い変更を避けた
- **HUDの「攻撃↑」表記**：`EFFECT_DEFINITIONS.attack_up.displayName`（「攻撃力上昇」）とは別に、HUD専用の短縮矢印表記を`main.ts`側でハードコードした。フルネームだと横幅が既存HUDの1行構成を圧迫すると判断し、要求仕様の表示例「効果: 攻撃↑ +5 (20)」をそのまま踏襲した
- **effect_expiredイベントの発行タイミング**：`advanceEffectDurations`が返す期限切れid配列をループしてイベントを1つずつ`processTurn`側でpushする設計にし、`effects.ts`側はイベント生成の責務を持たない（純粋なデータ操作のみ）ようにした。将来複数の効果が同時に切れるケースにも自然に対応できる
- **RNGストリーム定数**：banana配置に`0x4c8d29f6`を新規採番。既存の11個の定数（placement/species/apple/sword/armor/spear/hammer/sun_fruit/solar_gun/sol_enchantment/chocolate）と重複しないことを確認済み

## 未確認事項

- HUD表示（`effectsHudLabel`、`refreshStaticView`への組み込み）はPhaser実行時の見た目としては自動テスト対象外（既存main.tsコードも同様にvitest対象外）。手動プレイでの目視確認は行っていない
- 実プレイでのバランス（攻撃力上昇+5・持続20ターンが妥当か）はタスク仕様の固定値をそのまま採用したのみで、実プレイテレメトリによる検証は未実施
