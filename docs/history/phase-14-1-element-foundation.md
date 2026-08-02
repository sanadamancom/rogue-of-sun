# Phase 14.1 五属性共通基盤と既存ソル処理の移行

## 目的

エンチャントをソル単独の概念から五属性（sol / flame / frost / cloud / earth）
対応のデータモデルへ拡張し、共通の属性ダメージ計算関数を導入する。既存の
ソルエンチャント処理をこの共通基盤へ移行しつつ、現行の全敵をすべて neutral
とすることで、現在のゲーム結果・SOL消費・操作・HUD・telemetryを完全に維持
する。Phase 14.2以降で他属性の取得・戦闘効果を安全に追加できる土台を作る
ことが目的であり、Phase 14.1単体では他属性のゲームプレイは一切実装しない。

なお、本タスクの直前に提示されていた「ソル単独属性・弱点耐性基盤
(phase-14-1-sol-element-affinity)」という別案のPhase 14.1指示は、着手直後
（precheck・調査・実装途中）にキャンセルされ、本ドキュメントが記述する
「五属性共通基盤 (phase-14-1-element-foundation)」が正式なPhase 14.1として
実装された。ソル単独案のブランチ・変更は着手直後に破棄し、mainのc8f6cb5へ
リセットしてから本タスクを開始している。

## precheck結果

- repository: `sanadamancom/rogue-of-sun`
- 開始時point: local HEAD = `c8f6cb5`、origin/main = `c8f6cb5`（`git fetch
  origin --prune`後も一致）
- working tree: clean
- 既存テスト: 60ファイル、1430件、全成功
- `npx tsc --noEmit`: 成功
- `npx vite build`: 成功
- 全条件一致を確認した上で、mainから作業ブランチ
  `phase-14-1-element-foundation` を作成した

## Phase 14で扱う五属性

`sol`, `flame`, `frost`, `cloud`, `earth` の5種類。Phase 14.1では型として
定義するのみで、sol以外の取得・選択・戦闘効果・HUD表示は一切実装しない
（`not_implemented_now`の全項目を実装していない）。

## 今回扱わないルナと武器相性

`luna`という属性・状態・UI・コメント・予定コードへの追加は行っていない
（ドキュメント内で「lunaを追加しない」という除外事実を説明する文脈以外に
一切出現しない）。武器種別（sword/spear/hammer等）をElementIdへ混在させる
実装も行っていない。状態異常、敵の属性攻撃、プレイヤーの属性耐性、属性の
無効化・吸収・反射、複数属性同時適用は実装していない。

## 既存ソル処理の調査結果

実装前に以下を確認した：

- `computeAttackDamage`/`computeIncomingDamage`（combat.ts）: 物理ダメージ
  専用の純粋関数。呼び出し元はturn.tsの`applyPlayerAttackToEnemy`他。
- `applyPlayerAttackToEnemy`（turn.ts）: 命中判定後、物理ダメージ計算
  →ソルエンチャント発動条件判定→SOL消費→ボーナスダメージ加算→敵HP適用、
  という順で処理される唯一の箇所であることを確認。
- `resolveFacingAttack`/`resolveSolarGunAttack`: どちらも最終的に
  `applyPlayerAttackToEnemy`を経由する。
- `SOL_ENCHANT_ELIGIBLE_WEAPONS = ['sword', 'spear', 'hammer']`:
  素手とsolar_gunは対象外であることを確認。
- `SOL_ENCHANT_COST = 1`: 命中1回につきSOL1消費。
- `SOL_ENCHANT_BONUS_DAMAGE = 10`（現 `SOL_ELEMENTAL_BASE_DAMAGE`）:
  従来は固定加算だったソル追加ダメージ。
- ミス・空振り・対象不在・SOL不足のいずれでもSOLを消費しないことを確認
  （`solActivates`のガード条件を確認）。
- `sol_enchantment_used`イベント: `turn.ts`が1回だけpushする。
- `EnemyDefinition`（enemy-def.ts）: 9種の敵全定義を確認。属性相性の
  フィールドは存在しなかった。
- `player_attack` telemetry変換（telemetry.ts）: `sol_enchantment_used`が
  直前の`player_attack` RunEventの`physicalDamage`/`additionalDamage`/
  `calculatedDamage`/`solConsumed`を書き換える設計であることを確認。
- セーブ・再開: 本リポジトリにはディスクへのセーブ/ロード機構が存在せず
  （`localStorage`等の使用箇所なし）、フロア遷移時の状態引き継ぎのみが
  `state.ts`の`CarryOverStats`/`advanceToNextFloor`/`buildFloorState`で
  行われていることを確認した。新規ラン時は`carry`が存在しないため常に
  初期値になる。
