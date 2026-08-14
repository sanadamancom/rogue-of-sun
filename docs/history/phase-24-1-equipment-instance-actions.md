# Phase 24.1: 装備個体の選択・交換・解除・配置操作

## 起点commit・branch・precheck

- base branch: `origin/phase-24-0-equipment-readiness-audit`
- base commit: `fdef8a3959b94eb5dd97888c3262492586647c7b`（一致確認済み）
- `origin/main`: `80596cd5334294255a439cb79db375f622193c50`（一致確認済み、未変更）
- `origin/phase-23-7-final-run-structure`: `272a5c81a954b0b5586aa7a252e9ae89fda53411`（一致確認済み、未変更）
- precheck結果：`git fetch origin`実行、上記3コミット全て一致確認、working tree clean確認、`phase-24-1-equipment-instance-actions`のlocal/remote branch未存在確認、指定base commitから新規work branch作成。
- baseline test（`npx vitest run`）: 110 files / 2757 tests 全通過（本フェーズ開始前に確認済み）。

## Phase 24.0から確定したproducer判断

- 装備枠：武器1・防具1（アクセサリーはPhase 24.5まで追加しない）。
- 専用「装備解除」actionを追加する（`unequip_weapon`/`unequip_armor`）。インベントリで装備中個体を選択して通常の装備操作を確定した場合、equipではなくunequip actionを送るUIルールを採用。
- equipment rankをPhase 24.1でデータ基盤として追加する（`EquipmentRank = 'C'|'B'|'A'|'S'|'R'`）。現行5定義（sword/spear/hammer/solar_gun/armor）はすべて`'C'`。戦闘・生成weight・AIへは接続しない。
- DPはPhase 24.1で追加しない（後述）。
- 呪い抽選RNGストリーム（`createRng(floorSeed ^ 0xc7d4a19e)`）は既に独立していることを確認済み。Phase 24.1では変更しない。

## InventoryEntryの最終構造

```ts
export type InventoryEntry =
  | { kind: 'inventory_item'; itemId: ItemId; count: number }
  | {
      kind: 'equipment_instance';
      itemId: ItemId;
      instanceId: string;
      refineLevel: number;
      rank: EquipmentRank;
      cursed: boolean;
      curseRevealed: boolean;
      equipped: boolean;
    };
```

- `GameState.inventory`のItemId単位カウントは所持数の正本として維持。Inventory全体をEquipmentInstance配列へ置換しない。
- 消耗品・カードは従来どおり`inventory_item`（1 ItemId = 1 entry、count表示）。
- 武器・防具は`getHeldEquipmentInstances`（既存のPhase 20.0d関数、装備中個体を先頭・残りは`equipmentInstances`の既存安定順）を使い、所持個体ごとに1 entryを生成。
- `inventoryEntries`は呼び出し時に`normalizeEquipmentInstances(state)`を実行してから構築するため、`equipmentInstances`未設定の legacy fixture でも owned count と一致する entry 数を返す。
- 順序はRNG・Object key列挙順に依存しない（`equipmentInstances`配列の既存安定順のみに依存）。
- 未判明の呪いはentryへ一切出力しない（`curseRevealed`が`false`の間は`cursed`の値に関わらず表示上区別不可）。

## PlayerActionの最終構造とlegacy互換

```ts
| { type: 'equip_weapon'; weaponId: WeaponId; equipmentInstanceId?: string }
| { type: 'equip_armor'; armorId: ArmorId; equipmentInstanceId?: string }
| { type: 'unequip_weapon'; equipmentInstanceId: string }
| { type: 'unequip_armor'; equipmentInstanceId: string }
| { type: 'place_item'; itemId: ItemId; equipmentInstanceId?: string }
| { type: 'discard_item'; itemId: ItemId; equipmentInstanceId?: string }
```

