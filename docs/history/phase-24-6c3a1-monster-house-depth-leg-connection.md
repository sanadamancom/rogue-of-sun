# Phase 24.6c3a1: モンスターハウスのdepth・leg接続

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §13・§16 row `24.6c3a` に基づき実装した。

## 1. 実装

- モンスターハウスの発生対象を下降legのdepth 2～26（両端を含む）へ変更した。depth 1、depth 27以降、上昇legでは発生判定を行わない。
- 対象floorごとの独立した発生確率を`0.2`から`0.05`へ変更した。ラン全体の上限、最低保証、pity処理は追加していない。
- floor state構築時に既存の`leg`をモンスターハウス判定へ渡した。対象外、候補部屋なし、抽選失敗、抽選成功の各分岐におけるRNG消費回数と順序は維持した。
- モンスターハウス敵の種類・level生成、罠、日照、S/R防具lootは変更していない。

## 2. 検証

- depth 1／2／26／27の境界と、上昇legが全depthで対象外となることをtestで固定した。
- `buildMonsterHouseFloorState`の既存RNG消費回数回帰を新しいleg入力で維持した。
- `npm run typecheck` / `npm test` / `npm run build` を実行し、すべて通過した。
