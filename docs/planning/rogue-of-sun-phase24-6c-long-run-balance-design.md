# ROGUE OF SOL Phase 24.6c 26F往復・敵成長・資源設計

更新日：2026-08-17
文書版：Version 4
対象baseline：branch `phase-24-6b2a2-availability-regression-coverage` / commit `701c3a3464de52ff2f1ec9fe92598f7315a365e6`
文書の役割：Phase 24.6c～24.8で実装・測定する製品run構造、EnemyLevel、経験値、敵供給、item供給、帰還条件の設計正本

### Version 4の主な更新

- 26F救出を即時の帰還遷移から分離し、救出後に同じ26Fの階段へ戻って初めて帰還legへ移る状態機械を確定
- おてんこさまの決定的配置、救出時のターン処理、同行描画とゲーム状態の境界を追加
- 下降seedの既存互換と帰還専用seed、floor visit ordinal、floor内turn、増援ordinalの契約を確定
- 中断saveの保存対象、保存可能時点、単一slot、one-shot再開、破損・version不一致時の扱いを確定
- telemetry event、HUDの下降／帰還表示、51 floor visitの集計keyを追加

---

## 1. 結論

製品版はshort／standard／deepのコース制を採用せず、単一の26Fダンジョンとする。

1. 1Fから26Fまで下降する。
2. 26Fで封印されたおてんこさまを救出する。
3. 26Fから1Fまで帰還する。
4. おてんこさま救出済みで1Fから地上へ出るとclearになる。

下降26floor＋帰還25floorで、最大51回のfloor訪問となる。floor遷移のたびにmapを再生成し、以前のfloor状態は復元しない。帰還時には通常の床itemを生成しないが、通常敵とenemy dropは存在する。

プレイヤーlevel、能力ポイント、EnemyLevel 1～3、装備rank C～R、太陽鍛冶は維持する。ただしEnemyLevelは全体進行度に一律適用せず、各敵種の登場期間内における相対的な強化段階として扱う。

---

## 2. 参考作品の役割

1. **初代`Rogue`**：基本システムの正本。下降と帰還、floor再生成、item分類、資源管理、識別、死亡時のrun喪失を参照する。
2. **『ボクらの太陽』**：本作独自の主題。SOL、日照、太陽銃、属性、太陽鍛冶、おてんこさまを組み込む。
3. **SFC版『トルネコの大冒険』『風来のシレン』**：日本語UI、操作性、敵level、プレイヤー成長、罠、モンスターハウス等を参照する。

作品間で仕様が衝突する場合はこの順で判断する。原作数値は無条件に移植せず、本作の総獲得EXP、戦闘手数、turn数、inventory圧迫から調整する。

---

## 3. 現行実装からの変更

### 維持

- 3F sampleの決定性と回帰test
- プレイヤーlevel、LIFE、SOL、満腹度、4能力
- EnemyType 12種と既存固有行動
- `EnemyLevel = 1 | 2 | 3`の内部表現
- C／B／A／S／R装備rankと太陽鍛冶
- 生成経路ごとの独立RNGとマスターseedからの再導出

### 廃止・置換

- short=10F、standard=30F、deep=99Fを廃止する。
- 製品版の`totalFloors`は26とする。
- `runDepthTier`、`minimumRunDepth`、コース別UIは互換期間を経て撤去する。
- 全敵levelを単一の`progress`で決める設計を廃止する。
- item availabilityは`minimumDepth`、任意の`maximumDepth`、`leg`へ置換する。
- 最終floor到達clearを、救出後の1F脱出clearへ置換する。

### 新規state

- `leg: "descent" | "ascent"`
- `otencoState: "sealed" | "rescued"`
- `depth`: 1～26
- `floorVisitOrdinal`: 1から開始し、floor遷移成功時だけ加算する
- `floorTurn`: floor開始時0、consumed turnごとに加算する
- `reinforcementOrdinal`: floor開始時0、増援判定ごとに加算する
- `foodDroughtFloors`: 下降floorの食料不足補正用counter
- `otencoPos?: Vec2`: 26F救出前だけ存在するfloor内目標座標

26Fで救出した時点では`leg = descent`のまま同じmapに留まる。救出後に26Fの階段へ到達したfloor遷移で、初めて`leg = ascent`へ切り替えて25Fを生成する。`leg = ascent`かつ`otencoState = rescued`で1Fの階段へ到達すると、次のfloorを生成せず地上帰還clearになる。

おてんこさまは救出対象と同行表示だけを行う。HP、AI、collision、攻撃、buff、SOL／満腹度効果、罠相互作用、escort失敗条件は持たない。救出対象への接触は通常の成立したmoveとして1turnを消費するが、救出後のおてんこさま自身はturnを消費しない。

---

## 4. floor遷移と生成

### 4.1 遷移状態機械

| 現在状態 | 階段到達時の結果 |
|---|---|
| 下降1～25F | `depth + 1`の下降floorを生成 |
| 下降26F・`sealed` | 遷移せず、「おてんこさまを見つけなければ、地上へは戻れない。」と通知 |
| 下降26F・`rescued` | `leg = ascent`へ変更し、25F帰還floorを生成 |
| 帰還25～2F | `depth - 1`の帰還floorを生成 |
| 帰還1F・`rescued` | floor生成を行わず、地上帰還clear |

