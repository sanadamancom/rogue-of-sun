# Phase 12.2 鈍足の罠と移動鈍足効果

## 目的

各フロアに決定的に最大1個の「鈍足の罠」を配置し、プレイヤーが踏むとmovement_slow（強度1・持続10成功ターン）を付与する。効果中に実際のマス移動が成功した場合だけ、通常の敵行動フェーズに加えてもう1回敵行動フェーズを実行し、攻撃・待機・アイテム使用などの非移動行動や失敗移動、出口移動では追加行動を発生させない。Phase 12.1のactiveEffects基盤を必要最小限だけ拡張し、既存の蜘蛛の糸（Actor.slowed）・石化（Actor.petrified）・attack_upの挙動は一切変更しない。

## 前回監査から判断を変更した理由

Phase 12.2監査（前回セッション）では候補C（既存slowedを維持しactiveEffects上へ一般鈍足effectを別概念として追加）を推奨していた。今回のタスク仕様はこの推奨方針とほぼ一致する内容だったため、監査結果からの判断変更はない。ただし監査時点では「敵の追加行動を発生させる方式は採用すべきでない」と結論していたのに対し、今回のタスク仕様は明示的に「成功移動時のみ敵行動フェーズを1回追加する」という設計を指定している。これは監査時の推奨と表面上は逆だが、監査での懸念（`resolveEnemiesAction`の対称性を崩すことによる満腹度・自然回復・一時効果減算等の周期処理への波及）は、今回のタスク仕様が「追加フェーズの入口を一箇所に限定する」「満腹度・自然回復・効果減算は1回だけ実行する」という制約を明示的に課すことで正面から解消されている設計だったため、監査の懸念点を踏まえた上でタスク仕様の指示に従うことにした。

## 開始時のrepository、branch、HEAD、working tree

- repository: `https://github.com/sanadamancom/rogue-of-sun`
- branch: `main`
- HEAD: `68060fef8d6874e7d82aa5c2af3fecc9a9489138`
- working tree: clean

## baseline検証結果

- `npx tsc --noEmit`: 成功
- `npx vitest run`: 52テストファイル・1176件 全成功
- `npx vite build`: 成功

## 既存の移動・敵行動・ターン処理

- `applyPlayerAction`（`turn.ts`）のmove分岐：`player.facing`更新→petrified最優先チェック（関数冒頭）→slowed（蜘蛛の糸）チェック（moveのみ、他の全アクション種別では一切参照されない）→`canMove`判定→成功時`player.pos = destination`→web踏み判定→（今回追加：罠判定）→アイテム自動取得
- `processTurn`の確定順序：`applyPlayerAction`（consumed判定）→（consumed時のみ）`resolveEnemiesAction`→hunger→playerDefeated確定→自然回復→（Phase 12.1）`advanceEffectDurations`→フロア到達判定→`turn`インクリメント→`expireWebs`→phase更新
- `resolveEnemiesAction(state, events)`は生存敵を`state.enemies`の固定順で1体ずつ`resolveOneEnemy`により1回行動させ、プレイヤー死亡時点で即座に打ち切る、既存の唯一の敵行動エントリーポイント

## 罠のデータ所有とfixture構造

- `types.ts`に`TrapTile`インターフェース（`{ id: number; pos: Vec2; triggered: boolean }`）を新設。`Fixture`型（`'exit' | 'trap' | 'chest'`）がPhase 02から`'trap'`を予約していたが実データ構造は存在しなかったため、今回初めて実体化した
- `GameState.traps?: TrapTile[]`をoptionalフィールドとして追加（webs/groundItemsは必須フィールドだが、既存テストフィクスチャへの影響を避けるためPhase 11.2/11.3/12.1と同じ理由でoptionalとした。実装時には`state.traps ?? []`で常に安全に読み取る）
- ground_itemではなくfixtureとして表現：`GroundItem`とは別の独立した配列（`traps`）とし、`ItemDefinition`や`inventory`には一切登録していない

