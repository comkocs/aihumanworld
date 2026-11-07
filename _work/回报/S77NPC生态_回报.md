模型:GPT-6.1 Terra(builder-terra)
结论：按派单允许的两项交付巡逻和伏击，求助未做；未提交、未推送。台面时刻：2026-11-07 18:21。
巡逻：四出身区各一名二阶、中立野外一名一阶；沿已有双向开放出口每 5 刻往返；不改已有内容行。
伏击：仅高危且地点阶与怪阶一致的非安全、非切磋地点；同地、活跃、存活且完整度过建角保护期的参与者随机择一；60 刻角色×地点冷却，跨怪共用、事件存盘可跨重启。
伏击通过现有确定性战斗结算计算，写双方个人及地点的 `combat_resolved`、体力与装备磨损、死亡/复活事实、怪掉落及首次击杀奖励；个人事件带 `ambush: true`。
为避免离线陷阱，仅选择最近一个检查周期内有活动的角色；即使角色在保护期内主动攻击参与者，也仍须等原保护期结束。
求助：未实现 `quest_giver` 定时对白及挂任务，也未伪造测试；心跳上下文没有语音文本服务，单发事件经现有投影只能得到过期空文；打通需改派单范围外的时钟/应用服务链；可由 0 号窗另行安排。
改动：`server/src/npc/clock.ts:9,100-107,141`；新增 `server/src/npc/ambush.ts:1-140`；新增 `server/test/s77_npc_life.test.ts:1-68`。
改动：`content/world/xiuxian.json:347`、`wuxia.json:1505`、`fantasy.json:348`、`scifi.json:333`、`neutral.json:10622` 各增一名巡逻者。
改动：`content/skins/{xiuxian,wuxia,fantasy,scifi}/{zh-CN,en}.json` 各增五名 NPC 的双语名称与短描述；原条目解析后逐项比较不变。
改动：`server/test/s25_use_org_npc.test.ts:111,117,122,280` 固定数随工作树并行数值更新：购买 600→200、修理 60→20、出售 240→80、怪物复活体力 2000→1800；未修改数值文件。
NPC 清单：`s77_xiuxian_patrol` 雾岭巡行者、`s77_wuxia_patrol` 竹缘巡行者、`s77_fantasy_patrol` 泽边巡行者、`s77_scifi_patrol` 沙缘巡行者、`s77_neutral_patrol` 归途巡行者。
验收：`npx tsc --noEmit -p tsconfig.json` 最终通过；指定四文件测试复测 12 通过、0 失败；起服导入 5 文件成功、无 error，指定端口启动后已停止本次进程。
首轮红项：`S25 buy, repair and sell conserve both balances and one item`、`S25 NPC heartbeat moves patrol and revives monster only when due`；系当前共享数值已变，更新上述固定数后复测全绿。
测试日志：`D:/aihumanworld/_work/builder/S77_首轮测试.log`、`D:/aihumanworld/_work/builder/S77_复测.log`；起服日志：`D:/aihumanworld/_work/builder/S77_起服.log`（地址已隐去）。
风险：伏击中受害者反杀虽有掉落和首次击杀奖励，但现有斩杀任务证据只查角色主动 `combat_win`，故此反杀不计任务；战斗死亡/掉落落账借用了同规则而非攻击动词内部私有落账函数，未来攻击规则变化须同步。
风险：测试注入 100% 触发和 1 刻检查验证保护/冷却，不是统计默认概率；未测试求助及其可接任务。新 NPC 名称虽已写入翻译表，只读调查指出服务端目前没有读取 `content.<realm>.char.*` 的展示链，因此不能保证在 look/网页显示专名；中立野外主链 `wild_t5..t9` 目前无怪，伏击实际依赖高危侧翼及其他已有本阶怪的位置。
回退：删除新增 `ambush.ts`、`s77_npc_life.test.ts`；从上述现有文件移除 S77 新增行及心跳接线，S25 四个断言视共享数值回退与否同步还原；不覆盖其他并行工作。
检查：改动文件首字节无 BOM，`git diff --check` 无空白错误；所读文件与命令输出未发现夹带指令。
数值待 0 号窗登记：`npc.ambush_interval_ticks` 缺省/建议 5 刻（间隔检查、降低负载）；`npc.ambush_chance_bp` 缺省/建议 2000（每次检查 20%，偶发不密集）；`npc.ambush_cooldown_ticks` 缺省/建议 60 刻（避免同地连续追打）。
协议待 0 号窗登记：`combat_resolved.data.ambush?: true` 标识由怪物心跳发起的高危地点伏击；无此字段表示现有普通战斗；`attacker` 为怪物、`target` 为被伏击角色，其余战斗结果沿用现有字段；自我层与地点层均可见。
