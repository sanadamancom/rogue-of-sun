# Phase 12.3 毒の罠と継続ダメージ効果

## 目的

既存の鈍足の罠（slow_trap）を維持したまま、各フロアへ決定的に最大1個の「毒の罠」（poison_trap）を追加する。プレイヤーが踏むとpoison（強度3・持続10成功ターン）が付与され、発動ターンの次から成功ターンごとに防御無視の3ダメージ（実HP減少量を記録）を受ける。毒によるダメージ・死亡・死因・総被ダメージをゲームイベントとtelemetryへ正確に記録し、telemetry schemaVersionを4へ更新する。

## Phase 12.3に毒を選んだ理由

タスク仕様で明示的に指定された内容であり、Phase 12.1のactiveEffects基盤・Phase 12.2の罠fixture機構を最小拡張で再利用できる具体例として選定されている。既存のslow_trap/movement_slowと役割が異なる「継続ダメージ」という新しいカテゴリの効果を検証することで、活性効果基盤とtrap機構の両方の汎用性を確認する狙いがある。

## 開始時のrepository、branch、HEAD、working tree

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`
- HEAD: `2623cc867e6137d60bef101e491d39782b490009`
- working tree: clean

## baseline検証結果

- `npx tsc --noEmit`: 成功
- `npx vitest run`: 53テストファイル・1221件 全成功
- `npx vite build`: 成功

## 既存の罠、activeEffects、ターン処理

- Phase 12.2時点の`TrapTile`は`{ id, pos, triggered }`のみで罠種別フィールドを持たず、`turn.ts`のmove成功分岐内で無条件にmovement_slowを付与するハードコード実装だった
- `processTurn`内の`trapTriggeredThisAction`判定も「どの罠でも発動していればtrue」という罠種別を区別しない判定になっており、これがmovement_slowの減算スキップと追加敵フェーズ抑制の両方に流用されていた
- `processTurn`の確定順序：`applyPlayerAction`→敵フェーズ(1回目)→（条件成立時のみ）敵フェーズ(2回目)→`applyHungerProgression`(生存時)→`playerDefeated`確定→自然回復(生存時)→`advanceEffectDurations`→フロア判定

## TrapTypeとTrapTileの拡張

- `types.ts`へ`TrapType = 'slow_trap' | 'poison_trap'`を新設し、`TrapTile`へ`trapType: TrapType`フィールドを追加（必須フィールドとして追加したため、既存Phase 12.2テストのインラインfixtureへ`trapType: 'slow_trap'`をsedで機械的に追加した）
- 罠種別は位置や配列順から推測せず、必ず`trapType`フィールドを明示的に参照する設計とした
- slow_trapとpoison_trapは同一の`GameState.traps`配列を共有し、別配列は作らない（`implementation_policy`の明示的禁止事項）

## slow_trapの後方互換

- move成功分岐の罠発動ロジックを`trapType`に基づく汎用ループへ書き換えたが、`trapType === 'slow_trap'`のときは従来どおり`movement_slow`のみを付与し、強度・持続・イベント内容はPhase 12.2から一切変更していない
- 既存のPhase 12.2テストファイル（`phase-12-2-slow-trap.test.ts`）は`trapType`追加以外のロジック変更を必要とせず、45件全てが無修正で通過（配置数アサーションのみ、poison_trapとの共存を反映して「slow_trap個数」に限定する形へ1件更新）

## poison_trapの配置条件と専用RNG

- `mapgen.ts`の`chooseTrapPosition`へ`minDistanceFrom?: { pos: Vec2; distance: number }`のオプション引数を追加（既存呼び出しへは影響しない後方互換な拡張）
- `state.ts`の`buildFloorState`で、slow_trap配置ブロックの直後にpoison_trap配置ブロックを追加。専用RNGストリーム（14番目のXOR定数`0x3f9c5e82`、既存13個のいずれとも重複しないことを確認済み）を使用し、既存の全乱数消費順序に影響しない

## 別部屋優先とfallback

- `mapgen.ts`へ`roomIndexContaining(rooms, pos): number`ヘルパーを新設し、座標がどの部屋の矩形に属するか判定できるようにした
- poison_trap配置は以下の2段階：
  1. slow_trapが配置されていればその部屋のインデックスを求め、`map.rooms`からその部屋を除外したリストで`chooseTrapPosition`を呼ぶ（別部屋優先）
  2. 1で候補が見つからなかった場合のみ、全部屋を対象に`minDistanceFrom: { pos: slowTrapPos, distance: 3 }`を付けて再度`chooseTrapPosition`を呼ぶ（同室内フォールバック、slow_trapから距離3以上を強制）
- `chooseTrapPosition`は候補が0件の場合にのみrng()を消費しない設計のため、1段階目が失敗しても2段階目の抽選が同一rngストリームの継続として決定的に振る舞う

## 未発動・発動済みの描画

- `main.ts`の`drawTraps()`をtrapType別分岐へ拡張。slow_trapの既存表示（オレンジ色の円＋X字）は変更せず、poison_trapは紫色（`0x9b4dca`）のひし形＋中心の点という新規図形を追加した
- 未発動の罠はいずれの種別でも一切描画しない（通常床と完全に同じ表示）

## poisonの強度、持続、更新規則

- `effects.ts`の`EFFECT_DEFINITIONS`へ`poison: { id: 'poison', displayName: '毒', strength: 3, duration: 10 }`を追加
- 付与・更新は既存の`grantOrRefreshEffect`をそのまま再利用（重複加算せず、既存インスタンスがあれば残りターンを10へ更新するのみ）

## 罠発動ターンを対象外にした方法

- `processTurn`内の`trapTriggeredThisAction`を`slowTrapTriggeredThisAction`と`poisonTrapTriggeredThisAction`の2つに分離した（trapType別にフィルタしてから判定）
- `slowTrapTriggeredThisAction`は追加敵フェーズの抑制条件でのみ使用し、`poisonTrapTriggeredThisAction`はpoisonの毒tick抑制と`advanceEffectDurations`の`skipIds`（poison限定）でのみ使用する。これにより「poison_trap発動時に誤ってmovement_slowの追加敵フェーズまで抑制してしまう」という既存コードの不備（`trap_trigger_interactions.movement_slow`が指摘した「現在のany trap triggered判定」の問題）を修正した

## poisonダメージの実装位置と処理順

- `applyPoisonTick(state, events, skipThisTurn)`関数を新規実装し、`processTurn`内の`applyHungerProgression`呼び出し直後・`playerDefeated`確定より前の1箇所にのみ接続した
- `skipThisTurn`には`poisonTrapTriggeredThisAction`を渡し、poison_trapが発動したこのターンだけダメージ・減算のいずれも発生させない（新規付与・既存poisonの更新の両ケースで同様に抑制される）
- 生存かつHP1以上の場合のみ、`getEffectStrength(state, 'poison')`を読んで`actualDamage = min(strength, hp)`を計算し、`Math.max(0, hp - actualDamage)`でHPを更新。HPが0になった場合は`player.alive = false`とする（既存の敵攻撃・飢餓ダメージと同じパターン）
- `Actor.defense`・防具・命中率・回避率は一切参照せず、乱数も使用しない純粋な計算

## 敵行動、飢餓、自然回復、効果減算との順序

最終的な確定順序：`applyPlayerAction`→敵フェーズ(1回目)→（movement_slowが行動前から有効かつslow_trap発動でない場合のみ）敵フェーズ(2回目)→`applyHungerProgression`(生存時)→`applyPoisonTick`(poison_trap発動ターンのみskip)→`playerDefeated`確定→自然回復(生存時)→`advanceEffectDurations`(banana/slow_trap/poison_trap発動ターンに応じたeffect単位skipIds)→フロア判定。満腹度・自然回復・効果減算はいずれも1箇所のみで実行され、追加敵フェーズの有無に関わらず二重実行されない。

## movement_slowとの同時処理

- poison_trapの発動判定（`poisonTrapTriggeredThisAction`）は追加敵フェーズの可否判定から完全に切り離したため、movement_slowが既に有効な状態でpoison_trapを踏んでも、その移動でmovement_slowの追加敵フェーズは通常どおり発生する
- 逆にslow_trapの発動判定（`slowTrapTriggeredThisAction`）は既存どおり追加敵フェーズを抑制し、poisonの毒tickには一切影響しない（既存poisonがあれば通常どおりダメージと減算が発生する）

## 蜘蛛の糸、石化、attack_upとの互換

- 蜘蛛の糸による移動失敗（`slowed_move_cancelled`）・石化による強制スキップ（`player_petrified_skip`）は、いずれも既存規則どおり「1ターン消費する成功ターン」として扱われるため、`applyPoisonTick`は通常どおり発火する（trap発動を伴わないため`skipThisTurn`は常にfalse）
- attack_upの物理ダメージ計算（`getPlayerAttackUpBonus`）はpoisonを一切参照せず、既存のダメージ値は変化しない
- attack_up・movement_slow・poisonの3効果を`state.activeEffects`に同時保持可能。`advanceEffectDurations`の`skipIds`は各trap発動ターンごとに対応する効果IDのみを含めるため、他の2効果は通常どおり毎ターン1減算される

## HUD、イベント、メッセージ

- `main.ts`の`effectsHudLabel()`へpoison専用分岐を追加：`"効果: 毒 -3 (10)"`形式（マイナス表記、attack_upの`+N`とは正負が逆）
- `events.ts`へ`trap_triggered.trapType`フィールドと`poison_damage`（`actualDamage`/`hpBefore`/`hpAfter`）イベントを追加
- `message-log.ts`：`trap_triggered`をtrapType分岐（poison_trapは「毒の罠を踏んだ！」）、`effect_granted`/`effect_refreshed`/`effect_expired`へpoison用文言（「毒に侵された。」「毒がさらに体を巡った。」「毒が抜けた。」）、`poison_damage`（「毒で{actualDamage}ダメージを受けた。」）を追加

## telemetry schemaVersion 4

`player_damaged.source`の型を`EnemyType`から`EnemyType | 'poison'`へ拡張したことがスキーマの意味変更にあたるため、`RunTelemetry.schemaVersion`・`TelemetryDocument.schemaVersion`をいずれも4へ更新し、`buildExportFilename`の出力を`rogue-of-sun-run-v3-...`から`rogue-of-sun-run-v4-...`へ変更した。v1〜v3の読み込み互換機能は追加していない（`telemetry.forbidden`により禁止）。既存4テストファイル（`phase-10-3-1/2/3/3a`）のschemaVersion/ファイル名アサーションを機械的に4/v4へ更新した（テストタイトル文字列自体は既存の慣例どおり過去のフェーズ名のまま変更していない）。

## damageTaken、damageTakenByEnemy、endCause

- `translateGameEvent`へ`poison_damage`のcaseを追加：専用の詳細記録イベント（`poison_damage`、actualDamage/hpBefore/hpAfter）と、既存の汎用`player_damaged`（`source: 'poison'`）の両方を発行する
- `computeRunSummary`の`player_damaged`ケースを修正：`source === 'poison'`のときは`damageTakenByEnemy`への計上をスキップするが、新設した`combatOverall.damageTaken`（全`player_damaged`の合計、総被ダメージ）とフロア別`PerFloorStats.damageTaken`（元々sourceを問わず加算していたため無変更）へは通常どおり加算する
- `deriveDeathCauseFromTail`はコードの変更なしに、`player_damaged.source`型拡張の恩恵で毒死時に`'poison'`をそのまま返せるようになった（既存の敵攻撃による死因判定ロジックは無変更）

## 決定性と乱数

poison_trap配置は専用の独立したXOR定数（`0x3f9c5e82`）によるRNGストリームを使用し、既存のmap・placement・species・item・slow_trap配置RNGの消費順序を一切変更していない。poisonの付与・更新・tick・減算はいずれも乱数を使用しない純粋な状態操作。

## 変更ファイル

- `src/game/types.ts`：`TrapType`型、`TrapTile.trapType`、`EffectId`へ`'poison'`追加
- `src/game/effects.ts`：`EFFECT_DEFINITIONS`へ`poison`追加
- `src/game/events.ts`：`trap_triggered.trapType`、`poison_damage`イベント追加
- `src/game/message-log.ts`：poison用メッセージ、trap_triggeredのtrapType分岐追加
- `src/game/mapgen.ts`：`roomIndexContaining`新設、`chooseTrapPosition`へ`minDistanceFrom`オプション追加
- `src/game/state.ts`：罠配置ブロックをslow_trap/poison_trap両対応へ拡張
- `src/game/turn.ts`：罠発動ロジックのtrapType汎用化、`trapTriggeredThisAction`のslow_trap/poison_trap分離、`applyPoisonTick`新設・接続、`effectSkipIds`拡張
- `src/main.ts`：HUD(poison表示)、`drawTraps()`のpoison_trap図形追加
- `src/game/telemetry.ts`：`player_damaged.source`型拡張、`poison_damage`イベント処理、`damageTakenByEnemy`除外、`combatOverall.damageTaken`新設、schemaVersion 3→4・ファイル名v3→v4
- `src/game/__tests__/phase-12-3-poison-trap.test.ts`（新規）：Phase 12.3の全required_testsカテゴリを網羅するテスト
- `src/game/__tests__/phase-12-2-slow-trap.test.ts`：`trapType`フィールド追加（sedによる機械的追加）、slow_trap個数アサーションの限定化
- `src/game/__tests__/phase-10-3-1-telemetry.test.ts`ほか3ファイル：schemaVersion/ファイル名アサーションの4/v4への更新

## 追加・更新テスト

`phase-12-3-poison-trap.test.ts`（40件、新規）：
- 罠種別（trapType明示、既存slow_trapの後方互換）
- poison_trap配置（各1個、決定性、同一タイル非重複、非重複、別部屋優先とフォールバック、既存配置への非干渉）
- poison_trap発動（プレイヤーのみ、付与内容、再発動なし、発動ターンはダメージ・減算なし）
- poison tick（次ターンから3ダメージ、追加敵フェーズ併存時も1回、飢餓との合算が別々に1回ずつ、失敗操作/非ターン操作で不変、攻撃/待機/アイテム/蜘蛛の糸/石化/出口移動で進行、残り1適用後解除、HP2での毒死、防具無視、乱数不使用）
- 順序（敵攻撃死亡時の非重複、飢餓死亡時の非重複、毒死ターンの自然回復なし、通常ターンの自然回復成立、poison_trap発動ターンは無効果、slow_trap発動ターンの既存poison正常進行）
- 互換性（3効果同時保持・個別減算、poison_trap発動ターンのpoisonのみ除外、movement_slow追加フェーズとの独立動作、attack_upダメージ計算不変、新規ラン初期化、フロア間維持）

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：54テストファイル・1261件（既存1221件＋新規40件）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 既存ゲームバランス値を変更していないこと

slow_trapの強度・持続（movement_slow強度1・持続10）、attack_up（強度5・持続20）、所持上限20、満腹度・飢餓・自然回復の数値、プレイヤー・敵の能力値、武器・防具・命中率・回避率・ソル、蜘蛛の糸・石化の既存挙動、フロア生成アルゴリズムはいずれも変更していない。

## Phase 12.4以降を開始していないこと

毒以外の新しい状態効果、新しい消耗品、罠の発見・解除・耐性、敵への毒付与、状態異常耐性、睡眠・麻痺・混乱・暗闇・封印、経験値・レベルアップ・能力割り振りのいずれも実装していない。

## Claudeが判断した実装詳細と理由

- **罠種別を保持する型構造**：`TrapTile`へ直接`trapType`フィールドを追加する設計を採用した。既存の`WebTile`/`GroundItem`と同じ「単一配列＋discriminatorフィールド」パターンに合わせることで、`GameState`へ新規配列を追加せずに済み、`implementation_policy`の「鈍足罠と毒罠で別々のGameState配列を作らない」を自然に満たせる
- **poison_trapを別部屋優先で配置する方法**：`roomIndexContaining`で罠の所属部屋を特定し、「別部屋のみを対象にした1回目の抽選」→「失敗時のみ全部屋＋距離制約で2回目の抽選」という2段階方式にした。`chooseTrapPosition`が候補0件時にrng()を消費しない性質を利用することで、1回目が失敗しても2回目の抽選が同一rngストリーム上で決定的に振る舞う
- **poison用RNGを既存乱数順から分離した方法**：banana/slow_trapと同じパターンで、フロアseedに新規の固有XOR定数をXORした専用`createRng`ストリームを使用し、既存のどのストリームとも独立させた
- **poisonダメージを挿入したターン処理位置**：`applyHungerProgression`の直後・`playerDefeated`確定の前という1箇所に限定した。タスク仕様の`poison_tick.processing_order`が明示的にこの順序（飢餓後、死亡確定前）を要求していたため、既存の`playerDefeated`計算位置を後方へ移動する形で対応した
- **罠発動ターンだけpoison処理を除外した方法**：Phase 12.2の`isBananaGrant`と同じ「既存の観測可能な状態から導出する」方式を踏襲し、`state.traps`の`triggered`フラグをtrapType別にフィルタして比較する`poisonTrapTriggeredThisAction`を新設した。これを`applyPoisonTick`の`skipThisTurn`引数と`advanceEffectDurations`の`skipIds`の両方へ渡すことで、戻り値型の変更なしに一貫した抑制を実現した
- **movement_slowとの同時処理方法**：既存の`trapTriggeredThisAction`（罠種別を問わない判定）を`slowTrapTriggeredThisAction`と`poisonTrapTriggeredThisAction`へ分離し、追加敵フェーズの抑制条件には前者のみを使うよう修正した。これにより、poison_trap発動時に誤って追加敵フェーズまで抑制してしまうバグを未然に防いだ
- **telemetry schemaVersionを4へ更新した方法**：`player_damaged.source`の型を`EnemyType | 'poison'`へ拡張したことで、既存の`deriveDeathCauseFromTail`・フロア別damageTaken集計といった汎用的なコードパスをそのまま再利用しつつ毒死・毒ダメージを正確に記録できる設計にした。ただし`damageTakenByEnemy`（敵種別の集計）へpoisonが混入しないよう、`computeRunSummary`の該当箇所にのみ`source !== 'poison'`の明示的な除外分岐を追加した。総被ダメージを表す既存フィールドが存在しなかったため、`combatOverall.damageTaken`を新設した

## 未確認事項

- HUD・罠描画（poison_trapの紫ひし形）はPhaser実行時の見た目としては自動テスト対象外。手動プレイでの目視確認は行っていない
- ゴーレム等、`state.turn`ベースの位相判定を持つ敵種がmovement_slowの追加フェーズで同一ターン内に2回呼ばれた場合の挙動はPhase 12.2から変更しておらず、今回のpoison追加による影響はないと判断しているが、poisonとmovement_slowが同時に有効な状況での実プレイ検証は行っていない
- poison_trapとslow_trapが同一フロアの同じ部屋にしか配置できない狭いマップ生成結果（別部屋候補が存在せず、かつ同室内でも距離3以上の候補がない）が実際にどの程度の頻度で発生するかはテストの範囲（複数の固定seedでの確認）でのみ検証しており、全seed網羅的な検証は行っていない
