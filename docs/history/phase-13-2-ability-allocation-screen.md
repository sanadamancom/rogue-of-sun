# Phase 13.2 能力ポイント割り振り画面

## 目的

カラダ／ココロ／チカラ／ハヤサの4能力を初期値0で進行状態へ追加し、
レベルアップで得た未使用能力ポイントを専用overlayから1ポイント単位で
割り振れるようにする。Phase 13.2では4能力の値・割り振り処理・画面だ
けを実装し、割り振った能力を既存の戦闘数値（HP、SOL、攻撃、防御、速
度など）へ一切反映しない。

## Phase 13.1開始基準

`src/game/progression.ts`にlevel/experience/unspentAbilityPointsの基
盤が存在し、初期状態がLv1・EXP0・能力P0であること、フロア遷移で3値が
維持され、死亡後再挑戦で初期化されることを確認した（`state.ts`の
`buildFloorState`のcarry有無による分岐、および`createInitialState`/
`main.ts`の`restart`が常にcarryなしで`buildFloorState`を呼ぶ経路）。
これらはPhase 13.1で構築済みの基盤としてそのまま利用した。

## Phase 13.2と13.3の境界

Phase 13.2は「4能力の値・割り振り操作・overlay」までを実装し、能力の
実効果（最大HP・SOL・攻撃・防御・速度・回避・満腹度・自然回復などへ
の補正）は一切実装しない。能力値は保持・表示・記録のみに使われ、既存
のどの計算式からも参照されない。実効果はPhase 13.3で決定・実装する。

## 4能力のIDと表示名

`src/game/ability.ts`に`AbilityId`（'body' | 'mind' | 'power' |
'speed'）と`ABILITY_DISPLAY_NAMES`（body→カラダ、mind→ココロ、power→
チカラ、speed→ハヤサ）を定義し、ID↔表示名の対応をこの1箇所に集約し
た。`AbilityId`・`AbilityValues`型そのものは循環import回避のため
`types.ts`側に定義し（`EffectId`が`effects.ts`ではなく`types.ts`にあ
るのと同じ理由）、`ability.ts`はそこから型のみを再利用する。

## 初期能力値

新規ラン・死亡後再挑戦ともに4能力すべて0（`INITIAL_ABILITY_VALUES`）。

## 能力ポイント割り振り規則

- 未使用能力ポイントが1以上のときだけ割り振れる。
- 1回の確定操作（確認画面で「はい」→Enter）につき1ポイントだけ消費し、
  選択した能力のみを1増やす。他の3能力は変化しない。
- `unspentAbilityPoints + body + mind + power + speed`は、そのラン中
  に獲得した総能力ポイントと常に一致する（`allocateAbilityPoint`が2つ
  のフィールドを同一トランザクションとして更新するため、途中状態が外
  から観測されることはない）。
- 割り振り後もoverlayは開いたままとなり、続けて別の能力へ割り振れる。

## 割り振り済みポイントを戻せない仕様

`ability.ts`には能力値を減らす関数・経路を一切実装していない。振り直
し・返却・一括割り振りのいずれも実装対象外（restrictions）であり、
`allocateAbilityPoint`は常に対象能力を+1するのみで、他の値を書き換え
る手段を外部へ公開していない。

## 能力overlayの表示と操作

Pキーで開閉する専用overlay（`main.ts`の`createAbilityOverlay`/
`refreshAbilityOverlay`、既存の`createInventoryOverlay`と同じ
Graphics+Text構成、depthのみ200番台の空きを使って重ならないよう配
置）。表示内容はタイトル「能力割り振り」、残り能力ポイント数、4能力
の現在値（選択中の行に`>`マーカー、能力ポイント0のときは全行に「（割
り振り不可）」を付与）、「能力の効果は次のフェーズで実装予定」の注記、
操作ヘルプ。

操作：
- ↑↓ / W S：4能力を循環選択（末尾↔先頭でラップ）
- Enter：選択中の能力の確認状態へ入る（能力ポイント0では入らない）
- P / Esc：overlayを閉じる

## 確認操作と誤操作防止

