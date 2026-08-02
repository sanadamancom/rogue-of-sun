# Phase 14.2 五属性の取得・解禁・選択・切替

## 目的

Phase 14.1で導入した五属性（sol/flame/frost/cloud/earth）の型・敵相性・
共通ダメージ計算基盤の上に、flame・frost・cloud・earthの専用取得物をラン
内へ配置し、取得による解禁、Fキーによる順送り切替（none→sol→flame→
frost→cloud→earth→none、未解禁属性はスキップ）を実装する。本フェーズでは
他四属性の戦闘効果・敵の正式な弱点耐性・完成版演出には一切着手しない。

## precheck結果

- 開始時point: local HEAD = origin/main = `678711a42c7853822a6f0280354e7ff3cc72c169`
- working tree: clean
- 既存テスト: 61ファイル、1451件、全成功
- `npx tsc --noEmit` / `npx vite build`: 成功
- 全条件一致を確認した上で、mainから作業ブランチ
  `phase-14-2-element-acquisition` を作成した

## 調査した既存ソル取得・切替処理

- `turn.ts`のground item自動取得（`applyMove`内、`item.itemId ===
  'sol_enchantment'`分岐）: インベントリへ入れず、`solUnlocked`を直接
  trueにし、`selectedEnchantment`は変更しない（自動選択しない）、
  idempotent（再取得不可、既に解禁済みなら何もしない）。
- `input.ts`のFキー: `actionForKey('f')` → `{ type: 'toggle_enchantment'
  }`。ターンを消費しない設計（`processTurn`側の`toggle_enchantment`
  ハンドラが常に`consumed: false`を返す）。
- 旧`toggle_enchantment`ハンドラ（Phase 10.1時点）: `solUnlocked`が
  falseなら即no-op（イベントなし・状態変更なし）。trueなら
  `selectedEnchantment`を`'none'`↔`'sol'`で単純トグル。
- `state.ts`のground item配置: 各アイテムが専用の独立RNGストリーム
  （`floorSeed ^ 定数`）を持ち、既存アイテム・敵・start/exitを除外して
  `chooseGroundItemPosition`で1個選ぶパターンが一貫して使われている
  ことを確認。
- `EnemyDefinition.elementalAffinities`・`unlockedEnchantments`・
  `selectedEnchantment`・`ElementId`・`EnchantmentId`はPhase 14.1の完了
  報告と一致することを確認。
- 現在のフロア数（`TOTAL_FLOORS`）が3であることを確認。

調査結果は前提と一致したため実装を継続した。

## 追加した四種類の専用取得物

`ItemId`へ`flame_enchantment`/`frost_enchantment`/`cloud_enchantment`/
`earth_enchantment`を追加し、`item-def.ts`に`sol_enchantment`と同じ
パターン（`ITEM_IDS_IN_ORDER`から除外＝インベントリへ入らない、
`category: 'consumable'`, `consumable: false`, `stackable: false`）で
登録した。表示名・仮グリフ（🔥/❄️/☁️/🪨）は新設の`element-def.ts`
（`ELEMENT_DISPLAY_NAMES`/`ELEMENT_GLYPHS`）を単一の情報源として参照し、
`item-def.ts`とHUD（`main.ts`）とメッセージログの三箇所で名称が重複定義
されないようにした。

## 各フロアへの配置結果

`state.ts`の`buildFloorState`へ、既存の毒消し/万能薬配置の直後に以下を
追加：

- floor 1: `flame_enchantment`を1個（RNG定数 `0x8b3e6f1a`）
- floor 2: `frost_enchantment`を1個（`0x1e7c5a94`）→`cloud_enchantment`
  を1個（`0x4f9d2b83`）。cloudは可能な限りfrostと別の部屋へ配置する
  ため、まずfrostの`roomIndexContaining`結果の部屋タイルをすべて除外
  リストへ加えて`chooseGroundItemPosition`を試み、候補が0件で例外に
  なった場合のみ（`chooseGroundItemPosition`は候補0件のとき`rng()`を
  一度も呼ばずに即例外を投げるため、この失敗はRNG消費を伴わない）
  室除外なしで同じRNGストリームへ再試行する。
