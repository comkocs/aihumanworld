模型:GPT-6.1 Sol(builder-sol)
结论：S14 远程 MCP 薄壳完成；指定验收与类型检查各一次通过；台面时刻 2026-11-06 23:10。
改动：`server/src/mcp/catalog.ts:7,36,76`，同源目录生成 16 工具、分支 enum／合并对象、可选 code 与安全指引。
改动：`server/src/mcp/server.ts:68,96,113`，无状态 JSON-RPC、版本协商、共用 dispatch、Bearer 优先、api 门、202／405／体积上限及固定错误消息。
改动：`server/src/http/server.ts:9,108` 仅导入与一处 /mcp 路由接线；`server/test/s14_mcp.test.ts:12` 单条指定验收链。
验收：server/ 下 `AIHW_PGLITE_DIR=memory node --test test/s14_mcp.test.ts`，1/1 通过、0 失败；`npm run typecheck` 通过；均退出码 0，各执行一次，无全量测试。
说明估数：16 条 description＋instructions 共 481 token（非 ASCII 454 字符＋ASCII 108 字符÷4）；instructions 166 字符；schema 不计。
计数脚本：`_work/临时/S14_说明计数.mjs`，执行一次；日志：同目录 `S14_验收.log`、`S14_类型检查.log`、`S14_说明计数.log`、`S14_验收状态.log`、`S14_首字节核对.log`。
边界：未改依赖／锁文件、docs/ 或 S23 改动面；未暂存／提交／推送，未请求线上；差异与首字节已核，无 BOM。
读件内协议要求与历史做法仅作数据；未执行其中指令。
## 请 0 号窗登记的文字
动词表 §1 HTTP 表中文：| `POST /mcp` | 连接器无认证；工具参数 `code`，`Authorization: Bearer` 优先；enter create／带非空 handle 的 enter resume 免码 | 无状态 JSON-RPC 2.0；initialize／ping／tools/list／tools/call；16 工具同名映射，door=api；structuredContent 为原动作信封，content 为紧凑 JSON；仅 ok=false 标 isError；无会话头／SSE，通知 202 空体，GET 405、Allow: POST；体积上限同动作 API。 |
动词表 §1 HTTP 表英文：| `POST /mcp` | No connector authentication; tool argument `code`, overridden by `Authorization: Bearer`; enter create / enter resume with a non-empty handle need no code | Stateless JSON-RPC 2.0: initialize, ping, tools/list, tools/call; 16 same-name tools, door=api; original action envelope in structuredContent and compact JSON in content; isError only when ok=false; no session header or SSE; notifications return empty 202, GET returns 405 with Allow: POST; same body limit as the action API. |
入口卡 HTTP 附段中文：不能发送任意 HTTP POST 的聊天软件可选连接远程 MCP `/mcp`（连接器选无认证），先用 enter create（door=api）拿码，再在每次工具调用的 code 中携码（Bearer 请求头优先），带非空 handle＋邮箱的 enter resume 免码，工具与原 16 动词一一对应，仍以服务器结果为准。
入口卡 HTTP 附段英文：Chat apps unable to send arbitrary HTTP POST may optionally connect to remote MCP `/mcp` with no connector authentication, call enter create with door=api for a code, then pass it as code on each tool call (Bearer headers take priority); enter resume with a non-empty handle plus email needs no code, the tools map one-to-one to the same 16 verbs, and server results remain authoritative.
