# S63 NPC 论道回话:多几句轮换、跟说话者的语言走(S54 小尾巴;乙·小,builder-terra)

模型:GPT-6.1 Terra(builder-terra)。回报首行写模型名,≤20 行。
仓:`D:/aihumanworld`(本地 main)。不 git add / commit / push,收口由 0 号窗提交。
**并行**:同时有五位施工员在本仓改 `server/src/tasks/`、`content/`、`server/src/content/`、`server/src/orgs/`、`docs/`、`server/src/verbs/bounty.ts`、`build.ts`、`server/src/public/`、`server/src/facts/` 等;本单只碰下面两个文件。

## 问题
验收位 15:0x 实玩:同一个 NPC 每次回的都是同一句英文。现在 `server/src/growth/npc_lines.ts` 每个原型只有一句,语言按说话者所在地点的区(fantasy / scifi 英文,其余中文)。

## 改法(零 LLM,不看说的内容是什么意思)
1. 每个原型(及 PLAIN)中英各 4~6 句,短、口语、各原型口吻不同;不写剧情、不写专名(四皮共用,不能出现「灵石」「法术」这类皮内词)。
2. 选哪一句:按(说话者 id、NPC id、当前刻)做个稳定哈希取模,同一刻同一对说两遍得同一句,换刻会轮换。
3. 语言:跟说话者这句话走——文本里有中日韩字符就回中文,否则回英文;判不出(空 / 只有符号)再退回现在的按地点区判。`npcLine` 签名可改,同步改 `server/src/growth/discourse.ts` 约 160~165 行的调用。
   **15:06 0 号补(第一轮回报「越界阻塞」)**:`server/src/verbs/say.ts` 也可改——把本句文本(或你在 say 里先判好的语言 `zh | en`)作为参数传进 `settleDiscourse`;只改这条传参,不改 say 的其他逻辑与 summary。文本仍不进事实库。

## 验收(只跑改动面,一次)
- `cd D:/aihumanworld/server && npx tsc --noEmit -p tsconfig.json` 0 错。
- `AIHW_PGLITE_DIR=memory node --test test/s46_discourse.test.ts` 全绿(若有断言写死回话原文,改成断言「非空且属于该原型的句表」)。

## 不碰
除 `server/src/growth/npc_lines.ts`、`server/src/growth/discourse.ts`、`server/src/verbs/say.ts`(只传参)、`server/test/s46_discourse.test.ts`(只相关断言;S61 可能同时在改该文件里的规则键一处,改前重读)外的一切文件;不改任何数。

## 回报
结论 / 每原型几句 / 语言判法一句 / 验收数。

回报落盘:D:/aihumanworld/_work/回报/S63NPC回话多样_回报.md
