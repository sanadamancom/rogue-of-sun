# Phase 08.6 移動・向き変更・Xアクションの分離

## 目的

移動入力に組み込まれていた自動攻撃を廃止し、「方向入力＝移動」「Shift＋方向入力＝向き変更」「X＝現在向いている方向へのアクション」に分離します。現Phaseのアクションは攻撃のみとし、スピアの射程2をプレイヤーが能動的に利用できる操作へ修正します。

## 開始時のHEAD

`628e96bfc6b2abbaf0d05af41a34c3c57e93bb3d`（origin/mainと一致、working tree clean、baseline 35ファイル/538件全成功）

## Phase 08.5の自動攻撃方式で生じた操作上の問題

Phase 08.5までは、方向入力（W/A/S/D、Q/E/Z/C）が「その方向へのマスに敵がいれば攻撃、いなければ移動」という単一の入力として振る舞っていました。スピアの射程2は「隣接マスが空いていて、2マス先に敵がいる場合」にしか発動しないため、プレイヤーが意図的に距離を保って2マス攻撃を狙うことができず、敵に隣接した瞬間に必ず隣接攻撃（射程1）が優先される設計上、スピアの射程という利点を能動的に使う手段がありませんでした。

## 調査した入力、向き、移動、攻撃、角抜け、ターン進行処理

- `turn.ts`の`applyPlayerAction`：`move`アクション1種類のみで、`destination`（1マス先）に敵がいれば`applyPlayerAttackToEnemy`を呼び、いなければ`canMove`で移動判定する構造でした。Phase 08.5で追加された射程2判定（`canMove`を2区間に適用）もこの`move`分岐に組み込まれていました。
- `types.ts`：`Actor`型に既に`facing: Direction8`フィールドが存在しており（`Actor`/`EnemyActor`共通）、新しい向きstateを追加する必要はなく、既存フィールドをそのまま「明示的な向きstate」として再利用できることを確認しました。
- `input.ts`：`actionForKey(key: string)`はW/A/S/D、Q/E/Z/C、Spaceのみをマッピングしており、矢印キー・Shift判定・Xキーは未対応でした。
- `main.ts`：keydownリスナーは`event.key`のみを`handleKey`へ渡しており、`event.shiftKey`は未使用でした。Xキーの既存割り当てはなく、安全に新規アクションキーとして使えることを確認しました。
- `map.ts`の`canMove(map, from, direction)`：目的地の壁・範囲外・斜め角抜け禁止を1回の呼び出しで判定する既存の再利用可能な純粋関数で、Phase 08.5の射程2判定同様、移動判定・攻撃経路判定の両方に使えることを確認しました。
- `processTurn`の`inventoryOpen`ガードと`phase !== 'playing'`ガード：既存の許可アクション型リストに新しいアクション型を加えなければ、自動的にインベントリ表示中・ゲーム終了状態でブロックされる構造であることを確認しました。
- 既存538テストのうち、`processTurn(state, { type: 'move', direction: ... })`で敵への攻撃を検証していたテストを列挙し、`turn.test.ts`、`weapon-and-sword.test.ts`、`spear-reach-weapon.test.ts`、`armor-and-golem.test.ts`、`enemy-behavior-melee-variants.test.ts`、`enemy-type.test.ts`、`integration.test.ts`、`message-log.test.ts`、`multi-floor.test.ts`の9ファイル30件が該当することを確認しました。

## 通常方向入力の新しい処理

`turn.ts`の`applyPlayerAction`で、`action.type === 'move'`の処理を全面的に書き換えました。まず`player.facing = action.direction`で向きを更新し、次に移動先に生存中の敵がいれば「移動失敗」として`consumed: false`を返します（攻撃は一切発生しません）。敵がいなければ既存の`canMove`判定・ground item取得・web減速処理をそのまま実行します。

## 移動失敗時も向きだけ更新する規則

`player.facing = action.direction`を、敵占有チェック・`slowed`チェック・`canMove`チェックのいずれよりも前に無条件で実行するようにしました。これにより、壁・マップ外・敵占有のいずれの理由で移動が失敗しても、向きの更新だけは必ず反映されます。

## Shift＋方向入力の処理

`PlayerAction`に`{ type: 'face'; direction: Direction8 }`を追加しました。`applyPlayerAction`内で`action.type === 'face'`のとき`player.facing`を更新するだけで即座に`{ consumed: false, ... }`を返し、以降の処理（敵行動・ターン加算等）には一切進みません。`input.ts`の`actionForKey(key, shiftKey)`が、方向キーかつ`shiftKey === true`のときに`face`アクションを生成します。

