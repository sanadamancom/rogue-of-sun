# Phase 15.1: 基礎数値・戦闘再調整

作成日: 2026-08-05
対象commit: `phase-15-balance-rework`ブランチ（`main` HEAD `ddc003a0fa5993c62614db6180f4a5002c446256`から分岐）
参照資料: `rogue-of-sun-phase15-balance-draft.md`（Phase 15全体の設計案）、`rogue-of-sun-development-plan.md`

## 1. 対象範囲

Phase 15.1では、Phase 15全体（`rogue-of-sun-phase15-balance-draft.md`）のうち以下だけを実装した。

- LIFE・SOLの初期尺度
- 基礎戦闘値（プレイヤー基礎攻撃力、初期4武器の威力）
- 防御式（敵からプレイヤーへの攻撃を固定減算から割合軽減へ変更）
- Lv1敵9種のHP・攻撃・経験値

回復、満腹度、状態異常、属性追加値、能力成長係数、敵配置数、アイテム生成方式は今回変更していない（`rogue-of-sun-phase15-balance-draft.md`の対象範囲外）。

## 2. 数値の正本と変更箇所

| 項目 | 定義箇所 | 変更前 | 変更後 |
|---|---|---:|---:|
| プレイヤー初期最大LIFE・現在LIFE | `state.ts`のbuildFloorState（新規ラン時のcreateInitialActor呼び出し） | 30 | 15 |
| プレイヤー基礎攻撃力 | 同上 | 10 | 2 |
| プレイヤー基礎防御・命中・回避 | 同上 | 0 / 90 / 0 | 変更なし |
| 初期SOL・最大SOL | `state.ts`のINITIAL_SOLAR_ENERGY / INITIAL_MAX_SOLAR_ENERGY | 5 / 5 | 15 / 15 |
| 命中率下限 | `combat.ts`のMIN_HIT_CHANCE | 5 | 10 |
| ソード(グラディウス)威力ボーナス | `weapon-def.ts` | 10 | 2 |
| スピア(ショートスピア)威力ボーナス | `weapon-def.ts` | 0 | 1 |
| ハンマー(クラブ)威力ボーナス | `weapon-def.ts` | 20 | 3 |
| 太陽銃威力ボーナス | `weapon-def.ts` | 0 | 1 |
| 防具(クロスアーマー)防御値 | `armor-def.ts` | 10 | 2 |
| 敵からプレイヤーへのダメージ式 | `combat.ts`のcomputeIncomingDamage | `max(0, attack - defense)` | `max(1, round(attack * 2^(-defense/10)))` |

武器・防具の内部ID（`sword`/`spear`/`hammer`/`armor`/`solar_gun`）は保存・参照互換のため維持し、表示名のみ変更した（`item-def.ts`）。

| 内部ID | 変更前displayName | 変更後displayName |
|---|---|---|
| sword | ソード | グラディウス |
| spear | スピア | ショートスピア |
| hammer | ハンマー | クラブ |
| armor | アーマー | クロスアーマー |

### Lv1敵9種

| 敵種 | HP(旧→新) | 攻撃(旧→新) | 防御 | 経験値(旧→新) |
|---|---:|---:|---:|---:|
| bok(ボク) | 30→6 | 10→6 | 0 | 1→1 |
| cockatrice(コカトリス) | 30→8 | 10→7 | 0 | 1→2 |
| spider(スパイダー) | 20→5 | 10→5 | 0 | 1→1 |
| bat(コウモリ) | 20→4 | 10→4 | 0 | 1→1 |
| mummy(マミー) | 50→10 | 20→9 | 0 | 1→2 |
| golem(ゴーレム) | 40→10 | 30→12 | 1（維持） | 1→3 |
| sword(ソード) | 40→9 | 20→8 | 0 | 1→2 |
| axe(アックス) | 60→12 | 20→12 | 0 | 1→3 |
| kraken(クラーケン) | 60→12 | 20→10 | 1（維持） | 1→3 |

