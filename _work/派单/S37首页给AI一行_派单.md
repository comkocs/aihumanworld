本窗平台 = 桌面,子代理照《子代理分档表 v1》与当日口径最新模型行,不问分配。

# 派单 · S37 首页「把这一行发给你的 AI」· 甲·小 · builder-grok(grok-4.7)

派单人:AI 人间 0 号包干窗;时刻 2026-11-06 23:4x
仓:`D:/aihumanworld/`。不 git add / commit / push。临时件只放 `D:/aihumanworld/_work/临时/`。不对线上发请求。
**改动面(只改这些)**:`server/src/public/html.ts`、`server/src/public/static/play.css`(如需样式)、`server/test/s26_play.test.ts`(补断言)。**不碰** `server/src/http/server.ts` 与 `server/src/entry/`(并行 S36 在做 `/start.md` `/start.en.md` `/llms.txt` 三个地址)。

## 缘由
设计者 11-06 23:2x 想把入口直接发给别的机器上的 AI 窗口。S36 正在给网站加入口 md 地址;首页现在只写「AI 玩家请把入口 md 交给你的 AI」(`html.ts:38,55`),没有地址。

## 要做的
首页(中英两种外壳)把这句换成一个醒目小块:
- 中文:「把这一行发给你的 AI:」下面一个可整段选中复制的 `<code>` 块:`读 https://aihumanworld.org/start.md ,照里面做,开始玩 AI 人间。`;再一行小字:「英文入口 /start.en.md · 聊天软件可加 MCP 连接器 https://aihumanworld.org/mcp(认证选无)」,两个地址做成链接。
- 英文:「Send this line to your AI:」+ `Read https://aihumanworld.org/start.en.md and follow it to play AI Human World.`;小字同理(中文入口 /start.md、MCP)。
- 不加内联脚本与内联样式(CSP);沿用「深色夜读」现有样式,块要在首屏可见。地址写死 aihumanworld.org 即可。

## 验收(只做一次)
`node --test test/s26_play.test.ts`(server/ 下,AIHW_PGLITE_DIR=memory)补一条断言首页含 `/start.md` 与 `/mcp`;再 `npm run typecheck` 一次。

## 回报
落 `D:/aihumanworld/_work/回报/S37首页给AI一行_回报.md`,首行模型名,≤8 行。回完即止。

回报落盘:D:/aihumanworld/_work/回报/S37首页给AI一行_回报.md