- `equip_weapon`/`equip_armor`/`place_item`/`discard_item`は`equipmentInstanceId`を省略可能。省略時は既存の「未装備個体を安定順で選ぶ」fallback（`findUnequippedInstance`系）を使用し、pre-24.1の挙動を完全に再現する。production UIは常に選択entryの`instanceId`を明示的に渡す。
- `unequip_weapon`/`unequip_armor`は`equipmentInstanceId`必須。現在装備中の個体と一致しない場合は「stale」として拒否し、別個体を推測しない。
- 明示的な`equipmentInstanceId`が指定された場合、所持中でない・種別不一致・床上のみの個体は`invalid_instance`（equip系）で即座に拒否。**別個体へのフォールバックは一切行わない**。
- `card-target-selection.ts`の`CardTargetRef{kind:'equipment_instance',instanceId}`パターンは踏襲したが、PlayerActionへ直接流用はしていない（カード固有の対象型のため）。

## rankの型・初期値・normalize

- `EquipmentRank = 'C' | 'B' | 'A' | 'S' | 'R'`（types.ts）。
- `WeaponDefinition`/`ArmorDefinition`へ`rank`フィールドを追加。現行5定義は全て`'C'`。
- `EquipmentInstance.rank`をmint時に対応する定義から設定（`mintEquipmentInstance`）。
- `normalizeEquipmentInstances`が不正/欠落rankを定義側rankへ補正（refineLevel/cursed/curseRevealedと同じ「壊れている場合のみ補正・冪等」パターン）。
- 戦闘・生成weight・AIには一切接続していない（データ・表示のみ）。rank抽選も追加していない。R装備を通常生成へは追加していない（元々Phase 24.1範囲外）。

## DPを追加しなかった理由

- DPの意味・最大値・増減契機・戦闘/破損接続が正式決定されていないため、placeholderフィールド追加をしていない（`producer_decisions.dp.implement_in_phase_24_1: false`の指示どおり）。
- 耐久・破損処理・DPのRNG抽選は一切実装していない。
- Phase 24.3（個別装備仕様確定）着手前に再検討する。

## 装備・交換・解除の状態遷移

| 現在の状態 | 操作 | 結果 |
|---|---|---|
| 未装備 | `equip_weapon`（instanceId明示） | 該当個体を装備。呪い未判明ならcurseRevealed維持、cursedならcurseRevealed=true。1ターン消費、inventory close |
| 装備中Aと同じinstanceId | `equip_weapon`（同じA） | no-op（`weapon_already_equipped`）。ターン不消費 |
| 装備中Aと同一definitionの別個体B | `equip_weapon`（B） | Aが呪いロックでなければB装備。Aは所持のまま未装備で残存。1ターン消費 |
| 装備中Aが判明済み呪い | `equip_weapon`（別個体） | 拒否（`weapon_equip_blocked reason:'cursed'`）。ターン不消費 |
| 装備中A | `unequip_weapon`（A） | 呪いロックでなければ解除成功。equippedWeaponId/InstanceId→null。1ターン消費、inventory close |
| 装備中Aが判明済み呪い | `unequip_weapon`（A） | 拒否（`weapon_unequip_blocked reason:'cursed'`）。ターン不消費 |
| 装備中がB（Aではない） | `unequip_weapon`（A、stale） | 拒否（`weapon_unequip_blocked reason:'stale'`）。ターン不消費、別個体を推測しない |
| 何も装備していない | `unequip_weapon`（任意instanceId） | 拒否（stale）。ターン不消費 |

防具側（`unequip_armor`/`armor_equip_blocked`等）も対称的に同一契約。

## place/discard/pickupのidentity契約

