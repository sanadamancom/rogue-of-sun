# Phase 24.5a2: アクセサリー採用品・効果接続設計

docs-only監査。production code・testは変更していない。

## precheck

- base branch: `phase-24-5a1-accessory-ui-audit-completion`
- expected HEAD: `300b68fabc4c1958ebd78aeb73390adc5db8f172` — 実測一致
- local/remote SHA一致
- working tree clean（開始時点）
- main: `80596cd5334294255a439cb79db375f622193c50`（未変更）
- work branch `phase-24-5a2-accessory-selection-audit`: local/remoteとも不存在（新規作成）
- 未使用branch `phase-24-5b-accessory-core`: HEAD `300b68f...`（baseと同一）、独自commitなし、working tree変更なし、remote未push — 確認のみ、無変更
- remote URLにPAT/credential残存なし（作業開始時に除去、fetch後も除去を維持）
- `/mnt/project/githubpat`は無変更

baseline full suite（125/3152）・typecheck・buildはPhase 24.5a1時点で成功記録済みのため、docs-only工程として再実行していない。

## 指示逸脱の訂正（Phase 24.5a2aで追記）

Phase 24.5a2の完了報告には以下の不備があり、当時の「指示逸脱なし」という報告は誤りだった。

1. 選定条件「初期6種にC/B/A/Sを最低1種ずつ含める」という明示条件に対し、案A・案BともS rankが0種のまま完了報告していた。
2. 「コード上の未確認事項」を2件残したまま完了報告していた。
3. 上記1・2があったにもかかわらず「指示逸脱なし」と報告した。
4. 「S rank非採用」を最終判断待ちのPM判断として記録したが、S rankを含めること自体が既に明示条件であり、判断の余地がある事項ではなかった。

production/testへの影響はなく、本docs-only工程（Phase 24.5a2a）で全て解消した。具体的な訂正内容は本文書の各該当節（rank評価・案A/案B・enemy recognition監査・damage処理順・コード上の未確認事項・final selectionに残るPM判断）を参照。

## development planとの整合

現行development planの確定事項（本タスク文書記載分）：

- accessory装備枠は1枠
- 名称と基本効果は『新・ボクらの太陽』の一覧を基準にする
- 採用品は依存システム（敵・装備・状態異常・アイテム供給）完成後に選定する
- Phase 24.4完了後にPhase 24.5へ進む
- 既存のEquipmentInstance・一般アイテム鑑定・装備操作基盤を再実装せず拡張する

Phase 24.4系（enemy drop・curse・identification・telemetry整合性）は本監査時点で完了済みであることをbranch一覧（`phase-24-4a`〜`phase-24-4e2a`が全てmainへ統合済み）で確認した。依存システムはPhase 24.5a/24.5a1のreadiness audit（`docs/history/phase-24-5a-accessory-readiness-audit.md`）で確認済みの状態と矛盾しない。本監査はこの前提の上に立ち、productionへの採用品確定ではなく比較・監査を行う。

## 原作参照情報

`https://sunmiguere.web.fc2.com/shinbok_accessory.html` および `https://cyberfater.web.fc2.com/buki.and.akusesalre.html` への外部アクセスは本環境から行えないため、タスク文書で提示された11種の「原作効果の核」列（下記matrix）を入力事実としてそのまま採用した。本監査はこの入力情報の真偽を検証する立場になく、あくまで本ゲームのコード構造との接続可否を監査する。

## 効果再構成の方針（確認）

タスク文書の「引き継ぐもの／変更可能なもの／許容する例／許容しないもの」をそのまま監査基準として採用した。矛盾は見つからなかった。特に以下は既存コードの実例と直接対応することを確認した：

- 「ココロ上昇→本作のココロ能力・最大SOL接続」の許容例 → `ability.ts`のmind allocation（`state.maxSolarEnergy += MIND_MAX_SOL_PER_RANK`）、および`equipment-effects.ts`の`getEffectiveMaxSolarEnergy`（light_garb armorが既に同型の「装備由来の最大SOLボーナス」を実装済み）と完全に同型。
- 「透明化→認識距離低下」の許容例 → `turn.ts`の`isWithinAggroRange`/`AGGRO_RANGE`、および`equipment-effects.ts`の`getArmorAggroRangeReduction`（skull_suit armorが既に同型の「装備由来の初期認識距離短縮」を実装済み）と完全に同型。
- 「アイテム出現率をenemy dropへ限定」の許容例 → `enemy-drop.ts`の`rollEnemyDropOccurs`/`ENEMY_DROP_CHANCE_PROVISIONAL`が単一のchance閾値定数であり、閾値だけを差し替える拡張と自然に対応する。

## 共通実装契約の成立可否

タスク文書section 8の契約案を監査した結果、**全項目がPhase 24.5b（Claude側で設計調査済み、未実装）の設計と技術的に矛盾しない**。特に以下を確認：

- `EquipmentInstance`によるinstance ID単位管理・複数instance区別・装備/解除/交換/置く/捨てる・definitionId単位鑑定・pickupのみでは鑑定しない・`cursed:false`/`curseRevealed:false`固定・save/load不要 — Phase 24.5b調査時点（前工程）で`equipment-instance.ts`の既存契約（`isWeaponOrArmorId`→`isEquipmentDefinitionId`拡張、`getHeldEquipmentInstances`の3カテゴリ化）で成立することを確認済み。
- refineLevel強化対象外・DP対象外・solar forge対象外・Star/Temperance対象外・Moon/Sun対象外・mummy curse/curse_trap対象外 — 前工程で「`getStarCandidates`/`getTemperanceCandidates`/`getActiveCurseEligibleInstances`はaccessoryのcursed常時falseとrank C/B/Aにより既存フィルタを暗黙に素通りするため、category明示除外が必須」と特定済み（本監査でも同じ結論を再確認、下記「除外契約」参照）。
- 「accessory IDごとの大規模switchを複数箇所へ散在させない」 — `equipment-effects.ts`が武器/防具の`effectId`ディスパッチ基盤として既に存在し、`WeaponDefinition.effectId`/`ArmorDefinition.effectId`と同型の`AccessoryDefinition.effectId`をここへ追加する形で単一module集約が可能。技術的矛盾なし。
- 新規永続RNG field禁止・telemetry schemaVersion 8維持（24.5b/24.5c） — 前工程・本監査のいずれでも矛盾を発見していない。