- 階段遷移は現行仕様どおり、プレイヤー自身の成立したmoveで階段へ入った場合だけ発生する。
- 26F救出前に階段へ入るmoveは通常どおり1turnを消費し、敵行動まで解決する。後から救出しても自動遷移せず、階段へ再進入する必要がある。
- おてんこさまへ入るmoveも1turnを消費し、`sealed → rescued`後に敵行動まで解決する。同turnにプレイヤーが死亡した場合はgame overを優先する。
- 下降1Fを`floorVisitOrdinal = 1`、下降26Fを26、帰還25Fを27、帰還1Fを51とする。救出だけではordinalを増やさない。

### 4.2 生成要素

| 要素 | 下降 | 帰還 |
|---|---|---|
| 新規map生成 | あり | あり |
| 通常床item | あり | なし |
| 通常敵 | あり | あり |
| enemy drop | あり | あり |
| モンスターハウス | あり | なし |
| 罠 | あり | あり |
| 日照・暗所 | あり | あり |
| 食料不足補正 | あり | なし |

- 過去の地形、床item、敵、罠、モンスターハウスを復元しない。
- seed導出へ`leg`を加え、同じdepthでも下降と帰還で別mapにする。
- 帰還時も現在depthの敵・環境表を使う。浅層へ戻るほど敵種と危険度も浅層側へ戻る。
- 帰還時も敵EXPとenemy dropを得られ、未完成の太陽鍛冶を完成できる可能性を残す。

帰還時の通常床itemとモンスターハウスを停止する契約は、初代`Rogue`が目的物取得後の既到達depth再生成時に通常object配置を行わない挙動を基準とする。map、通常敵、罠、階段まで停止するものではない。

### 4.3 おてんこさまの配置

- 下降26Fだけに配置し、start、階段、敵、item、罠と重複させない。
- startから到達可能な通常床を候補とする。
- 候補のうち、`min(distance(start, cell), distance(stairs, cell))`が最大となるcellを選ぶ。distanceは通常移動規則による最短経路長とする。
- 同点時はroomの固定順、次にy昇順、x昇順で決め、追加RNGを消費しない。
- おてんこさまのroomはモンスターハウス候補から除外する。
- 条件を満たすcellがない場合はstartや階段へ代替配置せず、map生成attemptを失敗として既存上限内で再試行する。
- 生成順ではstart／階段／初期敵の後、通常item／モンスターハウス／罠の前に位置を確保する。

### 4.4 seed契約

- `deriveFloorSeed(runSeed, depth, leg)`をfloor生成の入口とする。
- `leg = descent`は現行`deriveFloorSeed(runSeed, depth)`とbyte-identicalなseedを返し、既存3F回帰結果を維持する。
- `leg = ascent`は専用の固定saltをrun seedへmixしてから同じ導出処理を使う。同じdepthでも下降mapと帰還mapを分離する。
- 26F救出時はfloorを再生成せず、下降seedと現在mapを維持する。
- 同じdepth／legを1run中に複数回訪問しないため、`floorVisitOrdinal`はfloor seedへ混ぜない。
- floor内のitem、罠、日照、モンスターハウス等の用途別streamは、leg別floor seedから従来どおり独立導出する。
- `combatRngState`等の進行中streamはfloor遷移、save、loadをまたいで保持する。

---

## 5. プレイヤー成長

現行の`level * 5`を廃止し、累積経験値tableを正本とする。

`requirement(level) = cumulative[level + 1] - cumulative[level]`

GameStateの`experience`は現Lv内の残余値として維持する。

| Lv | 累積EXP | Lv | 累積EXP | Lv | 累積EXP | Lv | 累積EXP |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 11 | 950 | 21 | 7000 | 31 | 48000 |
| 2 | 10 | 12 | 1200 | 22 | 8000 | 32 | 54000 |
| 3 | 30 | 13 | 1500 | 23 | 10000 | 33 | 60000 |
| 4 | 60 | 14 | 1800 | 24 | 13000 | 34 | 70000 |
| 5 | 100 | 15 | 2300 | 25 | 16000 | 35 | 80000 |
| 6 | 150 | 16 | 2800 | 26 | 20000 | 36 | 90000 |
| 7 | 230 | 17 | 3500 | 27 | 25000 | 37 | 100000 |
| 8 | 350 | 18 | 4200 | 28 | 30000 | 38 | 115000 |
| 9 | 500 | 19 | 5000 | 29 | 36000 | 39 | 130000 |
| 10 | 700 | 20 | 6000 | 30 | 42000 | 40 | 145000 |

Lv41～50は160000、175000、200000、230000、260000、290000、320000、350000、380000、410000を初期値とする。Lv51以降はtechnical fallbackとして前Lv+30000を使う。

能力ポイントはLv2と以後の偶数Lvで1点を付与する。rank上限10を維持し、効果は次のとおり。

- カラダ：最大／現在LIFE +2
- ココロ：最大SOL +2、既存の属性scaleへ接続
- チカラ：直接damage +1
- ハヤサ：既存値 +10

---

## 6. 敵EXPとEnemyLevel補正

