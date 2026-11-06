本窗平台 = 桌面,子代理照《子代理分档表 v1》与当日口径最新模型行,不问分配。
回报落盘:D:/aihumanworld/_work/回报/S2b_回报.md

# 派单 · S2b 入口 md(世界卡 + HTTP 用法)· 乙·中小 · builder-terra(GPT-6.1 Terra)

派单人:AI 人间 0 号包干窗;时刻 2026-11-06 14:4x
仓:`D:/aihumanworld/`。不 git add / commit / push。只新建 `docs/入口/` 下两件与回报件;世界卡原件只读。临时件只放 `D:/aihumanworld/_work/临时/`。并行在跑:S16a(`server/src/content/`、`content/world/`)、S19 审计(只读)。

## 出题
照《研发顺序建议 v1》S2 行的乙档部分:把世界卡扩成「一份 md 就能进世界」的入口件——世界卡主体 + HTTP 用法 + curl 示例 + 公开页网址,不需要插件(产品文档第八节 1)。先出中文修仙、英文魔幻两份。

## 读件(只读)
- 世界卡 v2:`D:/aihumanworld/docs/世界卡/世界卡_修仙_zh-CN.md`、`world_card_fantasy_en.md`(主体原样搬,不改一字)。
- `D:/aihumanworld/server/README.md`(请求一条路:`POST /v1/actions/<verb>`、`Authorization: Bearer <身份码>`、体 `{"args":{…}}`);`D:/aihumanworld/docs/协议/动词表_v1.md` §1~§3 与各动词参数;`server/src/public/routes.ts`(公开页路径与网页表单路径,只读)。

## 已定口径
1. 网址用正式域名 `https://aihumanworld.org`(已购,公开);接口 `https://aihumanworld.org/v1/actions/<verb>`,公开页照 routes.ts 的路径。服务器 IP 不入件。
2. 用法附段写在世界卡主体之后,标题分开;世界卡主体 ≤1,200 字 / ≤900 词的限制不含附段;附段力求短,只给:首入 enter create(拿码,码只显示一次)、带码的 events / look / task / go 各一条 curl、出错怎么看(错误码与「下刻再来」)、只能读网址时读哪几页、网页表单在哪。
3. 身份码只放请求头 `Authorization: Bearer`,示例用占位 `<你的身份码>`,不放网址。
4. 不提 MCP、插件、行动链接(阶段四按需);不要求关安全模式,一次允许清单不算。

## 产出
`docs/入口/AI人间_修仙_zh-CN.md`、`docs/入口/AIHumanWorld_fantasy_en.md`。

## 验收(只做一次)
设计者 11-06 当窗原话「不要有过多的复杂测试哦，也不要有重复的全量测试。」——纸上活:附段里的路径、请求头、参数名与 routes.ts / 动词表逐个对照一次,写进回报;不起服、不跑测试。

## 回报
落 `D:/aihumanworld/_work/回报/S2b_回报.md`,首行模型名,≤40 行:两件路径与字节数;附段字数;对照结果;拿不准的写法 ≤5 条。回完即止。
