# Phase 20.5b 月・太陽（Phase 20完了）

## 目的

月（moon）・太陽（sun）を実装し、Phase 20（17種全カード効果）を完了する。開始commit：`5da2bb4d296bca9cefa3290d9a78648710119454`。

## refineLevelの戦闘計算反映状況の監査結果

`refineLevel`の値自体はPhase 20.0cから既に管理されているが、実際の攻撃力・防御力計算（`getPowerDamageBonus`・weapon-def/armor-def由来の基礎値）へは一切反映されていないことを確認した。この反映処理は既存方針（Phase20は仮値配置まで、実計算接続はPhase24/27）に沿ってPhase20の範囲外として扱う。月・太陽は`refineLevel`の数値管理のみを行う。

## moon/sunの対象決定方法

装備中固定（`state.equippedWeaponInstanceId`／`state.equippedArmorInstanceId`）。Phase20.0dの対象選択基盤（`getTargetSelectableCardId`等）は一切使用しない。未装備時は不成立（`no_valid_target`、消費・鑑定・ターン・RNG無変化）。

## refineLevel上限のクランプ規則

`EQUIPMENT_REFINE_LEVEL_CAP`（Phase20.0c既存定数、変更なし）を用い`Math.min(cap, refineLevel+1)`。既に上限に達している場合も「効果0でも成立」の契約に従い消費・鑑定・ターン進行は成立する。

## production実装箇所

`turn.ts`：`applyMoonCardUse`／`applySunCardUse`、`applyCardUse`ディスパッチへ登録。`events.ts`：`card_refine_applied`イベント（`refineLevelBefore`/`refineLevelAfter`比較で効果0判定可能）。`message-log.ts`：対応ログ。

## 専用テストの完全な名称と結果

`phase-20-5b-equipment-card-effects.test.ts`：21件、全通過（moon9、sun9、regression3）

## focused検証結果

3ファイル、166件、全通過

## 全通常テストの結果

**94ファイル、2380件、全通過**

## typecheck・build・git diff --check結果

いずれも成功・問題なし

## 変更ファイル一覧

- 変更：`src/game/turn.ts`（`applyMoonCardUse`/`applySunCardUse`、ディスパッチ登録、`EQUIPMENT_REFINE_LEVEL_CAP`のimport追加）、`src/game/events.ts`（`card_refine_applied`イベント）、`src/game/message-log.ts`（対応ログ）
- 新規：`src/game/__tests__/phase-20-5b-equipment-card-effects.test.ts`

---

## Phase 20 完了報告：17種全カードの効果実装状況

| カード | Phase | 効果概要 | production実装 |
|---|---|---|---|
| 女教皇 | 20.1 | ココロ+1 | ✅ |
| 女帝 | 20.1 | カラダ+1 | ✅ |
| 戦車 | 20.1 | ハヤサ+1 | ✅ |
| 力 | 20.1 | チカラ+1 | ✅ |
| 運命の輪 | 20.1 | 4能力から1つ等確率+2 | ✅ |
| 恋人 | 20.2 | SOL全回復（満タンでも成立） | ✅ |
| 吊るされた男 | 20.2 | LIFE/SOL整数交換（同値でも成立） | ✅ |
| 皇帝 | 20.3 | 敵直接ダメージ50%軽減、5ターン | ✅ |
| 死神 | 20.3 | LIFE0・SOL全回復（既存実装） | ✅ |
| 審判 | 20.3 | 死亡時1枚消費でLIFE全回復（既存実装） | ✅ |
| 正義 | 20.4 | 同室敵へLIFE減少量ダメージ | ✅ |
| 悪魔 | 20.4 | SOL3消費、同室敵へ固定5ダメージ | ✅ |
| 塔 | 20.4 | 同室敵＋自分へレベル3倍ダメージ | ✅ |
| 節制 | 20.5a | 判明済み呪い装備を解呪 | ✅ |
| 星 | 20.5a | 同カテゴリ内で装備・所持品を変換 | ✅ |
| 月 | 20.5b | 装備中武器のrefineLevel+1 | ✅ |
| 太陽 | 20.5b | 装備中防具のrefineLevel+1 | ✅ |

全17種（愚者を除く大アルカナ基準）が通常カード使用経路（`processTurn`の`use_item`または`use_targeted_card`）から到達可能な状態になった。

## Phase 21以降へ委ねる項目

- 全17カードの`floorDropEnabled`は依然`false`のまま（床出現設計自体はPhase21以降）
- `lootWeight`・`unlockFloor`の確定値決定（Phase20.0eの型自体は現存するが未使用のまま据え置き）
- 敵ドロップ経路（`enemyDropEnabled`）は全カード`false`のまま未実装
- 皇帝の軽減率・継続ターン数、正義・悪魔・塔のダメージ係数、月・太陽の`EQUIPMENT_REFINE_LEVEL_CAP`はいずれもPhase20仮値、Phase27で最終調整
- `refineLevel`の実戦闘計算（攻撃力・防御力）への反映はPhase24/27の責務として未実装

## 開発計画への反映が必要な事項

- 皇帝がPhase20単位表に単位定義を持たなかった件（Phase20.3の履歴文書で既報告）
- 審判の実装順序が計画書のPhase20.3位置づけと実際のcommit順序（20.0c/20.0d以前）で食い違う件（Phase20.2の履歴文書で既報告）
