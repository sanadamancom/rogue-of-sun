# Phase 24.4e1: 能動的な呪い付与経路

## precheck

- baseline branch: `phase-24-4e0b-curse-audit-finalization`
- expected_head_prefix: `85fcde9` — 実際のHEAD `85fcde9e8951ef375c9f67ca5889b6f9d92a51fd`と一致
- local/remote SHA一致、working tree clean、同名work branch不存在（新規作成）
- main（`80596cd`）は監査中未変更
- baseline full suite: 123 files / 3094 tests — 全pass
- typecheck/build: baseline時点で成功確認済み

## 採用した最小curse model

- `EquipmentInstance.cursed: boolean` / `curseRevealed: boolean` を維持。`curseEffectId`/`curseStrength`/複数curse配列は追加していない。
- このPhaseで扱う効果は既存の束縛（`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`）のみ。劣化・災厄は実装していない。
- Temperanceによる同一instance解呪（`turn.ts`の既存resolver）はそのまま。改変なし。
- 呪い付与だけでは装備本体（`identifiedGeneralItemIds`）を鑑定しない。curseRevealedの成立は既存の「装備した瞬間に判明」契約と同じ意味論を再利用。

## mummy trigger/chance/target

- 実装箇所: `turn.ts`の`resolveEnemyAttackHit`（唯一の共通ダメージ確定点）内、`if (enemy.type === 'mummy')`で厳密にgate。他の全11種は一切影響を受けない。
- gate位置は命中確定後（`enemy_attack`イベントpush後、`player.hp===0`判定後）。miss分岐（`resolvesAsHit`がfalse）では一切呼ばれない。
- scope: `state.equippedWeaponInstanceId`/`state.equippedArmorInstanceId`に一致する、かつ`getActiveCurseEligibleInstances`を通過したinstanceのみ（装備中限定）。
- 0候補: chance RNG stream自体を構築しない。
- chance roll: `MUMMY_CURSE_CHANCE_PROVISIONAL = 0.1`。専用stream（`MUMMY_CURSE_CHANCE_SALT`）。失敗時はtarget stream非構築。
- target: 1候補ならRNG不要で確定。2候補（weapon+armor同時）なら`selectActiveCurseTarget`（`MUMMY_CURSE_TARGET_SALT`由来のstreamで、equipmentInstanceId安定順ソート後にindex選択）。
- 成功時: `cursed=true`, `curseRevealed=true`（常に装備中のため即判明）。`equipment_cursed`イベント（internal telemetry）を1件push。追加ターン・追加damageなし。
- 失敗時（chance/0候補）: 状態変更なし、player-visible messageなし（`equipment_cursed`はどのみち内部telemetry専用で、mummy成功時もplayer-visible文言は存在しない — 仕様書のmummy_curseセクションにplayer_message要件が明記されていないため、既存のcorsesca stun等の他on-hit効果と同様、専用メッセージは実装していない）。

## curse_trap生成weight/target

- `types.ts`の`TrapType`に`'curse_trap'`を追加。
- 生成箇所（`state.ts`）: 既存の2スロット（元は`slow_trap`固定/`poison_trap`固定）の**位置決定RNG・位置ロジック・除外規則は完全に不変**。各スロットの`trapType`だけを、新設の独立RNGストリーム（`trapTypeSlot1Rng`=`floorSeed ^ 0x6a3fc19d`、`trapTypeSlot2Rng`=`floorSeed ^ 0x9b1ea472`）から`selectTrapType`（`curse-active.ts`、45/45/10重み付け）で決定するよう変更。型drawはそのスロットが実際に位置を得た場合のみ消費（`if (slowTrapPos)`/`if (poisonTrapPos)`のガード内）。
- 総trap数（最大2）・配置位置・既存2本の位置RNG消費回数は不変。
- trigger: `turn.ts`の既存trap-trigger loop内、`trap.trapType === 'curse_trap'`の場合に`applyCurseTrapEffect`を呼ぶ新規分岐。slow_trap/poison_trapの既存`grantOrRefreshEffect`パスとは完全に独立（`else`分岐、相互に影響なし）。one-shot（`triggered`フラグ）は既存の仕組みをそのまま利用。
- target scope: `getActiveCurseEligibleInstances`が返す**所持中の全instance**（装備中・未装備の両方）。
- chance roll: **なし**（仕様のcurse_trapセクションに確率記載がないため、候補1件以上なら必ず1体を対象にする）。
- target選択: 0件なら`curse_trap_result`（outcome: `no_target`）のみpush。1件ならRNG不要で確定。2件以上なら`CURSE_TRAP_TARGET_SALT`由来のstream（trap.idを安定識別子として利用）で`selectActiveCurseTarget`。
- 成功時: 対象が装備中なら`curseRevealed=true`、未装備なら`false`。inventory数量・instanceId・refineLevelは一切変更しない。

