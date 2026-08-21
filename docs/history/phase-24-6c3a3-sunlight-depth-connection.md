# Phase 24.6c3a3: 日照light/mixed/dark比率のdepth接続

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §13・§16 row `24.6c3a` に基づき実装した。

## 1. 実装

- 日照categoryの比率をdepth 1～6でlight 60／mixed 30／dark 10、7～13で45／35／20、14～19で30／40／30、20～26で20／35／45とし、範囲外は最寄りのbandへ防御的に丸めた。下降・上昇legによる分岐は設けていない。
- `floorSeed ^ SUNLIGHT_XOR`から作る既存の日照専用RNG streamの最初の1回でcategoryを抽選し、同じstreamを続けて選択された既存generatorへ渡すようにした。
- light／mixed／darkの各generator内部、fallback、RNG消費順は変更していない。monster house、罠、Phase 17.2の暗室、productionの`TOTAL_FLOORS`にも変更を加えていない。
- monster house・罠・日照のすべてがdepth接続され、`24.6c3a` line itemは本sliceで完了した。

## 2. 検証

- depth 1／6／7／13／14／19／20／26と範囲外のweight境界、weighted drawの累積境界、同一depth・floorSeedでの決定性をtestで固定した。
- light／mixed／darkそれぞれの既存生成shapeと、日照categoryの変更が他のRNG streamやmapを変化させないことを確認した。
- `npm run typecheck` / `npm test` / `npm run build` を実行し、すべて通過した。
