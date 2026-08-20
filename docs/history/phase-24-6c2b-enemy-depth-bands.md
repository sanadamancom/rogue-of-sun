# Phase 24.6c2b: Enemy depth bands

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §7・§8に基づき、敵種別depth窓、EnemyLevel帯、種族weight、初期敵数・増援周期をcanonical dataとpure derivationとして追加した。

## 1. 実装

- `src/game/enemy-depth-bands.ts`に12種の出現depth窓とLv1／Lv2／Lv3帯を追加した。
- level帯ごとのEnemyLevel weight（100/0/0、30/70/0、0/70/30）と12種の初期weightを追加した。
- depthで候補をfilter後、残存種族weightを正規化するpure functionを追加した。
- 敵種・depthからlevel帯とEnemyLevel weightを返すpure functionを追加した。出現窓外は`null`とした。
- depth 1～26の初期敵数・増援周期dataとpure lookup functionを追加した。不正depthは`RangeError`とした。

## 2. test

- species windowの境界を含む代表depthで候補集合、手計算した正規化weight、合計1を確認した。
- bat、sword、stepsのwindow開始、帯遷移、window終了でlevel帯とweight tripleを確認した。
- depth 1～26を全件走査し、初期敵数と増援周期を確認した。
- 既存`getEnemyPoolForFloor`の3F cumulative 4/8/12 scheduleを回帰確認した。

## 3. production接続境界

production spawn pathには一切触れず、threshold分岐およびfeature flagも追加していない。
