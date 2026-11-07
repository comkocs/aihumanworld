# S81 回包带 guide_rev + 版本通知多发几次(验收位 020;乙·小,builder-terra)

模型:GPT-6.1 Terra(builder-terra)。回报首行写模型名,≤25 行。
仓:`D:/aihumanworld`(本地 main)。不 git add / commit / push,收口由 0 号窗提交。不 stash 别人的文件。现在没有并行单。

## 需求
先读验收位派单 `D:/aihumanworld/_work/派单/验收位_020_版本通知别只发一次.md`。设计者:每次入口更新都得手动叫 Grok 重读。原因:`server/src/verbs/envelope_extras.ts` 的 notice 每角色每个 rev 只在更新后第一次成功回包里出现一次;Grok 常把几条 curl 用 && 连发,一次性的 notice 被略过就再也不出现。

## 要的效果
1. **每个带身份码的成功回包都带 `guide_rev`**(字段名就用这个,0 号窗入口按它写):值 = `content/notice.json` 当前 `rev`;notice 文件缺失 / 坏时不带。位置与现有 `notice` / `new_speech` 同层(信封级可选字段)。很小,不带 text。
2. **完整 `notice` 多发几次**:新 rev 发布后,每个角色在之后的若干次成功回包里都带完整 notice(次数或刻数你定,写理由;建议「发布后该角色前 N 次成功回包」或「发布后 M 刻内的每次回包」二选一,倾向简单、重启后不至于永远重复或一次都没有)。现在只靠进程内 memo + 刻边界,照这个思路做,**不新加表**;若非加不可,写明理由并用迁移 `1700_s81_*.sql`。
3. 不加强制:不因没重读而拒绝任何动作;不改别的协议字段。
4. 协议登记:`docs/协议/动词表_v1.md`(信封可选字段那节 + 修订记录一行)说明 `guide_rev` 与 notice 多发规则。

## 改动面
`server/src/verbs/envelope_extras.ts`、组装信封的那一处(先找 `noticeFor` 的调用方,如 `server/src/verbs/runner.ts` 或同类)、`server/src/mcp/` 若 MCP 回包另组信封也同步、`docs/协议/动词表_v1.md`。测试新文件 `server/test/s81_guide_rev.test.ts`:新 rev 发布后连续几次请求都有 `guide_rev`;notice 出现不止一次、到你定的次数 / 刻数后不再出现;notice 文件缺失时两者都不带。

## 验收(只跑改动面各一次;失败可再改再跑到全绿)
- `cd D:/aihumanworld/server && npx tsc --noEmit -p tsconfig.json`。
- `AIHW_PGLITE_DIR=memory node --test test/s81_guide_rev.test.ts test/s46_discourse.test.ts test/s14_mcp.test.ts test/s48_redname.test.ts`(后三份含 notice 断言,若因「只发一次」写死而红,按新规则改断言并写明)。

## 不碰
`docs/入口/`、`content/notice.json`(0 号窗改);`content/rules/`、`content/world/`;`README*.md`、`deploy/`、`tools/`。

## 回报
结论 / guide_rev 放在哪 / notice 多发规则与理由 / MCP 是否同步 / 改了哪些文件 / 验收数 / 风险。

回报落盘:D:/aihumanworld/_work/回报/S81版本通知_回报.md