- floor 3: `earth_enchantment`を1個（`0xb2c76e19`）

3フロア構成で四種類すべてが1ラン中に取得可能で、各1個だけ配置され、
既存のground item/trap/敵/start/exitと重複しない（既存の除外リスト
パターンをそのまま踏襲）。

## 配置の決定性と既存RNGへの非介入性

4個とも新規かつ他で使われていない独立XOR定数で`createRng(floorSeed ^
定数)`から作った専用RNGストリームのみを消費するため、マップ生成・敵配置
・既存アイテム・罠のRNGシーケンスや消費順は変更されない。同一シードでの
再現性、敵配置の決定性（`enemies.map(pos/type)`が同一シードで一致）を
テストで確認した。

## 取得時の解禁処理

`turn.ts`のground item自動取得ハンドラへ、`sol_enchantment`の既存分岐に
並ぶ形で`flame_enchantment`等4種の分岐を追加した
（`ELEMENT_ENCHANTMENT_ITEM_IDS`でItemId→ElementIdを引く）。取得すると
対応する`unlockedEnchantments[element]`だけをtrueにし、他属性・
`selectedEnchantment`は変更しない。インベントリへは入らず、床から消滅
し、歩行以外の追加ターンは発生しない（既存のsol_enchantment取得と同じ
`applyMove`の流れの中で処理される）。新規イベント`element_enchantment_
acquired`を1回だけpushする（idempotent、`sol_enchantment_acquired`とは
別イベント名で、solの挙動には触れない）。

## フロア遷移、新規ラン、再挑戦時の状態

`unlockedEnchantments`はPhase 14.1で追加済みの`CarryOverStats`経由で
フロア遷移時に維持される（本フェーズでの変更なし）。新規ラン・死亡後
再挑戦では`carry`が存在しないため、`buildFloorState`が五属性すべて
`false`・`selectedEnchantment: 'none'`から開始する（Phase 14.1と同じ
初期化パス）。

## Fキーの確定した切替順

`turn.ts`に`ENCHANTMENT_CYCLE_ORDER = ['none', 'sol', 'flame', 'frost',
'cloud', 'earth']`を追加し、これを唯一の順序定義とした（他のファイルに
順序の重複記述なし、`rg`で確認済み）。`getEnchantmentCycleCandidates`が
`'none'`を無条件、他4属性を`unlockedEnchantments[element]`がtrueの
ものだけに絞った配列を返す。`toggle_enchantment`ハンドラは現在の選択の
`candidates`内indexを求め、`(index + 1) % candidates.length`で次を選ぶ
（末尾から先頭へ循環）。

## 未解禁属性を飛ばすこと

`getEnchantmentCycleCandidates`のフィルタにより、未解禁の属性は
候補配列に含まれないため自動的にスキップされる。全解禁時は
none→sol→flame→frost→cloud→earth→noneの6候補循環、solのみ解禁時は
none→sol→noneの2候補循環（Phase 10.1の既存挙動と完全一致）、部分解禁
（例: sol+frost）ではnone→sol→frost→noneの3候補循環になることをテスト
で確認した。何も解禁されていない場合は`candidates.length === 1`
（`['none']`のみ）となり、イベントなし・状態変更なしのno-opになる
（Phase 10.1の「ソル未解禁時は何もしない」を全属性未解禁の場合へ一般化
したもの）。

## F操作がターンとRNGを進めないこと

`toggle_enchantment`ハンドラは変更後も常に`{ consumed: false, attacked:
false, defeated: false }`を返す。`state.turn`・敵位置・`hunger`・
`combatRngState`が変化しないことをテストで確認した。

## 他四属性の戦闘効果を実装していないこと

