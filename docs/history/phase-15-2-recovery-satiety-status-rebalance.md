# Phase 15.2: 自然回復・満腹度・毒の再調整

作成日: 2026-08-05
対象commit: `phase-15-2-recovery-satiety`ブランチ（`main` HEAD `b66cc29fde9823b8f63a438a3ee7c9b9b59007ec`から分岐）
参照資料: `rogue-of-sun-phase15-balance-draft.md`（Phase 15全体の設計案）

## 1. 対象範囲

Phase 15.1で変更したLIFE 15基準に合わせ、以下だけを再調整した。

- 自然回復（量・間隔）
- 満腹度・飢餓（減少間隔・飢餓ダメージ間隔）
- リンゴ・チョコレート・バナナの数値
- 毒（ダメージ量・tick間隔）

ターン処理順、状態異常システムの構造、鈍足の仕様は変更していない。回復、満腹度、状態異常以外（LIFE/SOL/基礎攻撃/防御式/敵数値、太陽の実、日向チャージ、属性追加ダメージ、能力成長、アイテム生成方式、敵配置数、敵Lv2/Lv3など）はPhase 15.2の対象外。

## 2. 数値の正本と変更前後

| 項目 | 定義箇所 | 変更前 | 変更後 |
|---|---|---:|---:|
| 自然回復の間隔 | `turn.ts`のREGEN_TURNS_PER_HP | 5 | 10 |
| 自然回復の量 | `turn.ts`のREGEN_AMOUNT_PER_TICK（新設。従来は`+10`のインラインリテラル） | 10（インライン） | 1（named constant） |
| 満腹度初期値・最大値 | `hunger.ts`のHUNGER_MAX | 100 | 100（維持） |
| 満腹度減少量・間隔 | `hunger.ts`のHUNGER_DECREASE_AMOUNT/INTERVAL | 1 / 4 | 1 / 4（維持） |
| 飢餓ダメージ量 | `hunger.ts`のSTARVATION_DAMAGE | 1 | 1（維持） |
| 飢餓ダメージ間隔 | `hunger.ts`のSTARVATION_INTERVAL | 5 | 1 |
| リンゴ回復量 | `item-def.ts`のapple.healAmount | 20 | 5 |
| チョコレート満腹度回復量 | `item-def.ts`のchocolate.hungerAmount | 30 | 30（維持） |
| バナナ攻撃力上昇量 | `effects.ts`のattack_up.strength | 5 | 1 |
| バナナ持続時間 | `effects.ts`のattack_up.duration | 20 | 20（維持） |
| 毒ダメージ量（1tick） | `effects.ts`のpoison.strength | 3 | 1 |
| 毒tick間隔 | `effects.ts`のPOISON_TICK_INTERVAL（新設） | なし（毎ターン） | 2消費ターンごと |
| 毒持続時間 | `effects.ts`のpoison.duration | 10 | 10（維持） |
| 鈍足持続時間 | `effects.ts`のmovement_slow.duration | 10 | 10（変更せず） |

apple/chocolate/bananaのinternal ID（`apple`/`chocolate`/`banana`）は変更していない。

## 3. ターン処理順と各周期の起点

`turn.ts`のprocessTurn内の既存順序を維持した（変更なし）。

```text
プレイヤー行動
→ 敵の行動
→ 満腹度減少・飢餓ダメージ（applyHungerProgression）
→ 毒tick（applyPoisonTick）
→ プレイヤー死亡判定
→ 自然回復（生存時のみ）
→ 状態異常の残りターン減算（advanceEffectDurations）
→ ターン数インクリメント
```

- 自然回復の周期起点：`state.regenProgress`（既存、変更せず）。消費されたプレイヤーターンだけを加算し、`turnConsumed=false`の入力では加算されない（既存のprocessTurn早期リターン経路がそもそも周期加算コードへ到達しない）。
- 満腹度減少・飢餓の周期起点：`state.hungerDecreaseProgress`/`state.starvationProgress`（既存、変更せず）。
- 毒tickの周期起点：**新設**の`state.poisonTickProgress`。付与・再付与（`grantOrRefreshEffect(state,'poison')`直後の`turn.ts`の呼び出し箇所）で0にリセットする。付与ターン自体は`skipThisTurn`によりtick処理そのものをスキップし、進捗も加算しない。

## 4. 毒tickの新規実装

既存実装には「間隔」の概念が一切なく、`getEffectStrength(state,'poison')`の値をpoison有効な消費ターンごとに毎回適用していた（旧仕様：毎ターン3ダメージ、10ターンで合計30）。この構造のままでは「2ターンごとに1ダメージ、計5回」を表現できないため、`regenProgress`/`hungerDecreaseProgress`/`starvationProgress`と同型の進捗カウンタを新設した。

