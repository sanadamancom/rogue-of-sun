# Phase 14.3 他四属性の近接エンチャント戦闘効果

## 目的

Phase 14.1（型・敵相性・共通計算基盤）とPhase 14.2（取得・解禁・選択・
切替）の上に、flame・frost・cloud・earthの正式な近接エンチャント戦闘
効果を実装する。五属性すべてを共通の発動・計算構造へまとめ、ココロrank
を属性基礎ダメージへ反映し、ソルと他四属性でSOL消費比率に差を設ける。
既存の物理戦闘・命中判定・武器固有挙動・combat RNG順序は一切変更しない。

## precheck結果

- 開始時point: local HEAD = origin/main = `1d5236538f0e6982b05b83833275477d9af82b84`
- working tree: clean
- 既存テスト: 62ファイル、1483件、全成功
- `npx tsc --noEmit` / `npx vite build`: 成功
- 全条件一致を確認した上で、mainから作業ブランチ
  `phase-14-3-element-combat-effects` を作成した

## 調査した既存ソル処理とココロrankの正本

- `turn.ts`の`applyPlayerAttackToEnemy`: 命中判定→物理ダメージ計算→
  ソル発動条件判定（対象武器・選択中・解禁・SOL残量）→SOL消費→属性
  ダメージ計算→物理と合算→HP適用→撃破処理、という既存の解決順序を
  確認した。
- `SOL_ENCHANT_ELIGIBLE_WEAPONS`（sword/spear/hammer）、
  `SOL_ENCHANT_COST = 1`、`SOL_ELEMENTAL_BASE_DAMAGE = 10`が唯一の
  定義箇所であることを確認した。
- `sol_enchantment_used`イベントの発生位置（`player_attack`直後、
  `enemy_defeated`判定前）、payload（`weaponId`, `enemyType`,
  `solBefore`, `solAfter`, `baseDamage`, `bonusDamage`, `element`,
  `affinity`）を確認した。
- `telemetry.ts`の`sol_enchantment_used`ハンドラが直前の`player_attack`
  RunEventを`physicalDamage`/`additionalDamage`/`calculatedDamage`/
  `solConsumed`で補正し、`sol_changed`（`reason: 'melee_enchantment'`）
  を追加pushする既存ロジックを確認した。
- ココロrankの正本は`ability.ts`の`getAbilityValue(state, 'mind')`
  （`getAbilities(state)[ability]`、`state.abilities`が未設定なら
  `INITIAL_ABILITY_VALUES`にフォールバック）であることを確認した。
  `getPowerDamageBonus`が同じ`getAbilityValue`を経由してチカラrankを
  物理ダメージへ反映する既存パターンを踏襲することにした。
- Phase 14.1の`ElementId`/`ElementalAffinity`/`computeElementalDamage`、
  Phase 14.2の`unlockedEnchantments`/`selectedEnchantment`/
  `ENCHANTMENT_CYCLE_ORDER`が完了報告と一致することを確認した。

調査結果は前提と一致したため実装を継続した。

## 五属性の共通定義構造

`turn.ts`へ以下の3つの単一定義を追加し、属性ごとの個別if分岐を排した：

```ts
const ELEMENT_ENCHANT_ELIGIBLE_WEAPONS: WeaponId[] = ['sword', 'spear', 'hammer'];

const ELEMENT_ENCHANTMENT_SOL_COST: Record<ElementId, number> = {
  sol: 1, flame: 2, frost: 2, cloud: 2, earth: 2,
};

const ELEMENTAL_BASE_DAMAGE = 10;
```

`applyPlayerAttackToEnemy`内の発動判定は、選択中エンチャント
（`'none'`含む`EnchantmentId`）1つを見るだけの単一の三項式
（`activatedElement: ElementId | null`）へ統合し、対象武器・選択中・
解禁状態（`unlockedEnchantments[selected]`）・SOL残量
（`ELEMENT_ENCHANTMENT_SOL_COST[selected]`以上）の4条件を五属性共通で
評価する。発動後の属性ダメージ計算も
`computeElementalDamage(ELEMENTAL_BASE_DAMAGE + getElementalMindBonus(state), affinity)`
という1本の式を全属性が共有する。

