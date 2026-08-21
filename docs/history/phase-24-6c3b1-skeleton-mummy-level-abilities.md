# Phase 24.6c3b1: スケルトン・マミーのLv別能力

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §9・§16 row `24.6c3b` に基づき実装した。

## 1. 実装

- スケルトンの頭部化から復活までのターン数を、敵instanceの`level`に応じてLv1は8、Lv2は6、Lv3は4とした。既存のbody/head状態機械、占有判定、復活eventは変更していない。
- マミーの命中時呪い付与確率を、敵instanceの`level`に応じてLv1は10%、Lv2は15%、Lv3は20%とした。既存のchance RNG streamとdraw回数、対象適格性・選択、呪い付与eventは変更していない。
- production spawnへのlevel割り当ては追加せず、既存のLv1 defaultを維持した。他種の能力には変更を加えていない。
- `24.6c3b` line itemは継続中であり、残る9種（bat、spider、cockatrice、sword、ghost、golem、axe、kraken、steps）は後続taskで扱う。

## 2. 検証

- Lv2／Lv3スケルトンが頭部化時点からそれぞれ6／4turn後に復活する境界と、マミーのLv1／Lv2／Lv3の呪い確率lookupをtestで固定した。
- `npm run typecheck` / `npm test` / `npm run build` を実行し、すべて通過した。