技術的矛盾は0件。

## 11種の候補監査matrix

| CandidateId | 原作効果の核 | 本作向け効果案 | exact hook | reused helper | state mutation | RNG effect | turn effect | UI/log effect | implementation size | balance risk | provisional rank | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `circlet` | ココロ上昇／アイテム出現率低下 | 最大SOL固定加算＋enemy drop率低下 | `equipment-effects.ts`の`getEffectiveMaxSolarEnergy`相当の装備ボーナス関数（accessory分岐追加）／`enemy-drop.ts`の`rollEnemyDropOccurs`閾値 | `getEffectiveMaxSolarEnergy`（light_garb同型）、`rollEnemyDropOccurs`（chance引数化） | 現在SOLは不変（最大値のみ増減、既存mind allocation・light_garbと同じ「装備解除時に現在SOLをclampのみ」規約を踏襲） | 既存RNG消費順不変（enemy-drop閾値比較のみ変更、rng()呼び出し回数不変） | なし（装備/解除の通常ターン消費のみ） | 装備欄・item detail（既存表示契約内） | 小 | 低（デメリット同梱でバランス調整しやすい） | B | `ADAPTABLE` |
| `cool_bandana` | ココロ上昇／TRC増加量低下 | 最大SOL固定加算＋太陽チャージ量（`SUNLIGHT_CHARGE_AMOUNT`）低下 | `resolveSolarCharge`内の`SUNLIGHT_CHARGE_AMOUNT`参照箇所 | `getEffectiveMaxSolarEnergy`相当（circletと共通の最大SOLボーナスhelper） | 現在SOLは不変 | 影響なし | 太陽チャージのSOL回復量が変化するのみ、ターン消費自体は不変 | 装備欄・item detail | 小 | 中（circletとの役割重複リスクあり、下記rank評価で言及） | B | `ADAPTABLE` |
| `hot_blooded_headband` | TRC増加量上昇 | 太陽チャージ量（`SUNLIGHT_CHARGE_AMOUNT`）上昇 | `resolveSolarCharge` | 同上（cool_bandanaと対になる同一hookの符号違い） | なし | 影響なし | 太陽チャージのSOL回復量が変化するのみ | 装備欄・item detail | 小 | 低 | C | `DIRECT_FIT` |
| `earth_guard` | 毒化防止 | 装備中の新規poison付与を防止（enemy由来・poison_trap由来の両方） | `equipment-effects.ts`の`isPlayerPoisonImmune`（既存poison_guard armorの実装をaccessory側にも拡張する形の分岐追加、armorとaccessoryのOR条件） | `isPlayerPoisonImmune`（poison_guard同型そのもの） | なし | 影響なし | 影響なし | 装備欄・item detail | 極小（既存armor版と全く同じ判定を1関数拡張） | 低 | C | `DIRECT_FIT` |
| `shinobi_proof` | 足音消失／TRC増加量低下 | 未認識敵の初期認識距離短縮（`AGGRO_RANGE`）＋太陽チャージ量低下 | `turn.ts`の`isWithinAggroRange`が読む装備ボーナス関数（skull_suit armorの`getArmorAggroRangeReduction`と同枠、accessory分岐追加） | `getArmorAggroRangeReduction`（skull_suit同型） | なし | 影響なし | 既に追跡中／隣接／golem_charge中／steps稼働中の敵には無効（`isWithinAggroRange`の既存呼び出しガードがそのまま適用される） | 装備欄・item detail | 小 | 中（alphard_tiaraと同一hookのため役割重複リスク、下記rank評価で言及） | B | `DIRECT_FIT` |
| `alphard_tiara` | 透明化／取得経験値低下 | 未認識敵の初期認識距離短縮（`AGGRO_RANGE`、shinobi_proofと同一hook）＋取得経験値減少 | `isWithinAggroRange`の装備ボーナス関数（shinobi_proofと同一hook）／`defeatEnemyIfNeeded`内の`experienceReward`算出直前 | `getArmorAggroRangeReduction`相当／`applyExperienceGain`の呼び出し引数 | なし | 影響なし | 既に追跡中の敵には無効（shinobi_proofと同条件） | 装備欄・item detail | 小 | 中（shinobi_proofとの役割重複、下記rank評価で言及） | A | `ADAPTABLE` |
| `adventurer_boots` | 太陽の果実の効果上昇 | `sun_fruit`使用時のSOL回復量を固定加算で上昇 | `turn.ts`の`applyItemUse`内、`solarAmount > 0`分岐（sun_fruitのみがこの分岐に到達する既存の単一経路） | 既存`solarAmount`変数への装備ボーナス加算のみ | なし | 影響なし | `sun_fruit`使用不成立（SOL満タン）時の既存契約は不変（分岐に到達しないため） | メッセージログの回復量表示（既存`sun_fruit_used`イベントのamount反映のみ） | 極小 | 低 | B | `DIRECT_FIT` |
| `buckler` | ソードから受けるdamage軽減 | `enemy.type`が近接sword系（`sword`）の場合のみ被damage軽減 | `turn.ts`の`getIncomingDamage(state, attackPower)`の呼び出し箇所（呼び出し元に`enemy`が既にスコープ内にあるため`enemy.type`を新規第3引数として渡す拡張） | `getIncomingDamage`（シグネチャ拡張、armor防御との適用順は下記damage処理順で確定） | なし | 影響なし | 影響なし | 影響なし（戦闘ログの表示値には反映されるが専用UIなし） | 小（関数シグネチャ拡張1箇所＋呼び出し2箇所の引数追加） | 低 | C | `ADAPTABLE` |
| `crest_of_diamond` | 横斬りdamage上昇 | 通常近接物理damage（solar_gun以外の武器攻撃）へ固定加算 | `turn.ts`の`applyPlayerAttackToEnemy`内、`baseDamage`算出後の装備効果加算列（`equipment-effects.ts`の武器attack-start bonusと同じ挿入位置） | `equipment-effects.ts`の武器effect加算パターン（既存の複数装備効果が同じ`damage +=`列に並ぶ構造） | なし | 影響なし | 影響なし | 影響なし | 小 | 中（「横斬り」という原作モチーフが失われ通常近接一律強化になるため名称との乖離を監査時点で明記） | B | `ADAPTABLE` |
| `grigri_glasses` | 見えない罠等の発見 | 装備成立時に現在フロアの全trap発見、フロア移動時に新フロアの全trap発見、解除後も発見済み維持 | `turn.ts`の`revealTrap`（`applyClairvoyanceUse`と共有する既存の単一trap発見entry point）、装備成立時と`advanceToNextFloor`後のフック追加 | `revealTrap`（clairvoyance_fruitと完全同一関数の再利用） | trap配列の`revealed`フラグのみ（位置・種類・`triggered`は不変） | 消費なし | 影響なし | ミニマップ・player-visible表示は既存の`revealed`表示契約をそのまま再利用（新規UI不要） | 小 | 低 | A | `DIRECT_FIT` |
| `golden_mask` | アイテム出現率上昇 | 通常enemy drop成立率を10%→20%（`ENEMY_DROP_CHANCE_PROVISIONAL`の閾値のみ差し替え、RNG消費順不変） | `enemy-drop.ts`の`rollEnemyDropOccurs`（chance引数化） | `rollEnemyDropOccurs`（circletの低下版と対になる同一hookの符号違い） | なし | 消費回数・順序不変（同一rng()呼び出し1回、比較する閾値だけ変える） | 影響なし | 影響なし | 小 | 中（enemy dropのみに限定するか複数経路へ広げるかで原作らしさとRNG安全性がトレードオフ、下記に記録） | B | `ADAPTABLE` |