- **place**：`equipmentInstanceId`指定時はその個体のみを対象。装備中個体は所持数に関係なく常に拒否（`resolveEquipmentTargetForRemoval`が装備中instanceIdと一致した場合`'equipped'`で拒否）。新規個体生成・呪い再抽選・rank再設定は一切行わない。GroundItemへ同一instanceIdをそのまま設定。
- **discard**：同上のロジックを共有（`resolveEquipmentTargetForRemoval`）。選択個体のみを`equipmentInstances`から削除（新設の`removeInstanceById`）。他の同一定義個体には影響しない。
- **pickup**：既存の`turn.ts`のpickup処理（`item.equipmentInstanceId`を参照して同一個体を復元）は元々instanceId維持契約を満たしており、Phase 24.1での変更は不要だった（確認のみ実施）。
- **legacy fallback**：`equipmentInstanceId`省略時は、装備中個体しか存在しない場合に拒否する（`fallbackId === undefined && equippedInstanceIdForDefinition`のケースを追加）ことで「装備中個体しか存在しない場合はplace/discardを拒否する」という要件を満たした。

## 呪いロックと独立RNG維持

- 呪いロック判定（`isEquippedWeaponCurseLocked`/`isEquippedArmorCurseLocked`）は既存のまま再利用。unequip側にも同一ロックを適用。
- 床生成時の呪い抽選ストリーム（`createRng(floorSeed ^ 0xc7d4a19e)`）は変更していない。
- 装備選択・交換・解除・配置・破棄のいずれもRNGを消費しないことを専用テスト（`combatRngState`比較、敵不在状態で検証）で確認。

## discard確認のstale target対策

- `GameState.discardConfirmEquipmentInstanceId`を新設。`discardConfirmItemId`と対で設定・クリアする。
- インベントリを閉じた場合（`closeInventory`/`toggleInventory`）は両方をクリア。
- confirm実行時（`main.ts`の`handleMenuConfirm`）は保存していた`equipmentInstanceId`をそのまま`discard_item` actionへ渡し、`turn.ts`側で改めて所持・種別・非装備の再検証を行う（stale selectionはturn.ts側で最終的に弾かれる）。

## 変更ファイル一覧

- `src/game/types.ts`：`EquipmentRank`型、`EquipmentInstance.rank`、`PlayerAction`拡張（equip/place/discardへ`equipmentInstanceId?`、`unequip_weapon`/`unequip_armor`新設）、`GameState.discardConfirmEquipmentInstanceId`
- `src/game/weapon-def.ts` / `src/game/armor-def.ts`：`rank`フィールド追加、既存5定義に`rank:'C'`設定
- `src/game/equipment-instance.ts`：rank設定・normalize、`findHeldInstanceById`/`findHeldUnequippedInstanceById`/`removeInstanceById`新設、`equippedWeaponInstanceId`/`equippedArmorInstanceId`のnormalize時backfillを追加
- `src/game/turn.ts`：`applyWeaponEquip`/`applyArmorEquip`のinstance-aware化、`applyWeaponUnequip`/`applyArmorUnequip`新設、`applyPlaceItem`/`applyDiscardItem`のinstance-aware化（`resolveEquipmentTargetForRemoval`共通ヘルパー）、`processTurn`のaction dispatch・inventoryOpen例外リストへ新actionを追加
- `src/game/events.ts`：`weapon_equip_blocked`/`armor_equip_blocked`のreasonへ`'invalid_instance'`追加、`weapon_unequipped`/`armor_unequipped`/`weapon_unequip_blocked`/`armor_unequip_blocked`新設、`item_place_failed`/`item_discard_failed`のreasonへ`'invalid_instance'`追加
- `src/game/message-log.ts`：上記新規イベントの日本語ログ追加
- `src/game/inventory.ts`：`InventoryEntry`をunion型へ変更、`inventoryEntries`/`selectedInventoryAction`/`selectedItemId`のinstance-aware化、`selectedInventoryEntry`/`selectedEquipmentInstanceId`新設
- `src/main.ts`：インベントリ表示（rank/refineLevel/呪い判明表示、entry単位の装備マーカー）、`currentItemActions`のentry単位ラベル、装備/解除/置く/捨てるのUI dispatchをinstanceId対応化、discard確認への`discardConfirmEquipmentInstanceId`連携
- 回帰テスト修正：`weapon-and-sword.test.ts`、`armor-and-golem.test.ts`（既に装備中の個体をEnterで選択した際の挙動がno-opからunequipへ変更されたことの反映）、`inventory-and-apple.test.ts`、`spear-reach-weapon.test.ts`、`phase-10-3-2-telemetry-fix.test.ts`、`phase-20-0a-card-definition-foundation.test.ts`（entry構造がunion型になったことへの追従）、`phase-20-0c-equipment-instance.test.ts`（`normalizeEquipmentInstances`の個体カウント方式修正に伴う、床専用個体を含めない正しい期待値への修正）
- 新規テスト：`src/game/__tests__/phase-24-1-equipment-instance-actions.test.ts`

