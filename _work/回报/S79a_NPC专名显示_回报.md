模型:grok-4.7(builder-grok)

# S79a NPC 有专名显示专名(显示层) · 回报

时刻:2026-11-07 20:12。结论:完成。词表有 `content.<realm>.char.<local>` 就显示「专名(类型叫法)」,没有仍只显示类型叫法;四皮中英同一规则。

## 改了哪几处
- `server/src/public/pages.ts:86` 新增 `charGivenName`;`:117` `charLine` 有专名时写成 `雾岭巡行者(巡山弟子 \`npc.patroller\`)`,无专名时照旧只出类型 facet。公开地点页与传记都走 `charLine`。
- `server/src/public/static/play.js:519` 新增 `npcGivenName`;`:528` `charName` 同样「专名(类型叫法)」,无专名照旧 `tx("npc."+archetype)`。在场列表、商人、修理匠、战斗对象都经 `charName` / `shortName`,一处改全覆盖。

## 取名规则与取舍
- 键 = `content.<realm>.char.<local>`,local = 角色 id 去掉 `<realm>:char:` 前缀;不读 content_key 列,不加列、不加迁移。
- 并列类型:取「专名(类型叫法)」。理由:专名让人认出是谁,括号里的类型叫法让 AI 一眼分出商人 / 巡逻者 / 妖物,不丢原来的信息。
- 编年史只写角色 id 与事迹类型,不出现 NPC 叫法,无需改。

## 词表导出
- `sendLexicon`(`routes.ts:225`)本就整份下发 `content/skins/<skin>/<locale>.json`,`content.r1.char.*` 已在其中,play 页 `loadLex` 全量装进 `lex`,无需改导出。实测 `/play/lexicon/xiuxian/zh-CN.json` 含 `content.r1.char.s77_xiuxian_patrol` → 雾岭巡行者。`skins.ts`、`routes.ts` 未改。

## 验收
- `npx tsc --noEmit -p tsconfig.json`:绿。
- `AIHW_PGLITE_DIR=memory node --test test/s79_npc_names.test.ts`:1/1 绿。断言:雾岭页中文出「雾岭巡行者(巡山弟子)」、英文出「Mist Slope Patrol(Mountain Patrol Disciple)」;词表无条目的自插 NPC 只出「掌柜 `npc.merchant`」;换 fantasy/en 出「Mire Edge Patrol(Patroller)」;词表导出含专名条目。
- 相邻已有测试:grep `npc\.` 于 `server/test` 无断言公开页 NPC 叫法的旧例(命中都是字段访问)。跑了 `s13_public`、`s70_place_labels` 绿;`s26_play` 红在 `test/s26_play.test.ts:78` `use.branches.length` 期望 16 实得 17,断言的是 `/v1/verbs` 动词目录,与本单显示层无关,`catalog.ts` 相对 HEAD 无差异,未改。
- 本机起服 `AIHW_PGLITE_DIR=memory` 端口 8787,`/place/r1:place:xiuxian_out_mist_slope?skin=xiuxian&locale=zh-CN` 第 18 行实见「雾岭巡行者(巡山弟子 `npc.patroller`)」;测完已 `taskkill /PID 185116 /F`(只杀自己起的 node),端口已释放。

## 风险
- 并行的 S79b 在补专名,`content/skins/` 八个文件是它的改动,本单一个没碰;测试里「无专名」对照改用自插 NPC,不依赖种子 NPC 有没有被补名。
- 显示格式从「类型叫法」变为「专名(类型叫法)」,回包与协议字段未动,回包照旧给 id。
