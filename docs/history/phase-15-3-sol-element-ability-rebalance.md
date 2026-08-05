# Phase 15.3: SOL・属性・能力の再調整

作成日: 2026-08-05
対象commit: `phase-15-3-sol-element-growth`ブランチ（`main` HEAD `92d850ad52f50c9176f8947c03244259b001ca13`から分岐）
参照資料: `rogue-of-sun-phase15-balance-draft.md`（Phase 15全体の設計案）

## 1. 対象範囲

最大SOL 15（Phase 15.1で確定済み）に合わせ、以下だけを再調整した。

- SOL回復・消費（日向チャージ、太陽の実、太陽銃・五属性のSOL消費）
- 五属性の追加ダメージ計算式（倍率方式→固定追加値方式）
- 4能力（カラダ・ココロ・チカラ・ハヤサ）の成長量

既存のSOL資源モデル、属性相性表、能力割り振りUI、レベルアップ処理、telemetryの枠組みは維持し、数値と必要最小限の集計だけを変更した。

## 2. 数値の正本と変更前後

| 項目 | 定義箇所 | 変更前 | 変更後 |
|---|---|---:|---:|
| 初期SOL・最大SOL | `state.ts`のINITIAL_SOLAR_ENERGY/INITIAL_MAX_SOLAR_ENERGY | 15 | 15（Phase 15.1のまま維持） |
| 日向チャージ量 | `turn.ts`のSUNLIGHT_CHARGE_AMOUNT（新設。従来はインラインリテラル`1`） | 1（インライン） | 1（named constant） |
| 太陽の実SOL回復量 | `item-def.ts`のsun_fruit.solarAmount | 2 | 5 |
| 太陽銃SOL消費 | `weapon-def.ts`のsolar_gun.solarCost | 1 | 1（維持） |
| ソル属性SOL消費 | `turn.ts`のELEMENT_ENCHANTMENT_SOL_COST.sol | 1 | 1（維持） |
| 火・氷・雲・土属性SOL消費 | 同上（各元素） | 2 | 2（維持） |
| 属性追加ダメージ（耐性） | `combat.ts`のELEMENTAL_AFFINITY_BONUS_DAMAGE.resist | floor(base×50%) | 固定+1 |
| 属性追加ダメージ（通常） | 同上.neutral | floor(base×100%)（base=10+mind補正） | 固定+2 |
| 属性追加ダメージ（弱点） | 同上.weak | floor(base×150%) | 固定+3 |
| カラダ：最大LIFE成長量 | `ability.ts`のBODY_MAX_HP_PER_RANK | 4/rank | 2/rank |
| カラダ：割り振り時の現在LIFE回復 | 同上（allocateAbilityPointのbody分岐） | +4（連動） | +2（連動、変わらず最大LIFEを超えない） |
| ココロ：最大SOL成長量 | `ability.ts`のMIND_MAX_SOL_PER_RANK | 1/rank | 2/rank |
| ココロ：割り振り時の現在SOL回復 | 同上（allocateAbilityPointのmind分岐） | +1（連動） | **0（回復させない、仕様変更）** |
| ココロ：属性追加補正 | `ability.ts`のgetElementalMindBonus | +1/rank（属性の丸め前base値へ加算） | floor(ココロ/2)（属性の固定値へ加算） |
| チカラ：直接攻撃補正 | `ability.ts`のPOWER_DAMAGE_PER_RANK | 2/rank | 1/rank |
| ハヤサ：行動速度補正 | `ability.ts`のSPEED_PER_RANK | 10/rank | 10/rank（維持） |
| レベルアップ必要EXP | `progression.ts` | 現在レベル×5 | 現在レベル×5（維持、今回変更せず） |
| 敵EXP（1〜3） | `enemy-def.ts` | Phase 15.1の値 | 変更せず |

内部ID（`sun_fruit`/`sword`等のItemId、`sol`/`flame`/`frost`/`cloud`/`earth`のElementId、`body`/`mind`/`power`/`speed`のAbilityId）はすべて変更していない。

## 3. SOL回復・消費の正本と処理順

