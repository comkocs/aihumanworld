模型:GPT-6.1 Terra(builder-terra)

结论：四区及中立区补名完成；词表核验通过，指定内容测试 3 绿 2 红，未扩面修复。
时刻：2026-11-07 20:09。
补名表（每行前缀拼接各后缀为完整 local）：
| 区 | 本次新增 local | 数量 |
|---|---|---:|
| 修仙 | `xiuxian_` + `master_t1, merchant, repairer, guard, quest_giver, patroller, monster, tutorial` | 8 |
| 武侠 | `wuxia_` + `master_t1, merchant, repairer, guard, quest_giver, patroller, monster, tutorial_opponent` | 8 |
| 魔幻 | `fantasy_` + `master, merchant, repairer, guard, quest_giver, patroller, monster, tutorial` | 8 |
| 科幻 | `scifi_` + `master, merchant, repairer, guard, quest_giver, patroller, monster, tutorial` | 8 |
| 中立 | `merchant_t3, repairer_t2, guard_t3, quest_giver, patroller_t3, monster_t1, tutorial_opponent_t1` | 7 |
| 四皮举例，均为 `xiuxian_merchant` | 修仙：桑掌柜；武侠：陶掌柜；魔幻：商人艾芙；科幻：商员诺拉 | 4 |
共 39 个 local，四皮中英各 39 条，共新增 312 条；原词条不改。`monster_side_t1` 与 S77 巡逻者八表已有，保留；原有师父词条按各表保留，不改不重复。优先起点、邻近服务与任务、训练和一阶怪；不扩大到高阶角色。魔幻、科幻最低现有师父分别为二、三阶，按现有配置取用。
起名原则：各皮短名或地点称号，中英对应；描述限可见衣物、工具与外形，不写剧情、年表或旧 MUD 专名。
修改：`content/skins/{xiuxian,wuxia,fantasy,scifi}/{zh-CN,en}.json`，修仙各文件第 2–40 行，其余各文件第 6–44 行；均仅新增 39 行。临时生成与核验脚本：`D:/aihumanworld/_work/临时/S79b_补名.py`、`D:/aihumanworld/_work/临时/S79b_核词表.py`。
验收：8/8 合法 JSON，无对象重复键及词条重复键，首字节均为 `7b`，无 BOM；`git diff --check` 通过；未涉及 csproj、未 build。
指定五文件测试：5 例，3 通过、2 失败；失败逐名：`S16b scifi: origin import, connectivity, translations`、`S16b xiuxian: origin region import, connectivity, translations`。日志：`D:/claudetest/_work/builder/S79b_内容测试.log`（35 行）。
风险：两例均报导入跨区组织关系时目标组织不在库；未改、未重复跑；显示层仍由并行 S79a 负责，未实玩验证。
越界：`content/world/scifi.json`、`content/world/xiuxian.json`，失败发生在跨区组织关系导入，若需调整这些配置才能通过则超出本单范围；`server/` 同为不碰范围。
回退：仅移除以上八份词表第 2–40 / 6–44 行本单新增词条；不回退其他并行改动。
回报落盘：`D:/aihumanworld/_work/回报/S79b_NPC补专名_回报.md`。