## 新規・更新テスト数

- 新規専用テストファイル：`phase-24-1-equipment-instance-actions.test.ts`（38 tests）
- 既存テスト更新（挙動変更・構造変更への追従。アサーションの意図自体は変更せず、新entry構造/新振る舞いに合わせた必要最小限の修正）：7ファイル、9箇所
- 最終テスト総数：111 files / 2795 tests（baseline 110/2757 + 新規38 − 重複計上なし。差分は新規1ファイル38件、既存ファイルへの追加なし）

## targeted regression結果

`phase-20-0c-equipment-instance.test.ts`、`phase-20-0d-card-target-selection.test.ts`（該当ファイル名は`card-target-selection`関連の既存名称に準拠）、`phase-20-5a-targeted-card-effects.test.ts`、`phase-20-5b-equipment-card-effects.test.ts`、`inventory-actions`系（`inventory-and-apple.test.ts`/`inventory-capacity.test.ts`）、`multi-floor.test.ts`、`multi-floor-robustness.test.ts`、`determinism.test.ts`、`weapon-and-sword.test.ts`/`spear-reach-weapon.test.ts`/`armor-and-golem.test.ts`、`message-log.test.ts` — 全て通過。

## full suite結果

`npx vitest run`：**111 files / 2795 tests 全通過**（失敗・skip・todo・only なし）。

## typecheck/build/diff-check結果

- `npx tsc --noEmit`：エラーなし
- `npx vite build`：成功（`dist/`はコミット対象外として削除済み）
- `git diff --check`：clean

## production sanity結果

公開関数経由のheadless確認（一時テストで実施し、確認後に破棄・作業ツリーへ残していない）：
- 同一定義2個の所持間での装備交換（A→B）が成功
- 装備解除（`unequip_weapon`）で素手へ戻る
- 解除済み個体をplace→GroundItemへ同一instanceId反映
- 別個体をdiscard→所持数減少、対象個体のみequipmentInstancesから削除
- rankをA に設定した個体がフロア遷移（`advanceToNextFloor`）後も維持される

いずれも意図通りの結果を確認。

## 24.2への引き継ぎ事項

- 太陽鍛冶（同種同ランク2個→上位ランク）はPhase 24.1で確立したinstance選択・`findHeldInstanceById`パターンを再利用できる。
- rankフィールドは戦闘へ未接続のまま。24.2で合成対象の判定にのみ使用し、性能への反映はPhase 24.3以降に委ねる。
- DPフィールドは未追加のまま。24.3の個別装備仕様確定時に導入要否を再検討する必要がある。
- 「専用解除action」の追加により、UIの「外す」ラベルは実際にunequip_weapon/armorを送るようになった（以前は同じweaponIdでの再equipによる実質no-opだった）。24.2以降のUI変更時はこの契約を維持すること。

## 未確定事項とproducer判断が必要な項目（Phase 24.0からの継続）

- rank/DPフィールドの本格運用開始時期（24.3との調整）は引き続き未確定。
- 床生成時の呪い抽選RNGストリームが他の床アイテム生成と共有か独立かは、今回`0xc7d4a19e`という専用XOR定数を持つ独立streamであることを確認済み（Phase 24.0の未確認事項を解消）。

## 指示逸脱の有無

なし。DP追加禁止、太陽鍛冶実装禁止、27武器/15防具追加禁止、敵Lv2/Lv3・4F拡張禁止、telemetry schemaVersion変更禁止など、`out_of_scope`で指定された全項目を遵守した。