コードから確認できた事項に「推定」「要確認」「未確認」は残していない。原作効果の核（表の第2列）は外部参照不能につきタスク文書の入力情報をそのまま採用しており、この点のみ「本監査での検証対象外」である（推定ではなく、入力情報の受け入れとして明記）。

## damage処理順

`combat.ts`と`turn.ts`の該当コードを直接確認した現行pipelineは以下の通り。

**player→enemy（`applyPlayerAttackToEnemy`）:**

1. `computeAttackDamage(baseAttack, weaponBonus, defenderDefense)` — `baseAttack = state.player.attack + getPlayerAttackUpBonus + getPowerDamageBonus + getArmorEffectiveAttackBonus`、`weaponBonus = getPlayerWeaponBonus(state)`、`defenderDefense = target.defense`。`Math.max(1, baseAttack + weaponBonus - defenderDefense)`（固定減算、最小値1）
2. `baseDamage`を`damage`へ代入
3. 装備効果（武器attack-start bonus: sol_max_bonus/night_dark_bonus/low_life_bonus/dual_light_dark_bonus、maul/silver_flailのtrait bonus、battle_axeの per-floor-species bonus）を`damage +=`で加算
4. 属性ダメージ（`computeElementalDamage`）を別途加算（本監査では詳細未展開だが、既存の装備効果加算列とは別の変数として合算されることを`applyPlayerAttackToEnemy`冒頭で確認済み）
5. 最終的に`target.hp -= damage`相当でHP反映
6. `defeatEnemyIfNeeded`で撃破判定・経験値・enemy drop

**enemy→player（`getIncomingDamage`）:**

1. `computeIncomingDamage(attackerAttack, defenderDefense)` — `defenderDefense = getEffectivePlayerDefense(state)`（`state.player.defense + getEffectiveArmorValue(state)`）。`Math.max(1, Math.round(attackerAttack * Math.pow(2, -effectiveDefense/10)))`（比例減算、round、最小値1）
2. `emperor_shield`効果があれば`Math.max(1, Math.ceil(raw * (1 - EMPEROR_DAMAGE_REDUCTION)))`（乗算軽減、ceil、最小値1で再クランプ）
3. 呼び出し元（`tryMeleeAttack`等）でHP反映

**accessory挿入位置の推奨：**

- **buckler（enemy→player軽減）**: `getIncomingDamage`のarmor防御反映後・emperor_shield判定と同列（`raw`算出直後、emperor_shield分岐と同じ位置）に、`enemy.type === 'sword'`条件で乗算軽減を追加するのを推奨。armor軽減は`computeIncomingDamage`内の`defenderDefense`に既に織り込まれているため、buckler軽減は「armor軽減後の値」に対する追加乗算となり、適用順は「armor防御 → buckler軽減 → emperor_shield軽減」の順（emperor_shieldは既存コードで最後に位置するため、bucklerをその手前に挿入するのが最小変更）。最小値1は`getIncomingDamage`全体の最終戻り値に対して既存契約通り維持する。
- **crest_of_diamond（player→enemy強化）**（Phase 24.5a2aで実測・確定。以下「未確認事項2」参照）: `applyPlayerAttackToEnemy`内の既存装備効果加算列（手順3）に同じ形で`damage +=`加算するのを推奨。乗算ではなく既存パターンに合わせた固定加算とし、属性ダメージ（手順4）より前、`baseDamage`算出（手順1）より後に位置する。**重要な実測結果として、`resolveSolarGunAttack`は`applyPlayerAttackToEnemy`とは別の独立した関数ではなく、`applyPlayerAttackToEnemy`自体を直接呼び出している**（`turn.ts`内、solar_gun攻撃の最終ダメージ計算は近接攻撃と完全に同一の関数を共有する）。`applyPlayerAttackToEnemy`の呼び出し元は3箇所のみ（`resolveFacingAttack`内の隣接攻撃、同関数内のreach-2攻撃、`resolveSolarGunAttack`）で全て確認済み。`resolveFacingAttack`は`state.equippedWeaponId`が`solarCost`を持つ場合（solar_gunのみ）真っ先に`resolveSolarGunAttack`へ分岐するため、隣接/reach-2の2経路には常にsolar_gun以外の武器しか到達しない。したがって、crest_of_diamondの加算を無条件で装備効果加算列へ追加すると**solar_gun攻撃にも混入する**。この混入を防ぐ最小gateは、`applyPlayerAttackToEnemy`冒頭で既に取得済みのローカル変数`weaponId`（`const weaponId = state.equippedWeaponId`）を使った`if (weaponId !== 'solar_gun') { damage += crestBonus; }`という1行の条件分岐であり、これで近接物理damageの経路だけへ限定できる。card damage（justice/devil/tower等）は`applyPlayerAttackToEnemy`を一切呼び出さない別の固定ダメージ経路（`defeatEnemyIfNeeded`への直接呼び出し）であることも本監査で確認済みのため、そもそも混入経路が存在しない。属性ダメージ（手順4）は既存装備効果加算列とは別の変数として合算される独立ステップであるため混入しない。enemy→player方向は`getIncomingDamage`という完全に別の関数であるため混入しない。

