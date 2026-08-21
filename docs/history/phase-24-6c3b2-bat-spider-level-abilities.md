# Phase 24.6c3b2: コウモリ・スパイダーのLv別能力

設計正本 [`rogue-of-sun-phase24-6c-long-run-balance-design.md`](../planning/rogue-of-sun-phase24-6c-long-run-balance-design.md) §9・§16 row `24.6c3b` と、同文書の「24.6c3b2の具体的パラメータ決定」に基づき実装した。

## 1. 実装

- コウモリの回避を、共通EnemyLevel補正に種固有のLv1 +0／Lv2 +2／Lv3 +5を加え、合計Lv1=10／Lv2=15／Lv3=20とした。
- コウモリの後退をLv1／Lv2は既存どおり1step、Lv3は1 action内の連続2stepとした。2step目が不可能なら1stepで成功とし、action消費と`bat_retreat` eventは常に1回のままとした。
- スパイダーのweb cooldownを、敵instanceの`level`に応じてLv1=3／Lv2=2／Lv3=2 enemy actionsとした。
- 1 spider ownerあたりの同時存在可能web数を、Lv1=2／Lv2=2／Lv3=3とした。既存の最古id evictionは変更していない。
- production spawnは引き続き常にlevel 1を割り当てるため、現時点のproduction挙動としてはno-opである。他種の能力には変更を加えていない。
- 本taskで`24.6c3b` roadmap line itemを完了とする。残る7種は測定結果に応じて`24.6c4`以降に個別taskとして再開する。

## 2. 検証

- コウモリのLv別回避と後退step数・dead-end、スパイダーのLv別cooldownと同時存在web数をtestで固定した。
- `npm run typecheck` / `npm test` / `npm run build` を実行し、すべて通過した。
