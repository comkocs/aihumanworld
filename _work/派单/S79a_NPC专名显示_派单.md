# S79a NPC 有专名显示专名(显示层)(验收位 016 拆单 a;乙·小,builder-grok)

模型:grok-4.7(builder-grok)。回报首行写模型名,≤25 行。
仓:`D:/aihumanworld`(本地 main)。不 git add / commit / push,收口由 0 号窗提交。不 stash 别人的文件。
**并行**:S79b 在给 NPC 补专名,独占 `content/skins/`;你一律不碰 `content/`。

## 需求
先读验收位派单 `D:/aihumanworld/_work/派单/验收位_016_NPC显示专名.md`。现在 NPC 在公开页 / play 页只按类型显示(`npc.<archetype>`,如掌柜、巡山弟子);翻译表里已有的逐个专名 `content.r1.char.<local>`(例 `content/skins/xiuxian/zh-CN.json` 的 `content.r1.char.s77_xiuxian_patrol` → 雾岭巡行者)显示不出来。改成:**词表里有 `content.<realm>.char.<local>`(local = 角色 id 去掉 `<realm>:char:` 前缀)就显示专名,没有才照旧用类型叫法**;四皮中英同一规则。角色表没有 content_key 列,按 id 推键即可,不加列、不加迁移。

## 已知展示处(先核实,以实际为准)
- 公开页 `server/src/public/pages.ts` 的 `charLine`(约 105 行,现取 `npc.${c.archetype}`),以及地点页 / 编年史里出现 NPC 名的地方。
- play 页 `server/src/public/static/play.js`(约 519 行 `tx("npc." + c.archetype)`,以及 885 / 945 / 991 行附近商人、修理匠、战斗对象的叫法)。
- 词表导出 `/play/lexicon/<skin>/<locale>.json`(`server/src/public/routes.ts` 约 446 行、`server/src/public/skins.ts`):核一下 `content.r1.char.*` 条目有没有被导出;没有就让它导出(play 页靠它取名)。
- 有专名时可以「专名(类型叫法)」并列,方便 AI 认出是商人还是巡逻者;取舍归你,写理由。
- 不改动词回包与协议字段(回包照旧给 id)。

## 改动面
`server/src/public/pages.ts`、`server/src/public/skins.ts`、`server/src/public/routes.ts`、`server/src/public/static/play.js`;必要时 `server/src/public/` 下别的展示件。测试新文件 `server/test/s79_npc_names.test.ts`:有专名的 NPC(用现成的 s77 巡逻者)在公开地点页与词表导出里出专名;没专名的 NPC 仍是类型叫法;换皮出对应皮的名字。

## 验收(只跑改动面各一次;失败可再改再跑到全绿)
- `cd D:/aihumanworld/server && npx tsc --noEmit -p tsconfig.json`。
- `AIHW_PGLITE_DIR=memory node --test test/s79_npc_names.test.ts` + grep 到断言公开页 NPC 叫法的已有测试(例如 `grep -rln "npc\." test/ | xargs grep -ln "pages\|/place/\|lexicon"`,以实际为准)。
- 本机起服(`AIHW_PGLITE_DIR=memory`,端口 8787)打开 `/place/r1:place:xiuxian_out_mist_slope` 看巡逻者显示专名;测完停服。

## 不碰
`content/`、`server/src/verbs/`、`server/src/npc/`、`docs/协议/`;`README*.md`、`deploy/`、`tools/`。

## 回报
结论 / 改了哪几处展示、怎么取名、有无并列类型 / 词表导出改动 / 验收数 / 风险。

回报落盘:D:/aihumanworld/_work/回报/S79a_NPC专名显示_回报.md