**floor/ceil/round慣習**: player→enemyは切り捨てなしの単純減算（floor相当の整数演算のみ）、enemy→playerは`Math.round`、emperor_shieldは`Math.ceil`。accessory加算は既存の各経路の丸め方式を変更せず、既存の丸め済み値に対して整数固定加算または追加の乗算ステップとして挿入する（新しい丸め方式を導入しない）。

**telemetry/logへの影響**: `damage`変数自体に加算/軽減が反映されるため、既存の`player_attack_hit`/`player_damaged`等のイベントペイロード（既にダメージ確定値を記録する既存契約）はaccessory適用後の最終値をそのまま記録することになり、accessory専用の新規telemetry fieldは不要（既存汎用イベントの記録値が自動的に反映されるだけ）。

## enemy recognition監査

`turn.ts`の`isWithinAggroRange`/`AGGRO_RANGE`が全EnemyType共通の単一認識ゲートであることを確認した。

- **同室認識**: 本監査で該当する専用ロジックは見つからなかった（`isWithinAggroRange`はChebyshev距離のみで判定、部屋境界を参照しない）。
- **視界または距離認識**: `isWithinAggroRange`（Chebyshev距離、`AGGRO_RANGE = 8`固定、`state`引数経由で`getArmorAggroRangeReduction`による短縮を反映）。
- **隣接攻撃**: `isAdjacent(enemy.pos, state.player.pos)`が真の場合は`isWithinAggroRange`の判定を経由せず常に行動（ゲートの前提条件`!isAdjacent(...)`で除外）。
- **遠距離能力・予告済み能力**: golem突進（`golemChargeState !== 'idle'`）・steps（`stepsState !== 'hidden'`）は`isWithinAggroRange`のゲート自体をバイパスする明示的な条件式（`!golemChargeInProgress && !stepsMidCycle`）で除外されている。
- **既に追跡中の状態**: 上記golem/stepsの2種以外に「追跡中フラグ」を持つ敵種は本監査のコード確認範囲では見つからなかった。`isWithinAggroRange`はChebyshev距離のみを見るため、一度隣接から離れた敵は次ターン以降再びこのゲートを通過する（ただし通常の8マス範囲なら`shinobi_proof`/`alphard_tiara`装備時は再判定も短縮された距離で行われる）。
- **wall内・固定配置・特殊状態の敵**: `behaviorType !== 'stationary'`条件で`stationary`種は常にゲートをバイパス（＝常に行動、距離に関わらない）。skeleton head形態は`isWithinAggroRange`の判定より前の早期returnで「一切行動しない」扱いとなり、認識ゲート自体に到達しない。
- **monsterHouse発覚後**（Phase 24.5a2aで実測・確定。以下「未確認事項1」参照）: `turn.ts`の敵行動ループ（`resolveEnemiesAction`相当のfor文）で`if (enemy.spawnSource === 'monster_house' && state.map.monsterHouse?.status === 'hidden') continue;`が最初に評価される。`state.map.monsterHouse?.status`が`'hidden'`の間はmonsterHouse産の敵は行動ループへ一切入らない（RNG消費もaction gauge消費もなし）。`status`が`'revealed'`になった後は、この`continue`条件が偽になるため、monsterHouse産の敵はそれ以降**通常の敵と全く同じ行動ループ**（`resolveOneEnemy`）へ入り、`isWithinAggroRange`を含む既存の全ゲート（golem_charge/steps中断・stationary・skeleton head等の個別バイパスも含む）をそのまま通過する。`resolveOneEnemy`内部に`spawnSource === 'monster_house'`を参照する分岐は存在しない（本監査で`resolveOneEnemy`全文を確認済み、該当参照は上記行動ループの`continue`1箇所のみ）。

**結論（未確認事項1の確定結果）**: **共通認識ゲートで処理可能**。monsterHouse産の敵はrevealed後、`isWithinAggroRange`という同一の共通ゲートで処理され、認識距離を無視して強制追跡することはない。専用の除外や特別扱いは不要——shinobi_proof/alphard_tiaraの認識距離短縮効果は、revealed後のmonsterHouse産の敵にも通常の敵と全く同じように自然に適用される。「推定」「要確認」「未確認」は残していない。

**総合結論**: 共通hook（`isWithinAggroRange`とその装備ボーナス引数）で全EnemyTypeを問題なく処理できる。個別敵species分岐は不要。shinobi_proof/alphard_tiaraはいずれも`DEFER`ではなく実装可能と判断する。

## generation設計（Phase 24.5c向け、実装なし）

- **weapon/armorカテゴリへ混ぜない・accessory独立カテゴリ**: `equipment-loot.ts`の`NormalEquipmentSlot`型（`'sword'|'spear'|'hammer'|'armor'|'solar_gun'`の5値union）へaccessoryを追加せず、並行する新規`AccessoryEquipmentSlot`型（accessory rank別またはaccessory単一slot）を設けることで達成可能。
- **独立RNG stream**: `state.ts`のfloor生成ループが`equipmentDefinitionRng`/`equipmentCurseRng`という専用XOR定数ストリームを既に持つのと同じパターンで、`accessoryDefinitionRng`等の新規専用ストリームを追加する（既存ストリームの消費順序には触れない）。
- **接続境界（3経路）**:
  - 通常床: `state.ts`のground-item配置ループ（`isWeaponOrArmorId(itemId)`分岐と並行する新規`isAccessorySlot(itemId)`分岐）
  - monsterHouse報酬: 同ファイルの reward 生成ループ（同型の並行分岐）
  - enemy drop: `enemy-drop.ts`の`selectEnemyDropItemIdWithCards`相当（accessory候補を含める場合は新規independent salt）
