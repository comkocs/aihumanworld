本窗平台 = 桌面,子代理照《子代理分档表 v1》与当日口径最新模型行,不问分配。
回报落盘:D:/aihumanworld/_work/回报/S16b_scifi_回报.md

# 派单 · S16b 科幻皮出身区内容 + 起名 · 乙·中小 · builder-grok(grok-4.7;设计者 11-06 14:57「乙类任务可以优先用grok写」)

派单人:AI 人间 0 号包干窗;时刻 2026-11-06 15:0x
仓:`D:/aihumanworld/`。不 git add / commit / push。只改:新建 `content/world/scifi.json`;改 `content/skins/scifi/zh-CN.json` 与 `en.json`(只追加条目,不删不改已有条目);新建 `server/test/s16b_scifi.test.ts`;外加回报件。临时件只放 `D:/aihumanworld/_work/临时/`,不往仓外写。另有三位施工员同时在做修仙、武侠、魔幻三皮(各自的 `content/world/<皮>.json` 与 `content/skins/<皮>/`),`content/world/neutral.json`、导入器 `server/src/content/` 与一切 server 源码只读不改。设计者 11-06:「没有雏形版，上线就是直接的正式版，做就做好」。

## 出题
照《研发顺序建议 v1》S16 行(四皮并行、一皮一派)与产品文档第十七节 E / F:为科幻出身区生成事实数据,并在本皮翻译表里给本区内容与中立区内容起名。零散文。

## 读件(只读)
- `D:/aihumanworld/content/world/README.md`(数据格式 aihw.content.v1,含 orgs 与组织技能段;全部中立 content_key 清单)、`content/world/neutral.json`(照它的形状写)。
- `D:/aihumanworld/docs/设定/科幻_出身区.md`(出身区名、默认登记组织、首关、另 2~3 个组织名)、`docs/设定/中立区与元设定.md`。
- `D:/aihumanworld/docs/产品文档_v1.md` 第十七节 E / F、第十八节;`docs/协议/标签词表_v1.md` §8;`docs/协议/事实格式_v1.md` place / org / char / task 表;`content/rules/numbers.v1.json`(数值照 S5)。
- `D:/aihumanworld/server/src/seed/minimal.ts`:种子已有 `r1:place:start_scifi`(settlement,作新手村)与 `r1:org:registry_scifi`(默认登记组织,驻地为起点)。

## 范围(`content/world/scifi.json`)
1. 地点:以 `r1:place:start_scifi` 为新手村;新增 1 个组织驻地、6~10 个野外地点(其中 1~2 个 combat=pk、危险度较高,自愿进入;其余 safe / pve)、1 个必胜首关(tutorial_opponent 在场);用 place_links 从起点接入,本区地点全部连通;起点通中立区的门种子已有,不重建。
2. NPC:本区八原型各至少一个(师父覆盖 1~3 阶即可,高阶在中立区);NPC 不逐个起键,翻译走签名(词表 §8.1)。
3. 组织:设定里另起名的 2~3 个组织各一行(hall 在本区),每个组织专属技能 2~3 门(组织技能键形照 README 与词表 §8.1)。
4. 任务模板:可加本区 1 阶新手任务若干(reach / deliver 在本区内),形状照 neutral.json;不新增装备定义(全世界共用 neutral.json 的 81 件,避免四皮撞键)。
5. content_key 本地段一律以 `scifi_` 开头,例 `content.r1.place.scifi_dock`,避免四皮撞名。

## 起名(只追加)
在 `content/skins/scifi/zh-CN.json` 与 `en.json` 各追加:本文件全部 content_key、`content/world/README.md` 清单里全部中立 content_key、本皮组织与组织技能键的名字;两份 key 集合仍须完全相同;皮不带数(只 key / name / flavor)。

## 验收(各只跑一次)
设计者 11-06 当窗原话「不要有过多的复杂测试哦，也不要有重复的全量测试。」:
- `server/test/s16b_scifi.test.ts` 一条链:用临时内容目录只放 `neutral.json` 与 `scifi.json` 两个文件(配置 `content_dir` 指向它,不读别皮文件)→ 起服导入全过 → 本区地点数照第十七节 E、八原型齐、组织与技能在 → 从 `start_scifi` 能走到本区全部地点与 `market_neutral` → 两份翻译表覆盖两个文件里的全部 content_key。在 `server/` 下只跑这一个文件一次。
- `npm run typecheck` 一次。不跑全量,不加别的测试。

## 回报
落 `D:/aihumanworld/_work/回报/S16b_scifi_回报.md`,首行模型名,≤40 行:文件与条数;两条命令与结果;地点 / NPC / 组织 / 技能 / 模板数;新增翻译条数;拿不准的命名 ≤5 条。回完即止,不派写码孙代理。