## 罠の配置条件と専用RNG

- `mapgen.ts`へ`chooseTrapPosition(map, rooms, start, exit, exclude, rng)`を新設。既存の`chooseGroundItemPosition`と異なり、候補が0件の場合は例外を投げず`null`を返す
- 候補は`rooms`（`Room[]`）の各矩形内部のみを走査する。`doorway-rule.test.ts`の既存検証により、入口タイルは部屋矩形の外側（隣接1マス）に生成されることが確認済みのため、部屋矩形内だけを走査することで通路・入口を自動的に除外できる
- 開始地点からマンハッタン距離4以上、出口からマンハッタン距離2以上、`exclude`（start/exit/敵位置/既存groundItem位置）との重複を除外
- `state.ts`の`buildFloorState`で、既存のbanana配置ブロックの直後に専用RNGストリーム（13番目のXOR定数`0x1a6f83c5`、既存12個のいずれとも重複しないことを確認済み）で毎フロア0または1個配置。配置できなかった場合は`traps: []`のまま次へ進む（例外なし）

## 未発動・発動済みの描画

- `main.ts`に`trapGraphics`（`Phaser.GameObjects.Graphics`、`drawWebs`と同じ設計）を新設し、`drawTraps()`メソッドを追加
- 未発動（`triggered: false`）の罠は一切描画しない（通常床と同じ表示）
- 発動済み（`triggered: true`）の罠のみ、円＋X字の簡素な図形（新規画像アセット不使用、`0xc97a3a`のだいだい色）を描画
- `create()`と`refreshStaticView()`の両方で`drawWebs()`直後に`drawTraps()`を呼び出す（`refreshStaticView()`はフロア遷移・毎ターン更新・リスタートいずれの経路からも呼ばれるため、これで全ケースをカバーする）

## movement_slowの定義

- `effects.ts`の`EFFECT_DEFINITIONS`へ`movement_slow: { id: 'movement_slow', displayName: '鈍足', strength: 1, duration: 10 }`を追加
- `strength`の意味はattack_up（物理攻撃力への固定加算）とは異なり、「成功移動時に追加する敵行動フェーズ数」。`effects.ts`自体はこの意味を解釈せず、汎用的なid/strength/duration容れ物のままとし、`turn.ts`側の移動フェーズロジックだけがこの意味で`strength`を読む設計にした

## 付与、持続、更新、終了規則

- 付与・更新は既存の`grantOrRefreshEffect`をそのまま再利用（重複加算せず、既存インスタンスがあれば残りターンを10へ更新するのみ）。今回罠は一度しか発動しないため「将来再付与された場合は残り10へ更新する」の分岐は実質的に到達しないが、汎用関数を流用することで将来の再発動可能な罠にもそのまま対応できる
- 減算は`advanceEffectDurations`（後述のskipIds拡張版）で他の効果と共通の1箇所（`processTurn`内、hunger/regenの後）から1回だけ実行
- 終了：残りターンが0になった時点で配列から除去し、`effect_expired`イベントを1回だけ発行（Phase 12.1のattack_upと共通のイベント/ロジック）

## 追加敵フェーズの実装位置（理由付き）

