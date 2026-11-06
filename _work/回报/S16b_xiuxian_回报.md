模型:grok-4.7(builder-grok)
时刻:2026-11-06 15:16

结论:修仙出身区事实数据与两份翻译表起名已落盘,验收链与 typecheck 均一次通过。

文件
- 新建 `content/world/xiuxian.json`:地点 12(种子新手村栖霞村 + 登箓院驻地 + 试道木廊首关 + 野外 8 + 组织驻地另 3,野外含 2 处 pk:山门演武场 danger=medium、妖窟 danger=high)、place_links 1、NPC 10(八原型齐,师父 t1/t2/t3)、组织 4(登箓院为种子已有、本文件只补技能,另太华剑宗 / 九还丹阁 / 云篆符楼各带 hall 与长老职级)、组织技能 12(每组织 3 门)、任务模板 3(reach 2、deliver 1,均 1 阶、区内)。
- 追加 `content/skins/xiuxian/zh-CN.json` 与 `en.json`:各 +310 条(258 → 568),旧 258 条一字未动;两份键集合完全相同。310 = 中立 content_key 275(README 清单,place 41 / item 189 / task 45,含种子 market_neutral)+ 本皮 35(地点 13 含种子起点、组织 4、任务 3、组织技能展示键 12、职级键 3)。
- 新建 `server/test/s16b_xiuxian.test.ts`:一条链。

命令(各一次)
- `node --test test/s16b_xiuxian.test.ts`(server/):pass 1 / fail 0,1207ms。
- `npm run typecheck`(server/):tsc --noEmit 通过,无输出。

拿不准的命名(≤5)
1. 野外地点名(桃霞坡、灵田、露华池、药谷、断崖、妖窟)为自拟,设定只点名了村、院、首关与三组织。
2. 组织技能名(太华拔剑 / 九还炉火 / 云篆护符等 12 门)设定未给,按组织职能自拟。
3. 中立区高阶地点按「N 阶 + 类名」直译(如九阶秘境深处),未另起专名。
4. 登记组织三门技能(登箓吐纳 / 登箓步 / 登箓掌)设定未列,因导入器要求本文件动过的组织须有 2~3 门,故补。
5. 中立装备 content_key 用 weapon/armor 而库内 kind 为 blade/light_armor,翻译名按剑 / 轻甲对齐已有原子键。