- **再利用可能なhelper**: `mintEquipmentInstance`（Phase 24.5b調査で`EquipmentDefinitionId`を受け取れるよう拡張見込み）、`floorProgressRatio`（既存のフロア深度比率関数、rank別weight算出に転用可能）
- **必要な新規helper**: accessory rank別（C/B/A/S）weighted選択関数（`equipment-loot.ts`の`getNormalEquipmentCandidates`と同型）、accessory候補プール定義（`item-def.ts`のGROUND_ITEM_POOL系と並行する新規配列）
- **必要な独立salt**: 通常床用accessory定義ロール・rank抽選ロール、monsterHouse報酬用の同型2種、enemy drop用の同型2種（既存の「経路ごと・用途ごとに専用salt」原則を踏襲）
- **instance mint境界**: 配置成功時のみ（既存のweapon/armor floor生成と同じ「配置位置が見つからなければinstance自体をmintしない」契約を踏襲可能、`chooseGroundItemPosition`の失敗時挙動と同型）
- **placement failure時の挙動**: 既存のweapon/armor floor生成同様、配置位置探索が失敗した場合はそのスロットをスキップ（instanceを作らない）
- **既存RNG非干渉の検証方法**: 新規accessory streamがすべて独自XOR定数由来であることのfocused test（既存の`combatRngState`/`itemSelectionRng`等の消費回数が新規accessory生成コードの有無で変化しないことを比較するテスト）
- **Phase 24.5cで決めるべきprovisional値**: 3経路それぞれのroute weight、rank別weight比率、accessory全体の出現割合（既存カテゴリへの無断上乗せ禁止のため、これは既存カテゴリの重みを削らず「新規独立枠」として加える設計が必要——本監査ではこの数値自体は決定しない）

## rank評価

原作レベルではなく本ゲームでの影響度から評価した。

| CandidateId | 発動頻度 | 対象範囲 | 1ラン全体への影響 | 既存consumable無価値化 | 敵/罠/供給依存度 | 3F sample価値 | 長編run価値 | デメリット | 役割重複 | provisional rank |
|---|---|---|---|---|---|---|---|---|---|---|
| `circlet` | 常時（最大SOL) + enemy drop毎 | 資源・loot | 中 | なし | 低 | 中 | 中 | あり（drop率低下） | cool_bandanaと部分重複 | B |
| `cool_bandana` | 常時（最大SOL）+ チャージ毎 | 資源 | 中 | なし | 低 | 中 | 中 | あり（チャージ量低下） | circletと部分重複 | B |
| `hot_blooded_headband` | チャージ毎 | 資源 | 小〜中 | なし | 低 | 中 | 中 | なし | なし | C |
| `earth_guard` | 常時（毒付与試行毎） | 状態異常防御 | 小（毒の出現頻度に依存） | `antidote`/`panacea`の一部用途と部分重複するが根絶ではない | 中（毒付与経路の頻度に依存） | 低〜中 | 中 | なし | `poison_guard` armorと役割重複（装備枠が別なので実害は限定的） | C |
| `shinobi_proof` | 常時（未認識敵との遭遇毎） | 探索・回避 | 中〜高 | なし | 低 | 高 | 高 | あり（チャージ量低下） | alphard_tiaraと同一hookで重複 | B |
| `alphard_tiara` | 常時（未認識敵との遭遇毎 + 撃破毎） | 探索・戦闘回避・資源 | 中〜高 | なし | 低 | 高 | 高 | あり（経験値減少） | shinobi_proofと同一hookで重複 | A |
| `adventurer_boots` | `sun_fruit`使用毎 | 資源 | 小（`sun_fruit`所持数に依存） | なし | 低 | 低（3Fでは`sun_fruit`遭遇数が限定的） | 中 | なし | なし | B |
| `buckler` | sword系敵との戦闘毎 | 戦闘防御 | 小〜中（sword系敵の出現割合に依存） | なし | 中（sword系敵の出現頻度に依存） | 中 | 中 | なし | なし | C |
| `crest_of_diamond` | 近接攻撃毎 | 戦闘攻撃 | 中 | なし | 低 | 中 | 中 | なし | なし | B |
| `grigri_glasses` | フロア移動毎 | 探索 | 中（罠回避価値） | `clairvoyance_fruit`と機能重複（フロア全体trap発見という同一効果） | 低 | 中 | 中 | なし | `clairvoyance_fruit`と重複（別カテゴリなので実害は限定的、下記に記録） | A |
| `golden_mask` | enemy drop毎 | loot | 中〜高（累積効果） | なし | 中（enemy drop頻度に依存） | 低（3Fでは撃破数が限定的） | 高（長編runほど累積） | なし | circlet（逆方向効果）と対 | B |

**訂正（Phase 24.5a2a）**: 前回report時点の本節では「S rankは11候補中に該当なし」としてC/B/Aの3段階のみで評価していたが、これはPhase 24.5a2で明示された「初期6種にC/B/A/Sを最低1種ずつ含める」という条件への違反であり、誤りだった。Phase 24.5a2aで以下の通り訂正する：

- `grigri_glasses`（グリグリメガネ）は「フロア全体の探索情報を恒常的に変化させる」という影響範囲の大きさから、S rankへ格上げする（rank判断基準「S：フロア全体の探索情報を恒常的に変化させる」に合致）。
- `golden_mask`（黄金仮面、案Bのみ採用）は「run全体の供給へ影響する」ことから、S rankへ格上げする。

この訂正を反映した確定rank構成は下記「正式採用案（Phase 24.5a2aで確定）」「案A（rank訂正後）」「案Bのrank訂正」を参照。

## 正式採用案（Phase 24.5a2aで確定）

Phase 24.5a2の案Aを、下記の通りrankを訂正した上で初期採用品として正式採用する。数値はPhase 24.5dでprovisional値を設定し、本工程では意味・対象・境界のみを確定する。

| AccessoryId | 表示名 | rank | 効果の方向性 |
|---|---|---:|---|
| `hot_blooded_headband` | 熱血ハチマキ | C | 太陽チャージ強化 |
| `earth_guard` | 大地の守り | C | 新たな毒付与を防止 |
| `buckler` | バックラー | C | sword敵からの物理damage軽減 |
| `adventurer_boots` | 冒険者のブーツ | B | 太陽の実によるSOL回復強化 |
| `circlet` | サークレット | A | 最大SOL強化＋通常enemy drop率低下 |
| `grigri_glasses` | グリグリメガネ | S | 現在フロアのtrapを発見 |

rank構成: C×3、B×1、A×1、S×1 — C/B/A/S全rankを最低1種ずつ含む条件を満たす。

### 確定した効果契約

**熱血ハチマキ**: 装備中の成立した太陽チャージ量を増加。日向で成立する既存solar charge処理（`resolveSolarCharge`）だけが対象。`sun_fruit`、カード、敵撃破、自然回復へ影響しない。RNG非消費。charge不成立時は効果なし（`resolveSolarCharge`は既にSOL満タン等の不成立条件を呼び出し元で確認済みの前提でのみ呼ばれるため、この契約は既存呼び出し規約とそのまま整合する）。