```text
GameState.poisonTickProgress?: number  // 0..POISON_TICK_INTERVAL-1、既定0
effects.ts: POISON_TICK_INTERVAL = 2
effects.ts: getPoisonTickProgress(state)
```

`applyPoisonTick`の新しいロジック：

```text
if (このターンが付与/再付与ターン) return;
if (プレイヤー死亡 or HP<=0) return;
poison効果が存在しない場合 → poisonTickProgress=0 にして return;
progress = getPoisonTickProgress(state) + 1;
if (progress < POISON_TICK_INTERVAL) {
  poisonTickProgress = progress; return;  // ダメージなし
}
poisonTickProgress = 0;
strength（1）ぶんダメージを適用し、poison_damageイベントを発行;
```

`state.poisonTickProgress`は`state.ts`の`CarryOverStats`/`buildFloorState`/`advanceToNextFloor`へ、`hungerDecreaseProgress`と同一パターンで組み込み、フロア移動時も維持される（poison自体（`activeEffects`）が既にフロア間で維持される既存仕様と整合）。

固定テストで実測した結果（`phase-12-3-poison-trap.test.ts`の新規テスト「a full 10-turn poison duration」）：

```text
付与直後からの消費ターン: 1  2  3  4  5  6  7  8  9  10
ダメージ発生:             0  1  0  1  0  1  0  1  0  1
```

合計5ダメージ、10ターン目にduration切れ（`effect_expired`）と同時に最後のtickが発生する。この「最終tickと満了が同じターンに重なる」挙動は、既存の`advanceEffectDurations`呼び出し順（毒tick適用 → 状態異常残りターン減算、の順で毎ターン実行）をそのまま維持した結果であり、Phase 15.2で新たに設計したものではない。

## 5. 状態異常再付与時の既存規則

`grantOrRefreshEffect`の既存仕様（strength/remainingTurnsを常に定義値で上書きし、重複加算・複数レコード化はしない）は変更していない。Phase 15.2では、この既存規則を`poisonTickProgress`にも一貫して適用しただけである：再付与時は`poisonTickProgress`も0へリセットし、常にそのターンを起点とした新しい2/4/6/8/10のtickスケジュールが始まる。これは新しい規則の追加ではなく、既存の「refreshは完全に作り直す」という規則をtick進捗という新しいフィールドへも一貫させたものである。

## 6. 満腹度が0になるターンの挙動（固定）

既存の処理順をそのまま維持した。

- `hunger>=1`の消費ターンでHUNGER_DECREASE_INTERVAL（4）に到達し満腹度が1減って0になった場合、そのターンでは飢餓ダメージは発生しない（`applyHungerProgression`はそのターンの冒頭で読んだ`hunger`値に基づき分岐するため）。
- 満腹度が0の状態で迎える次の消費ターンから、`STARVATION_INTERVAL`（Phase 15.2で1へ変更）に従って**毎消費ターン**飢餓ダメージが発生する。

この挙動は`phase-12-3-poison-trap.test.ts`や`hunger-food-starvation.test.ts`の既存テスト、および`phase-10-3-1-telemetry.test.ts`の新規テストで固定されている。

## 7. 毒と自然回復が同じターンに発生する場合の挙動

既存の処理順（毒tick → 死亡判定 → 自然回復）を維持した。毒tickでプレイヤーが死亡した場合、同じターンの自然回復ブロックは`if (state.player.alive)`のガードにより実行されない（`phase-12-3-poison-trap.test.ts`の「does not naturally regenerate on the turn the player dies of poison」で検証済み、Phase 15.2でも無変更のまま通過）。毒で死ななかったターンの自然回復は通常どおり進行する。

## 8. telemetry追加

### 8.1 新規GameEvent

`events.ts`に`satiety_decreased`を追加した。

```ts
{ type: 'satiety_decreased'; amount: number; satietyAfter: number }
```

- `applyHungerProgression`が満腹度を実際に1減らした消費ターンにのみ発行する（`starvation_damage`と同じ「実際に発生したときだけ発行」という既存パターンを踏襲）。
- **チョコレートによる回復では発行しない**：チョコレートの回復は`chocolate_used`（既存GameEvent）が持つ`recovered`から別途集計する。したがって`satiety_decreased`の合計は常に自然減少分だけであり、チョコレートの回復量と混同しない。
- ユーザー向けメッセージは持たない（`message-log.ts`で空文字を返す、bookkeeping専用イベント）。`formatEvents`が空文字を除外するため、UIに空行として表示されることもない。
- ゲーム結果・RNG消費には一切影響しない（イベントを発行するだけで、`state.hunger`の計算自体は既存ロジックのまま）。

