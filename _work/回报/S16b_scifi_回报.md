模型:grok-4.7(builder-grok)

结论:科幻出身区事实数据与中英起名已落盘,一条验收链与 typecheck 各跑一次,均过。时刻 2026-11-06 15:17。

文件与条数
- 新建 `content/world/scifi.json`:地点 11(种子起点子午港 + 测绘厅驻地 + 野外 8 + 模拟舱首关)、place_links 1、NPC 8、组织 3、组织技能 8、任务模板 3。无装备定义。
- 改 `content/skins/scifi/zh-CN.json` 与 `en.json`:各从 258 追加到 563,新增 305 条(本文件 content_key + README 中立清单 + 本皮组织 / 技能 / 职级);两份键集合相同,只追加,无 BOM。
- 新建 `server/test/s16b_scifi.test.ts`:一条链。

地点:start_scifi(种子,settlement)→ 测绘厅(hall,深空测绘团)→ 轨道泊位(market,轨道商团)、环带路、信标原、尘原、残骸闸、弃舰货舱、回收坞(ruin,残带回收队)、残带(pk)、暗航道(pk)、模拟舱(tutorial,靶机在场)。pk 两处 danger=high,自愿从回收坞进入。
NPC:师父(3 阶)/ 店家 / 修理匠 / 守卫 / 任务发布者 / 巡逻者 / 怪物 / 首关对手,八原型各一。
组织:深空测绘团、轨道商团、残带回收队,技能 3 / 2 / 3 门。舰队登记处是种子,不重建、不加技能。
模板:reach 模拟舱、reach 回收坞、deliver 一阶矿样到轨道泊位。

命令
- `server/` 下 `node --test test/s16b_scifi.test.ts`:pass 1 / fail 0(1262 ms)。临时目录只放 neutral.json 与 scifi.json,测完已清。
- `server/` 下 `npm run typecheck`:tsc --noEmit 过,无输出。

拿不准的命名(≤5)
1. 中立秘境 `dungeon_tN` / `inner_tN` 译作「秘境 / 秘境深处」(设定只给归墟,没给分带地名)。
2. 中立 `wild2_tN` 译作「边荒」,与 `wild_tN`「荒野」分开。
3. 组织职级 `org_rank.scifi_*` 译作测绘长 / 经纪官 / 回收头,设定没给职级名。
4. 回收坞写成 ruin 不是 hall:第十七节 E 只要 1 个组织驻地(测绘厅),另外两个组织的 hall 仍在本区。
5. 残带、暗航道两处 pk 都挂在回收坞外,危险度 high。