**大地の守り**: 装備中、新たなpoison付与を防ぐ。`isPlayerPoisonImmune`（既存poison_guard armorの実装）と同型の判定をaccessory側にも拡張し、enemy由来と`poison_trap`由来の両方（turn.tsの`if (effectId === 'poison' && isPlayerPoisonImmune(state))`という単一の共通ガード位置を経由する全経路）を対象とする。装備前から成立しているpoisonは治療しない（`isPlayerPoisonImmune`は新規付与の拒否のみで既存effectには触れない、poison_guardと同じ挙動）。装備解除時にpoisonを付与しない（解除自体はpoison付与処理を一切トリガーしない）。damage・turn・RNGへ影響しない。

**バックラー**: 装備中、`enemy.type === 'sword'`から受ける成立済み物理damageを軽減。`getIncomingDamage`内、armor防御反映後・`emperor_shield`判定と同列の位置に、`enemy.type === 'sword'`条件のみで動作する乗算軽減を追加。sword以外の敵へ影響しない。状態異常・追加効果へ影響しない（`getIncomingDamage`は`damage`という数値のみを返す純粋な計算経路であり、状態異常付与は別の呼び出し元処理のため自動的に非干渉）。emperor shield等の既存軽減と共存（適用順は「armor防御 → buckler軽減 → emperor_shield軽減」）。minimum damageは`getIncomingDamage`全体の最終戻り値に対して既存契約通り維持。具体的な軽減率と丸めはPhase 24.5dで決定。

**冒険者のブーツ**: 装備中に成立した`sun_fruit`使用だけを強化。`applyItemUse`内の`solarAmount > 0`分岐（sun_fruitのみがこの分岐に到達する既存の単一経路）でSOL回復量を増加。最大SOLでclamp（既存の`Math.min(getEffectiveMaxSolarEnergy(state), ...)`のclamp処理をそのまま利用）。他の果実、太陽チャージ、自然回復、カードへ影響しない（`solarAmount`分岐は`sun_fruit`専用の単一経路であり、他の回復源はそれぞれ別の分岐・別の関数を経由するため構造的に非干渉）。RNG非消費。使用不成立時（SOL満タン、`sun_fruit_use_failed`）は分岐へ到達しないため追加効果なし。

**サークレット**: 装備中、最大SOLを増加。一般アイテム鑑定とは独立（`markGeneralItemIdentified`は装備成立時に別途呼ばれる既存の独立処理であり、最大SOL増減自体はこれと無関係）。装備解除時、現在SOLが新しい最大値を超える場合だけclamp（mind allocationの既存contract「現在SOLは維持、最大値変動時のみclamp」を踏襲）。通常enemy drop成立率を低下——`enemy-drop.ts`の`rollEnemyDropOccurs`が比較する閾値（`ENEMY_DROP_CHANCE_PROVISIONAL`）のみを装備状態に応じて差し替える。floor item、MH報酬、card supply、固定報酬へ影響しない（`rollEnemyDropOccurs`はenemy drop専用の単一関数であり、他の供給経路はそれぞれ独立したプール・RNGストリームを持つため構造的に非干渉）。enemy-drop既存独立RNG streamを維持——rng()呼び出し回数・順序は変えず、比較する閾値定数だけを変更する。最大SOL上昇量とdrop率低下幅はPhase 24.5dで決定。

**グリグリメガネ**: 装備成立時、現在フロアの全trapを発見済みにする（`revealTrap`をtraps配列全件へ適用、`applyClairvoyanceUse`と完全に同一のループパターン）。装備中に次フロアへ移動した場合、新フロアの全trapを発見済みにする（`advanceToNextFloor`完了後のフックで同じ処理を再適用）。一度発見したtrapは装備解除後も発見済みのまま（`revealTrap`が設定する`trap.revealed = true`はtrap個体に紐づく永続フラグであり、装備解除で巻き戻す処理を追加しない限り自動的に維持される）。trap位置・種類・発動状態は変更しない（`revealTrap`は`revealed`フィールドのみを変更し、`trapType`/`pos`/`triggered`には触れない）。`clairvoyance_fruit`の既存trap発見helper（`revealTrap`）を再利用。RNG非消費（`revealTrap`自体がRNGを消費しない純粋なフラグ設定関数）。既存の発見済みtrap表示（ミニマップ・player-visible表示）をそのまま再利用（`revealed`フラグを参照する既存表示契約に新規分岐は不要）。

## 案B：原作らしさ優先（代替案としてhistoryへ残す、初期採用しない）

**Phase 24.5a2aで`golden_mask`のrankをBからSへ訂正した。** 黄金仮面はrun全体のアイテム供給へ影響するため、rank判断基準「S：フロア全体の探索情報を恒常的に変化させる」に準ずる影響範囲の大きさ（run全体のloot供給という時間軸での恒常的影響）からSへ格上げする。

| Accessory | rank | 本作向け効果 | デメリット | exact hook | implementation size | balance risk |
|---|---|---|---|---|---|---|
| `hot_blooded_headband` | C | 太陽チャージ量上昇 | なし | `resolveSolarCharge` | 小 | 低 |
| `circlet` | B | 最大SOL上昇＋enemy drop率低下 | あり（drop率低下） | 装備ボーナスhelper＋`rollEnemyDropOccurs`閾値 | 小 | 低 |
| `shinobi_proof` | B | 未認識敵の初期認識距離短縮＋チャージ量低下 | あり（チャージ量低下） | `isWithinAggroRange`装備ボーナス | 小 | 中（alphard_tiaraと同一hookのため、両方採用時は役割の差別化を明文化する必要） |
| `crest_of_diamond` | B | 近接物理damage上昇 | なし | `applyPlayerAttackToEnemy`装備効果加算列（`weaponId !== 'solar_gun'`ゲート必須） | 小 | 中（「横斬り」モチーフが通常近接一律強化に変換されるため原作らしさがやや後退） |
| `alphard_tiara` | A | 未認識敵の初期認識距離短縮＋取得経験値減少 | あり（経験値減少） | `isWithinAggroRange`装備ボーナス＋`experienceReward` | 小 | 中（同上） |
| `golden_mask` | **S**（訂正: B→S） | enemy drop率上昇（10%→20%） | なし | `rollEnemyDropOccurs`閾値 | 小 | 中（circletの逆方向効果と対になるため、両方採用時のバランス確認が必要） |