| EnemyType | 表示名 | Lv1 EXP |
|---|---|---:|
| `bat` | コウモリ | 5 |
| `bok` | ボク | 6 |
| `spider` | スパイダー | 8 |
| `sword` | ソード | 12 |
| `mummy` | マミー | 14 |
| `skeleton` | スケルトン | 15 |
| `cockatrice` | コカトリス | 16 |
| `axe` | アックス | 18 |
| `kraken` | クラーケン | 18 |
| `golem` | ゴーレム | 20 |
| `ghost` | ゴースト | 22 |
| `steps` | ステップス | 24 |

| EnemyLevel | HP | 攻撃 | 防御 | 命中 | 回避 | EXP |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | ×1.00 | ×1.00 | +0 | +0 | +0 | ×1 |
| 2 | ×1.55、切上げ | ×1.25、四捨五入 | +1 | +2 | +3 | ×3 |
| 3 | ×2.30、切上げ | ×1.55、四捨五入 | +2 | +4 | +5 | ×8 |

accuracyは95を上限とする。補正は生成時に一度だけ適用する。EnemyLevelは敵種内の段階であり、異なる敵種間の絶対強度を示さない。

---

## 7. 敵種別depth窓

| 敵 | 出現depth | Lv1帯 | Lv2中心帯 | Lv3混在帯 |
|---|---:|---:|---:|---:|
| コウモリ | 1～6 | 1～2 | 3～4 | 5～6 |
| ボク | 1～8 | 1～3 | 4～6 | 7～8 |
| スパイダー | 1～10 | 1～4 | 5～7 | 8～10 |
| スケルトン | 3～12 | 3～6 | 7～9 | 10～12 |
| ソード | 5～14 | 5～8 | 9～11 | 12～14 |
| コカトリス | 7～16 | 7～10 | 11～13 | 14～16 |
| マミー | 9～18 | 9～12 | 13～15 | 16～18 |
| ゴースト | 11～22 | 11～15 | 16～19 | 20～22 |
| アックス | 13～26 | 13～17 | 18～22 | 23～26 |
| ゴーレム | 15～26 | 15～19 | 20～23 | 24～26 |
| クラーケン | 17～26 | 17～20 | 21～23 | 24～26 |
| ステップス | 19～26 | 19～21 | 22～24 | 25～26 |

| 帯 | Lv1 | Lv2 | Lv3 |
|---|---:|---:|---:|
| Lv1帯 | 100 | 0 | 0 |
| Lv2中心帯 | 30 | 70 | 0 |
| Lv3混在帯 | 0 | 70 | 30 |

- 帰還時も現在depthの表を使う。
- 全敵Lv3のfloorや境界専用50／50表は作らない。
- 表示名へ数値levelを付けない。強化個体はtintまたはmarkerで示す。
- 内部`enemyLevel`は戦闘、EXP、telemetry、saveに保持する。

種族weight初期値は、ボク10、スパイダー10、コウモリ10、スケルトン8、ソード8、マミー8、コカトリス7、ゴースト6、ゴーレム6、アックス6、クラーケン5、ステップス5とする。候補を先にfilterしてから再正規化する。

---

## 8. 敵数と増援

| depth | 通常初期敵数 | 増援周期 |
|---:|---:|---:|
| 1～5 | 6 | 1～8Fは100turn |
| 6～10 | 7 | 1～8Fは100turn、9～10Fは80turn |
| 11～15 | 8 | 80turn |
| 16～20 | 9 | 16～17Fは80turn、18～20Fは60turn |
| 21～26 | 10 | 60turn |

- 下降・帰還とも現在depthの値を使う。
- 生存通常敵数が`初期敵数 + 2`以上なら増援しない。
- 現在視界外、非隣接、到達可能、他actor・item・階段と非重複のセルへ置く。
- 候補セル0件なら生成しない。
- 同depth・同legの通常生成と同じ敵候補・level weightを使う。
- `combatRngState`を使わず、seed、depth、leg、増援ordinal、用途別saltから再導出する。
- 増援はEXPと通常enemy dropを持つ。

---

## 9. Lv2／Lv3固有能力

Phase 24.6c2では共通statsだけを実装し、通し測定後に必要な種族だけ固有能力を追加する。

| 敵 | Lv2候補 | Lv3候補 |
|---|---|---|
| ボク | statsのみ | statsのみ |
| コウモリ | 回避上昇 | 後退・再接近強化 |
| スパイダー | 巣cooldown短縮 | 同時存在上限増加 |
| スケルトン | 復活8→6turn | 6→4turn |
| コカトリス | 石化持続強化 | 射程または予告範囲強化 |
| マミー | 呪い率10→15% | 15→20% |
| ソード | statsのみ | 最大接近距離2→3候補 |
| ゴースト | 認識距離上昇 | 壁内追跡圧強化 |
| ゴーレム | 突進距離上昇 | recovery短縮候補 |
| アックス | recovery短縮 | 範囲攻撃は保留 |
| クラーケン | 予告頻度上昇 | pull後の位置危険強化 |
| ステップス | revealed時間短縮 | 攻撃予告猶予短縮 |

予告を完全に消す、回避不能にする、初見で対処不能にする強化は採らない。

### 24.6c3bの適用範囲決定（human decision, 2026-08-21）