sol自身の解禁チェックは、Phase 14.2で`solUnlocked`が真になる同じ箇所
（ground item取得処理）で`unlockedEnchantments.sol`も同時に真になる
既存の同期規則により、`unlockedEnchantments.sol`を読むだけでPhase 10.1
以来のsol解禁条件を完全に再現できることを確認した上で、冗長な
`solUnlocked`直接参照を廃止した（`solUnlocked`フィールド自体は削除
していない）。

## 属性ごとの基礎ダメージとSOL消費量

| 属性 | SOL消費 | rank0基礎ダメージ |
|---|---|---|
| sol | 1 | 10 |
| flame | 2 | 10 |
| frost | 2 | 10 |
| cloud | 2 | 10 |
| earth | 2 | 10 |

四属性のSOL消費2は、原作の消費比率を参考にsolとの差を設けた暫定値
（`confirmed_combat_spec.sol_cost`）。

## ココロrankの属性ダメージ反映結果

`ability.ts`へ純粋関数`getElementalMindBonus(state)`
（`= getAbilityValue(state, 'mind')`）を追加し、`ELEMENTAL_BASE_DAMAGE
+ getElementalMindBonus(state)`という式を`computeElementalDamage`の
第一引数として全属性が共有する形にした。GameStateやEnemyActorへ計算
途中の値は保存しない。

- rank0: 10 + 0 = 10
- rank1: 10 + 1 = 11
- rank5: 10 + 5 = 15
- rank10: 10 + 10 = 20

ココロrankは物理ダメージ式（`computeAttackDamage`）・命中率式
（`computeHitChance`）・SOL消費量のいずれにも影響しない。チカラ、
`attack_up`、武器威力は既存どおり物理部分（`baseDamage`計算）だけへ
適用され、属性ダメージ側には一切加算されない。

## 対象武器と対象外攻撃

`ELEMENT_ENCHANT_ELIGIBLE_WEAPONS = ['sword', 'spear', 'hammer']`が
唯一の定義箇所（sol含む五属性共通）。素手（`equippedWeaponId ===
null`）とsolar_gunはこのリストに含まれないため、いずれの属性選択中
でも発動しない。

## ミス、空振り、SOL不足時の挙動

- ミス: `resolvesAsHit`がfalseを返した時点で即returnするため、属性
  発動判定そのものに到達しない（SOL非消費、属性イベントなし）。
- 空振り・対象不在: `applyPlayerAttackToEnemy`自体が呼ばれないため、
  combat RNGも消費されない。
- SOL不足: `activatedElement`が`null`になり、通常物理ダメージのみが
  適用される。`selectedEnchantment`は変更されない。攻撃自体は通常
  どおりターンを消費する。

## 他四属性へ固有状態異常を追加していないこと

`no_unique_secondary_effects`の指示どおり、flameへ継続ダメージ、
frostへ鈍足/凍結、cloudへノックバック/範囲攻撃、earthへ回復/防御上昇/
拘束のいずれも追加していない。属性ごとの命中補正・武器別補正・複数
属性同時発動・地形/オブジェクトへの作用も追加していない。四属性が
現時点で行うのは「物理ダメージに属性ダメージを加算する」ことだけで
ある。

## 既存ソル挙動の互換結果

- rank0・neutral時の追加ダメージ10、SOL消費1を維持（テストで確認）。
- sword/spear/hammerだけが対象、素手とsolar_gun対象外を維持。
- ミス・空振り・対象不在・SOL0での非発動を維持。
- `sol_enchantment_used`のイベント名・payloadフィールド・意味・発生
  位置・件数を無変更で維持。