- **回復経路**：日向チャージ（`turn.ts`のresolveSolarCharge、`{type:'wait'}`が日向タイル上でSOL<最大のときに自動的にこの分岐へ入る）、太陽の実（`turn.ts`のapplyItemUse内sun_fruit分岐）。いずれも`Math.min(maxSolarEnergy, solarEnergy + amount)`で上限処理し、実回復量をtelemetryへ記録する。
- **消費経路**：太陽銃（`turn.ts`のresolveSolarGunAttack、`weaponDef.solarCost`を引く。SOL不足なら攻撃自体を不成立にする既存仕様を維持）、近接属性エンチャント（`turn.ts`のapplyPlayerAttackToEnemy、`ELEMENT_ENCHANTMENT_SOL_COST[element]`を引く。**命中した攻撃でのみ**消費し、ミス・攻撃不成立では一切消費しない既存仕様を維持）。
- **SOL不足時の物理攻撃**：属性が発動しなくても物理ダメージ部分は既存仕様どおり通常どおり成立する（元々の分岐構造を維持、変更なし）。
- **SOL不足による属性不発の可視化（今回の追加）**：従来は「属性未選択」と「選択済みだがSOL不足」が区別できず、どちらも無言でスキップされていた。今回、`turn.ts`のapplyPlayerAttackToEnemy内で「対象武器が近接属性対応・属性選択済み・解禁済みだがSOL不足」の場合だけ新規GameEvent `element_activation_failed`を発行するようにし、ログ（「SOLが足りず、〜の力を発動できなかった。」）とtelemetry（同名のTelemetryEvent）の両方で識別可能にした。ゲーム結果（ダメージ・SOL消費・RNG消費）には一切影響しない、純粋な可観測性の追加。

## 4. 属性固定追加ダメージの計算順

```text
1. 命中判定（既存、変更なし）
2. 物理ダメージ = computeAttackDamage(...)（既存、変更なし。防御力を減算、最低1）
3. 属性が発動する場合:
   a. SOLを ELEMENT_ENCHANTMENT_SOL_COST[element] だけ消費
   b. affinity = 対象の属性相性（既存の相性表、変更なし）
   c. mindBonus = floor(ココロ / 2)
   d. 属性追加ダメージ = ELEMENTAL_AFFINITY_BONUS_DAMAGE[affinity] + mindBonus
      （耐性1・通常2・弱点3 + mindBonus。敵防御を一切参照しない）
   e. 合計ダメージ = 物理ダメージ + 属性追加ダメージ
4. 敵HP = max(0, 敵HP - 合計ダメージ)（既存、変更なし。物理・属性を分離せず合算してから一度だけ上限処理）
5. 撃破判定・enemy_defeatedイベントは既存の合算後の値で判定（変更なし）
```

物理ダメージだけで撃破した場合と属性追加ダメージが撃破に寄与した場合とで、処理経路の分岐は一切追加していない（既存の「合算してから一度だけHP減算・撃破判定」という処理順をそのまま維持）。

## 5. ココロ補正の計算式

`ability.ts`のgetElementalMindBonus:

```ts
floor(getAbilityValue(state, 'mind') / 2)
```

- ココロ0・1 → +0（属性追加ダメージへの影響なし）
- ココロ2・3 → +1
- ココロ4・5 → +2
- ココロ6・7 → +3

この補正は属性追加ダメージ（`computeElementalDamage`の第2引数）にのみ加算され、物理ダメージ・毒・飢餓・太陽銃の「基礎威力」そのものには一切加算されない。太陽銃自身のダメージは既存どおり物理ダメージ計算（`computeAttackDamage`）のみを通り、五属性の共通経路（エンチャント発動）は太陽銃では発動しない仕様（`ELEMENT_ENCHANT_ELIGIBLE_WEAPONS`が剣・槍・ハンマーのみで太陽銃を含まない）が既存のまま維持されているため、「太陽銃専用の重複したココロ補正」は元々存在せず、今回も新設していない。

## 6. 各能力の対象範囲

| 能力 | 対象 | 境界値 |
|---|---|---|
| カラダ | `player.maxHp`（+2/rank）、割り振り時の`player.hp`（+2、maxHpを超えない） | 上限10ランク、防御力は不変 |
| ココロ | `maxSolarEnergy`（+2/rank）。割り振り時の`solarEnergy`は**変更しない**（Phase 15.3の仕様変更） | 上限10ランク |
| チカラ | `getPowerDamageBonus`経由で素手・近接3種・太陽銃の直接攻撃ダメージに一律+1/rank。属性追加ダメージには非適用、バナナのattack_up(+1)とは別の加算源として扱う（既存の`turn.ts`の加算順序は変更していない: `player.attack + attackUpBonus + powerBonus` の各項がそれぞれ独立） | 上限10ランク |
| ハヤサ | `getPlayerSpeed`経由で敵行動頻度（action gauge比較）に+10/rank | 上限10ランク、命中率・回避率は不変 |