`24.6c3b1`でスケルトン・マミーを実装済み。残り10種の扱いについて、全種を`24.6c3b`内で一括実装する案（A）と、`24.6c3b`をここで打ち切り残りを`24.6c4`以降の実測後に送る案（B）の両案をuserへ提示した結果、両案を混ぜた方針が決定した。

- コウモリ・スパイダーは`24.6c3b2`として追加実装する（回避上昇・後退再接近強化／巣cooldown短縮・同時存在上限増加）。
- 残る7種（コカトリス、ソード、ゴースト、ゴーレム、アックス、クラーケン、ステップス）の固有能力実装は`24.6c3b`内で一括着手せず、measurement-gatedとする。本表の候補設計自体は変更せず維持するが、実装着手は`24.6c4`以降の実測（production spawnへのEnemyLevel割り当て接続後の実プレイ・simulation計測）でどの種に実際に必要性があるか確認してから、必要な種だけ後続taskとして着手する。
- `24.6c3b`は`24.6c3b2`完了をもってこのroadmap segment内の作業を一旦区切り、次は`24.6c4`（availability移行、下降限定床loot、食料補正、S防具）へ進む。残り7種のLv2／Lv3実装は、`24.6c4`以降のどこかのタイミングで測定結果に応じて個別taskとして再開する（`24.6c5`の再測定前後を含め、フェーズ番号は実測結果を見て後決めとする）。

---

## 10. item availabilityと供給

### availability

- 通常床itemは下降時だけ生成する。
- enemy dropは両legで発生する。
- 通常消耗品、カード、アクセサリー、太陽銃は1Fから候補。
- 近接武器familyはソード1F、スピア5F、ハンマー9Fから候補。
- 付与属性はSOL／炎1F、氷／雲9F、大地18Fから候補。
- C／B／A装備はdepth weightで通常取得する。
- S武器は太陽鍛冶、S防具は下降19～26F通常loot。
- R武器は指定S対の固有合成、R防具は特殊event限定。
- 帰還中のenemy dropは現在depthの通常候補からC／B／Aまでを抽選する。S防具とR装備は帰還enemy dropへ加えない。
- C／B／Aの最終weightはdepth帯ごとの固定表とし、Phase 24.6c5のsimulationで確定する。現行の連続weight式は移行時の比較baselineであり、製品仕様として固定しない。

### 通常床item数

- 下降floorごとに9回の独立配置試行。
- 1試行の成功率36%。
- 期待値は1floor当たり3.24個、下降26floorで約84個。
- 0個floorを許容する。帰還時は0個。
- category初期値はカード10%、アクセサリー10%、その他80%。
- カード／アクセサリーrank初期値はC60／B30／A8／S2。
- 上位rank保証、R保証、pityは設けない。

---

## 11. 太陽鍛冶

| 素材 | 結果 |
|---|---|
| 同family C＋C | 同lineageのB |
| 同family B＋B | 同lineageのA |
| 同family A＋A | 同lineageのS |
| 指定された光側S＋闇側S | 固有R |

- inventoryから場所・legを問わず実行できる。
- ターンとSOLを消費しない。
- 呪われた素材は使えない。
- 素材2個を消費し、鑑定済み完成品1個を生成する。
- 装備中素材を含む場合は完成品を装備する。
- 太陽銃、防具、アクセサリーは対象外。
- `solar_sword + dark_sword = gram`
- `white_queen + black_queen = gungnir`
- `dawn + twilight = mjolnir`

到達目標は、C→Bは頻繁、B→Aは中盤までに可能、A→Sは1familyへ集中すれば26Fまでに可能、S→Rは希少とする。帰還中のenemy dropで未完成合成を完成できる可能性を残す。S／R保証とpityは設けない。

---

## 12. LIFE・満腹度・SOL

### 現行baseline

- 最大満腹度100、10 consumed turnごとに1減少。
- チョコレートで30回復。満腹度0で毎turn LIFE1減少。
- 満腹度1以上かつLIFE不足時、毎consumed turn LIFE1自然回復。
- リンゴでLIFE5回復。
- 初期／最大SOL15。
- 日向で1turnにつきSOL1回復。
- 太陽銃は1射につきSOL3、太陽の実はSOL5回復。
- おてんこさま救出後も数値を変更しない。

### 食料不足補正

- 下降時に3floor連続でチョコレートが生成されなかった場合、次の下降floorへ1個を保証する。
- 保証分は通常item試行とは別に配置し、通常試行も行う。
- 生成時にcounterをresetし、取得有無は問わない。
- enemy dropはcounterをresetしない。
- 帰還時は保証しない。
- 保証判定と配置には専用RNG streamを使い、通常itemの個数・選択・配置streamを変化させない。
- 保証分のcellを通常item配置より先に確保する。通常item配置後の空きcell不足を理由に保証を失敗させない。
- 帰還中は`foodDroughtFloors`を増減させず、下降時の値を保持する。

### turn予算

| 区間 | 1floor目安 | 合計 |
|---|---:|---:|
| 下降26floor | 60～90turn | 1560～2340 |
| 帰還25floor | 30～50turn | 750～1250 |
| 全体 | - | 2310～3590 |