`processTurn`内、最初の`resolveEnemiesAction`呼び出し直後・`applyHungerProgression`より前の1箇所に限定した。理由：
- 満腹度・自然回復・効果減算はこの後段で1回だけ実行される既存コードのため、追加フェーズをそれより前に置けば二重実行を避けられる（`implementation_policy`の「追加敵フェーズの入口を一箇所に限定する」「敵フェーズ以外のターン処理が二重実行されない構造にする」を満たす）
- 判定条件は以下をすべてANDで満たす場合のみ`resolveEnemiesAction`をもう一度呼ぶ：
  1. `action.type === 'move'`かつ`applyPlayerAction`前後でプレイヤー座標が実際に変化した（壁移動失敗・蜘蛛の糸による移動キャンセル・石化による強制スキップは、いずれも座標が変化しないためこの1条件だけで自動的に除外される。新しい戻り値フィールドをapplyPlayerActionへ追加せず、Phase 12.1の`isBananaGrant`と同じ「既存の観測可能な状態から導出する」手法を踏襲した）
  2. その移動が出口タイルへ到達していない
  3. その移動自体が罠を発動させていない（`state.traps`の`triggered`フラグをアクション前後でdiffして判定。movement_slowが既に有効な状態でさらに別の罠を踏んで更新するという稀なケースも正しく除外できる）
  4. movement_slowがこのアクション**開始前から**有効だった（新規付与された当のターンは対象外）
  5. 最初の敵行動フェーズの後もプレイヤーが生存している（「ゲーム終了状態になった場合」も、敵行動だけでゲームが終了しうるのはプレイヤー死亡のみのため、この1条件でカバーされる）
- 条件を満たす場合のみ、同じ`resolveEnemiesAction`関数をもう一度呼び出し、その`acted`/`attacked`を最初のフェーズの結果とOR演算して`TurnResult.enemyActed`/`enemyAttacked`へ反映する

## 罠発動ターンを効果対象外にした方法

`advanceEffectDurations`のシグネチャを`(state, skipIds: EffectId[] = [])`へ拡張した。Phase 12.1では「バナナ使用ターンは呼び出しごと丸ごとスキップ」という設計だったが、今回はattack_upとmovement_slowが同一ターンに同時存在しうるため、効果ID単位で選択的にスキップできるよう変更した。`processTurn`側で`isBananaGrant`なら`'attack_up'`を、`trapTriggeredThisAction`なら`'movement_slow'`を`skipIds`へ積み、`advanceEffectDurations(state, skipIds)`を常に1回だけ呼ぶ形に統一した（呼び出し自体を条件分岐で省略する旧方式を廃止）。

## 満腹度、自然回復、効果減算を二重実行しない方法

`applyHungerProgression`・自然回復ブロック・`advanceEffectDurations`はいずれも`processTurn`内で従来通り1箇所にしか存在せず、今回の変更でも複製していない。追加敵フェーズの呼び出しはこれらより前（`resolveEnemiesAction`の直後）に完結する1回限りの分岐として実装したため、後続のhunger/regen/効果減算コードは常にちょうど1回だけ実行される。

## 蜘蛛の糸との処理順

- `player.slowed`（蜘蛛の糸）チェックは`applyPlayerAction`のmove分岐冒頭、罠判定より前に存在し、変更していない。蜘蛛の糸で移動が失敗する場合（`player.slowed`が真）は`destination`計算に到達する前にreturnするため、罠判定・追加敵フェーズ判定のいずれにも到達しない
- 「実際のマス移動が成功したか」の判定（座標変化の有無）により、蜘蛛の糸で失敗したターンは`actualMoveHappened`が偽となり、追加敵フェーズは自動的にスキップされる
- 一方、蜘蛛の糸で失敗したターンも`consumed: true`の成功ターンであるため、movement_slowの残りターンは（スキップ対象にならない限り）通常通り1減算される。これはコードを分岐追加せずとも「trapTriggeredThisActionが偽であれば`skipIds`にmovement_slowが入らない」という既存ロジックだけで自然に満たされる

## 石化との互換

`player.petrified`の付与・解除・優先順位（`applyPlayerAction`冒頭での最優先チェック）は一切変更していない。石化による強制スキップも座標変化なしのため`actualMoveHappened`が偽となり追加敵フェーズは発生しない。石化とmovement_slowの同時保持は禁止しておらず、石化スキップのターンでもmovement_slowは通常通り1減算される。

## attack_upとの同時保持

