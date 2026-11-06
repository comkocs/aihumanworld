本窗平台 = 桌面,子代理照《子代理分档表 v1》与当日口径最新模型行,不问分配。

# 派单 · S36 网站直接给出入口 md(别的机器上的 AI 一句话就能读到)· 甲·小 · builder-grok(grok-4.7)

派单人:AI 人间 0 号包干窗;时刻 2026-11-06 23:2x
仓:`D:/aihumanworld/`。不 git add / commit / push。临时件只放 `D:/aihumanworld/_work/临时/`。不对线上发请求。
**改动面(只改这些)**:新建 `server/src/entry/`(文件自定);`server/src/http/server.ts` 只加路由接线一处(照 `/mcp` 那处的写法);新建 `server/test/s36_entry.test.ts`。**不碰** `server/src/public/`(并行 S23 正在改,首页链接 0 号窗之后另派)、`docs/`、`tools/`。

## 缘由
设计者 11-06 23:2x:想把入口发给别的机器上的 AI 窗口直接下载测试。现在网站上没有入口 md 的地址(仓是私有的,也拿不到)。

## 要做的
1. `GET /start.md` → 原样返回 `docs/入口/AI人间_修仙_zh-CN.md`;`GET /start.en.md` → `docs/入口/AIHumanWorld_fantasy_en.md`。`Content-Type: text/markdown; charset=utf-8`,`Cache-Control: public, max-age=300`。文件在启动时读一次缓存(路径从 `server/src` 相对解析到仓根 `docs/入口/`,同 `server/src/content/index.ts:72` 的写法);读不到就该路径回 404,不挡启动。
2. `GET /llms.txt`(text/plain; charset=utf-8):五六行英文 + 中文,指向 `/start.md`、`/start.en.md`、`/mcp`(远程 MCP,连接器无认证)、`/v1/verbs`;写一句「先读入口 md 再行动」。
3. HEAD 同 GET 不带体;其他方法 405。

## 验收(只做一次)
`node --test test/s36_entry.test.ts`(server/ 下,AIHW_PGLITE_DIR=memory):三路 200 与类型头、内容首行对得上、POST 405;再 `npm run typecheck` 一次。不跑全量。

## 回报
落 `D:/aihumanworld/_work/回报/S36入口md直取_回报.md`,首行模型名,≤10 行。回完即止。

回报落盘:D:/aihumanworld/_work/回报/S36入口md直取_回报.md