### 8.2 TelemetryEvent（telemetry.ts）の追加・拡張

| 変更 | 内容 |
|---|---|
| `run_started` | `satiety: number`を追加（ラン開始時点の満腹度） |
| `player_attack` | `attackUpActive: boolean`を追加（このターンの行動開始前にattack_up（バナナ）が有効だったか） |
| `player_damaged.source` | `EnemyType \| 'poison'` → `EnemyType \| 'poison' \| 'starvation'`（追加のみ、既存値の意味は変更なし） |
| `starvation_damage`（新規） | `{ damage; hpBefore; hpAfter }`。`poison_damage`と全く同じ二段発行パターン（詳細レコード＋`player_damaged(source:'starvation')`）で、Phase 15.2以前は`starvation_damage`が一切telemetryへ変換されていなかった欠落を修正した |
| `satiety_decreased`（新規） | `{ amount; satietyAfter }`。GameEvent側と1:1 |
| `chocolate_used`の扱い | 既存の`item_used(effect:'satiety', amount:recovered)`として発行するよう追加（Phase 15.2以前は`chocolate_used`も一切telemetryへ変換されていなかった欠落を修正）。`itemsUsedByType`がchocoalteの使用回数も自動的に拾えるようになった |
| `player_healed`のrequestedAmount（自然回復分） | インラインリテラル`10`をやめ、`turn.ts`が公開する`REGEN_AMOUNT_PER_TICK`を参照するよう変更（telemetry側の重複定義を解消） |

schemaVersionは7のまま据え置いた（`player_damaged.source`の拡張は既存値の意味を変えない追加のみであり、Phase 15.1が`enemy_attack`/`EnemyDamageStats`へ行った追加と同じ扱いとした）。

### 8.3 RunSummaryの追加

`RunSummary`に`recoveryAndSatiety`を新設し、以下を集計する。

```ts
recoveryAndSatiety: {
  satiety: { start; min; end; naturalLoss; foodRecovered };
  starvation: { turnsAtZero; damageEvents; totalDamage };
  naturalRegen: { occurrences; requestedTotal; actualTotal };
  poison: { tickEvents; totalDamage };
  apple: { usedCount; requestedTotal; actualTotal };
  banana: { usedCount; attacksWhileActive };
}
```

- **satiety.start/min/end**：`start`は`run_started.satiety`、`min`は`run_started.satiety`と全`satiety_decreased.satietyAfter`のうちの最小値（および最終的な`finalState`の満腹度も含めて評価）、`end`は`finalState`から`getHunger`で取得した最終値。チョコレートによる回復は`satiety_decreased`を発行しないため、`min`の計算にチョコレート由来の増加が紛れ込むことはない。
- **satiety.naturalLoss**：全`satiety_decreased.amount`の合計（自然減少分のみ）。
- **satiety.foodRecovered**：チョコレートの`item_used(effect:'satiety')`の`amount`合計。
- **starvation.turnsAtZero**：`STARVATION_INTERVAL`が1になったため、`starvation_damage`イベント1件＝満腹度0で過ごした消費ターン1回、という対応関係になり、`damageEvents`と同じ値を別途重複計算せずそのまま採用した。
- **poison.tickEvents/totalDamage**：`poison_damage`イベントから集計（従来このイベントは集計ループに一切組み込まれていなかった欠落も合わせて修正）。
- **apple.requestedTotal/actualTotal**：`player_healed(source:'item', itemId:'apple')`のrequestedAmount/actualHealingから集計。LIFE上限による丸め（`requestedTotal`＞`actualTotal`となるケース）と、致死到達時の丸めの双方を固定テストで検証した。
- **apple.usedCount**：`item_used(itemId:'apple')`の件数。**全item使用回数（`resources.itemsUsedByType.apple`）と二重計上にならないよう、両者は同じ`item_used`イベントから独立に加算するだけで、互いを参照・複製しない**構造にした。
- **banana.usedCount**：`item_used(itemId:'banana')`の件数。
- **banana.attacksWhileActive**：`player_attack`イベントのうち`attackUpActive===true`のものの件数。**攻撃試行回数（命中・外れ・撃破を問わない全attempt）**を数える——これは`combatByWeapon`の`validAttacks`（命中・外れを問わずカウント）と同じ既存の「試行回数ベース」の集計規則に合わせたものであり、命中回数（`hits`）ベースではない。

## 9. telemetry実装上の注意点への対応

