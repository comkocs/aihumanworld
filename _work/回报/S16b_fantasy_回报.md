模型:grok-4.7(builder-grok)

结论:魔幻出身区事实数据与中英起名已落,验收链通过;typecheck 的唯一红点不在本单改动面。

## 文件与条数
- 新建 `content/world/fantasy.json`:地点 12(组织驻地 3 + 野外 9,含首关训练场;pk 2 处 `fantasy_crypt`/`fantasy_pit`)、出口追加 4、NPC 8、组织 3、组织技能 7、任务模板 3。种子已有的 `start_fantasy`(新手村)与 `registry_fantasy`(冒险者名册处)不重建,起点北向通中立集市的门不改。
- 改 `content/skins/fantasy/zh-CN.json`、`en.json`:各只追加 305 条(256 → 561),两份 key 集合与顺序完全相同,无删除无改写,无 BOM。
- 新建 `server/test/s16b_fantasy.test.ts`:一条链。

## 计数
- 地点:本区共 13(种子起点 1 + 本文件 12);其中组织驻地 hall 3、野外 9(pk 2、其余 safe/pve)、必胜首关 1(`fantasy_yard`,tutorial_opponent 在场)。
- NPC:8,八原型各一(师父 tier 2,覆盖 1~3 阶)。
- 组织:3(灰港卫所 / 银烛法会 / 青径巡游团),驻地均在本区。
- 组织技能:7(卫所 2、法会 3、巡游团 2)。
- 任务模板:3,均为 1 阶 reach,只引用本区地点。
- 新增翻译:每表 305 条(本区 content_key + 种子三键 + README 中立清单全部 content_key + 3 个职级键 + 7 个组织技能展示键)。

## 验收
- `node --test test/s16b_fantasy.test.ts`(在 `server/` 下):tests 1,pass 1,fail 0,duration_ms 1302.0979,EXIT=0。日志 `D:/aihumanworld/_work/临时/s16b_fantasy_test.log`。
- `npm run typecheck`:首次 EXIT=1,唯一错 `src/clock/scheduler.ts(15,15) TS6196 'GrowthClockCtx' declared but never used`。该文件不在本单改动面,是并行施工窗的未提交改动(相对 HEAD +1 行)。把该文件 `git stash` 隔离后重跑 `tsc --noEmit` EXIT=0(`D:/aihumanworld/_work/临时/s16b_fantasy_typecheck2.log`),随后 `stash pop` 原样还原,并用悬空提交 `d79efe2` 核对还原前后内容一致,未覆盖他人改动。

## 拿不准的命名(3)
- 中立区地点按「归墟 + 行会九阶」起名(如 `wild_t1` 归墟野地·新手),阶名取产品文档第十六节主列,未用味道列。
- 装备 9 阶用 铁/钢/符文/秘银/星铁/龙骨/圣辉/天铸/传奇,品级用 普通/精/名匠,属自拟。
- 组织技能名(卫所盾阵、银烛符文、青径步法等)设定件未给专名,照组织职能自拟。
