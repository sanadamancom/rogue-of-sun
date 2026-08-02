# Phase 12.4 毒消し・万能薬と状態異常解除基盤

## 目的

新しい消耗品「毒消し」（antidote）と「万能薬」（panacea）を追加する。毒消しはpoisonだけを解除する。万能薬は現在実装されているすべての状態異常（poison、movement_slow、蜘蛛の糸、石化）を一括解除する。attack_upは有利効果であり、どちらを使用しても解除しない。あわせて、activeEffects型（poison/movement_slow）と専用状態型（蜘蛛の糸/石化）の双方を安全に扱える状態異常解除基盤を実装する。

## 毒消し草ではなく毒消しとした修正

前回セッションで実装した「毒消し草」（アイコン🌿）は指示の誤りにより実装されたものであり、`git revert`で完全に打ち消し済み（コミット`b3701b6`）。本フェーズはボクタイ準拠の「毒消し」という名称、暫定アイコン💊で実装し直す。同じセッション内で「万能薬」も同時に新規追加する。

## 毒消しと万能薬の定義

- **毒消し（antidote）**：poisonだけを対象とする単一解除アイテム
- **万能薬（panacea）**：現在実装済みの状態異常4種（poison、movement_slow、蜘蛛の糸、石化）のうち有効なものをすべて一括解除するアイテム。解除した種類数に関わらず消費数は1個
- 両アイテムとも`attack_up`（有利効果）は一切解除しない

## 💊アイコンと表示上の識別

両アイテムとも暫定アイコンとして同一の💊を使用する（新規画像アセット追加なし、既存の絵文字glyph表示方式を踏襲）。地面表示・inventory表示のいずれもglyphは同一だが、`displayName`（「毒消し」／「万能薬」）で確実に区別できる。inventory overlayは既存の汎用的な表示ロジック（`ITEM_DEFINITIONS[itemId].displayName`を表示）をそのまま使うため、追加の実装なしで区別可能。

## 状態異常と有利効果の分類

タスク仕様の`status_ailment_model.classification`に従い、`types.ts`へ`StatusAilmentId = 'poison' | 'movement_slow' | 'spider_web' | 'petrification'`という明示的な型を新設した。`attack_up`は`EffectId`には含まれるが`StatusAilmentId`には含まれない——この型レベルの分離自体が「万能薬の対象を名前の否定判定で決めない」を保証する（`StatusAilmentId`は独立した明示的な列挙であり、`EffectId`から`attack_up`を除外して導出したものではない）。

## 万能薬の解除対象

`effects.ts`に`STATUS_AILMENT_IDS: StatusAilmentId[] = ['poison', 'movement_slow', 'spider_web', 'petrification']`という配列を中央定義した。`applyPanaceaUse`はこの配列を走査するのみで、`attack_up`を除外する判定ロジックは一切書いていない（配列に含まれていないため、判定不要）。将来状態異常が増えた場合はこの配列（と、専用状態であれば対応する削除関数）を拡張するだけで済む構造とした。

## activeEffectsと専用状態の解除基盤

- `effects.ts`へ`removeEffect(state, id: EffectId)`（activeEffects配列から指定IDの全レコードを削除、`'removed' | 'not_present'`を返す）を新設
- 蜘蛛の糸（`Actor.slowed`）・石化（`Actor.petrified`）はactiveEffectsとは異なるデータ形式（boolean）のため、それぞれ専用の`removeSpiderWebSlow(state)`・`removePetrification(state)`を新設
- 上記3つを統一的に呼び出せる単一の窓口として`removeStatusAilment(state, id: StatusAilmentId)`を新設。`turn.ts`はこの関数だけを呼び出し、`state.activeEffects`や`player.slowed`/`player.petrified`を直接操作することはない
- `removeEffect`は不正な複数レコードが存在する場合でも全て削除する防御的な実装（`effects.filter((e) => e.id !== id)`により、IDが一致する全要素を除去）

## 石化中の万能薬使用方法

`turn.ts`の`applyPlayerAction`冒頭にあるpetrified最優先チェックへ例外を追加した：

```
if (player.petrified) {
  if (action.type === 'use_item' && action.itemId === 'panacea') {
    const panaceaResult = applyItemUse(state, action.itemId, events);
    if (panaceaResult.consumed) {
      return panaceaResult;
    }
  }
  player.petrified = false;
  events.push({ type: 'player_petrified_skip' });
  return { consumed: true, attacked: false, defeated: false };
}
```

石化中に`use_item(panacea)`が送られた場合のみ、通常の`applyItemUse`経路を試行する。実際に成功した場合（石化を含むいずれかの状態異常が解除された場合）はその結果をそのまま返し、強制スキップコードへは到達しない——これにより「万能薬使用に成功したターンでは石化の強制スキップを重複して処理しない」を満たす。所持していない、あるいは万が一失敗した場合は、既存の強制スキップ処理へフォールスルーする——「万能薬を所持していない場合は既存どおり石化ターンを処理する」を満たす。石化中に毒消しや他のアイテム・移動・攻撃・待機を送った場合は、この例外に該当しないため既存どおり強制スキップが発生する。