（rank構成: C×1、B×3、A×1、S×1 — C/B/A/S全rankを最低1種ずつ含む条件を満たす。デメリット付きが3種と多く、shinobi_proof/alphard_tiaraの同一hook重複を許容する設計。この案は代替案としてhistoryへ残すのみで、初期採用品には含めない。）

## 共通する候補・各案だけの候補

- **共通**: `circlet`、`hot_blooded_headband`
- **案Aだけ**: `earth_guard`、`adventurer_boots`、`grigri_glasses`、`buckler`
- **案Bだけ**: `shinobi_proof`、`alphard_tiara`、`crest_of_diamond`、`golden_mask`

## 推奨案

**案Aを正式な初期採用案とする（Phase 24.5a2aで確定）。** rank構成は上記「正式採用案」節の通りC/B/A/S全rankを1種ずつ含む構成へ訂正済み。

### 推奨理由

- 全6種が単一の既存hookへの直接接続（`DIRECT_FIT`）または最小限のシグネチャ拡張（`ADAPTABLE`、いずれも1関数・数行規模）で成立し、Phase 24.5d（固有効果実装）を短期間で完了できる見込みが高い。
- 役割重複が実質的にない（circletのenemy drop率低下とhot_blooded_headbandのチャージ量上昇は異なる資源軸、earth_guardの毒防止とadventurer_bootsの果実強化とgrigri_glassesの罠発見とbucklerの被ダメ軽減はいずれも独立した領域）。案Bのshinobi_proof/alphard_tiara同一hook重複という設計判断の先送りが不要。
- combat（buckler）・resource（circlet/hot_blooded_headband/adventurer_boots）・exploration（grigri_glasses）・status防御（earth_guard）の複数領域を1種類ずつ含み、選定条件5（複数領域を含む）を最も自然に満たす。
- デメリット付き装備1種（circlet）を含み、選定条件7を満たす。

### 推奨案の実装コストとbalance risk

実装コストは6種中5種が`DIRECT_FIT`または`ADAPTABLE`の最小規模（既存関数への数行分岐追加、または1箇所のシグネチャ拡張）であり、Phase 24.5d全体としても既存の武器/防具効果実装（Phase 24.3）と同規模かそれ以下と見込む。balance riskはcircletのenemy drop率低下（プレイヤー体験へ与える影響がやや不透明）を除き全て低い。

## デメリット付き装備の扱い

案Aは`circlet`（enemy drop率低下）の1種のみがデメリット付きで、選定条件7「デメリット付き装備を最低1種含めるか、不採用理由を示す」を満たす。他5種は無デメリットだが、これは「装備選択の判断が発生する」という条件2を弱める可能性がある——ただし装備枠が1つしかない以上、6種のうちどれを装備するかという選択自体が既に条件2を満たすため、追加デメリットの有無は必須ではないと判断する。

## 効果再構成を行った候補

11種全てで数値・発動条件・対象範囲のいずれかを本ゲーム向けに変更している。特に以下は原作の性質から明確に変換している：

- `alphard_tiara`「透明化（無敵）」→「未認識敵の初期認識距離短縮（既存追跡中の敵には無効）」——完全無敵化を明示的に排除する要件通り
- `shinobi_proof`「足音消失」→ 同上の認識距離短縮（同一hookのため実質同効果、太陽チャージ低下で差別化）
- `crest_of_diamond`「横斬りdamage上昇」→「近接物理damage一律上昇」——本ゲームに横斬りという攻撃種が存在しないための必然的変換
- `golden_mask`/`circlet`「アイテム出現率」→「enemy drop chance閾値」——複数経路への同時適用ではなく単一経路（enemy drop）へ限定

## 延期・不採用候補

今回の11候補は全て`DIRECT_FIT`または`ADAPTABLE`に分類され、`DEFER`/`REJECT`に該当する候補は0件だった。ただし案A/案Bのいずれにも採用しなかった5種（`earth_guard`/`adventurer_boots`/`buckler`または`shinobi_proof`/`alphard_tiara`/`crest_of_diamond`/`golden_mask`、選ばなかった側）は、次点候補としてPhase 24.6以降の追加accessory候補に据え置くことを推奨する。

## generation接続可否

Phase 24.5c向けの生成方式（上記「generation設計」節）はweapon/armorカテゴリへの無断混入がなく、既存RNGストリームとの非干渉も「独立salt新設」という既存パターンの反復で達成可能と判断した。stop conditionには該当しない。

## RNG非干渉方針

circlet/golden_maskの`rollEnemyDropOccurs`閾値変更は、rng()呼び出し回数・順序を一切変えず比較対象の定数のみを差し替える設計とすることで、既存のcombat RNG・map生成RNG・floor item RNG・monsterHouse RNG・enemy-drop RNG・card-supply RNG・curse RNGのいずれにも影響しない。他候補（hot_blooded_headband/earth_guard/adventurer_boots/buckler/grigri_glasses/shinobi_proof/alphard_tiara/crest_of_diamond）はRNGを一切消費しない設計のため、この点でも非干渉が成立する。

## 共通実装契約の成立可否（再掲）

上記「共通実装契約の成立可否」節の通り、全項目が成立する。矛盾なし。

## 全除外契約の成立可否

Star/Temperance/Moon/Sun/solar forge/refine/mummy curse/curse_trap/normal floor loot/monsterHouse reward/enemy drop candidate pool/card supplyの全除外契約は、Phase 24.5bの設計調査で特定した「`getStarCandidates`/`getTemperanceCandidates`/`getActiveCurseEligibleInstances`への明示的category除外の追加」と、Phase 24.5cで新設する独立生成カテゴリ（既存プールへの無断混入をしない設計）の組み合わせで成立する。本監査で新たな矛盾は発見しなかった。

## telemetry schemaVersion判断