- 既存Phase 10.1/10.2/10.3/14.1/14.2のテストは全て無修正で成功（1件
  のみ、Phase 14.2のテストファイル内の「他四属性は無効果」という
  Phase 14.2当時の前提を検証していた2ブロックを、Phase 14.3で正式に
  戦闘効果が実装されたことに合わせて更新した — 実装は変更しておらず、
  テストの期待値をPhase 14.3の確定仕様に合わせただけ）。

## 全9敵が五属性neutralのままであること

`enemy-def.ts`は本フェーズで一切変更していない。9種全敵の
`elementalAffinities`が五属性すべてneutralのままであることを`rg`と
専用テストの両方で確認した。

## イベント、ログ、telemetryの実装結果

- `events.ts`へ`element_enchantment_used`を1種類だけ追加
  （`element: Exclude<ElementId, 'sol'>`, `affinity`, `weaponId`,
  `enemyType`, `solBefore`, `solAfter`, `physicalDamage`,
  `elementalDamage`）。属性ごとに4種類のイベント名は作っていない。
  `player_attack`直後・`enemy_defeated`判定前という既存sol イベント
  相当の位置に、命中して発動した攻撃につき1回だけpushされる。
- `message-log.ts`へ`element_enchantment_used`のケースを追加し、
  `${属性名}の力が攻撃に宿った。`という最小限の共通文言を表示する
  （`ELEMENT_DISPLAY_NAMES`を再利用）。weak/resist専用文言とダメージ
  内訳表示はPhase 14.5へ持ち越す。既存のソルログ文言は無変更。
- `telemetry.ts`へ`element_enchantment_used`のケースを追加し、
  `sol_enchantment_used`と同じ方式（直前の`player_attack`
  RunEventを`physicalDamage`/`additionalDamage`/`calculatedDamage`/
  `solConsumed`で補正し、`sol_changed`（reason:
  'melee_enchantment'）をpush）で処理する。新しいRunEvent種別や属性別
  集計軸は追加していない。

## telemetry v7を維持したこと

`schemaVersion: 7`、エクスポートファイル名`rogue-of-sun-run-v7-...`は
無変更。export document構造への変更もない。

## 変更ファイル

- `src/game/ability.ts`: `getElementalMindBonus`追加
- `src/game/events.ts`: `element_enchantment_used`イベント追加
- `src/game/turn.ts`: 発動判定・ダメージ計算を共通構造へ統合
  （`ELEMENT_ENCHANT_ELIGIBLE_WEAPONS`/`ELEMENT_ENCHANTMENT_SOL_COST`/
  `ELEMENTAL_BASE_DAMAGE`定義、`applyPlayerAttackToEnemy`書き換え）
- `src/game/message-log.ts`: `element_enchantment_used`ケース追加
- `src/game/telemetry.ts`: `element_enchantment_used`のtelemetry変換
  追加
- `src/game/__tests__/phase-14-2-element-acquisition-selection.test.ts`:
  Phase 14.2当時「他四属性は無効果」だった2ブロックをPhase 14.3の
  確定仕様に合わせて更新（実装変更ではなくテスト期待値の更新）
- `src/game/__tests__/phase-14-3-element-combat-effects.test.ts`
  （新規）: 本フェーズの検証テスト

## テスト結果

新規テストファイル: 96件、全成功（共通定義、ココロ補正、発動条件、
SOL消費・不足時挙動、ダメージ、ミス/RNG非干渉、武器回帰、イベント/
ログ、telemetry、敵相性維持）。既存62ファイル1483件を含む全体：63
ファイル、1579件、全成功。`npx tsc --noEmit`: 成功。`npx vite build`:
成功。`git diff --check`: 問題なし。

## Phase 14.4と14.5へ未着手であること

本コミットはPhase 14.3の範囲（他四属性の戦闘効果実装）のみを実装した。
敵への正式な弱点・耐性分布（Phase 14.4）、weak/resist専用ログや詳細
ダメージ表示・完成版演出（Phase 14.5）には着手していない。