Enterで確認状態に入ると「{能力名}を{現在値}から{現在値+1}へ上げます
か？」を表示し、初期選択は「いいえ」。←→ / A Dで「はい」「いいえ」を
切り替え、Enterで確定。確認中のEscは確認状態だけを閉じ、overlay自体
は開いたままにする。確認中にPを押した場合は割り振らずoverlay全体を閉
じる（`main.ts`のhandleKeyでPキーの処理を、通常状態と確認中とを区別
せず`toggleAbilityOverlay`へ一律ルーティングすることで実現——`toggleAbilityOverlay`は開いているoverlayを閉じる際に確認状態も同時に
クリアするため、確認中のPは「確認だけ閉じる」ではなく「overlow全体を
閉じる」という仕様どおりの動作になる）。

二重処理防止：`resolveAbilityConfirm`は`state.abilityConfirmPending`
を最初に読み取った直後にnullへクリアしてから`allocateAbilityPoint`を
呼び出すため、同一フレーム内で誤って2回解決されても2回目は
`attempted: false`となり状態を変更しない（テストで確認済み）。
`allocateAbilityPoint`自体も未使用ポイント数・能力IDの妥当性・
`state.phase`を独立して再検証し、UI側の判定だけに依存しない
（allocation_core.requirements）。

## 非ターン消費処理

能力割り振り関連の操作（overlay開閉、選択移動、確認表示、割り振り確
定）はいずれも`processTurn`/`PlayerAction`を経由しない独立した状態更
新関数（`ability.ts`）として実装した。`state.turn`を進めず、敵行動・
満腹度減少・毒ダメージ・自然回復・activeEffectsの残りターン減少のいず
れも発生しない。`turn.ts`の`processTurn`には
`state.abilityOverlayOpen`のガードを追加し、overlayが開いている間は
（inventoryOpenガードと同様に）通常アクションを無条件で拒否する第二
の防御線とした。

## inventory overlayおよび終了overlayとの排他制御

`main.ts`の`handleKey`で、Tab押下時は常に能力overlayを閉じてからイン
ベントリをトグルし、P押下時（`inventoryOpen`が false であることが直
前の分岐で保証された状態でのみ到達）は`toggleAbilityOverlay`を呼ぶ。
`ability.ts`の`toggleAbilityOverlay`がoverlayを開く際に
`state.inventoryOpen`を明示的にfalseへ、`inventory.ts`の
`toggleInventory`がoverlayを開く際に`state.abilityOverlayOpen`を明示
的にfalseへセットする、双方向の相互排他とした。

能力overlayは`state.phase !== 'playing'`のとき（ゲームオーバー確定
後・フロア到達による終了確定後）`toggleAbilityOverlay`/
`allocateAbilityPoint`双方が即座にno-opとなるため、終了確定後に新たな
割り振りはできない。終了overlay（DOM要素、zIndex 1000）はPhaser
Canvas全体の最前面に独立して重なるため、能力overlay（Phaser
depth 200番台）より常に前面になる。

## 新規ラン、死亡後再挑戦、フロア遷移

`state.ts`の`buildFloorState`に`abilities`をcarry有無で初期化/維持す
るよう追加した（`level`/`experience`/`unspentAbilityPoints`と同じ分
岐構造）。新規ラン・死亡後再挑戦は`createInitialState`/`restart`が常
にcarryなしで呼ぶため4能力とも0に初期化される。フロア遷移
（`advanceToNextFloor`）は`CarryOverStats`に`abilities`を追加して4能
力と未使用ポイントを維持し、フロア遷移だけで値が増減したり
`ability_point_spent`が発行されたりすることはない。overlay自体の開閉
状態・選択位置・確認状態は他のoverlay同様、フロア/ラン開始時に常にリ
セットされる。

## ability_point_spentイベントとメッセージ

`events.ts`に`ability_point_spent`（`ability`/`abilityDisplayName`/
`previousValue`/`newValue`/`remainingAbilityPoints`）を追加。成功した
1ポイントの割り振りにつき`allocateAbilityPoint`内で1回だけ発行し、
ポイント不足・不正なID・確認キャンセル・overlay開閉/選択移動では発行
しない。`message-log.ts`に「{abilityDisplayName}に1ポイント割り振っ
た。」のフォーマットを追加し、`main.ts`側で割り振り成功時のみ
`formatEvents`経由でmessage logへ反映する。

## telemetry schemaVersion 6