初期満腹度は約1000turn、チョコレート1個は約300turnに相当する。必要量は概算5～9個で、通常抽選と不足補正により下降中5～8個程度の生成を初期目安とする。

不足時は、floor当たりturn数、チョコレート抽選率・保証間隔、回復量、空腹減少間隔の順で調整する。おてんこさまへ効果を追加して補正しない。

---

## 13. 環境・特殊装備

### モンスターハウス

- 下降2～26Fのみ候補。1floor 5%から開始する。
- 最低保証、天井、pityなし。敵4～8体、報酬3個。
- EnemyLevelは現在depthの通常生成と同じ。帰還時は生成しない。

### 罠

| depth | 基本罠数 |
|---:|---:|
| 1～10 | 2 |
| 11～19 | 3 |
| 20～26 | 4 |

### 日照・暗所

| depth | 明 | 混合 | 暗 |
|---:|---:|---:|---:|
| 1～6 | 60 | 30 | 10 |
| 7～13 | 45 | 35 | 20 |
| 14～19 | 30 | 40 | 30 |
| 20～26 | 20 | 35 | 45 |

帰還時も現在depthの罠数と日照比率を使う。

### 特殊装備

- S防具3種は下降19～26Fの通常loot。
- `black_armor`は下降19～25Fの封印部屋event限定。
- 封印部屋は1run最大1室、専用RNG、番人撃破時の確定報酬。pityなし。
- `mail_of_dark`の現行no-op効果は暗い部屋で実効防御+2とする案をPhase 24.6c4で検証する。

---

## 14. save・clear

- 26F到達だけではclearにしない。
- 26Fで救出後、帰還中に死亡すれば通常のgame over。
- 1Fから地上へ出る時点で`otencoState = rescued`ならclear。
- おてんこさまは失われず、escort failureは存在しない。
- 中断saveは51 floor visitの製品runに必要。
- `saveSchemaVersion`はtelemetry schemaと分離し、初期値1から開始する。
- 初期版は1run 1slotのone-shot中断saveとする。死亡後復元、巻き戻し、複数slotは許可しない。
- 保存はplayer input待機中、turn処理とanimationが完了した安定境界だけで許可する。overlay、対象選択、animation、key状態の途中を保存しない。
- save payloadは、全GameState、全RNG state、depth／leg／救出状態、floor visit ordinal、floorTurn、増援ordinal、食料不足counter、現在map・敵・item・罠・一時状態、inventory・装備・成長、telemetry、探索済みtileを含む。
- 一時的なoverlay、対象選択、animation、押下中key、message logは保存せず、再開時に閉じた状態へresetする。
- 書込みは一時keyへのserialize・検証後に本slotへ置換するatomic手順とする。
- load時はschema versionと不変条件を検証する。未知version、破損、範囲外depth、状態矛盾を暗黙補正せず、再開を拒否して理由を表示する。
- 中断dataはdeserialize、GameState適用、最初の描画成功後に削除する。load失敗時や描画開始前には削除しない。
- 死亡・clear時にも残存する中断dataを削除する。
- save／load有無で、非表示metadataを除く最終GameStateとtelemetry event順序が変化しないことを決定性testで保証する。

---

## 15. telemetryと合格基準

### 必須telemetry

- 全event共通のglobal turn、depth、leg、floor visit ordinal、floorTurn
- 救出turn、帰還開始、clear／death depth
- EnemyType、EnemyLevel、spawn source、撃破EXP
- 初期敵数、増援数、モンスターハウス敵数
- player level、現Lv内EXP、累積EXP、能力ポイント
- 被damage、自然回復量、リンゴ使用
- hunger入出、チョコレート生成／取得／使用、飢餓turn
- SOL入出、日照charge、太陽銃消費、太陽の実使用
- item生成／取得／破棄、生成route、装備rank
- family別素材数、鍛冶回数、最高到達rank

### 必須event

- `floor_started`：floor seed、depth、leg、floor visit ordinal
- `floor_completed`：移動方向と完了理由
- `otenco_rescued`：26Fでの救出turnと座標
- `return_started`：26Fから25Fへの遷移
- `surface_escaped`：帰還1Fの階段から地上へ出た時点
- `run_completed`：clear時のcauseを`escaped_with_otenco`とする

同じdepthを下降と帰還で訪れるため、floor単位集計は`(leg, depth, floorVisitOrdinal)`をkeyとする。depth単独でeventや集計を上書きしない。common field追加に伴いtelemetry schemaを更新する。

### UI・同行描画

- HUDは下降中を`13F ↓`、帰還中を`13F ↑`のように表示し、depthと移動方向を同時に示す。
- 26F救出前はおてんこさまをmap上の目標objectとして描画し、プレイヤーがmoveで接触すると自動救出する。専用interaction keyは追加しない。
- 救出後のおてんこさまはActor、occupancy、攻撃対象、罠対象として登録しない。`otencoState`だけを正規game stateとする。
- 同行表示は、成立したplayer move後に直前のplayer tileへ表示する。待機、攻撃、item使用等の非移動turnでは追従位置を変えない。
- floor遷移直後とload直後はplayer背後への小offsetまたはplayer tileとの重なりで表示し、最初の成立move後から直前tile追従へ移る。
- 追従先が描画不能の場合はplayer背後表示へfallbackし、gameplay上の位置補正は行わない。
- 初期実装では既存階段／魔法陣assetを再利用し、方向はHUD、minimap、messageで示す。
- 基本文言は救出時「おてんこさまを救出した。地上へ帰ろう。」、帰還floor開始時「上の階へ戻った。」、clear時「おてんこさまとともに地上へ帰還した。」とする。