## 3. 採用した計算式

```text
プレイヤー攻撃 = max(1, baseAttack(2) + weaponPower + weaponEnhancement + strengthModifier - 敵防御)
実効防御       = max(0, 防具防御力 + 防具強化値)
敵攻撃         = max(1, round(敵攻撃力 * 2 ^ (-実効防御 / 10)))
```

プレイヤーから敵への攻撃は固定減算・最低1ダメージを維持（`computeAttackDamage`、変更なし）。敵からプレイヤーへの攻撃だけを割合軽減式へ変更した（`computeIncomingDamage`）。

### 3.1 設計変更点：完全無効化ケースの廃止

Phase 08.4以来、`computeIncomingDamage`は`max(0, attack - defense)`という固定減算式で、十分な防御力を持てば被ダメージが正確に0になる「完全無効化」を意図的に許容していた（`docs/history/phase-10-2-combat-stat-scale-redesign.md`参照）。

Phase 15.1の指示（`damage_formula.enemy_to_player`）は`max(1, round(...))`という最低1ダメージの式を明示しており、この完全無効化ケースを廃止する設計変更を含む。これに伴い、以下のテストの前提が成立しなくなったため、新しい設計に合わせて書き換えた（値の書き換えではなく、テストが検証する仕様そのものの変更）。

- `armor-and-golem.test.ts`：「armor 10: attack power 10 becomes 0 damage」→「armor 2: attack power 10 is proportionally reduced to 9」
- `phase-10-2-combat-stat-scale.test.ts`：「computeIncomingDamage subtracts defense and floors at 0」→「floors at 1」
- `phase-10-3-2-telemetry-fix.test.ts`：「0-damage hit semantics」ブロックの2件
- `phase-10-3-accuracy-evasion.test.ts`：「existing armor-based damage reduction still applies on a hit」

## 4. 理論必要攻撃回数の実測

`rogue-of-sun-phase15-balance-draft.md`の§8表と一致することを`phase-10-2-combat-stat-scale.test.ts`の`representative hit counts`ブロックで固定テスト化した（基礎攻撃力2を明示的に使用）。

| 武器 | 対象 | 必要回数（実測・draft一致） |
|---|---|---:|
| グラディウス | ボク | 2 |
| クラブ | マミー | 2 |
| グラディウス | ゴーレム（防御1） | 4 |
| グラディウス | アックス | 3 |

被弾側（プレイヤー、防具クロスアーマー装備、防御2）についても、bok/cockatrice/spider/batいずれも「0damageに到達しない（＝最低1ダメージが必ず発生する）」ことをテストで固定した。ゴーレムの攻撃12・防御2に対しては`round(12*2^-0.2)=10`ダメージとなり、プレイヤーHP30想定で3発で撃破される計算になる。

## 5. telemetry変更

`telemetry.ts`の`enemy_attack`イベントに以下の3フィールドを追加した（防御式の変更により、`damage`だけでは軽減量・フロア到達の有無が事後的に復元できなくなったため）。

- `rawAttackPower`: 攻撃側敵の生の攻撃力（軽減前ダメージ）
- `armorReduction`: `rawAttackPower - damage`（防具による軽減量）
- `flooredAtMinimum`: 割合軽減式の丸め前の値が1未満で、最低保証の1ダメージへ切り上げられたかどうか

`EnemyDamageStats`（`computeRunSummary`が生成する敵種別集計）にも対応する集計フィールドを追加した。

- `defeated`: その敵種が撃破された回数（`enemy_defeated`イベントの`targetType`から集計。従来は敵種別の撃破数が存在せず、武器別のkillsとoverallのkillsのみだった）
- `rawDamage`: 命中ヒットの`rawAttackPower`合計
- `armorReduction`: 命中ヒットの`armorReduction`合計
- `flooredAtMinimumHits`: `flooredAtMinimum`がtrueだったヒット数