## Xアクションの処理

`PlayerAction`に`{ type: 'action' }`を追加しました。`applyPlayerAction`内で`action.type === 'action'`のとき、新設した`resolveFacingAttack(state, player.facing, events)`を呼び出します。この関数はPhase 08.5で`move`分岐に組み込まれていた「隣接優先→射程2（reach>=2の武器のみ）→対象なしなら空振り」のロジックをそのまま移設したもので、プレイヤー座標は一切変更しません。

## 現PhaseではXが攻撃だけを行うこと

`resolveFacingAttack`は攻撃（隣接または射程2）と空振りのみを扱います。会話・調査・扉操作・宝箱操作などは実装していません。将来的にこれらをXへ統合できる余地は残していますが、今回は追加していません。

## 会話や調査を未実装であること

上記のとおり、Xアクションは攻撃専用です。汎用的なinteractionシステムの基盤は作らず、`resolveFacingAttack`という具体的な攻撃解決関数のみを実装しました。

## 空振りも1ターン消費すること

`resolveFacingAttack`が隣接・射程2のいずれにも対象を見つけられなかった場合、`player_whiff`イベント（装備武器があれば`weaponId`を含む）をpushし、`{ consumed: true, attacked: false, defeated: false }`を返します。`consumed: true`のため、`processTurn`の後段（敵行動解決・自然回復・フロア到達判定・ターン加算）が通常どおり実行され、空振り後も敵は正式に1回行動します。

## 素手、ソード、スピアの射程

`getEffectiveAttackPower`（Phase 08.3）・`WEAPON_DEFINITIONS`（Phase 08.5で`reach`フィールド導入）は無変更です。素手は`reach`定義を持たないため`resolveFacingAttack`内で「装備武器なしなら1」として扱い、ソードは`reach: 1`、スピアは`reach: 2`のままです。

## 壁、actor、斜め角による遮蔽

`resolveFacingAttack`はPhase 08.5の`canMove`ベースの2区間判定をそのまま使用しています。区間1（プレイヤー→中間マス）・区間2（中間マス→奥のマス）の両方に独立して壁・範囲外・斜め角抜け禁止判定が適用されます。中間マスに敵がいる場合は、隣接判定（`resolveFacingAttack`冒頭の対象検索）で先に検出されるため、奥へは届きません。ground itemとexitは`canMove`が参照する地形情報に影響しないため、攻撃を妨げません。

## 向きの視覚表示方法

既存のプレイヤースプライトは4方向（`toDirection4`でNE/SEがE、NW/SWがWに収束）しか区別できないため、斜め向き（NE/NW/SE/SW）が既存スプライトだけでは判別できません。`main.ts`に`updateFacingMarker()`を新設し、プレイヤーのタイル中心から`player.facing`の方向ベクトル分だけオフセットした位置に、既存の`Phaser.GameObjects.Graphics`で小さな円形マーカーを描画するようにしました。8方向すべてで同じオフセット距離・同じ描画規則を使用し、新しい画像アセットは追加していません。マーカーはプレイヤースプライトの近傍に小さく表示されるだけで、敵・ground item・exitの識別を妨げません。

## フロア遷移時の向き維持

`state.ts`の`CarryOverStats`に`facing: Direction8`を追加し、`advanceToNextFloor`が`state.player.facing`をそのまま次フロアの`carry.facing`として渡すようにしました。`buildFloorState`内で`carry`がある場合、`player.facing = carry.facing`で上書きします（`createInitialActor`のデフォルト`'S'`を後から上書きする形）。

## 新しいゲームでの向き初期化

`createInitialActor`は既に`facing: 'S'`をデフォルトとしており（Phase 01からの既存実装、無変更）、`carry`なしの`createInitialState`ではこのデフォルトがそのまま使われるため、新しいゲームは常に下向きから開始します。

## 変更ファイル