- **Phase 24.5b（型・操作・UI）**: 既存の`equipment_changed`/`equipment_acquired`等の汎用イベントは`slot: 'weapon'|'armor'`限定の型であり、accessory用に新しいraw event/summary fieldを追加しない限りschemaVersion 8を維持できる（Phase 24.5b調査時点の結論を再確認）。
- **Phase 24.5c（生成追加）**: 生成経路の追加自体は`ItemId`/`EquipmentDefinitionId`のunion拡張のみであり、export schema自体を変更しない限りschemaVersion 8を維持できる。
- **Phase 24.5d（固有効果）**: 本監査で洗い出した6種の効果はいずれも既存の汎用イベント（`sol_changed`/`solar_charge`/`sun_fruit_used`/`player_damaged`/`trap_revealed`/`equipment_curse_generated`系）が記録する値に自然に反映される設計とした（例: bucklerの軽減は`player_damaged`のamountに、adventurer_bootsの回復量上昇は`sun_fruit_used`のrecoveredに、circletのenemy drop率低下は既存drop関連イベントの発生頻度自体に反映される）。**accessory固有のraw event・summary fieldは不要と判断し、Phase 24.5dでもschemaVersion変更は不要という結論に至った**——ただし固有effectログとして「どのaccessoryが効果を発動させたか」を明示的にtelemetryへ残したい場合はこの限りでなく、その場合は既存パターン（Phase 24.4e2の前例、7→8）に倣ったbumpが必要になる。この判断はPhase 24.5d着手時に再確認することを推奨する。
- **player-visible未鑑定名漏洩の危険**: 上記6種のいずれの効果も、`getDisplayedItemName`/既存の一般アイテム鑑定契約を経由しない直接的な名前露出を要求しない設計とした（damage軽減・SOL増減・trap発見はいずれもプレイヤーへaccessoryの真名を明示しなくても体感できる効果）。

## 後続Phase分割

タスク文書section 18の分割案を検証した結果、矛盾は見つからなかった。

- Phase 24.5b：AccessoryId、定義、instance、1枠、基本操作、鑑定、最小UI、既存機能からの除外
- Phase 24.5c：独立生成カテゴリ、通常床・MH報酬・敵ドロップ、RNG非干渉
- Phase 24.5d：固有効果、効果ログ、必要なtelemetry接続
- Phase 24.6：出現率、効果量、所持枠への影響調整

この分割のまま推奨する。

## コード上の未確認事項

**0件**（Phase 24.5a2aで確定。前回report時点の2件はいずれもコード実測により解消済み）:

1. ~~monsterHouse発覚後のフラグが`isWithinAggroRange`の判定と独立して存在するかどうか~~ → **確定済み**: `turn.ts`の敵行動ループを直接確認し、monsterHouse産の敵は`status === 'hidden'`の間のみ行動ループ自体から除外され、`revealed`後は`isWithinAggroRange`を含む通常の共通ゲートで処理されることを確認した（上記「enemy recognition監査」節参照）。
2. ~~`resolveSolarGunAttack`とcrest_of_diamond加算列の独立性~~ → **確定済み**: `resolveSolarGunAttack`は独立した別経路ではなく`applyPlayerAttackToEnemy`自体を呼び出す共有関数であることを直接確認した。混入を防ぐ最小gate（`weaponId !== 'solar_gun'`)を特定した（上記「damage処理順」節参照）。

## final selectionに残るPM判断

**訂正（Phase 24.5a2a）**: 「6種の最終確定」自体はPhase 24.5a2aで案A（rank訂正版）を正式採用したため解消済み。「S rankを初期6種に含めるか否か」の項目は、Sを含めること自体が既に明示条件だったため削除する（誤った前提のPM判断だった）。残るPM判断は以下の通り：

- 数値（デメリット率・回復量・軽減率等）の具体的provisional値（Phase 24.5dで決定）
- circletのenemy drop閾値の具体的な変更幅（監査内で言及した数値は一例であり確定値ではない）
- Phase 24.5cのroute weight・rank別weight比率のprovisional値

## development-planへ反映すべき具体的文章（下書き）

以下はChatGPT側でdevelopment-plan.mdへ反映できる短い更新案。repositoryへdevelopment-plan.mdは作成していない。

```
### Phase 24.5 アクセサリー装備

- Phase 24.4（enemy drop・curse・identification・telemetry整合性）完了。
- Phase 24.5a（readiness audit）・24.5a1（UI audit補完）・24.5a2（採用品・効果接続設計）・
  24.5a2a（選定監査の補正・最終化）完了。
- アクセサリー装備枠は1枠（weapon/armorと並ぶ第三枠）。
- 名称・効果の方向性は原作を維持しつつ、数値・対象・発動条件は本ゲーム向けに調整可能。
- 初期採用品6種（確定）:
  - 熱血ハチマキ（hot_blooded_headband）: rank C、太陽チャージ強化
  - 大地の守り（earth_guard）: rank C、新たな毒付与を防止
  - バックラー（buckler）: rank C、sword敵からの物理damage軽減
  - 冒険者のブーツ（adventurer_boots）: rank B、太陽の実によるSOL回復強化
  - サークレット（circlet）: rank A、最大SOL強化＋通常enemy drop率低下
  - グリグリメガネ（grigri_glasses）: rank S、現在フロアのtrapを発見
- 初期accessoryはcurse・refine・DP・solar forge・Star・Temperance・Moon・Sun対象外。
- Phase分割: 24.5b（定義・instance・1枠・操作・鑑定・UI・除外）→
  24.5c（独立生成カテゴリと3route接続）→
  24.5d（固有効果と必要なtelemetry）→ 24.6（出現率・効果量・所持枠影響の調整）。
- telemetry schemaVersionはPhase 24.5b/24.5cで8を維持。24.5dでのbump要否は
  実装時に再確認。
```

## verification

- production code変更: **なし**（`git diff --stat`はhistoryファイルのみ）
- test変更: **なし**
- history以外の差分: **なし**
- 一時ファイル: **なし**（読み取り専用のgrep/view/sedによるコード監査のみ、一時スクリプトを作成していない）
- generated file: **なし**
- credential/PAT混入: **なし**
- 未使用`phase-24-5b-accessory-core`: **未変更**（本工程中に一切checkout/操作していない）

### Phase 24.5a2a（本補正工程）でのverification

- production code変更: **なし**
- test変更: **なし**
- 更新対象history（本ファイル）以外の差分: **なし**
- 新規history: **なし**（既存ファイルの更新のみ、`phase-24-5a2a`名の新規文書は作成していない）
- 一時ファイル: **なし**
- credential/PAT混入: **なし**
- 未使用`phase-24-5b-accessory-core`: **未変更**（本工程中に一切checkout/操作していない）
