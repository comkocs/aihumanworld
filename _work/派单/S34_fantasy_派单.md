本窗平台 = 桌面,子代理照《子代理分档表 v1》与当日口径最新模型行,不问分配。
回报落盘:D:/aihumanworld/_work/回报/S34_fantasy_回报.md

# 派单 · S3 + S4 · 魔幻皮:翻译表 + 出身区设定 · 乙·中小 · builder-grok(grok-4.7)

派单人:AI 人间 0 号包干窗;时刻 2026-11-06 13:1x
仓:`D:/aihumanworld/`(本地 main)。不 git add / commit / push;只新建下面「产出」里列的文件与回报件。另有三位施工员同时在做修仙、武侠、科幻三皮,S2 世界卡、S5 数值、S9 引擎也在并行,别人的文件(其他皮的 `content/skins/<皮>/`、`docs/设定/<皮>_出身区.md`、`docs/世界卡/`、`docs/数值/`、`content/rules/`、`server/`)一律不碰。

## 出题
照《研发顺序建议 v1》S3、S4 两行,为魔幻皮(skin 键 `fantasy`)出两样:① 翻译表,中英两份;② 出身区设定与组织命名。设计者 11-06 12:4x 定四皮加中立区同开、共用一条战力阶梯,皮只换名字。设计者 11-06 12:5x 定「没有雏形版，上线就是直接的正式版，做就做好」,按正式版质量起名。

## 读件(只读)
- `D:/aihumanworld/docs/协议/标签词表_v1.md` 全文;§8.2 翻译查找规则与 §9 翻译表格式定稿照做。
- `D:/aihumanworld/docs/协议/事实格式_v1.md`:查某个键对应什么事实时按需读。
- `D:/aihumanworld/docs/产品文档_v1.md`:第九、十五、十六、十七、十八节(第十六节九阶四列表以魔幻列为准;第十七节 F 是内容清单;第十八节是设定写多少)。

## 已定口径(不得违背)
1. 皮不带数(标签词表 §9):entries 只含 key / name / flavor;flavor 至多一句风味,不藏任何规则或数值暗示。
2. 覆盖标签词表 §2~§7 各表里的全部固定原子键(§9 末段):不穷举笛卡尔积;短名与完整签名行可选补,建议补九阶常见武器 / 护具 / 饰件短名若干。
3. 九阶名照第十六节:Neophyte → Legendary(第十六节魔幻主列·行会九阶;轮回 = Ascension);小段叫法:I / II / III / IV。
4. 借体系不借专名:AD&D 1978 头衔只作风格参照,正式词自拟同风格,不整表照搬;D&D SRD 5.1(CC-BY-4.0)里的通用机制词可借,出版方独有的怪物 / 世界 / 人物专名不用。中文版用通行译名。
5. 魔幻四职业 warrior / mage / ranger / cleric(战士 / 法师 / 游侠 / 牧师):只出 `title·tierN·class.<class>` 与 `skill.<base>·class.<class>` 覆盖行(标签词表 §8.2 第 5 条),只换名字,不换数值。
6. 同一个 key 在四皮里指同一件事实,只换叫法;八个 NPC 原型用同一八键翻译,不为本皮分叉原型。
7. 主语言 en,副语言 zh-CN;两份文件 key 集合完全相同,每个 name 只写一种语言,不在一个 name 里中英混拼(§9 locale 行)。

## 产出(新建)
1. `D:/aihumanworld/content/skins/fantasy/en.json` 与 `D:/aihumanworld/content/skins/fantasy/zh-CN.json`:照 §9 格式,UTF-8 无 BOM。
2. `D:/aihumanworld/docs/设定/魔幻_出身区.md`:出身区一段(≤100 字:地名、默认登记组织名、首关是什么);组织命名(默认登记组织 + 另 2~3 个组织,每个一行一句);中文一份、英文一份写在同一件里。


## 验收(只做一次)
设计者 11-06 当窗原话「不要有过多的复杂测试哦，也不要有重复的全量测试。」——不写别的测试,下面各做一次:
- 自写一条命令(Python 用 `C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe`)跑一次:两份 JSON 可解析;schema / skin / locale 字段正确;两份 key 集合相同;从标签词表 §2~§7 各表第一列抽出的固定原子键全部覆盖(列出缺的键,应为 0);无 BOM。命令原文和输出写进回报。
- 设定段中文字数 ≤100。

## 回报
落 `D:/aihumanworld/_work/回报/S34_fantasy_回报.md`,首行写模型名,≤40 行:产出路径与字节数;entries 条数;缺键数;组织名清单;拿不准的命名 ≤5 条。可派只读孙代理查资料,不派写码孙代理。回完即止。