## eligibility helper

新規`src/game/curse-active.ts`の`getActiveCurseEligibleInstances(state)`をmummy/curse_trap双方が共有:
- `getHeldEquipmentInstances(state)`（所持中instance、Temperance/Starと同じ関数）を基点に、
- `!instance.cursed`
- `NORMAL_RANKS`（C/B/A、equipment-loot.tsの既存単一情報源）に含まれる
- `ACTIVE_CURSE_INELIGIBLE_IDS`（`solar_gun`, `black_armor`）に含まれない

でフィルタ。solar_gunはrank Cのため、rankフィルタだけでは除外できず明示的exclusion setが必要だった（実装時に確認）。black_armorはrank Rのためrankフィルタで自動的に除外されるが、明示リストにも含めて自己文書化。S/R/ground上未所持/stale instance/consumable/card/enchantment系は`getHeldEquipmentInstances`自体の既存契約により自動的に対象外。

## reveal/identification規則

- mummy: 対象は常に装備中のため、成功時は常に`curseRevealed=true`。
- curse_trap: 装備中なら`curseRevealed=true`、未装備なら`curseRevealed=false`（未判明のまま保持）。
- どちらの経路も`identifiedGeneralItemIds`（一般アイテム鑑定状態）には一切触れない — focused testで確認済み。
- curse_trap未装備成功時のplayer-facing event（`curse_trap_result`, outcome: `unequipped`）は`displayName`フィールドを持たない（`undefined`固定）。真のItemId/instanceId/slotはevent構造上にも一切現れない。

## RNG saltsとstable input

新規`src/game/curse-active.ts`に3つの独立salt定数を定義（`deriveActiveCurseSeed`が`state.seed`/`state.floor`/`state.turn`/route固有のstable identity number（mummy: `EnemyActor.id`, curse_trap: `TrapTile.id`）/saltを合成、`turn.ts`の`deriveStarTransformSeed`と同型のパターン）:

- `MUMMY_CURSE_CHANCE_SALT = 0xf1a6c273`
- `MUMMY_CURSE_TARGET_SALT = 0x8d3e7b91`
- `CURSE_TRAP_TARGET_SALT = 0x4c9f21d6`

trap生成時の型選択には別途2本の独立ストリーム（`floorSeed`ベース、既存の位置RNGとは異なるXOR定数）を使用。

- `state.combatRngState`・`Math.random`・map生成RNG・trap配置RNG・floor item/monsterHouse/enemy-drop/card-supply RNGはいずれも一切参照・消費していない（コードレビューおよびfocused test「combatRngState非干渉」で確認）。
- GameStateへの永続RNG field追加なし（すべて`createRng`による都度使い捨てstream）。
- chance/targetは別salt。候補0件ではchance streamも生成しない。chance失敗時はtarget streamを生成しない。候補1件ではtarget streamを生成しない（コード上、`eligible.length === 1`分岐でRNG関数自体を呼ばない）。
- 対象候補は`selectActiveCurseTarget`内で`instanceId`文字列比較による安定ソート後にindex選択。
- 同一seed/state/actionで同一結果（focused testの決定性テストで確認）。

## telemetry