### 測定量

- 自動simulation：最低1000 seed
- ブラウザ手動通し：最低10 run
- 救出後の帰還と脱出までを1runとして集計する。

### 合格基準

- 例外、到達不能階段、配置衝突、RNG非決定性が0。
- 敵種の出現depthとEnemyLevel率が表と整合する。
- 後発敵種Lv1と既存種Lv3が同時に出ても、撃破手数と報酬を役割上説明できる。
- 能力ポイントが1能力の早期rank10を常態化させない。
- 下降中に探索と即降りの両方が選択肢として残る。
- 帰還が床itemなしでも成立し、かつ無条件の消化試合にならない。
- 食料死因、食料のinventory占有、帰還開始時備蓄を確認する。
- A→Sは集中投資で成立し得るが、S→Rは標準結果にならない。
- すべてのseedをclear可能にする保証は設けない。

---

## 16. 実装順

| Phase | 内容 | production変更 |
|---|---|---|
| 24.6c0 | 本Version 4とdevelopment-plan Version 34の同期 | なし |
| 24.6c1 | leg、depth、救出・帰還、EnemyLevel、EXP、資源、鍛冶telemetry | あり |
| 24.6c2a | EnemyLevel型、個体保持、共通stats／EXP倍率 | あり |
| 24.6c2b | 敵種別depth窓、level帯、種族weight、初期敵数曲線をcanonical dataとpure derivationとして実装（productionのspawn path接続はなし。決定はversion 4本文および24.6c2bのhistoryを参照） | なし（このPhaseではproduction未接続。26F run structure導入phaseで接続） |
| 24.6c2c | floorVisitOrdinal、floorTurn、増援ordinal、通常増援、leg別RNG | あり |
| 24.6c2d | 累積EXP table、偶数Lv能力ポイント | あり |
| 24.6c3a | モンスターハウス、罠、日照のdepth／leg接続 | あり |
| 24.6c3b | 必要な敵だけLv2／Lv3固有能力を追加（`24.6c3b1`：スケルトン・マミー完了。`24.6c3b2`：コウモリ・スパイダー。残り7種は§9のhuman decisionによりmeasurement-gated、`24.6c4`以降へ） | あり |
| 24.6c4 | availability移行、下降限定床loot、独立RNGによる食料補正、S防具 | あり |
| 24.6c5 | 26F下降＋25F帰還simulationと定数調整 | 原則定数のみ |
| 24.7 | 黒の鎧専用封印部屋と番人 | あり |
| 24.8 | 26F目標配置・救出、階段状態機械、帰還、1F脱出、同行描画、中断save、統合試験 | あり |

---

## 17. 確定事項と暫定事項

### 確定

- 単一26F、26F救出、1F帰還clear。
- floor遷移時のmap再生成。
- 帰還時は通常床itemとモンスターハウスなし。
- おてんこさまは同行表示のみ。
- 26F救出時は同じmapに留まり、救出後の階段到達で帰還を開始。
- 下降seedの既存互換と帰還専用seedを分離。
- 1run 1slot、one-shot再開の中断save。
- プレイヤーlevel、能力ポイント、EnemyLevel 1～3を維持。
- EnemyLevelは敵種内の相対段階。
- 敵種ごとに登場・退場depthとlevel帯を持つ。
- SFC型累積EXP、C～R装備rank、太陽鍛冶を維持。
- S武器は鍛冶、R武器は指定S対、S防具は深層loot、R防具はevent。

### simulationで調整

- 敵EXPとEnemyLevel倍率
- 敵種weight、level weight、敵数、増援周期
- 累積EXP tableと偶数Lv能力ポイント
- 通常item 9試行×36%
- 食料3floor不足後保証、チョコレート5～8個目安
- モンスターハウス5%、罠数、日照比率
- S防具、黒の鎧、`mail_of_dark`の数値

暫定値は最初に実装・測定する値であり、24.6c5まではbalance確定値として他機能へ焼き込まない。

---

## 18. 26F下降＋25F帰還simulation契約

### 18.1 目的と分離

長期simulationは次の4層に分ける。各層の結果を混在させない。

| 層 | 名称 | 目的 | player action |
|---|---|---|---|
| A | generation audit | 51回のfloor生成、配置、候補、供給契約の検証 | なし |
| B | deterministic scenario | 救出・帰還・save・RNG非干渉の検証 | 固定action列 |
| C | headless policy run | 資源、戦闘、成長、鍛冶の分布測定 | 非チート自動agent |
| D | browser playthrough | 操作感、判断可能性、テンポ、体感難度の確認 | 人間 |

層A／Bはcorrectness gate、層C／Dはbalance測定とする。層Aのprojectionだけでclear可能性を判定せず、層Cのagent勝率だけで人間の難度を断定しない。

### 18.2 共通再現条件