## 7. 能力割り振り時の現在LIFE・現在SOLの扱い

- **カラダ**：`allocateAbilityPoint`のbody分岐で`maxHp += 2`、`hp = min(maxHp, hp + 2)`。既存の「最大値と同時に現在値も連動して回復する」規則を維持し、量だけ4→2に変更した。
- **ココロ**：`allocateAbilityPoint`のmind分岐で`maxSolarEnergy += 2`のみ。**現在の`solarEnergy`には一切触れない**（Phase 15.3の明示的仕様変更、旧仕様は最大値と同量だけ現在値も回復していた）。最大値が増えるだけなので現在値が新しい最大値を超えることは構造上あり得ない（クランプ処理自体が不要）。

## 8. SOL不足時の既存規則（維持した内容）

- ミス時・攻撃不成立時はSOLを一切消費しない（既存のまま）。
- SOL不足でも物理ダメージ部分は成立する（既存のまま）。
- SOLを0未満にしない（`Math.min`/`Math.max`による既存のクランプを維持、変更なし）。
- 消費処理はRNGを一切消費しない（`computeElementalDamage`・SOL減算はいずれも乱数不使用の純粋計算、変更なし）。

## 9. telemetry変更

### 9.1 新規GameEvent

`events.ts`に`element_activation_failed`を追加（§3参照）。

### 9.2 TelemetryEvent（telemetry.ts）の追加・拡張

| 変更 | 内容 |
|---|---|
| `run_started` | `sol: number`を追加（ラン開始時点のSOL） |
| `player_attack` | `powerBonus: number`を追加（このヒットに適用されたチカラ補正値、`getPowerDamageBonus`から取得） |
| `sol_changed` | `requestedAmount?: number`を追加。太陽の実は`ITEM_DEFINITIONS.sun_fruit.solarAmount`、日向チャージは`SUNLIGHT_CHARGE_AMOUNT`を記録し、消費側（`amount`が負）では設定しない |
| `element_activation`（新規） | `{element, affinity, weapon, requestedElementalDamage, actualElementalDamage, mindBonusPortion, solConsumed}`。sol・他四属性を問わず共通の1レコードで発行。`sol_enchantment_used`/`element_enchantment_used`の処理内から新設の共有ヘルパー`pushElementActivation`経由で発行し、既存の`player_attack`エンリッチ処理（physicalDamage/additionalDamage分割）はそのまま維持した |
| `element_activation_failed`（新規） | `{element, reason:'insufficient_sol'}` |

**requested/actualの区別**：`requestedElementalDamage`は`computeElementalDamage`が返す生の値（クランプ前）。`actualElementalDamage`は「物理ダメージが先に適用される」という既存の加算順序を前提に、`実際の合計ダメージ(actualDamage) - 物理ダメージ`を0以上・要求量以下にクランプした値とした。撃破時に敵の残りHPを超えるオーバーキル分は、物理側が先に消費してから属性側の実ダメージが減衰するモデルとして扱っている（これは新たな計算式ではなく、既存の「物理+属性を合算してから一度だけHP減算する」処理順の事後的な内訳解釈である点に注意）。

### 9.3 RunSummaryの追加

`RunSummary`に`solAndElements`を新設した。

```ts
solAndElements: {
  sol: { start; gained; consumed; end };
  elementActivations: {
    byElement: Record<ElementId, { count; requestedTotal; actualTotal; mindBonusTotal }>;
    byAffinity: Record<ElementalAffinity, number>;
    insufficientSolCount: number;
  };
  abilities: {
    allocationsByAbility: Record<AbilityId, number>;
    mindBonusDamageTotal: number;
    powerBonusDamageTotal: number;
  };
}
```