- HUD/メッセージログ: `message-log.ts`の`sol_enchantment_used`ケースは
  固定文言「ソルの力が攻撃に宿った。」を返す。

調査結果は前提（ソル追加ダメージ10、SOL消費1、対象武器sword/spear/hammer、
素手とsolar_gun対象外、ミス等で非消費）と一致したため、実装を継続した。

## ElementIdと相性データモデル

`types.ts`に以下を追加：

```ts
export type ElementId = 'sol' | 'flame' | 'frost' | 'cloud' | 'earth';
export type ElementalAffinity = 'weak' | 'neutral' | 'resist';
export type EnchantmentId = ElementId | 'none';
```

`EnchantmentId`は既存の`'none' | 'sol'`から、五属性全てを含む
`ElementId | 'none'`へ拡張した。「ElementIdまたはnullで保持できるように
する」という要求は、既存の`'none'`文字列センチネルをそのまま維持する形
（nullを新規導入せず、'none'が意味的に同じ役割を果たす）で満たしている。
これにより既存の全ての`=== 'none'`比較・分岐が無変更で動作する。

## プレイヤーの五属性解禁状態

`GameState`に新規フィールド `unlockedEnchantments: Record<ElementId,
boolean>` を追加した。既存の`solUnlocked: boolean`はそのまま維持し
（戦闘コードが読む唯一の権威として維持）、`unlockedEnchantments.sol`は
`solUnlocked`がtrueになる同じ箇所（turn.tsのsol_enchantmentアイテム取得
処理）で同時に同期する。flame/frost/cloud/earthは常に`false`のまま
（取得アイテム・選択操作が存在しないため）。

新規ランでは全属性`false`から開始し、フロア遷移では
`CarryOverStats.unlockedEnchantments`として引き継がれる（solUnlocked/
selectedEnchantmentと同じ扱い）。

## 敵定義の五属性相性

`EnemyDefinition`に `elementalAffinities: Record<ElementId,
ElementalAffinity>` を必須フィールドとして追加した（オプショナルではない
ため、全敵が明示しない限り型エラーになる）。`ActorやEnemyActor`への複製
は行っていない。9種の現行敵（bok, cockatrice, spider, bat, mummy, golem,
sword, axe, kraken）全てに以下を設定：

```ts
elementalAffinities: { sol: 'neutral', flame: 'neutral', frost: 'neutral', cloud: 'neutral', earth: 'neutral' }
```

## Phase 14.1では全現行敵をneutralとした理由

正式な弱点分布は、他四属性（flame/frost/cloud/earth）の戦闘効果が確定
してから後続フェーズで設定する方針のため。マミーやクレイゴーレムを含め、
Phase 14.1では暫定的な弱点・耐性を一切割り当てていない。

## 共通属性ダメージ計算

`combat.ts`に以下を追加：

```ts
export const ELEMENTAL_AFFINITY_PERCENT: Record<ElementalAffinity, number> = {
  weak: 150,
  neutral: 100,
  resist: 50,
};

export function computeElementalDamage(baseElementalDamage: number, affinity: ElementalAffinity): number {
  return Math.floor((baseElementalDamage * ELEMENTAL_AFFINITY_PERCENT[affinity]) / 100);
}
```

`computeAttackDamage`/`computeIncomingDamage`と同じくGameState・
EnemyActor・RNG・イベントに依存しない純粋関数。倍率対応表はこの一箇所
のみに存在し、turn.ts等での重複記述は行っていない。

計算例：
- base 10, weak → floor(10 * 150 / 100) = 15
- base 10, neutral → floor(10 * 100 / 100) = 10
- base 10, resist → floor(10 * 50 / 100) = 5
- base 7, weak → floor(7 * 150 / 100) = floor(10.5) = 10（端数切り捨て）

## 物理ダメージとの分離

`turn.ts`の`applyPlayerAttackToEnemy`を以下の順で処理するよう移行した：

1. 既存の命中判定（変更なし）
2. `computeAttackDamage`による物理ダメージ計算（式そのものは無変更）
3. ソル発動条件判定（対象武器・選択中・解禁・SOL残量、全て無変更）
4. 発動時: SOLを1消費 → 対象敵の`elementalAffinities.sol`を取得 →
   `computeElementalDamage(SOL_ELEMENTAL_BASE_DAMAGE, affinity)`で属性
   ダメージを算出 → 物理ダメージへ加算
5. 敵HPへ適用、`targetHpBefore`/`targetHpAfter`からactualDamage相当を算出
6. 撃破・武器固有処理（変更なし）