- productionと同じgame logic、map generator、RNG、item／enemy definitionをimportして使う。simulation専用の再実装を作らない。
- simulationはPhaser、Canvas、DOMに依存しないheadless entry pointから実行する。
- run seed、source commit SHA、simulation config version、policy idを全出力へ記録する。
- seed集合は昇順固定とし、調整のたびに同じ集合を再利用する。
- telemetryは観測専用とし、作成有無でGameState、RNG消費、結果が変わらないことをpair testする。
- hard timeoutは1floor 300 consumed turn、1run 8000 consumed turn。到達時はdeathへ変換せず`timeout`として別集計する。

### 18.3 層A：generation audit

run seed 1～1000について、下降26floorと帰還25floorの合計51000 floorを生成する。

全件で次を確認する。

- map生成成功、全床連結、開始地点から階段到達可能
- start／stairs／enemy／item／trapの配置重複なし
- 下降26Fのおてんこさまがstart／stairs／enemy／item／trapと非重複かつ到達可能
- おてんこさまのroomがモンスターハウス候補から除外される
- 同一`(runSeed, depth, leg)`の再生成結果がbyte-identical
- 下降seedが変更前の`deriveFloorSeed(runSeed, depth)`と一致
- 同じdepthでも`leg`が異なれば専用seed streamを使う
- 下降は通常床itemあり、帰還は通常床item0
- 帰還はモンスターハウス0、食料不足保証0
- 両legで通常敵とenemy drop候補あり
- 敵種、EnemyLevel、初期敵数、増援周期が現在depthの表と一致
- 26F救出前にascentへ移れず、救出後だけ帰還可能
- 救出直後は下降26Fの同じmapに留まり、階段再到達で帰還25Fへ移る
- `floorVisitOrdinal`が下降1F=1、下降26F=26、帰還25F=27、帰還1F=51となる
- rescued状態で1Fから地上へ出た場合だけclear

correctness gateは全項目0件失敗とする。出現率等の確率項目は期待値との差をWilson 95%信頼区間で確認し、単一の固定許容率を全項目へ流用しない。

### 18.4 層B：deterministic scenario

seed 1～100を各scenarioで2回実行し、最終GameStateと正規化telemetry event列のhashを完全一致させる。

| scenario | 確認内容 |
|---|---|
| uninterrupted | 下降、救出、帰還、脱出まで連続実行 |
| telemetry_off | telemetryなしでもuninterruptedと結果一致 |
| save_at_descent_13 | 13F開始時にsave／loadして結果一致 |
| save_after_rescue | 26F救出直後にsave／loadして結果一致 |
| save_at_ascent_13 | 帰還13F開始時にsave／loadして結果一致 |
| otenco_pair | rescue前後で同行表示以外のcombat／resource結果が一致 |
| invalid_save | 未知schema、破損、状態矛盾を拒否し、中断dataを保持 |
| one_shot_save | 正常loadと最初の描画成功後だけ中断dataを削除 |

比較時刻等の非決定値はhash対象から除外するが、seed、floor visit ordinal、depth、leg、敵・item identity、RNG state、inventory、EXP、能力、満腹度、SOL、LIFEは除外しない。

### 18.5 層C：非チート自動agent

agentが参照できる情報は、現在視界、探索済み地形、表示済みactor／item／trap、player-visible inventory、HUD情報に限定する。未探索map、未発見階段、未識別itemの真ID、将来のRNG、敵の非公開内部状態を読まない。

全policyで、同じdirection tie-break、pathfinding、item評価、装備比較、状態異常治療規則を共有し、探索方針だけを変える。

| policy | 下降方針 | 帰還方針 |
|---|---|---|
| `route_first` | 階段発見後は直行。進路上・隣接itemだけ回収し、任意戦闘を避ける | 階段発見後は直行 |
| `balanced` | 階段発見後も新たに2部屋を訪問するかfloor turn 120まで探索し、その後は階段を優先 | 階段発見後は直行。視界内の高優先itemはenemy dropだけ回収 |
| `harvest` | 既知の未探索frontierがなくなるかfloor turn 180まで探索し、視界内の敵とitemを積極処理 | 階段発見後は直行し、意図的な増援待ちはしない |

共通行動規則の初期値：

- 満腹度40以下でチョコレートを使用する。
- LIFE40%以下でリンゴを使用する。
- SOL5以下で太陽の実を使用する。
- 未識別itemの真IDは参照せず、識別済みまたはplayer-visibleな名称だけで使用を判断する。
- 対応する治療itemがあれば、毒・鈍足等を治療する。
- 装備は鑑定済み情報だけで比較し、明確な上位装備を優先する。
- 成立している太陽鍛冶はfloor移動前に実行する。
- 能力ポイントはカラダ→チカラ→ココロ→ハヤサの固定round-robinで配分する。
- SOL回復だけを目的とする待機は、敵が視界内におらずSOL5以下の場合に最大6turnまで許可する。
- 増援待ち、自然回復だけを目的とする無制限待機、hidden情報による最短経路移動は禁止する。
- path／targetが同順位の場合はN→NE→E→SE→S→SW→W→NW、次にy昇順、x昇順で固定する。
- inventory満杯時の取得・破棄はplayer-visible情報から算出するversioned utility tableを使い、simulation結果と同じconfig versionへ固定する。

