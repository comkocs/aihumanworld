# S79b 给常碰到的 NPC 补专名(内容)(验收位 016 拆单 b;乙·小,builder-terra)

模型:GPT-6.1 Terra(builder-terra)。回报首行写模型名,≤25 行。
仓:`D:/aihumanworld`(本地 main)。不 git add / commit / push,收口由 0 号窗提交。不 stash 别人的文件。
**并行**:S79a 在改显示层(`server/src/public/`),你一律不碰 `server/`。**本单独占 `content/skins/`。**

## 需求
先读验收位派单 `D:/aihumanworld/_work/派单/验收位_016_NPC显示专名.md` 第 2 条:给四区 + 中立玩家头一天常碰到的 NPC 补专名与一句描述,四皮中英;数量你定,**宁少勿滥**。显示层另由 S79a 改成「词表有 `content.r1.char.<local>` 就显示专名」。

## 范围建议(取舍归你,写理由)
- 每区头一天常碰到的:起点商人、修理匠、守卫、任务发布者、教学对手、原有巡逻者、各组织驻地的一阶 / 低阶师父、本区一阶怪(含外圈第一格的怪)。中立区:营地 / 环市一带的商人与一阶怪。
- 先核已有条目:`content/skins/<皮>/<locale>.json` 里已有不少 `content.r1.char.*`(S68 师父、S75 行商、S77 巡逻者等),**已有的不改、不重复**,只补缺的。
- 角色 local 以 `content/world/*.json` 的 `chars` 段为准;一个 NPC 在四个皮里各起本皮叫法(修仙 / 武侠 / 魔幻 / 科幻,中英各一),名字短、像人名或称号,描述一句、只写看得见的(不写剧情、不写年表,产品文档 §十八);不搬老 MUD 原文与专名。
- 格式照现有条目:`{"key":"content.r1.char.<local>","name":"…","flavor":"…"}`,只加行,不改已有行。

## 验收(只跑改动面各一次;失败可再改再跑到全绿)
- 八个文件都是合法 JSON、无重复键(写个一次性小脚本核,脚本放 `_work/临时/`,不入仓)。
- `cd D:/aihumanworld/server && AIHW_PGLITE_DIR=memory node --test test/s16a_content.test.ts test/s16b_xiuxian.test.ts test/s16b_wuxia.test.ts test/s16b_fantasy.test.ts test/s16b_scifi.test.ts`(词表校验若在这些测试里)。
- 回报附小表:每区补了哪几个 NPC(local)、四皮各一例名字。

## 不碰
`server/`、`content/world/`、`content/rules/`、已有词条;`README*.md`、`deploy/`、`tools/`。

## 回报
结论 / 补名清单与数量 / 起名原则 / 验收数 / 风险。

回报落盘:D:/aihumanworld/_work/回报/S79b_NPC补专名_回报.md
