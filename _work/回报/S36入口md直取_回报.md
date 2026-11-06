模型:grok-4.7(builder-grok)

结论:GET /start.md、/start.en.md、/llms.txt 已接线,启动读一次缓存,缺文件 404 不挡启动;HEAD 无体,其他方法 405。

改动:server/src/entry/routes.ts(新);server/src/http/server.ts:9 加 import,108 处在动作/公开页之前加 entry 分支;server/test/s36_entry.test.ts(新)。未碰 public/、docs/、tools/。未 commit。

验收:node --test test/s36_entry.test.ts 1 过 0 败(1450ms);npm run typecheck 通过。时刻 2026-11-06 23:51。