`grantOrRefreshEffect`・`getEffectStrength`・`advanceEffectDurations`はいずれもeffect id単位で動作する既存の汎用関数のため、attack_upとmovement_slowを`state.activeEffects`に同時に持たせても互いに干渉しない。罠発動ターンは`skipIds`に`'movement_slow'`のみが積まれるため、同一ターンに有効なattack_upは通常通り1減算される。物理ダメージ計算（`getPlayerAttackUpBonus`）はmovement_slowを一切参照しないため影響を受けない。

## フロア遷移、新規ラン、死亡後再挑戦

- `traps`はwebs/groundItemsと同じ「毎フロア新規生成・フロア間で持ち越さない」フィールドとして実装（`CarryOverStats`には含めていない）
- movement_slow自体はPhase 12.1のactiveEffects機構をそのまま使うため、`CarryOverStats.activeEffects`経由でフロア間維持・新規ラン/死亡後再挑戦で消去という既存の規則がそのまま適用される（追加のコード変更不要）

## HUD、イベント、メッセージ

- `main.ts`の`effectsHudLabel()`をmovement_slow対応に拡張：strengthが「加算値」の意味を持たないため、`"効果: 鈍足 (10)"`のように`+N`表記を省略する専用分岐を追加した（attack_upは従来通り`"効果: 攻撃↑ +5 (20)"`）
- `events.ts`へ`trap_triggered`イベントを新規追加。movement_slowの付与・更新・終了はPhase 12.1の`effect_granted`/`effect_refreshed`/`effect_expired`をそのまま再利用（新規イベント型を増やさない）
- `message-log.ts`の`effect_granted`/`effect_refreshed`/`effect_expired`をeffectId分岐に変更し、movement_slow用の固定文言（「体が重くなった。」「体の重さがなくなった。」）とattack_up用の既存文言を出し分けるようにした。`trap_triggered`には「鈍足の罠を踏んだ！」を追加
- `telemetry.ts`の`translateGameEvent`は既存の非網羅的switch＋catch-all defaultのため、新規イベント追加による変更は不要

## 決定性と乱数

- 罠配置は専用の独立したXOR定数（`0x1a6f83c5`）によるRNGストリームを使用し、既存のmap・placement・species・item配置RNGの消費順序を一切変更していない
- movement_slowの付与・更新・減算・追加敵フェーズの判定処理はいずれも乱数を使用しない純粋な状態操作・条件分岐のみ

## 変更ファイル

- `src/game/types.ts`：`TrapTile`型、`GameState.traps`、`EffectId`へ`'movement_slow'`追加
- `src/game/effects.ts`：`EFFECT_DEFINITIONS`へ`movement_slow`追加、`advanceEffectDurations`へ`skipIds`パラメータ追加
- `src/game/events.ts`：`trap_triggered`イベント追加
- `src/game/message-log.ts`：`effect_granted`/`effect_refreshed`/`effect_expired`のeffectId分岐、`trap_triggered`メッセージ追加
- `src/game/mapgen.ts`：`chooseTrapPosition`関数追加
- `src/game/state.ts`：`buildFloorState`への罠配置ブロック追加
- `src/game/turn.ts`：move成功分岐への罠発動ロジック追加、`processTurn`への追加敵フェーズ判定・実行ロジック追加、`isBananaGrant`ロジックの`effectSkipIds`方式への書き換え
- `src/main.ts`：`trapGraphics`フィールド・`drawTraps()`メソッド追加、`create()`/`refreshStaticView()`への呼び出し追加、`effectsHudLabel()`のmovement_slow対応
- `src/game/__tests__/phase-12-2-slow-trap.test.ts`（新規）：Phase 12.2の全required_testsカテゴリを網羅するテスト

## 追加・更新したテスト