- `src/game/types.ts`：`PlayerAction`に`face`/`action`追加
- `src/game/input.ts`：矢印キー対応、`shiftKey`引数、Xキー対応で全面書き換え
- `src/game/turn.ts`：`applyPlayerAction`の`move`分岐を移動専用へ再構成、`face`/`action`ハンドリング追加、`resolveFacingAttack`新設（Phase 08.5の攻撃解決ロジックを移設）
- `src/game/events.ts`：`player_whiff`イベント追加
- `src/game/message-log.ts`：`player_whiff`の日本語ログ追加
- `src/game/state.ts`：`CarryOverStats`に`facing`追加、フロア遷移での向き維持
- `src/main.ts`：`shiftKey`の伝播、HUDへの操作説明行追加、8方向向きマーカーの新設・描画
- `src/game/__tests__/facing-and-action-controls.test.ts`（新規、32件）
- `src/game/__tests__/input.test.ts`：矢印キー・Shift・Xのテストを追加
- 既存テスト9ファイル（`turn.test.ts`、`weapon-and-sword.test.ts`、`spear-reach-weapon.test.ts`、`armor-and-golem.test.ts`、`enemy-behavior-melee-variants.test.ts`、`enemy-type.test.ts`、`integration.test.ts`、`message-log.test.ts`、`multi-floor.test.ts`）：自動攻撃を前提にしていた計30件のテストを、この仕様変更に直接起因する差分として`{type:'action'}`（事前に`player.facing`を設定）へ更新
- `docs/history/phase-08-6-facing-and-action-controls.md`：本ファイル

## 自動テスト結果

- `npx tsc --noEmit`：エラー0件
- `npx vitest run`：**36ファイル / 577件**、全成功（既存538件から30件を仕様変更に伴い更新、新規39件追加）
- `npx vite build`：成功。既知の「チャンクサイズ500kB超」警告以外に新規警告なし
- `git diff --check`：成功
- `package.json`／`package-lock.json`：差分なし
- マップ・敵・exit・ground itemのseed期待値に変更はありません（`multi-floor-robustness.test.ts`等の決定性テストは無変更のまま全て成功）

方向入力で自動攻撃しないことのテスト結果：`facing-and-action-controls.test.ts`の「movement no longer auto-attacks」ブロック（8件）で、敵へ移動しても攻撃・ターン消費が発生しないことを確認しています。攻撃と空振りのターン進行結果：同ファイルの「X action」ブロック（10件）で、攻撃成功・空振りいずれも1ターン消費、空振り後の敵行動、インベントリ表示中・ゲーム終了状態でのX無効化を確認しています。

## 手動確認結果

Playwright（キャッシュ済みChromium revision 1194 + playwright-core 1.56.0）を用い、ビルド済みプレビューをヘッドレスブラウザで操作して確認しました。確認のため一時的なデバッグ用フック（`window.__debugState`）をmain.tsに追加しましたが、確認後に完全に削除し、commit対象には含めていません。

確認できた項目（状態JSONで検証）：

- 通常画面でゲームが起動すること
- 初期向きが`'S'`（下向き）であること
- 通常方向入力（`d`＝東）で移動し、向きも`E`へ更新されること
- Shift＋W（北）で移動せず向きだけ`N`へ変わり、ターンが進まないこと
- Shift＋Q（斜め北西）で向きが`NW`へ変わること
- 敵のいるマスへ通常方向入力（東）しても、敵HPが変化せず、ターンが進まず、向きだけ`E`に更新されること
- Xキーで前方（東）の隣接敵を攻撃でき、HPが1減り（素手攻撃力1）、ターンが1だけ進み、プレイヤー座標が変化しないこと
- 対象のいない方向（北）へのXで空振りとなり、ターンが1だけ進むこと
- 上記いずれの操作でもブラウザコンソールに新規エラーが出ないこと

未確認項目（自動テストのみでカバー、実画面のスクリーンショットは撮影したが目視での詳細確認は行っていない）：

- スピア装備中の2マス攻撃の実画面確認（自動テストの`resolveFacingAttack`検証では確認済み）
- 壁越し・斜め角越しの攻撃阻止の実画面確認（自動テストでは確認済み）
- インベントリ表示中のX・Shift＋方向入力無効化の実画面確認（自動テストでは確認済み）
- 向きマーカーの8方向すべての見た目の目視確認（スクリーンショットは取得したが、本報告では状態JSONの検証を主とした）
- ソード・アーマー・リンゴが従来どおり動くことの実画面での網羅確認（自動テストの回帰テストでは確認済み、手動では時間の都合上、今回の変更に関わる操作のみ確認）

長時間のバランステストは実施していません。

## 今後の拡張について

今後、Xアクションへ会話・調査・扉操作などを統合できる余地は残していますが、今回は攻撃のみの実装です。操作体系が最終確定したとは断定しません。