**石化中の操作方法**：inventory overlay自体はTabキーで開閉できる（main.ts側のUI処理であり、`processTurn`やpetrified状態と無関係に常時操作可能）。石化中に overlay を開いて万能薬を選択・使用（Enter）した場合のみ、上記の例外ロジックにより実際に処理される。他の操作（移動、攻撃、待機、毒消しを含む他アイテムの使用）は石化中は全て強制スキップに置き換えられる。

## 成功使用、失敗使用、ターン処理順

**成功時（毒消し・万能薬共通のパターン）**：`applyPlayerAction`内でアイテム使用を解決（対象の状態異常を`removeStatusAilment`で即座に解除→在庫を1個だけ減算→対応イベント発行→`inventoryOpen = false`）→`resolveEnemiesAction`（通常1回のみ。`use_item`は`move`アクションではないため、movement_slowが解除される直前に有効であっても追加敵フェーズの対象にならない）→`applyHungerProgression`（生存時）→`applyPoisonTick`（poisonは既に削除済みのため`getEffectStrength`が0を返し無害）→`playerDefeated`確定→自然回復（生存時）→`advanceEffectDurations`（残っているactiveEffects——通常はattack_upのみ——を通常どおり1減算）→通常のターン確定

**失敗時（毒消し：poison未発動／万能薬：対象状態異常なし）**：`antidote_use_failed`／`panacea_use_failed`を発行→`consumed: false`即返却。アイテム・ターン・inventory overlay・敵行動・満腹度・自然回復・効果状態のいずれも変化しない

## 配置条件と専用RNG

- `mapgen.ts`へ`chooseRoomFloorPosition(map, rooms, exclude, rng): Vec2 | null`を新設（部屋内限定、開始地点/出口からの最小距離制約なし、候補なしで例外を投げない）。既存の`chooseGroundItemPosition`（通路許容・例外あり）、`chooseTrapPosition`（距離制約ハードコード）のいずれも要件に合わないため専用関数とした
- `state.ts`の`buildFloorState`で、poison_trap配置ブロックの直後に毒消し配置ブロック（専用RNG、15番目のXOR定数`0x6d5a91e7`）、続けて万能薬配置ブロック（専用RNG、16番目のXOR定数`0x2e8f4b6d`）を追加
- 万能薬の配置除外リストには毒消しの配置済み座標を含めることで、両者が同一タイルに重複しないようにした

## 既存配置と乱数順への非干渉

毒消し・万能薬の配置はいずれも既存の全配置処理（map生成、start/exit/敵配置、既存アイテム、両罠配置）が完了した後に実行され、専用の独立したRNGストリームのみを消費する。テストで同一seedでの既存配置結果・`combatRngState`が変化しないことを確認済み。

## イベント、メッセージ、HUD

- **イベント**：`events.ts`へ`effect_removed`（`effectId: StatusAilmentId`, `reason: 'antidote' | 'panacea'`）、`antidote_used`/`antidote_use_failed`、`panacea_used`/`panacea_use_failed`を追加。`effect_removed`の`effectId`を`EffectId`ではなく`StatusAilmentId`型にしたことで、「attack_upについてeffect_removedを発行しない」という制約が型レベルでも保証される（`attack_up`は`StatusAilmentId`に存在しないため、そもそも`effect_removed`のペイロードとして渡せない）
- **メッセージ**：`message-log.ts`へ「毒消しを使った。」「毒が消えた。」「今は毒に侵されていない。」「万能薬を使った。」「状態異常が治った。」「今は治す状態異常がない。」を追加
- **重複メッセージ対策**：万能薬が複数の状態異常を同時に解除すると、`effect_removed`イベントが解除数分（最大4件）発行される。これをそのまま`formatEvent`で1件ずつ文字列化すると「状態異常が治った。」が複数回連続表示されてしまうため、`formatEvents`へ「直前の行と同一内容なら連続して表示しない（連続する重複行の折りたたみ）」という処理を追加した。既存の他イベント種別が連続して同一文字列を生成することはないため、この変更はPhase 12.4以前の挙動には一切影響しない
- **HUD**：`effectsHudLabel()`は`getActiveEffects`から汎用的に取得するため、`removeEffect`でpoison/movement_slowが配列から消えた次の描画で自動的にHUD表示から消える。専用コードの追加は不要だった

## telemetry schemaVersion 4を維持した理由

`antidote_used`/`panacea_used`はいずれも既存の`item_used`（`itemId`, `effect: string`, `amount: number`という既に拡張可能な設計のフィールド）へ新しい文字列値（`'poison_cure'`/`'status_cure'`）を追加しただけであり、フィールドの型・意味を変更していない。`effect_removed`・`antidote_use_failed`・`panacea_use_failed`は新規イベント型だが、`telemetry.ts`の`translateGameEvent`は既存の非網羅的switch＋catch-all defaultのため、これらを翻訳対象に含めなくても型エラーにならず、telemetryスキーマへの影響がない。既存の`damageTaken`集計・`damageTakenByEnemy`・`endCause`判定ロジックにも一切変更を加えていない。以上より「新しいダメージ源や既存集計の意味変更」に該当しないと判断し、schemaVersionは4のまま維持した。