`applyPlayerAttackToEnemy`のsolエンチャント発動条件は
`state.selectedEnchantment === 'sol'`のままで変更していない。flame/
frost/cloud/earthを選択していても、この条件に一致しないため通常の
物理攻撃としてのみ解決され、SOL消費・`sol_enchantment_used`イベント・
新規戦闘イベントは一切発生しない。素手・sword・spear・hammer・
solar_gunの既存挙動、物理ダメージ式、命中率式、RNG消費順は無変更。

## 既存ソル戦闘が維持されたこと

sol選択時の追加ダメージ10・SOL消費1・命中/ミス/SOL0時のフォールバック
挙動はPhase 14.1までと完全に同じであることをテストで確認した。

## 全現行敵が五属性neutralのままであること

`enemy-def.ts`の`elementalAffinities`は本フェーズで一切変更していない
（9種全敵が五属性すべてneutralのまま、`rg`で確認済み）。
`computeElementalDamage`と相性倍率テーブルも無変更。

## telemetry v7を維持したこと

`schemaVersion: 7`、エクスポートファイル名`rogue-of-sun-run-v7-...`は
無変更。`telemetry.ts`自体へのコード変更は行っていない。flame/frost/
cloud/earth選択中の通常物理攻撃では`sol_enchantment_used`が発火しない
ため、telemetryの`additionalDamage`は自然に0になる（既存の
`player_attack`翻訳ロジックがそのまま使われるだけで、telemetry側の
特別な分岐は追加していない）。

## 変更ファイル

- `src/game/types.ts`: `ItemId`へ4種の`*_enchantment`追加
- `src/game/element-def.ts`（新規）: `ELEMENT_DISPLAY_NAMES`/
  `ELEMENT_GLYPHS`
- `src/game/item-def.ts`: 4種のItemDefinition追加
- `src/game/events.ts`: `element_enchantment_acquired`イベント追加
- `src/game/turn.ts`: pickup分岐追加、`ENCHANTMENT_CYCLE_ORDER`/
  `getEnchantmentCycleCandidates`追加、`toggle_enchantment`ハンドラを
  五属性対応へ書き換え
- `src/game/message-log.ts`: `enchantment_toggled`を全属性対応へ一般化
  （sol選択時の表示文言はバイト単位で従来と同一）、
  `element_enchantment_acquired`ケース追加
- `src/game/state.ts`: floor 1/2/3への4アイテム配置ブロック追加
- `src/main.ts`: HUDの`enchantHudLabel`を五属性対応へ拡張（「未取得」
  判定をsolUnlockedから「いずれかの属性が解禁済みか」へ一般化）
- `src/game/__tests__/*.test.ts`（既存24ファイル）: `Inventory`型が
  必須化した4つの新規キーをテストフィクスチャのインベントリ literal
  へ追加（`sol_enchantment: 0`直後に4キーを追加、値はすべて0）。
  `phase-10-1-sol-enchant.test.ts`の1箇所は`solUnlocked: true`単独
  オーバーライドが`unlockedEnchantments.sol`と矛盾する非現実的な状態に
  なっていたため、整合するよう修正した。
- `src/game/__tests__/phase-14-2-element-acquisition-selection.test.ts`
  （新規）: 本フェーズの検証テスト

## テスト結果

新規テストファイル: 32件、全成功（配置9件、取得7件、切替8件、戦闘境界
5件、telemetry2件、内訳はおおよそ）。既存61ファイル1451件を含む全体：
62ファイル、1483件、全成功。`npx tsc --noEmit`: 成功。`npx vite build`:
成功。`git diff --check`: 問題なし。

## Phase 14.3へ未着手であること

本コミットはPhase 14.2の範囲（取得・解禁・選択・切替）のみを実装した。
flame/frost/cloud/earthの戦闘効果、敵への正式な弱点・耐性分布、完成版
演出はPhase 14.3以降へ持ち越しており、着手していない。