- `events.ts`に`equipment_cursed`（internal telemetry専用、`source`/`equipmentInstanceId`/`itemId`/`equipped`/`revealed`を保持、真ID保持可）と`curse_trap_result`（player-visible、`displayName`は`outcome: 'equipped'`時のみ）の2イベントを追加。
- `message-log.ts`の`formatEvent`に両イベントのcaseを追加（TypeScriptのexhaustive `never`チェックのため必須）。`equipment_cursed`は空文字列を返す（`trap_revealed`と同じ既存パターンで、`formatEvents`が空文字列を除外するためplayer-visible出力には現れない）。
- `telemetry.ts`（run summary export）は無変更。両イベントとも`translateGameEvent`のswitchに新規caseを追加しておらず、既存の`default`分岐（無視）を通る。**schemaVersion（現在7）は変更不要** — 新規イベントのrun-summary側集計は「comprehensive curse telemetryはPhase 24.4e2へ分離する」という指示どおり、このPhaseのスコープ外。

## 既存test変更

以下3ファイルの各1テストを更新した（`existing_test_policy`が明示的に許可する「trap type分布を固定値で検証する既存test」に該当）:

1. `phase-12-2-slow-trap.test.ts`: 「places at most one slow_trap per floor」→「places at most 2 traps total per floor」。理由: 各スロットが独立して型を抽選するようになったため、両スロットが同じ`slow_trap`を引く可能性があり、per-type「最大1」の保証は成立しなくなった。スロット数（最大2）の保証は不変。
2. `phase-12-3-poison-trap.test.ts`: 「at most one slow_trap and one poison_trap」→「at most 2 traps total」。理由は同上。
3. `phase-23-7-final-run-structure.test.ts`: 同じper-type「最大1」アサーションを「traps.length <= 2」へ変更。理由は同上。

いずれも**trap総数・位置・決定性の期待値は変更していない**。mummyの既存damage・休止・行動頻度期待値（`enemy-behavior-mummy.test.ts`）は無変更。期待値の削除・弱体化は行っていない（per-type上限という、新設計で成立しなくなった制約を、成立し続ける上位の制約=総数上限へ置き換えただけ）。

## focused/full suite/typecheck/build/sanity

- 新規`phase-24-4e1-active-curse-routes.test.ts`: 24 tests、mummy（命中+chance成功でcurse、miss時なし、chance失敗時なし、0候補で非curse、weapon+armor同時eligibleでも最大1件、既にcursed除外、鑑定状態不変、ターン数不変、決定性）、curse_trap（0/1/2候補の各分岐、装備中/未装備でのcurseRevealed差異、真名非漏洩、identity/refineLevel/inventory不変、one-shot、combatRngState非干渉、追加ターンなし）、trap type weights（境界値）、eligibility helper（cursed/solar_gun/black_armor除外）、integration（curse-lock接続、Temperance解呪×2経路）を検証。全pass。
- full suite: **124 files / 3118 tests — 全pass**（既存123/3094 + 新規1 file/24 tests）。
- typecheck: エラーなし。
- production build: 成功（`vite build`、警告はチャンクサイズのみで既存の警告と同一）。
- diff-check: 変更ファイルは`curse-active.ts`（新規）、`phase-24-4e1-active-curse-routes.test.ts`（新規）、`types.ts`/`events.ts`/`message-log.ts`/`state.ts`/`turn.ts`（実装）、既存test 3ファイル（型分布アサーション更新）のみ。
- production sanity: 1000 seed（`createInitialState(1..1000)`）で例外0件、`curse_trap`が2000スロット中217回出現（≈10.85%、期待値10%と整合）。RNG非干渉はfull suite内のdeterminism/multi-floor-robustness testが既存のまま全pass することで確認（trap位置決定・floor生成の再現性が保たれている）。一時スクリプトはすべて削除済み。

## out_of_scopeと後続分割

このPhaseで実装しなかった項目（仕様の`out_of_scope`どおり）:
- 劣化curse・災厄curse・`curseEffectId`・`curseStrength`・複数curse系統
- DP field・DP値・破損処理
- rank別curse率
- S/R/solar_gun/black_armorへの能動curse付与
- cockatrice/kraken/その他敵へのcurse能力（Phase 24.4e0b監査で特定した接続境界は温存されているが、担当種族の追加は本Phaseで行っていない）
- slow_trap/poison_trapの効果変更
- curse解除施設・完成版UI・数値バランス確定（10%/45-45-10はいずれも暫定値、最終調整はPhase 24.6または27）
- comprehensive curse telemetry（Phase 24.4e2）

## development_plan

リポジトリ内に`development-plan.md`は存在しないため、新規作成していない。