- **satiety_decreasedは自然減少分だけを記録する**：チョコレート使用時は`satiety_decreased`を発行しないコード上の分離により保証（8.1参照）。
- **starvation_damageとpoison damageの混同回避**：別々のTelemetryEvent型・別々のRunSummary集計フィールド（`starvation.totalDamage`と`poison.totalDamage`）として独立に実装し、固定テスト「starvation damage and poison damage are never confused with each other」で両者が同一ターンに発生しても正しく分離されることを検証した。
- **requested/actualの区別とLIFE上限・致死丸めの反映**：`player_healed`が既に持つ`requestedAmount`/`actualHealing`をそのまま利用。apple集計のLIFE上限丸めは固定テストで検証済み（8.3参照）。致死時（`poison_damage`/`starvation_damage`の`actualDamage`/`damage`）はプレイヤーの現在HPでMath.minされる既存ロジックのままで、telemetry側は追加のクランプを行わない。
- **apple固有集計と全item使用回数の二重計上回避**：8.3で前述のとおり、互いに参照しない独立集計。
- **banana攻撃回数の定義の明記**：8.3に明記（試行回数ベース、`combatByWeapon.validAttacks`と同じ規則）。
- **満腹度の開始・最低・終了値のrun単位集計**：`computeRunSummary`はrun全体の`telemetry.events`から算出しており、フロア単位ではない。
- **telemetry追加によるゲーム処理順・RNG消費への影響**：`satiety_decreased`はapplyHungerProgression内で条件が成立した場合にのみ追加でイベントをpushするだけであり、RNGを一切消費せず、既存の分岐・代入・戻り値には影響しない。他のtelemetry変更もすべて既存GameEventの追加翻訳、または`RunSummary`集計ロジックの追加であり、ゲーム本体（`turn.ts`のRNG消費箇所）には触れていない。
- **bookkeeping専用イベントのゲーム結果への非影響**：`satiety_decreased`はメッセージログに表示されず（空文字→`formatEvents`で除外）、`state.hunger`の値そのものへは影響しない（既存の`Math.max(0, hunger - HUNGER_DECREASE_AMOUNT)`計算はそのまま）。

## 10. 固定テスト結果

- `phase-12-3-poison-trap.test.ts`：新規追加した「a full 10-turn poison duration」で`[0,1,0,1,0,1,0,1,0,1]`・合計5ダメージ・10ターン目に`effect_expired`を確認。既存の41件すべて更新の上で通過。
- `phase-10-3-1-telemetry.test.ts`：Phase 15.2向けに10件の新規テストを追加（run_started.satiety、satiety_decreasedのチョコレート非計上、starvation_damageの二段発行、starvationとpoisonの分離、natural regen/appleのrequested-actual区別、apple二重計上なし、banana attacksWhileActive、satiety.minの最小値追跡）。全56件通過。
- telemetryに直接関係するその他ファイル（`phase-10-3-2-telemetry-fix.test.ts`、`phase-10-3-3-damage-recovery-fix.test.ts`、`phase-10-3-3a-healing-field-rename.test.ts`、`phase-13-3c-ability-ui-telemetry.test.ts`、`phase-14-1-element-foundation.test.ts`）：既存フィールドへの影響なし、全件通過を確認済み。

## 11. RNGと決定性への影響

- 自然回復・満腹度・毒のいずれの数値変更も、RNGを消費する分岐（命中判定など）には触れていない。
- `applyPoisonTick`の新しい間隔ロジックは`state.poisonTickProgress`という新しい状態フィールドの読み書きのみで、`rng.ts`のいかなる関数も呼び出さない。
- telemetryの追加（`satiety_decreased`等の新規GameEvent発行、TelemetryEventへの翻訳、RunSummaryの追加集計）はすべて既存の計算結果を読み取って記録するだけで、ゲーム側の乱数消費順序・消費回数を変えない。
- 既存の決定性テスト（`determinism.test.ts`、`multi-floor-robustness.test.ts`、`robustness.test.ts`など）は無変更のまま全件通過を確認した。

## 12. 今回変更しなかったPhase 15項目

- LIFE、SOL、基礎攻撃、防御式、敵数値（Phase 15.1で確定済み、再変更なし）
- 太陽の実の回復量、日向チャージ量（Phase 15.3対象）
- 属性追加ダメージの固定値化、カラダ・ココロ・チカラ・ハヤサの成長値
- アイテム生成方式・出現確率（Phase 15.4対象）、敵配置数、敵Lv2・Lv3、敵の自然発生
- 新しい食料・回復薬・解毒アイテム、毒耐性装備
- 鈍足の仕様（持続時間10ターン・行動制限規則とも変更せず）
- 装備追加・合成・強化、カード・呪い・アクセサリー
- ダッシュの敵接触判定と武器射程の連動、Space長押し中の状態異常別停止条件
- HUD区切り記号の微調整
