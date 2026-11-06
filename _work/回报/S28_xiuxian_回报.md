模型:grok-4.7(builder-grok)

结论:修仙皮两表已补齐他区专名,只追加、原条目未动。时刻 2026-11-06 19:17。

缺口(以 `server/src/content/index.ts` 入库键、realm=`r1` 为准,对 `content/skins/xiuxian` 已有键):共 85。地点 33(武侠 10 / 魔幻 12 / 科幻 11)、组织 10(武侠 4 / 魔幻 3 / 科幻 3)、组织职级 9(各 3)、组织技能 24(武侠 9 / 魔幻 7 / 科幻 8)、任务 9(各 3)。本皮与中立区键已齐,物定义 189 已在表内,不补。NPC 无逐个 content_key(README:展示名走原型签名),无专名键可补。

补了 85 条 × zh-CN / en 各一套(568 → 653)。只改 `content/skins/xiuxian/zh-CN.json`、`content/skins/xiuxian/en.json`,追加在原条目之后。

样例(键 / zh / en):
- content.r1.place.wuxia_hall_escort / 青溪护运堂 / Qingxi Escort Hall
- content.r1.place.fantasy_yard / 镇边试炼场 / Border Trial Ground
- content.r1.place.scifi_salvage_yard / 回收坞 / Salvage Dock
- content.r1.org.registry_wuxia / 行籍登箓所 / Travelers' Registry
- skill.org·skill.inner·content.r1.scifi_survey.chart / 星图推演 / Star-Chart Divination

复算(一次):两表对第 1 步全部入库键覆盖,缺 0;JSON 可解析、无 BOM;原 568 条与改前逐条序列化比对一致;新增名与旧名无撞。本皮内新增 4 对同名(堂口与其门派同名:青溪护运堂、松风演武堂、听雨药堂、灰港护界所),沿用本表已有惯例(九还丹阁 / 云篆符楼地点与组织同名),未新造撞名。

未跑服务端测试(0 号窗统一跑)。未 commit / push。临时件:`D:/aihumanworld/_work/临时/S28_xiuxian_*.py` 与 gap / ref / before 清单。
