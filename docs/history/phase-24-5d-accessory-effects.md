# Phase 24.5d: アクセサリー固有効果

## 1. precheck

- base branch: `phase-24-5c-accessory-generation`、expected HEAD `36c9e76eeca1ab4c8253834fe9426f66a28f76e8` — 完全一致を確認。
- baseline: `npx tsc --noEmit` 成功、`npx vitest run` で **127 files / 3216 tests** 全通過（仕様の baseline と一致）、`npx vite build` 成功。
- 既存6種の `definition`/`rank`（`accessory-def.ts`）を `docs/history/phase-24-5a2-accessory-selection-audit.md` の「正式採用案」テーブルと突き合わせ、完全一致を確認。
- work branch `phase-24-5d-accessory-effects` を base HEAD から新規作成。local/remote いずれにも同名ブランチが存在しないことを確認済み。
- 注意点として記録: task spec の `protected.未使用phase-24-5b-accessory-coreは300b68f...のまま` という記述と実際のリポジトリ状態に食い違いがある。実際の `phase-24-5b-accessory-core-implementation` ブランチの HEAD は `0076ce849c9840124b174b906d169424e5429556` であり、`300b68f...` は別ブランチ（`phase-24-5a1-accessory-ui-audit-completion`）のコミット。今回の作業では **どちらのブランチも一切変更していない**（`git branch -a` で両ブランチの存在とHEADのみ確認、checkoutもpushも行っていない）ため、保全という実質目的は満たされている。命名上の食い違いのみで作業に影響なし。

## 2. preimplementation_audit（hook監査）

以下の単一確定点を実装前に特定・確認した。

| 対象 | 確定点 | ファイル |
|---|---|---|
| 太陽チャージ量 | `resolveSolarCharge` | `turn.ts` |
| poison付与 | `applyPlayerAction` 内、`slow_trap`以外のtrap起動時の唯一の`grantOrRefreshEffect(state, 'poison')`呼び出し。生産コード上、他にplayerへ新規poisonを付与する経路は存在しない。 | `turn.ts` |
| enemy→player物理damage | `getIncomingDamage`（唯一のfunnel、呼び出し元は`resolveEnemyAttackHit`と`resolveKrakenEnemy`の2箇所のみ、いずれも`enemy.type`をスコープに保持） | `turn.ts` |
| sun_fruit SOL回復 | `applyItemUse`内 `solarAmount`分岐（唯一の確定点） | `turn.ts` |
| 最大SOL算出・clamp境界 | `getEffectiveMaxSolarEnergy`（単一source of truth。呼び出し元は全て同一関数を参照） | `equipment-effects.ts` |
| enemy drop chance判定境界 | `rollEnemyDropOccurs`（pure関数、閾値比較のみ） | `enemy-drop.ts` |
| trap発見状態とfloor生成後の確定点 | 装備時: `applyAccessoryEquip`。floor遷移後: `advanceToNextFloor`（`buildFloorState`呼び出し直後）。共有helperは`revealTrap`（Phase 18.2由来、clairvoyance_fruitと共用） | `turn.ts` / `state.ts` |

監査済みhookと現行コードの間に矛盾は見つからず、実装へ進んだ。

## 3. 6効果の実装値・処理順・対象外

### 3.1 定義追加（`accessory-def.ts`）

- `AccessoryEffectId` 型を新規追加（6種1:1のdispatch key）。
- `AccessoryDefinition` に `effectId: AccessoryEffectId` と `description: string`（識別済み時のみ表示、production計算値と同じ数値を文言化）を追加。既存の `id`/`displayName`/`rank` は変更なし。

### 3.2 hot_blooded_headband（C, `hot_blooded_headband_charge_bonus`）