- **sol.gained/consumed**は既存の`resources.solGained`/`solConsumed`をそのまま参照するだけで、独立した二重集計は行っていない（constraintsの「同一イベントを二重計上しない」に対応）。
- **elementActivations.byElement/byAffinity**は新規`element_activation`イベントから集計。「属性別の発動回数」「弱点・通常・耐性の発生回数」「属性の要求追加ダメージと実追加ダメージ」をすべてカバーする。
- **insufficientSolCount**は新規`element_activation_failed`イベントの件数。
- **abilities.allocationsByAbility**は既存の`ability_point_spent`イベントを`ability`別に振り分けたもの（`progression.abilityPointsSpent`という既存の総数と重複しない、内訳のみの追加）。
- **abilities.mindBonusDamageTotal**は`element_activation.mindBonusPortion`の合計（＝「ココロ補正による追加ダメージ」）。
- **abilities.powerBonusDamageTotal**は命中した`player_attack`イベントの`powerBonus`の合計（＝「チカラ補正による直接攻撃追加量」）。ミスには適用しない（ダメージが発生しないため）。
- 「能力が戦闘または資源上限へ影響した回数」は、上記の`allocationsByAbility`の内訳と等価（カラダ・ココロの割り振りは必ず資源上限を変え、チカラ・ハヤサの割り振りは必ず戦闘計算式を変える——例外がないため、別カウンタを新設せず同じ集計を流用した。二重計上を避けるための判断）。

## 10. 固定テスト結果

- SOL・属性の値変更に伴い、`phase-09-1-solar-energy-foundation`・`hunger-food-starvation`・`phase-10-1-sol-enchant`・`phase-10-2-combat-stat-scale`・`phase-10-3-1-telemetry`・`phase-10-3-3-damage-recovery-fix`・`phase-12-1-temporary-effect-banana`・`phase-13-2-ability-allocation-screen`・`phase-13-3a-ability-numeric-effects`・`phase-14-1-element-foundation`・`phase-14-2-element-acquisition-selection`・`phase-14-3-element-combat-effects`・`phase-14-4-enemy-affinities`の既存アサーションを新しい数値・新しい計算式に合わせて更新し、全件成功を確認した。
- `phase-13-3c-ability-ui-telemetry.test.ts`にココロの表示文言（「2ポイントごとに属性追加+1」を明記し、現在SOL回復を仄めかす文言が存在しないこと）を検証する新規テストを2件追加。
- `phase-10-3-1-telemetry.test.ts`にPhase 15.3向けの新規テストを10件追加（run_started.sol、太陽の実/日向チャージのrequestedAmount、通常/mind補正あり/オーバーキル時のelement_activation、SOL不足時のelement_activation_failedとログ文言、属性別・相性別集計、SOL収支の`resources`一致、能力別割り振り数とmind/powerボーナス合計）。全66件通過。

## 11. RNGと決定性への影響

- 属性追加ダメージの計算式変更（倍率→固定加算）は乱数を一切使用しない純粋関数の置き換えであり、命中判定（`resolvesAsHit`/`rollPercent`）やその消費順序には触れていない。
- SOL回復・消費量の変更も同様に乱数非依存。
- 能力成長量の変更（カラダ・ココロ・チカラ）はいずれも確定的な加算式の定数変更のみで、`allocateAbilityPoint`のRNG消費（そもそも存在しない）に影響しない。
- telemetryの追加（新規イベント発行、RunSummary集計拡張）はすべて既存の計算結果を読み取って記録するだけで、ゲーム側の乱数消費順序・消費回数を変えない。
- 既存の決定性テスト（`determinism.test.ts`、`multi-floor-robustness.test.ts`など）はPhase 15.3で変更しておらず、Phase 15.1/15.2から継続して無変更のまま成立している（本フェーズでは対象ファイルを変更していないため個別の再実行はしていない。テスト内容自体がSOL・属性・能力のいずれにも依存しないマップ生成・配置の決定性テストであるため、影響範囲外と判断した）。

## 12. 今回変更しなかったPhase 15項目

- LIFE、基礎攻撃、防御式、敵HP・攻撃・防御（Phase 15.1で確定済み）
- 自然回復、満腹度、食料、毒、鈍足（Phase 15.2で確定済み）
- 敵数と敵配置、床落ち総数・カテゴリ抽選・装備レアリティ、アイテム出現確率（いずれもPhase 15.4対象）
- 新しい属性、ルナ、敵・武器への新しい弱点分類、属性相性表そのもの
- 新しい能力、振り直し
- EXP曲線（次レベル必要EXP＝現在レベル×5は維持）、敵Lv2・Lv3、敵の自然発生
- 全武器・全防具の追加、合成・強化値、カード・呪い・アクセサリー
