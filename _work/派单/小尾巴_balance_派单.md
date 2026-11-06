本窗平台 = 桌面,子代理照《子代理分档表 v1》与当日口径最新模型行,不问分配。

# 派单 · 小尾巴:`growth/balance.ts` 补声明 day_ticks / week_ticks · 甲·小 · builder-grok(grok-4.7;当日口径甲·小 = grok)

派单人:AI 人间 0 号包干窗;时刻 2026-11-06 19:5x
仓:`D:/aihumanworld/`。不 git add / commit / push。只改 `server/src/growth/balance.ts` 与读这两个值的调用处(若为绕过类型的读法);临时件只放 `D:/aihumanworld/_work/临时/`。并行只读审计在跑,不影响。

## 问题
服务端合并时记下的尾巴:`clock.day_ticks` / `clock.week_ticks`(S5 数值表刻日历,1440 / 10080)在 `balance.ts` 的类型里没有声明,用处现绕过类型读取。补上声明与读取(从 `content/rules/numbers.v1.json` 走现有读数路),把绕过类型的读法改成正常字段访问;数值不变、行为不变。

## 验收(只做一次)
设计者 11-06 当窗原话「不要有过多的复杂测试哦，也不要有重复的全量测试。」:`npm run typecheck` 一次 + 跑读这两个值的那一个测试文件一次(多半是 `test/s10_growth.test.ts` 或 `test/chain.test.ts`)。全量由 0 号窗统一跑。

## 回报
落 `D:/aihumanworld/_work/回报/小尾巴_balance_回报.md`,首行模型名,≤12 行:改了哪几行(文件:行);两条命令与结果。回完即止。

回报落盘:D:/aihumanworld/_work/回报/小尾巴_balance_回报.md