新規フィールドは既存フィールドへの追加のみで、既存フィールドの意味・型は変更していない。`zeroDamageHits`は割合軽減式の下では理論上ほぼ発生しなくなるが（最低1ダメージが保証されるため）、フィールド自体は後方互換のため削除せず維持した。

`describeIncomingDamageReduction`ヘルパーを`telemetry.ts`に追加し、`turn.ts`の`getEffectivePlayerDefense`を値としてインポートして防具込みの実効防御を再計算している（`turn.ts`は`telemetry.ts`を型としてしかインポートしていないため、循環importは発生しない）。

## 6. RNGと決定性への影響

- ダメージ計算式の変更は、RNGの消費順序・消費回数に一切影響しない（`computeIncomingDamage`・`computeAttackDamage`はどちらも純粋関数で、乱数を消費しない）。
- 命中判定（`resolvesAsHit`/`rollPercent`）は変更していない。`MIN_HIT_CHANCE`の5→10変更は命中率のクランプ範囲のみに影響し、乱数消費のタイミングは変えない。
- `multi-floor-robustness.test.ts`・`robustness.test.ts`・`determinism.test.ts`など、既存の決定性テストはすべて無変更のまま通過することを確認済み。

## 7. 固定戦闘テスト結果

- `npx vitest run`: 68ファイル / 1719件（新規追加4件含む）すべて成功。
- `npx tsc -b --noEmit`: エラーなし。
- `npx vite build`: エラーなし（既存の500KB超チャンク警告のみ、Phase 15.1と無関係）。

## 8. ブラウザ確認内容

Playwright（headless Chromium）でビルド済みプレビュー（`vite preview`）を操作し、以下を確認した。

- 新規ラン開始時のHUD表示が`HP 15/15`・`SOL 15/15`であること（スクリーンショットで確認）。
- インベントリオーバーレイの開閉、道具メニュー（0/20、なし）の表示が正常であること。
- 約60ターン分の移動・攻撃キー入力（WASD + 対角+攻撃キー）を送出し、コンソール/ページエラーが一切発生しないこと。

乱数シードを外部から固定する手段（URLパラメータ等）が現状存在しないため、装備品の拾得・装備・攻撃という一連の流れを単一のスクリプトで確実に再現することはできなかった。この経路自体は`armor-and-golem.test.ts`・`weapon-and-sword.test.ts`・`hammer-knockback-weapon.test.ts`・`spear-reach-weapon.test.ts`・`phase-09-2-solar-gun.test.ts`が実際の`ITEM_DEFINITIONS`/`WEAPON_DEFINITIONS`/`ARMOR_DEFINITIONS`と`processTurn`を通して検証済みである。

## 9. 今回変更しなかったPhase 15項目

- 自然回復・満腹度・消耗品・状態異常の数値
- 属性追加ダメージの固定値化
- カラダ・ココロ・チカラ・ハヤサの成長係数
- 敵配置数（6・7・8体への変更）
- アイテム生成方式（床落ち総数抽選・カテゴリ抽選・装備レアリティ抽選）
- 敵Lv2・Lv3
- 武器28種構成・武器合成・防具15種
- 黒の鎧専用封印部屋

これらはいずれも`rogue-of-sun-phase15-balance-draft.md`のout_of_scope／未確定事項として明示されており、本フェーズでは着手していない。

## 10. 未解決事項

- ブラウザでの装備拾得・装備・攻撃の目視確認は、シード固定手段がないため完了できなかった（§8参照）。単体テストによる検証で代替した。
- `zeroDamageHits`フィールドは新しい割合軽減式の下では理論上到達しにくくなったが、将来的な特殊効果（例：完全回避、特殊防御）で再び意味を持つ可能性があるため、削除ではなく維持を選んだ。この判断の要否はPhase 15.1範囲外。