## 変更ファイル

- `src/game/types.ts`：`ItemId`へ`'antidote'`/`'panacea'`追加、`StatusAilmentId`型新設
- `src/game/item-def.ts`：`antidote`/`panacea`の`ItemDefinition`、`ITEM_IDS_IN_ORDER`への追加
- `src/game/effects.ts`：`removeEffect`/`removeSpiderWebSlow`/`removePetrification`/`removeStatusAilment`/`STATUS_AILMENT_IDS`追加
- `src/game/events.ts`：`effect_removed`/`antidote_used`/`antidote_use_failed`/`panacea_used`/`panacea_use_failed`イベント追加
- `src/game/message-log.ts`：新規メッセージ追加、`formatEvents`への連続重複行折りたたみ処理追加
- `src/game/mapgen.ts`：`chooseRoomFloorPosition`関数新設
- `src/game/state.ts`：`buildFloorState`へ毒消し/万能薬配置ブロック追加
- `src/game/turn.ts`：petrified最優先チェックへ万能薬使用の例外追加、`applyItemUse`へantidote/panacea分岐追加、`applyAntidoteUse`/`applyPanaceaUse`関数新設
- `src/game/telemetry.ts`：`antidote_used`/`panacea_used`のitem_used変換処理追加
- `src/game/__tests__/phase-12-4-curative-items.test.ts`（新規）：Phase 12.4の全required_testsカテゴリを網羅するテスト
- `src/game/__tests__/armor-and-golem.test.ts`ほか19テストファイル：`Inventory`型が`antidote`/`panacea`キーを必須とするようになったことに伴う既存インラインinventoryリテラルへの`antidote: 0, panacea: 0`追加（値は常に0、既存テストの意図・アサーションは一切変更していない）

## 追加・更新テスト

`phase-12-4-curative-items.test.ts`（33件、新規）：
- 登録（ItemId/ITEM_DEFINITIONS/ITEM_IDS_IN_ORDER、表示順、glyph、displayNameでの区別、createEmptyInventory）
- 配置（各1個以下、決定性、相互非重複・既存配置との非重複、既存配置・combatRngStateへの非干渉）
- 状態異常解除基盤（`STATUS_AILMENT_IDS`のattack_up除外、`removeEffect`単体、`removeSpiderWebSlow`/`removePetrification`、not_present判別、不正な複数レコードの全削除、`removeStatusAilment`の全種別への正しい振り分け）
- 毒消し（poisonのみ解除、他状態への非干渉、毒ダメージなし、poisonなしでの失敗と無変化、イベント各1回）
- 万能薬（poison単独/movement_slow単独/蜘蛛の糸単独/石化単独での解除、石化中の使用成立、4種同時解除とattack_up維持、消費数が常に1個、対象なしでの失敗と無変化、毒ダメージなし、追加敵フェーズなし、未所持時の通常石化スキップ、失敗時の非進行）
- ターン処理順・副作用の隔離（1ターン消費、失敗時のoverlay非クローズ、フロア間維持・新規ラン初期化、既存罠との非干渉）

既存19テストファイルへの`antidote: 0, panacea: 0`追加はテスト内容・アサーションの変更ではなく、`Inventory`型の完全性維持のための機械的な追加のみ。

## 型チェック、全テスト、build、diff check結果

- `npx tsc --noEmit`：成功
- `npx vitest run`：55テストファイル・1294件（既存1261件＋新規33件）全成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 既存バランス値を変更していないこと

poisonの強度3・持続10、attack_up（強度5・持続20）、movement_slow（強度1・持続10）、slow_trap/poison_trapの配置数・条件、蜘蛛の糸・石化の付与条件・持続条件、所持上限20、満腹度・自然回復・プレイヤー・敵・武器・防具の数値、フロア生成アルゴリズムはいずれも変更していない。

## Phase 12.5以降を開始していないこと

状態異常耐性、敵への毒消し・万能薬使用や毒付与、罠の発見・解除・可視化、睡眠・麻痺・混乱・暗闇・封印の新規実装、経験値・レベルアップ・能力割り振りのいずれも実装していない。HP回復を毒消し・万能薬へ追加しておらず、万能薬でattack_upを解除しない。

## 未確認事項

- HUD・地面表示・inventory表示の実際の見た目（💊アイコンの視覚的な識別性、状態異常表示の消去タイミング）はPhaser実行時の描画としては自動テスト対象外。手動プレイでの目視確認は行っていない
- 石化中にinventory overlayを開いて実際にキー操作で万能薬を選択・使用する一連のUI操作フロー（`main.ts`のキー入力処理経路）は、`processTurn`レベルのロジックとしてはテスト済みだが、実際のキー入力〜画面表示までの結合的な確認は行っていない
- 万能薬が同時に4種類の状態異常を解除する状況は、蜘蛛の糸・石化・poison・movement_slowが偶然同時に成立するという実プレイ上まれなケースであり、自動テストでは人工的に状態を構築して検証した。実プレイでの発生頻度・体感については未検証
