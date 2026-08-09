# Phase 20.0d カード対象選択基盤

## 実施内容

Temperance（節制）・Star（星）が使用する対象選択基盤を実装した。カード別の有効対象候補生成、候補の表示・移動・選択・取消、確定時の対象identity再検証、選択結果を将来のカード効果resolverへ渡す型付き契約を実装した。

Temperance・Starの実効果（解呪・変換）は実装していない。Moon・Sunは対象が装備中個体へ固定されるため、この基盤を使用しない。

## 節制・星の対象候補生成

`getTemperanceCandidates`：所持中（床上を除く）の`cursed && curseRevealed`な武器・防具個体のみを候補とする。装備中・未装備どちらも含む。

`getStarCandidates`：所持中consumable（カード除外、所持数>0）と所持中武器・防具個体のうち、`hasAlternateTransformCategory`（同カテゴリ内に自分以外の有効ItemIdが存在するか）を満たすもの。現行`ArmorId`は1種のみのため防具は常に除外される（意図した挙動）。

いずれも`GameState`を変更せずRNGも消費しない純粋関数。

## stale target回復とheld identity判定

`getHeldEquipmentInstances`（`equipment-instance.ts`）：`inventory`の種別ごとの個数を真実源とし、装備中個体を優先的に含め、`inventory`数を超える孤立個体・床上個体・discard済み個体を除外する。

`refreshCardTargetSelection`：確定直前の対象が無効化された場合、候補を現在のGameStateから再生成し、直前のカーソル対象を`CardTargetRef`で追跡してカーソル位置を維持する。候補が0件になった場合は`null`を返し、呼び出し元は選択画面を安全に終了する。

## resolver用working stateの隔離

`resolveCardTargetEffect`は`structuredClone(state)`で作業用コピーを生成し、resolverにはこのコピーのみを渡す。GameStateが完全にJSON直列化可能という既存設計原則により`structuredClone`が安全に機能する。`combatRngState`もGameStateの一フィールドのため、state全体の隔離により自動的に隔離される。

## successとfailure transactionの違い

```ts
type CardTargetEffectTransaction =
  | { status: 'failure'; reason: CardTargetEffectFailureReason }
  | { status: 'success'; nextState: GameState };
```

failure側はreasonのみを保持し、stateを一切保持しない（型レベルでcommit対象が存在しない）。success側は隔離された作業コピーに効果適用済みの`nextState`を保持する。resolverがworking stateを変更してからfailureを返しても、そのworking state自体が破棄されるため元のGameStateは不変。

## PendingCardTargetEffectHolder

`card-target-selection.ts`に新設したクラス。`private pending: PreparedCardTargetEffect | null`をカプセル化し、以下の型付きAPIのみを公開する。

- `setFromTransaction(cardId, target, transaction)`：成功なら格納、失敗なら自動的に消去
- `clear()`：無条件消去。新規選択開始・cancel・stale target・restartの全イベントがこの同一メソッドを呼ぶ
- `peek()`：値を消費せず参照
- `take()`：値の取得と消去を1操作で行う（Phase 20.5aのcommit工程用）

`main.ts`はこのクラスのインスタンスを`private readonly`フィールドとして保持し、外部からの直接代入経路を持たない。

## success時だけpendingを保持すること／failure・新規選択・cancel・stale・restart時の消去

`setFromTransaction`内部で`toPreparedCardTargetEffect`（`transaction.status !== 'success'`なら`null`を返す純粋関数）を呼ぶため、失敗時は自動的に`null`（消去）となる。新規選択開始・cancel・stale target・restartの4イベントはいずれも`.clear()`を呼ぶ共有経路。

## pending生成だけではstateをcommitしないこと

`main.ts`の確定ハンドラは`setFromTransaction`を呼ぶのみで、`.take()`や`.peek()`の戻り値を`this.state`へ代入する処理を一切持たない。

## production resolverが空であること

`CARD_TARGET_EFFECT_RESOLVERS: Partial<Record<TargetSelectableCardId, CardTargetEffectResolver>> = {}`。Temperance・Starいずれも未登録。Phase 20.5aがここへresolverを追加することで接続する設計。

## 74件の専用テスト結果

`phase-20-0d-card-target-selection.test.ts`：candidate_generation（temperance 7、star 8、purity/determinism 4）、selection 10、information_safety 3、transaction 3、regression 1、entry 5、stale_target_recovery 5、held_identity 6、unregistered_resolver 3、atomic_failure 1、prepared_success 2、ui_confirm 2、success_handoff 3、failure_handoff 3、lifecycle 8、計74件、全通過。

## 検証結果

- Phase 20.0d専用74件：全通過
- Phase 20.0c専用62件：全通過（回帰なし）
- 全通常テストスイート（88ファイル、2184件）：全通過
- `npx tsc --noEmit`：成功
- `npx vite build`：成功
- `git diff --check`：問題なし

## 対象外

Temperanceの解呪効果、Starの変換効果とその抽選、Moon・Sunの対象選択接続（対象固定のためこの基盤を使わない）、カード消費・鑑定・ターン進行の共通成功処理への接続。