pilotはseed 1～200を3 policyで実行する。agent停止、無限loop、telemetry欠損を修正した後、final測定としてseed 1～1000を3 policyで実行する。全policyで同じseedを使い、paired比較を可能にする。

能力配分の偏り確認は別stress testとし、`balanced` policy・seed 1～200に対して、カラダ優先、チカラ優先、ココロ優先、ハヤサ優先を追加実行する。これは標準勝率へ合算しない。

### 18.6 層Cの集計

平均値だけでなくcount、median、p10、p25、p75、p90、min、maxを出す。

- clear／death／timeout、death cause、death depth、death leg
- 救出率、救出後clear率
- 下降／帰還／全体turn、floor別turn
- 初期敵、増援、撃破、回避、被damage、自然回復
- 敵種／EnemyLevel別spawn、kill、撃破手数、被damage、EXP
- 到達Lv、累積EXP、能力point獲得・配分
- hunger入出、チョコレート生成／取得／使用、飢餓turn
- SOL入出、日照回復、太陽銃／属性消費、太陽の実
- itemのroute別生成／取得／使用／破棄、inventory満杯turn
- 装備rank、family別素材、鍛冶回数、B／A／S／R初到達depth・leg
- モンスターハウス、罠、呪い、黒の鎧event

runごとのraw JSONL、集約JSON、確認用Markdownを出力する。raw結果を通常unit testのsnapshotへ埋め込まない。

### 18.7 balance判定手順

最初のpilot前に勝率等の数値目標を置かない。未測定agentの勝率へ任意の合格率を与えると、agent性能とゲーム難度を混同するためである。

1. 層A／Bのcorrectness gateを全通過させる。
2. pilot 200 seed×3 policyを無調整で取得する。
3. 次の設計上の順序関係を確認する。
   - `route_first`は他policyよりturn、取得item、撃破、EXPが少ない。
   - `harvest`は`balanced`よりturn、取得item、撃破、鍛冶回数が多い。
   - 帰還のmedian turn／floorは下降より少ない。
   - 深層敵の撃破手数・被damage・EXPは浅層より概ね大きい。
4. pilot分布とブラウザ先行3runを基に、clear率、救出後clear率、死因比率、食料、到達Lv、S／R到達率のprovisional target bandを文書へ固定する。
5. 以後は一度に1系統だけ調整する。順序は敵stats／数→EXP→item category／rank→食料→環境。
6. final 1000 seed×3 policyを実行する。
7. 調整に未使用のseed 2001～2200でconfirmationを行い、target band逸脱がないか確認する。

correctness違反、全policy timeout、policy間の期待順序逆転、特定の単一死因への極端な集中は値調整前に原因を調査する。

### 18.8 層D：ブラウザ通し

最低10runを実施する。

- seed 1001～1006の6runは事前固定し、simulation調整に使わない。
- 残り4runはfinal simulationから、飢餓負荷最大、被damage最大、inventory圧迫最大、帰還失敗代表のseedを各1件選ぶ。
- debug情報、未探索map、将来RNGを見ない通常UIで遊ぶ。
- floor別turn、判断に迷った場面、資源を使えなかった理由、帰還の単調さ、敵level識別性を記録する。

自動agentと人間の傾向が食い違う場合は、人間の入力ミスだけで説明せず、agent規則、UI情報、操作コストのどこに差があるかを分離して報告する。

---

## 19. production実装境界

- 現行の`advanceToNextFloor`を製品runの主入口にせず、`transitionFloor`または同等の単一関数へ下降・救出後帰還・上昇・地上脱出を集約する。
- 次depthと次legは呼出側から自由入力させず、現在の`depth`、`leg`、`otencoState`から状態機械が導出する。
- 26F救出はfloor遷移関数を呼ばず、現在state内の`otencoState`と`otencoPos`だけを更新する。
- 既存3F test互換が必要な期間は旧関数を薄いwrapperとして残せるが、production経路は新しい状態機械を使用する。
- おてんこさまの追従座標は描画側の一時stateとし、save対象のActor listや衝突判定へ追加しない。
- 探索済みtileは現行GameState外にあるため、save payloadのview stateとして明示的に保存する。これを未探索へresetして再開させない。
- telemetryは観測専用とし、event作成、JSON化、download有無によってRNGやGameStateを変更しない。
- save serializerはGameState型の暗黙JSON化へ依存せず、schema version付きpayloadとvalidatorを専用moduleに置く。

### 24.6c2bの production接続タイミング

24.6c2bは§7（敵種別depth窓・level帯・種族weight）と§8（敵数・増援周期）をcanonical dataとpure derivation関数として実装し、対応するunit testsを追加するが、現行の3F sample production spawn path（`getEnemyPoolForFloor`／`buildEnemies`等）へはこのPhaseでは接続しない。既存3F cumulative 4/8/12 species scheduleとdeterminism/regression baselineは維持する。`totalFloors >= 26`のような暫定thresholdによるproduction分岐も追加しない — 新しいdepth-driven pathへのwiringは、26F run structureを導入する後続Phase（本節冒頭の`transitionFloor`状態機械を主入口とするPhase、想定24.6c3a以降）でまとめて行う。将来削除するためだけのdual-path threshold／feature flagは作らない。
