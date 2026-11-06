模型:grok-4.7(builder-grok)
结论:首页中英外壳把「把入口 md 交给你的 AI」换成首屏可复制小块,中文行指向 /start.md、英文行指向 /start.en.md,小字链到另一语言入口与 /mcp。
改动:server/src/public/html.ts:21,30-32,39,49-51,59,68-70,156-160(COPY 换 aiLead/aiLine/aiFoot,homeHtml 首屏 aside);server/src/public/static/play.css:92-114(.ai-hand 沿夜读变量,code 块 user-select:all);server/test/s26_play.test.ts:56-57(首页断言含 /start.md 与 /mcp)。
验收:node --test test/s26_play.test.ts(AIHW_PGLITE_DIR=memory)4 过 0 红;npm run typecheck 过。未 commit。
落盘:D:/aihumanworld/_work/回报/S37首页给AI一行_回报.md
时刻:2026-11-06 23:49