`phase-12-2-slow-trap.test.ts`（45件、新規）：
- `chooseTrapPosition`単体（部屋内限定、開始地点/出口からの距離、exclude、候補なしでnull、決定性）
- `createInitialState`経由の配置（0〜1個、部屋床、非重複、未発動初期状態、決定性、既存配置への非干渉）
- 罠発動（プレイヤーのみ発動、付与内容、イベント各1回、再発動なし、発動ターンは減算・追加フェーズなし）
- 追加敵行動フェーズ（成功移動で2回行動、プレイヤーは1マスのみ移動、攻撃/待機/アイテム使用/太陽銃/失敗移動/出口移動で追加フェーズなし、初手死亡時は追加フェーズなし、複数敵が両方2回行動）
- 持続時間・ライフサイクル（成功ターンで1減算、失敗移動で不変、残り1での適用後解除、フロア間維持、新規ランで消去）
- 蜘蛛の糸・石化・attack_upとの互換性
- HUD定義値・combatRngState不変の回帰確認

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：53テストファイル・1221件（既存1176件＋新規45件）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## telemetry schemaVersionを維持したこと

`telemetry.ts`の`telemetrySchemaVersion`は3のまま変更していない。既存の非網羅的switch＋catch-all default構造により、新規イベント型（`trap_triggered`）の追加はtelemetryへ影響しない。

## Phase 12.3以降を開始していないこと

毒・防御力上昇・暗闇・封印・SOL回復不能・敵への状態効果・状態異常耐性・睡眠麻痺混乱、罠の複数種類化・罠解除・罠発見・罠耐性のいずれも実装していない。`TrapId`のような罠種別の判別フィールドも追加していない（罠は今回1種類のみのため）。

## Claudeが判断した実装詳細と理由

- **`advanceEffectDurations`のskipIds方式への拡張**：Phase 12.1では「呼び出し全体をスキップ」という設計だったが、attack_upとmovement_slowが同一ターンに共存しうる今回の要件（「罠発動ターンの減算除外はmovement_slowだけに適用する」）を満たすには効果ID単位の選択的スキップが必要と判断し、後方互換なデフォルト引数（`skipIds = []`）で既存呼び出し元との互換性を保ったまま拡張した
- **罠発動ターン・追加フェーズ対象turnの判定方法**：`applyPlayerAction`/`applyBananaUse`の戻り値型を拡張せず、アクション前後の座標比較・`traps`配列の`triggered`フラグ比較という「既存の観測可能な状態からの導出」方式を採用した。Phase 12.1の`isBananaGrant`と同じ設計思想を踏襲することで、戻り値型変更という影響範囲の広い変更を避けた
- **HUDのmovement_slow表示形式**：`strength`の意味がattack_upと異なる（加算値ではなく追加フェーズ数）ため、`+N`表記を出さない専用分岐を設けた。要求仕様の表示例「効果: 鈍足 (10)」をそのまま踏襲
- **罠の描画記号**：円＋X字の簡素な図形を新規に選択した。既存のweb描画（ひし形＋クロスハッチ）と視覚的に区別しつつ、同じGraphics APIのみで完結する設計とした
- **`trap_triggered`を新規イベントとして追加**：movement_slowの付与自体は既存の`effect_granted`で表現できるが、「罠を踏んだ」という事象自体を区別できるイベントが必要と判断し、ペイロードなしの最小限のイベントとして追加した

## 未確認事項

- HUD描画・罠の図形表示はPhaser実行時の見た目としては自動テスト対象外（既存main.tsコードと同様、vitest対象外）。手動プレイでの目視確認は行っていない
- ゴーレム等、`state.turn`ベースの位相判定を持つ敵種が追加フェーズで同一ターン内に2回呼ばれた場合、位相計算が変化しないため同じ行動（待機または行動）を2回繰り返す。これは「既存の敵AI処理をそのまま再利用する」という要求に沿った自然な結果であり、恒久的な速度能力値やAI判断規則自体は変更していないが、実プレイでの見え方については未検証
- 罠とスパイダーの巣が同一タイルに重なるケース（配置時点では非重複だが、実行時にスパイダーが罠タイル上へ巣を張る可能性）は明示的な防止コードを入れていない。発生頻度は極めて低いと見込まれるが、実プレイでの検証は行っていない
