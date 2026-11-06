本窗平台 = 桌面,子代理照《子代理分档表 v1》与当日口径最新模型行,不问分配。

# 派单 · S28 修仙皮补全他区专名(xiuxian)· 乙·中小 · builder-grok(grok-4.7;设计者 14:57「乙类任务可以优先用grok写」)

派单人:AI 人间 0 号包干窗;时刻 2026-11-06 19:2x
仓:`D:/aihumanworld/`。不 git add / commit / push。**只改** `content/skins/xiuxian/zh-CN.json` 与 `content/skins/xiuxian/en.json`(只追加 entries,已有条目一字不动);其余只读。临时件只放 `D:/aihumanworld/_work/临时/`。并行:另三皮各有一张同样的单,只写各自目录;S26 收尾只写 `server/src/public/static/play.js`。不对线上发请求。

## 问题
「皮只换名、不改数」:玩 修仙皮的人看到的整个世界都该用修仙的说法。S16b / S16c 时每皮只给了本皮出身区与中立区起名,另外三个出身区(`content/world/{xiuxian,wuxia,fantasy,scifi}.json` 里非 xiuxian 的三个)的地点、组织、组织技能、任务等在本皮表里没有名字,网页游戏页显示「未知地点」、公开页显示 translation_missing。0 号窗粗算每皮每语言缺约 150 键(地点约 33、组织约 10、组织技能约 36、任务 9,外加 NPC 若有专名键)。

## 要做的
1. 先用脚本算准缺口:以 `server/src/content/index.ts` 实际写进库的 content_key 为准(地点 / 物定义 / 任务模板 / 组织 / 组织技能 / 有专名的 NPC 等,照导入代码取键,不要自己拼键),与 `content/skins/xiuxian/{zh-CN,en}.json` 已有 key 比,列出缺的。
2. 用修仙的风格为缺的键起名 + 一句 flavor,zh-CN 与 en 各一套;同一地点在本皮的叫法要贴合它在原区的功能(药圃、码头、试炼场等照 `kind` / `features` 与原皮名的意思转写),不直接照搬别的皮的名字;本皮内不撞名(与已有名字查重)。格式照表里现有条目(`{"key","name","flavor"}`)。
3. 起名参考:`docs/设定/`(四区设定)、`docs/世界卡/`、其他三皮表里同键的名字与 flavor(只参考意思)。

## 验收(只做一次)
设计者 11-06 当窗原话「不要有过多的复杂测试哦，也不要有重复的全量测试。」:脚本复算一次——两份表对第 1 步的键全覆盖、本皮内名字无重复、JSON 可解析、原有条目未变(与改前逐条比)。不跑服务端测试(0 号窗统一跑)。

## 回报
落 `D:/aihumanworld/_work/回报/S28_xiuxian_回报.md`,首行模型名,≤20 行:缺口数(按类)、补了几条、样例五行(键 / zh 名 / en 名)、复算结果。回完即止,不派写码孙代理。

回报落盘:D:/aihumanworld/_work/回报/S28_xiuxian_回报.md