- `HOT_BLOODED_HEADBAND_CHARGE_BONUS_PROVISIONAL = 1`
- `resolveSolarCharge`（唯一の太陽チャージ確定点）で `SUNLIGHT_CHARGE_AMOUNT + (装備中なら+1)` を加算後、`getEffectiveMaxSolarEnergy`でclamp。
- `solar_charge_used.recovered` は実測clamp後の差分（`state.solarEnergy`の実際の増分）を返すよう変更。従来は固定定数`SUNLIGHT_CHARGE_AMOUNT`を無条件に返していたが、これは既存の潜在的な不正確さであり、既存テストはこのフィールドの値を検証していないため実測値化しても既存挙動への影響はない（focused testで確認）。
- 日陰・チャージ不成立時・非装備時は`resolveSolarCharge`自体が呼ばれないため自動的に対象外（既存の`isSunlitAt`かつ`solarEnergy < max`の条件をそのまま利用）。
- 追加ターン・追加RNGなし（この関数はRNGを消費しない）。

### 3.3 earth_guard（C, `earth_guard_poison_immunity`）

- 生産コード上、新規poison付与の確定点は唯一（trap起動時の`grantOrRefreshEffect`のみ）であり、既存の`poison_guard`（防具）ゲートと共通gateに統合。
- `if (effectId === 'poison' && (isPlayerPoisonImmune(state) || isEarthGuardEquipped(state)))` として単一gateで両方をカバー。
- `effect_blocked.reason` の型を `'poison_guard' | 'earth_guard'` に拡張し、実際に効いた方を記録（メッセージ文言自体は共通 `毒を防いだ！` のまま変更なし）。
- 既存poisonの治療・短縮は一切行わない（gateはあくまで新規付与のみをブロック）。
- damage自体・ターン進行は通常通り（trapの発見・triggered化・trap_triggeredイベントは変更なし、効果付与のみスキップ）。

### 3.4 buckler（C, `buckler_sword_damage_reduction`）

- `BUCKLER_DAMAGE_MULTIPLIER_PROVISIONAL = 0.75`
- `getIncomingDamage(state, attackPower, enemyType?)` にオプション引数`enemyType`を追加。
- **適用順序（固定・記録）**: emperor_shield軽減 → buckler軽減（sword限定）→ HP反映。両者は同一関数`getIncomingDamage`内で順に適用され、HPは呼び出し元で1回のみ減算される。
- `damage = max(1, floor(originalDamage * 0.75))`。`raw <= 0`の早期returnは既存のまま維持（`computeIncomingDamage`は常に`Math.max(1, ...)`のため実際には到達しないコードパスだが、契約通り「0なら0のまま」を壊さない構造で実装）。
- 呼び出し元2箇所（`resolveEnemyAttackHit`, `resolveKrakenEnemy`）を更新し`enemy.type`を渡すよう変更。`resolveKrakenEnemy`のenemy typeは`'kraken'`固定でsword以外なので非対象のまま。
- sword以外のEnemyType・trap・poison・飢餓・カードdamageは元々`getIncomingDamage`を経由しない別経路のため、影響なし。

### 3.5 adventurer_boots（B, `adventurer_boots_sun_fruit_bonus`）

- `ADVENTURER_BOOTS_SUN_FRUIT_MULTIPLIER_PROVISIONAL = 1.5`
- `applyItemUse`のsun_fruit分岐で `effectiveSolarAmount = floor(solarAmount * 1.5)`（装備時のみ）を計算し、`getEffectiveMaxSolarEnergy`でclamp。
- sun_fruit以外の回復・太陽チャージ・カードには一切適用しない（別々の分岐・別々の確定点のため独立）。
- SOL最大時の既存use失敗契約（`sun_fruit_use_failed`）は変更なし。

### 3.6 circlet（A, `circlet_max_sol_bonus`）

