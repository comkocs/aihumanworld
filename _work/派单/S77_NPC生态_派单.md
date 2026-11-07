# S77 世界格局(四):NPC 生态——巡逻、伏击、求助(验收位 007 拆单 d;甲·中,builder-terra)

模型:GPT-6.1 Terra(builder-terra)。回报首行写模型名,≤35 行。
仓:`D:/aihumanworld`(本地 main)。不 git add / commit / push,收口由 0 号窗提交。不 stash 别人的文件。
**并行**:S72 在改世界事件(`server/src/world_events/`、`content/rules/numbers.v1.json`、`server/src/facts/`、`server/src/growth/balance.ts`、`server/src/verbs/go.ts`、`server/migrations/1400_s72_world_events.sql`、`docs/协议/`、`docs/数值/`、多份测试规则键)。那些一律不碰——**数值新键与协议登记都写在回报末尾,0 号窗合入**;代码里读新数值键用「缺省值」兜底(键不存在时按缺省行为),这样不改 numbers 也能跑。**本单独占 `content/world/*.json`、`content/skins/`、`server/src/npc/`。**

## 需求
先读验收位派单全文:`D:/aihumanworld/_work/派单/验收位_007_借老MUD世界格局与世界事件.md` 第 4 条「巡逻、伏击、送信求助等按规则行动的 NPC(§一),零 LLM」;产品文档 §一 常驻 NPC「店家 / 师父 / 捕快 / 巡逻 / 伏击 / 送信求助」(`docs/产品文档_v1.md:14`)。弱规则:不加报名、不加审批;让世界有点动静,别变成新人陷阱。

## 要的效果(怎么做、数多少归你,写理由;三样做扎实两样也行,做不了的写清为什么)
1. **巡逻**:现有 `patroller` 原型按 `patrol_route` 走(`server/src/npc/clock.ts` 心跳)。给四出身区与中立区补几条巡逻路线(新 NPC 行,走 S59 外圈与中立野外),让 AI 在路上能碰到 NPC。
2. **伏击**:高危(`danger` high)地点的本阶怪,按 NPC 心跳以小概率主动攻击同地一名**过了新手保护**的参与角色(每角色每地点有冷却,不连续追打;只在 danger high 处;用现有战斗结算,NPC 为攻击方,死亡照现有规则)。结果写进被打者的事件流,AI 能看见「被伏击」。
3. **求助**:`quest_giver` 原型 NPC 按心跳偶尔在所在地发一句求助(NPC 的 speech 事件,模板句,零 LLM),并挂一条可接的系统任务(优先复用现有任务模板 / 系统供给,例如指向同阶附近的 slay / deliver 模板),做成后照常得奖;不加新动词、不加新表。若挂任务要改 `server/src/tasks/`,只改最小一处并写理由。
4. 新 NPC 在四皮翻译表起名(名字 + 一句短描述)。

## 改动面
`server/src/npc/clock.ts`(及 `server/src/npc/` 下新文件)、`content/world/*.json`(只加行)、`content/skins/`;必要时 `server/src/tasks/` 最小一处。测试新文件 `server/test/s77_npc_life.test.ts`:巡逻 NPC 按路线移动;danger high 处过保护的角色在若干心跳内会被伏击一次、冷却内不再被打、保护期内不被打;quest_giver 求助后同地能接到任务。

## 验收(只跑改动面各一次;失败可再改再跑到全绿)
- `cd D:/aihumanworld/server && npx tsc --noEmit -p tsconfig.json`(共享区若因 S72 半成品报错,写明哪些不是你的)。
- `AIHW_PGLITE_DIR=memory node --test test/s77_npc_life.test.ts test/s25_use_org_npc.test.ts test/s16a_content.test.ts test/s48_redname.test.ts`(写死数量的断言改为新数并说明)。
- 本机起服(`AIHW_PGLITE_DIR=memory`,端口 8787)导入成功、日志无 error;测完停服。

## 不碰
「并行」栏的文件;`server/src/verbs/attack.ts`(S74 将改;伏击用结算函数,不改 attack 动词);`README*.md`、`deploy/`、`tools/`;已有内容行。

## 回报
结论 / 三样各怎么做 / 数值新键(键名、缺省值、建议值、理由)/ 协议登记文字 / 新 NPC 清单 / 验收数 / 风险。

回报落盘:D:/aihumanworld/_work/回报/S77NPC生态_回报.md
