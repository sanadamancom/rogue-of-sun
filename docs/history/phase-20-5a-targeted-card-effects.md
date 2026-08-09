# Phase 20.5a 節制・星

## 目的

節制（temperance）と星（star）をPhase 20.0dの対象選択基盤経由でproduction接続する。開始commit：`e8863151a06bec5a8661fbf3f4d1d9432433ece6`。

## 節制・星のproduction実装箇所

`turn.ts`：`resolveTemperanceEffect`/`resolveStarEffect`（`CARD_TARGET_EFFECT_RESOLVERS`へ登録）、`applyTargetedCardUse`（新規PlayerAction`use_targeted_card`のディスパッチ）。`main.ts`のcard_target_selection確定ハンドラを、この`use_targeted_card`アクションを実際に`processTurn`へ送出する実装へ更新した。

## 20.0c/20.0dから再利用した基盤

`EQUIPMENT_REFINE_LEVEL_CAP=3`・`FLOOR_EQUIPMENT_CURSE_CHANCE=0.1`（Phase20.0c既存、変更なし）。`getTemperanceCandidates`/`getStarCandidates`/`beginCardTargetSelection`/`confirmCardTargetSelection`/`refreshCardTargetSelection`/`resolveCardTargetEffect`/`PendingCardTargetEffectHolder`（Phase20.0d既存、resolverレジストリのみ今回空から実装済みへ変更）。

## PlayerAction拡張について

`processTurn`が単一アクション呼び出しで完結する既存設計のため、対象選択済みの効果を渡す新規action型`{ type: 'use_targeted_card', cardId, target }`を追加した。対象選択UI自体（開始・移動・取消）はPhase20.0dの既存実装を無変更のまま流用し、確定時にのみこの新アクションを発行する。

## 節制の候補条件と解呪後に維持する個体情報

候補：`cursed && curseRevealed`な所持中・装備中のweapon/armor個体（Phase20.0d`getTemperanceCandidates`既存ロジック）。解呪は対象個体の`cursed`のみ`false`化。`instanceId`・`definitionId`・`refineLevel`・装備位置は無変更。`curseRevealed`は`true`のまま維持（未判明へ戻さない）。

## 星の対象候補と変換候補の除外規則

対象候補：所持中consumable・装備中/所持中weapon・armor（カード除外）。変換候補：`getTransformCandidatesForItem`（新設、`hasAlternateTransformCategory`をこの関数で再実装）が、`ITEM_IDS_IN_ORDER`の安定順から同カテゴリ・非カード・非除外品・自分以外を列挙。production床loot無効状態（`floorDropEnabled=false`）とは独立に、アイテムロースター全体から候補を作るため無関係。

## stack itemを1個だけ変換する規則

`resolveStarEffect`が対象stackを`-1`、変換先stackを`+1`。stack全体を変換しない。

## 装備個体変換時の新規instance規則

変換前個体を`equipmentInstances`から除去し、`createEquipmentInstance`で新規個体を生成（`refineLevel=0`・`cursed=false`・`curseRevealed=false`、旧個体のinstance IDは再利用しない）。

## 装備中変換時のslot維持

変換前が装備中だった場合、新規個体を同一slotへ自動的に再装備（`equippedWeaponId`/`equippedWeaponInstanceId`または`equippedArmorId`/`equippedArmorInstanceId`を新individual基準へ更新）。一時的な未装備状態は生じない。

## 星のRNG消費条件と候補安定順

候補0件：RNG非消費・不成立。候補1件：RNG非消費・確定変換。候補2件以上：`state.combatRngState`から`rollPercent`を正確に1回消費し、`ITEM_IDS_IN_ORDER`由来の安定順でインデックス選択。

## target selectionの開始・取消・stale・確定契約

開始：候補0件ならselection state自体を生成しない（消費・鑑定・ターン進行なし）。取消：完全no-op。stale（対象個体の状態変化等）：`confirmCardTargetSelection`が`null`を返し不成立。確定成功時のみ`use_targeted_card`アクション経由で消費・鑑定・1ターン進行が原子的に成立。

## 専用テストの完全な名称と結果

`phase-20-5a-targeted-card-effects.test.ts`：30件、全通過（temperance9、star11、target_selection6、regression4）

## focused検証結果

7ファイル、350件、全通過

## 変更ファイル一覧

- 変更：`src/game/types.ts`（`use_targeted_card`PlayerAction追加）、`src/game/turn.ts`（resolver実装・ディスパッチ・`getTransformCandidatesForItem`利用）、`src/game/card-target-selection.ts`（`getTransformCandidatesForItem`新設、`hasAlternateTransformCategory`をこれで再実装）、`src/game/events.ts`（`card_target_effect_resolved`イベント）、`src/game/message-log.ts`（対応ログ）、`src/main.ts`（confirm処理を実commitへ更新）、`src/game/__tests__/phase-20-0d-card-target-selection.test.ts`（resolver登録済み状態への前提修正3件）
- 新規：`src/game/__tests__/phase-20-5a-targeted-card-effects.test.ts`

## Phase 27で再調整する事項

節制・星そのものに仮値パラメータはないが、月・太陽が使う`EQUIPMENT_REFINE_LEVEL_CAP`はPhase27調整対象のまま。