- `CIRCLET_MAX_SOL_MULTIPLIER_PROVISIONAL = 1.25`、`CIRCLET_ENEMY_DROP_MULTIPLIER_PROVISIONAL = 0.75`
- `getEffectiveMaxSolarEnergy(state)` を `floor((base + light_garbのarmor bonus) * 1.25)`（circlet装備時）に拡張。**設計判断**: circletの1.25倍は「素のmaxSolarEnergy」ではなく「light_garb適用後の実効最大値」に対して乗算する。理由: 既存の`getEffectiveMaxSolarEnergy`が全ての最大SOL比較・clampの単一source of truthであり、circletもこの同じ関数へレイヤーとして追加することで、既存の防具ボーナスとの二重管理を避けられるため。仕様書はこの点を明記していなかったため、本ドキュメントに設計判断として記録する。
- 装備時に現在SOLを自動回復しない（`clampSolarEnergyToEffectiveMax`は上方向には作用しない、`Math.min`ではなく「超過時のみ切り下げ」ロジックのため）。
- **removal_paths**: `applyAccessoryEquip`（swap時、新accessory反映後に呼び出し）と`applyAccessoryUnequip`（unequip時）の2箇所で`clampSolarEnergyToEffectiveMax(state)`を呼び出す共通ヘルパーとして実装。
  - `place`/`discard`については、既存の`resolveEquipmentTargetForRemoval`が装備中の個体を除去対象にすることを既に禁止しているため（Phase 24.1由来の既存ガード）、circletが装備されたままplace/discardされることはproduction上到達不能と判明した。そのためclamp呼び出しは実際に到達可能な2箇所（equip上書き・unequip）にのみ実装し、この理由をここに明記する。
- 通常enemy drop成立率のみ25%相対低下（`rollEnemyDropOccurs`に`chanceMultiplier`引数を追加、デフォルト1）。roll自体は同一の`rng()`呼び出し・同一stream・同一saltのまま、閾値比較のみ変更（`rng() < 0.1 * multiplier`）。monsterHouse報酬・床生成・固定報酬の経路（`equipment-loot.ts`/`accessory-loot.ts`）は一切変更していない。

### 3.7 grigri_glasses（S, `grigri_glasses_trap_reveal`）

- 装備成立時（`applyAccessoryEquip`内、identification後・SOL clamp後）に`revealAllCurrentFloorTraps`を呼び出し、現在floorの未発見trapを全て`revealTrap`（Phase 18.2由来、clairvoyance_fruitと共用の既存helper。今回`export`化し`source`型に`'grigri_glasses'`を追加）で発見済みにする。
- 装備したまま次floorへ進んだ場合: `advanceToNextFloor`に`events?: GameEvent[]`引数を追加し、`buildFloorState`呼び出し直後に`nextState.equippedAccessoryId === 'grigri_glasses'`を判定して新フロアのtrapを同じく`revealTrap`で全発見済みにする（`main.ts`側は現状メッセージログを即座にクリアする実装のため、機能的な`trap.revealed`更新自体は常に無条件で実行し、イベント配列はテスト用途のオプションとして実装）。
- 解除後も一度発見したtrapは`trap.revealed`フラグがそのまま維持される（unequip処理はこのフラグを一切触らない）。
- `revealTrap`自体が「既にrevealed済みなら何もしない」を保証するため、二重計上・二重通知は発生しない。
- 発動で追加ターン・追加RNGを発生させない（`revealTrap`はRNGを消費しないpure操作）。

## 4. equip/removal境界

- `equip_order`（仕様通り）: target validation → 装備/swap成立 → 一般アイテム鑑定(`markGeneralItemIdentified`) → 最大SOL再計算・clamp(`clampSolarEnergyToEffectiveMax`) → grigri_glassesの一回効果(`revealAllCurrentFloorTraps`) → message/event → 既存通り1ターン進行。`applyAccessoryEquip`内でこの順序を厳守した。
- `removal_paths`: `unequip`/`swap`は`applyAccessoryUnequip`/`applyAccessoryEquip`（上書き）で対応済み。`place`/`discard`は前述の通り既存ガードにより装備中個体には到達不能なため追加実装なし（3.6節に理由記録）。