敵の物理防御（`computeAttackDamage`内の`defenderDefense`）は物理部分
だけに適用され、属性ダメージへは再適用されない。power/attack_upの
ボーナスは既存どおり物理側（`state.player.attack`計算部分）にのみ効き、
mindは属性ダメージに一切影響しない。

## SOL消費と発動条件

`SOL_ENCHANT_ELIGIBLE_WEAPONS`（sword/spear/hammer）、
`SOL_ENCHANT_COST = 1`、素手・solar_gun対象外、ミス・空振り・対象不在・
SOL不足時の非消費、SOL不足時のフォールバック（選択維持したまま通常物理
攻撃）は全て無変更。現行敵が全てneutralであるため、ソル属性ダメージは
常に10（`floor(10 * 100 / 100)`）であり、Phase 10.1〜13時点の実際の
ゲーム結果と完全に一致する。

## イベント、ログ、telemetryの互換性

`sol_enchantment_used`イベントに`element: 'sol'`と
`affinity: ElementalAffinity`の2フィールドを追加した（ペイロード追加の
み、イベントの発生件数・順序・既存フィールドの意味は無変更）。
`bonusDamage`は引き続き「発動時の最終加算ダメージ」を意味し、現行は
常に10。

`message-log.ts`の`sol_enchantment_used`ケースは変更していない（固定
文言のまま）。weak/resist用の新しい実戦ログは、正式な弱点分布が導入
される後続フェーズへ持ち越した。

telemetryは`telemetry.ts`の`sol_enchantment_used`ハンドラが直前の
`player_attack` RunEventの`physicalDamage = event.baseDamage`、
`additionalDamage = event.bonusDamage`、
`calculatedDamage = baseDamage + bonusDamage`を設定する既存ロジックを
そのまま利用しており、`bonusDamage`が常に10であるため、telemetryの
出力値も既存と完全に一致する。`telemetry.ts`自体への変更は行っていない。

## telemetry schemaVersion 7との整合

`schemaVersion: 7`（`RunTelemetry`/`TelemetryDocument`）、エクスポート
ファイル名`rogue-of-sun-run-v7-...`は共に無変更。`telemetry.ts`への
コード変更は一切行っていない。

## 非介入性とRNG互換性

`combat.ts`の`computeElementalDamage`はGameState・EnemyActor・RNGに
一切触れない純粋関数。命中率計算・RNG消費順（`rollPercent`の呼び出し
箇所・回数）は無変更。敵AI（`resolveOneEnemy`等）へは一切触れていない。

## 変更ファイル

- `src/game/types.ts`: `ElementId`/`ElementalAffinity`型追加、
  `EnchantmentId`拡張、`GameState.unlockedEnchantments`追加
- `src/game/state.ts`: `CarryOverStats.unlockedEnchantments`追加、
  `buildFloorState`/`advanceToNextFloor`でのcarry処理追加
- `src/game/combat.ts`: `ELEMENTAL_AFFINITY_PERCENT`、
  `computeElementalDamage`追加
- `src/game/enemy-def.ts`: `EnemyDefinition.elementalAffinities`追加、
  全9敵にneutral×5属性を設定
- `src/game/turn.ts`: `applyPlayerAttackToEnemy`をcomputeElementalDamage
  経由へ移行、`unlockedEnchantments.sol`をsolUnlocked設定と同時に同期
- `src/game/events.ts`: `sol_enchantment_used`イベントへ`element`/
  `affinity`フィールド追加
- `src/game/__tests__/*.test.ts`（36ファイル）: 新規必須フィールド
  `unlockedEnchantments`をGameStateフィクスチャへ追加（値は既存の
  `solUnlocked`と同一のsol、他四属性はfalse）
- `src/game/__tests__/phase-14-1-element-foundation.test.ts`（新規）:
  本フェーズの検証テスト

## テスト結果

新規テストファイル `phase-14-1-element-foundation.test.ts`: 21件、全成功
（ElementId型検証、computeElementalDamageの純粋計算、敵定義の五属性
neutral検証、プレイヤー解禁状態、ソル戦闘のneutral回帰、武器回帰、
telemetry互換性）。

既存60ファイル1430件を含む全テスト: 61ファイル、1451件、全成功。
`npx tsc --noEmit`: 成功。`npx vite build`: 成功。`git diff --check`:
問題なし。

## Phase 14.2以降への持ち越し

- flame/frost/cloud/earthの取得アイテムと戦闘効果
- 他属性の選択操作・HUD表示
- 敵への正式な弱点・耐性分布の設定
- 属性別telemetry集計軸

## Phase 14をまだ完了としていないこと

本コミットはPhase 14.1のみの完了を表す。`phase_scope.phase_14_complete:
false`のとおり、Phase 14全体は未完了であり、Phase 14.2へは進んでいない。