`RunTelemetry`/`TelemetryDocument`の`schemaVersion`を5→6に、export
prefixを`rogue-of-sun-run-v5-`→`rogue-of-sun-run-v6-`に変更した。能力
割り振りは`processTurn`を経由しない非ターン操作であるため、既存の
`recordTurn`/`translateGameEvent`経路（`processTurn`が返す
`TurnResult.events`を走査する仕組み）では捕捉できない。そのため
`recordFloorStarted`と同じ「直接push」パターンで新規関数
`recordAbilityAllocation`を追加し、`main.ts`が割り振り成功時に明示的
に呼び出す形とした。`RunSummary.progression`へ`abilityPointsSpent`
（`ability_point_spent`イベント数の合計）と`endingAbilityRanks`（終了
時の4能力値）を追加した。既存の`experienceGained`/`levelsGained`/
`endingLevel`/`endingExperience`/`unspentAbilityPoints`や
`damageTaken`/`item_used`/`endCause`等の集計ロジックは変更していない。

## 4能力が既存能力値へ影響しないこと

`ability.ts`の`allocateAbilityPoint`は`state.abilities`と
`state.unspentAbilityPoints`のみを変更し、`player.hp`/`maxHp`/
`attack`/`defense`/`solarEnergy`/`maxSolarEnergy`等には一切触れない。
既存の武器・防具・敵・状態異常の計算式（`combat.ts`、`turn.ts`の各種
ダメージ計算）はいずれも`state.abilities`を参照していない。テストで、
4能力それぞれを割り振った前後でHP・maxHp・SOL・maxSOL・攻撃・防御が
変化しないこと、ターン処理・敵行動回数が変わらないことを確認した。

## 変更ファイル

- 新規：`src/game/ability.ts`
- 変更：`src/game/types.ts`、`src/game/events.ts`、
  `src/game/message-log.ts`、`src/game/inventory.ts`、
  `src/game/turn.ts`、`src/game/state.ts`、`src/game/telemetry.ts`、
  `src/main.ts`
- テスト新規：
  `src/game/__tests__/phase-13-2-ability-allocation-screen.test.ts`
- テスト更新（schemaVersion/exportファイル名の期待値をv6へ）：
  `src/game/__tests__/phase-10-3-1-telemetry.test.ts`、
  `src/game/__tests__/phase-10-3-2-telemetry-fix.test.ts`、
  `src/game/__tests__/phase-10-3-3-damage-recovery-fix.test.ts`、
  `src/game/__tests__/phase-10-3-3a-healing-field-rename.test.ts`

## 追加・更新テスト

新規ファイルに37件を追加（能力状態3件、割り振りコア8件、不変条件3
件、ライフサイクル3件、overlay状態機械9件、非ターン消費4件、イベン
ト/メッセージ2件、既存能力値への非影響4件、その他1件）。既存4ファイ
ルはschemaVersion/exportファイル名プレフィックスの期待値更新のみ（
数値アサーションの誤変更を1度作り込んでしまい、`git diff`で確認して
即座に差し戻した——実際のダメージ量・回復量アサーションは変更してい
ない）。

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：エラーなし
- `npx vitest run`：57ファイル / 1349件 全て成功（既存1312件 + 新規37件）
- `npx vite build`：成功
- `git diff --check`：問題なし

## Phase 13.3を開始していないこと

能力値の実効果（HP・SOL・攻撃・防御・速度・回避・満腹度・自然回復な
どへの補正）は一切実装していない。`state.abilities`はどの既存計算式
からも参照されない。

## ブラウザで確認すべき項目

- Pで能力割り振り画面を開閉できること
- カラダ／ココロ／チカラ／ハヤサがすべて表示されること
- レベルアップで得た能力ポイントが表示されること
- 能力を選んでEnterを押すと確認が表示されること
- 初期選択が「いいえ」であること
- 「はい」で1ポイントだけ割り振られること
- 割り振った能力が1増え、HUDの能力Pが1減ること
- 能力P0では追加割り振りできないこと
- 割り振り操作で敵、毒、満腹度などのターンが進まないこと
- Tabのinventory overlayと同時表示されないこと
- フロア遷移後も割り振り状態が維持されること

## 未確認事項

- カラダ／ココロ／チカラ／ハヤサの実際の効果と上昇量（Phase 13.3で決
  定・実装する）