## 5. RNG非干渉

- 新規stream・新規saltは一切追加していない（`new_stream: false`, `new_salt: false`の契約を遵守）。
- circletのenemy drop変更は既存`SALT_DROP_OCCURS`由来の同一`rng()`呼び出しの閾値のみを変更（sanity checkで同一streamからのsubset関係を確認済み — reduced=trueならfull=true）。
- headband/earth_guard/buckler/boots/circlet(SOL)/grigri_glassesのいずれも`combatRngState`および既存の全streamを一切消費しない。focused testで`combatRngState`不変を確認済み。

## 6. UI・message・telemetry判断

- **UI**: `main.ts`のinventory詳細画面で、accessoryカテゴリの場合、識別済みなら`ACCESSORY_DEFINITIONS[id].description`を表示（未識別時は非表示、weapon/armorの既存パターンと同一構造）。rank表示は既存の`rankSuffix`（リスト行）が既に全equipmentカテゴリ共通で機能しているため追加実装不要。
- **message**: `effect_blocked`（毒防止）は既存の共通メッセージ`毒を防いだ！`のまま（reason拡張のみ、表示文言変更なし）。`grigri_glasses_activated`という新規イベントを追加し、`clairvoyance_used`と同一パターンのメッセージ（`フロアの罠が見えるようになった。`/`罠は見つからなかった。`）を表示。個々の`trap_revealed`イベントは既存通り常に空文字（サイレント）。
- **telemetry**: `schemaVersion`は8のまま変更なし。新規raw categoryは追加していない（`trap_revealed.source`にenum値`'grigri_glasses'`を追加したのみ — union拡張であり構造変更ではないためschemaVersionバンプ対象外）。`grigri_glasses_activated`は既存の`item_used`（`effect: 'trap_reveal'`）を再利用してtelemetryへ変換（clairvoyance_usedと同一パターン）。

## 7. 既存テストの変更

**既存テストへの変更は一切行っていない。** 127 files / 3216 testsは変更前後で完全に同一の結果（全通過）。今回追加した効果（headband/earth_guard/buckler/boots/circlet/grigri_glasses）はいずれもデフォルト非装備状態では無効化されるため、既存のdamage/SOL/drop/trap期待値は一切変化しない。

## 8. 検証結果

- focused test: `src/game/__tests__/phase-24-5d-accessory-effects.test.ts` 新規26 tests、全通過。
- regression: `phase-24-5b-accessory-core.test.ts`（既存）、`phase-24-5c-accessory-generation.test.ts`（既存）を含むfull suiteで確認。
- full suite: **128 files / 3242 tests**（既存3216 + 新規26）全通過。
- typecheck: `npx tsc --noEmit` エラー0件。
- production build: `npx vite build` 成功（`dist/assets/index-C4LxKOc5.js`、警告は既存のchunk sizeのみで新規warning なし）。
- production sanity（一時スクリプト、検証後削除済み）:
  - 6効果×1000 seedでの装備・1アクション実行で例外0件。
  - circlet enemy drop率: 装備なし実測10.09%（期待10%）、装備あり実測7.66%（期待7.5%）。
  - buckler: sword型敵からのdamage 10→7（25%軽減、floor）を確認。
  - circlet: 最大SOL 15→18（1.25倍floor）を確認。
  - grigri_glasses: 次floorへ進んでもtrap全発見済み（trap 2件・イベント3件）を確認。

## 9. 指示逸脱・停止事項

- `stop_conditions`に該当する事象は発生せず、独断実装なしで完了した。
- precheck時に発見した「300b68f...ブランチ命名の食い違い」（1章参照）以外の指示逸脱はない。
- 設計判断として記録した1点: circletの最大SOL倍率をlight_garb適用後の実効値に対して乗算する方式を採用（6.6節参照）。仕様書に明記がなかったため、既存`getEffectiveMaxSolarEnergy`の単一source of truthパターンを維持する方向で判断した。
