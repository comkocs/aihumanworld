# content/world — 开服内容数据(事实,零散文)

本目录放开服建造导入的世界内容(`server/src/content/index.ts`,事实格式 §1「NPC、组织、技能与基础规则由开服建造导入」)。协议真源:`docs/协议/事实格式_v1.md`、`docs/协议/标签词表_v1.md`;数值真源:`docs/数值/数值表_v1.md`(机读件 `content/rules/numbers.v1.json`)。名字不进事实:每个 content_key 的展示名归各皮翻译表(标签词表 §8.3),第二步四皮起名。

## 文件格式(aihw.content.v1)

一个 JSON 对象,九段,全部可省(空文件合法):

| 段 | 内容 | 幂等键 |
|---|---|---|
| `places` | 地点行:`local/region/kind/features/tier/danger/combat/exits/owner_org` | `content.<realm>.place.<local>` |
| `place_links` | 给**已在库**地点追加一条空闲方向出口(事实格式 §4 追加语义;不改其他字段) | `<place> 的 <dir>` |
| `items` | 物定义行:`local/kind/tier/grade/element/slots/cap/dura_max/modifiers/effect` | `content.<realm>.item.<local>` |
| `chars` | NPC 行:`local/skin/origin_region/body/archetype/tier/stage/loc/respawn_place/patrol_route` | `<realm>:char:<local>` |
| `tasks` | 任务模板行:`local/tpl/tier/stage/condition/reward_spec/duration_ticks` | `content.<realm>.task.<local>` |
| `orgs` | 组织行(事实格式 §8.1):`local/region/hall/ranks/goal_kind`;`goal_kind` 可省,缺省 `system_tasks` | `content.<realm>.org.<local>` |
| `org_skills` | 组织专属技能定义(事实格式 §7.1 定义分支):`org/local/base/tier` | `org:<realm>:org:<org_local>:<local>` |
| `resource_spots` | 资源点产出表(S27):`{place, items:[{def, cap}]}`;`place` 必须带 `resource` feature | `<holder> 的 <def>` |
| `shop_lists` | 商人货单(S27):`{char, items:[{def, cap}]}`;`char` 必须是 merchant 原型 NPC | `<holder> 的 <def>` |

约定:

- `local` 即 content_key 尾段(小写字母数字下划线);引用一律写本 realm 相对形 `<type>:<local>`(如 `place:market_neutral`),导入时展开成 `<realm>:<type>:<local>`,不绑死 realm 名。
- place/item/task 先过 S12 建造校验器(格式 / 阶内数值 / content_key 不重名 / 引用存在),`builderTier=9`(开服导入);NPC 行做形状校验,数值(体力、币池、师父技能)由 S5 表派生,数据文件不写这些数。
- 锁门出口写 `locked:true` 加 `key_def`;师父(archetype=master)导入时自动配四类基础技能行,level=cap=该阶 `skill_cap_hard`(S5 `npc.master_skill_level_rule`)。
- 组织:`hall` 必须是已在库(或本文件 `places` 段)的地点,且其 region 与组织 region 相同(本皮地点);`ranks` 为 `{rank,key,can_promote,can_expel}` 数组,rank 号与 key 各不重复,key 形如 `org_rank.<local>`,必须含默认职级 `org_rank.member`。导入的组织一律 `registry=false`,`treasury=0`;`goal` 初值的 target / reward_rep 取 S5(`orgs.goal_min_target` / `orgs.goal_reward_rep`),week 取当前 `world.week_index`,之后由组织刻阶段(S25)按人头重算。本文件 `places` 段的地点可用 `owner_org` 指本文件新建的组织(先建地点,组织建好后补上归属)。
- 已在库的组织(含种子的四个登记组织 `org:registry_<皮>`)不重建、不改,`orgs` 段同名条目只计跳过;要给它们加专属技能,写在 `org_skills` 段。
- 组织专属技能:`org` 指已在库或本文件新建的组织,`base` 为四类之一,`tier` 为适用起阶 1..9。库内键为 `org:<org_id>:<local>`(事实格式 §2.1 SkillKey),展示键为 `skill.org·skill.<base>·content.<realm>.<org_local>.<local>`(标签词表 §8.1),四皮按展示键起名。定义只带 base 与 tier,不带数:练、学的等级与上限照 S5 同一四类公式(`tiers.skill_cap_hard` 等)。导入的定义 ID 为 `<realm>:skill:org_<org_local>_<local>`,并追加进该组织的 `skill_defs`(只增不删)。本文件新建或加过技能的组织,文件结束时须有 2~3 门专属技能(产品文档 §17 F),否则整文件不入。
- 一个文件一个事务,任何一条不过整文件不入,错误报出文件 / 段 / local;已在库的跳过、不覆盖。
- 资源点与商人(S27,「世界里要有物」):产出表 / 货单一行 = 一个物定义 + 该持有者名下同定义 `available` 实例的上限 `cap ≥ 1`;引用一律写 `item:<local>`(多为中立 189 定义)。两段在七段之后**第二遍**导入,故可引用本批稍后文件导入的定义。导入即把该行 `due_tick` 记为当前刻,开服首刻补满一次;之后资源点每 `npc.resource_respawn_ticks`、商人每 `npc.merchant_restock_ticks`(数值表)把缺的补到上限、只补缺不超上限(take / buy 拿走才重排到期,满额对象零开销)。补出的实例 holder = 该地点 / 该商人,可 take / 可 `use buy`。导入收口有一条库级校验:每个 deliver / gather 任务模板要的 `item_def`,必须在其交付地点(`to_place`)同区或中立区至少有一个资源点或商人能出,否则点名报错、整个导入失败。

## S31 锁门钥匙来源

- 荐：`key_t1` 到 `key_t9` 分别追加到同阶外层 `dungeon_t1` 到 `dungeon_t9` 的资源点，上限各 2 把；免费 `take`，首刻补满，拿走后的补货沿用 S5 `npc.resource_respawn_ticks=120`。到外层不需要本阶钥匙，钥匙用于该外层的 `in` 锁门。一至三阶为 S31 返工补齐，中立区单独导入即可自给；出身区商人货单及中立 `merchant_t3` 原有的 `key_t3` 货单不动。
- 导入收口还核每个锁门的 `key_def`：必须至少有一个资源点或商人来源，且能从出生地点沿出口、逐步取得其他可达钥匙后到达；来源只在本门之后、互锁循环或没有来源时拒绝启动，错误点名地点键、方向、目标和钥匙定义。不改出口与结算规则。

## neutral.json 的中立 content_key 清单(四皮第二步起名用)

形状:`content.<realm>.<type>.<local>`;四皮翻译表按同一键登记名字。种子已有的中立地点键一并列出(不属本文件,引用它)。

### 地点(place)

种子(引用,不在本文件):`content.<realm>.place.market_neutral`。
本文件:
- 枢纽:`content.<realm>.place.gate_confluence` `content.<realm>.place.camp_neutral` `content.<realm>.place.market_ring` `content.<realm>.place.arena_neutral`
- 第 1 阶带:`content.<realm>.place.wild_t1` `content.<realm>.place.wild2_t1` `content.<realm>.place.dungeon_t1` `content.<realm>.place.inner_t1`
- 第 2 阶带:`content.<realm>.place.wild_t2` `content.<realm>.place.wild2_t2` `content.<realm>.place.dungeon_t2` `content.<realm>.place.inner_t2`
- 第 3 阶带:`content.<realm>.place.wild_t3` `content.<realm>.place.wild2_t3` `content.<realm>.place.dungeon_t3` `content.<realm>.place.inner_t3`
- 第 4 阶带:`content.<realm>.place.wild_t4` `content.<realm>.place.wild2_t4` `content.<realm>.place.dungeon_t4` `content.<realm>.place.inner_t4`
- 第 5 阶带:`content.<realm>.place.wild_t5` `content.<realm>.place.wild2_t5` `content.<realm>.place.dungeon_t5` `content.<realm>.place.inner_t5`
- 第 6 阶带:`content.<realm>.place.wild_t6` `content.<realm>.place.wild2_t6` `content.<realm>.place.dungeon_t6` `content.<realm>.place.inner_t6`
- 第 7 阶带:`content.<realm>.place.wild_t7` `content.<realm>.place.wild2_t7` `content.<realm>.place.dungeon_t7` `content.<realm>.place.inner_t7`
- 第 8 阶带:`content.<realm>.place.wild_t8` `content.<realm>.place.wild2_t8` `content.<realm>.place.dungeon_t8` `content.<realm>.place.inner_t8`
- 第 9 阶带:`content.<realm>.place.wild_t9` `content.<realm>.place.wild2_t9` `content.<realm>.place.dungeon_t9` `content.<realm>.place.inner_t9`

### 物定义(item,全世界共用)

- blade(27):`content.<realm>.item.weapon_t1_g1` `content.<realm>.item.weapon_t1_g2` `content.<realm>.item.weapon_t1_g3` `content.<realm>.item.weapon_t2_g1` `content.<realm>.item.weapon_t2_g2` `content.<realm>.item.weapon_t2_g3` `content.<realm>.item.weapon_t3_g1` `content.<realm>.item.weapon_t3_g2` `content.<realm>.item.weapon_t3_g3` `content.<realm>.item.weapon_t4_g1` `content.<realm>.item.weapon_t4_g2` `content.<realm>.item.weapon_t4_g3` `content.<realm>.item.weapon_t5_g1` `content.<realm>.item.weapon_t5_g2` `content.<realm>.item.weapon_t5_g3` `content.<realm>.item.weapon_t6_g1` `content.<realm>.item.weapon_t6_g2` `content.<realm>.item.weapon_t6_g3` `content.<realm>.item.weapon_t7_g1` `content.<realm>.item.weapon_t7_g2` `content.<realm>.item.weapon_t7_g3` `content.<realm>.item.weapon_t8_g1` `content.<realm>.item.weapon_t8_g2` `content.<realm>.item.weapon_t8_g3` `content.<realm>.item.weapon_t9_g1` `content.<realm>.item.weapon_t9_g2` `content.<realm>.item.weapon_t9_g3`
- light_armor(27):`content.<realm>.item.armor_t1_g1` `content.<realm>.item.armor_t1_g2` `content.<realm>.item.armor_t1_g3` `content.<realm>.item.armor_t2_g1` `content.<realm>.item.armor_t2_g2` `content.<realm>.item.armor_t2_g3` `content.<realm>.item.armor_t3_g1` `content.<realm>.item.armor_t3_g2` `content.<realm>.item.armor_t3_g3` `content.<realm>.item.armor_t4_g1` `content.<realm>.item.armor_t4_g2` `content.<realm>.item.armor_t4_g3` `content.<realm>.item.armor_t5_g1` `content.<realm>.item.armor_t5_g2` `content.<realm>.item.armor_t5_g3` `content.<realm>.item.armor_t6_g1` `content.<realm>.item.armor_t6_g2` `content.<realm>.item.armor_t6_g3` `content.<realm>.item.armor_t7_g1` `content.<realm>.item.armor_t7_g2` `content.<realm>.item.armor_t7_g3` `content.<realm>.item.armor_t8_g1` `content.<realm>.item.armor_t8_g2` `content.<realm>.item.armor_t8_g3` `content.<realm>.item.armor_t9_g1` `content.<realm>.item.armor_t9_g2` `content.<realm>.item.armor_t9_g3`
- ring(27):`content.<realm>.item.ring_t1_g1` `content.<realm>.item.ring_t1_g2` `content.<realm>.item.ring_t1_g3` `content.<realm>.item.ring_t2_g1` `content.<realm>.item.ring_t2_g2` `content.<realm>.item.ring_t2_g3` `content.<realm>.item.ring_t3_g1` `content.<realm>.item.ring_t3_g2` `content.<realm>.item.ring_t3_g3` `content.<realm>.item.ring_t4_g1` `content.<realm>.item.ring_t4_g2` `content.<realm>.item.ring_t4_g3` `content.<realm>.item.ring_t5_g1` `content.<realm>.item.ring_t5_g2` `content.<realm>.item.ring_t5_g3` `content.<realm>.item.ring_t6_g1` `content.<realm>.item.ring_t6_g2` `content.<realm>.item.ring_t6_g3` `content.<realm>.item.ring_t7_g1` `content.<realm>.item.ring_t7_g2` `content.<realm>.item.ring_t7_g3` `content.<realm>.item.ring_t8_g1` `content.<realm>.item.ring_t8_g2` `content.<realm>.item.ring_t8_g3` `content.<realm>.item.ring_t9_g1` `content.<realm>.item.ring_t9_g2` `content.<realm>.item.ring_t9_g3`
- potion(36):`content.<realm>.item.potion_restore_t1_g1` `content.<realm>.item.potion_restore_t1_g2` `content.<realm>.item.potion_restore_t1_g3` `content.<realm>.item.potion_bt_t1` `content.<realm>.item.potion_restore_t2_g1` `content.<realm>.item.potion_restore_t2_g2` `content.<realm>.item.potion_restore_t2_g3` `content.<realm>.item.potion_bt_t2` `content.<realm>.item.potion_restore_t3_g1` `content.<realm>.item.potion_restore_t3_g2` `content.<realm>.item.potion_restore_t3_g3` `content.<realm>.item.potion_bt_t3` `content.<realm>.item.potion_restore_t4_g1` `content.<realm>.item.potion_restore_t4_g2` `content.<realm>.item.potion_restore_t4_g3` `content.<realm>.item.potion_bt_t4` `content.<realm>.item.potion_restore_t5_g1` `content.<realm>.item.potion_restore_t5_g2` `content.<realm>.item.potion_restore_t5_g3` `content.<realm>.item.potion_bt_t5` `content.<realm>.item.potion_restore_t6_g1` `content.<realm>.item.potion_restore_t6_g2` `content.<realm>.item.potion_restore_t6_g3` `content.<realm>.item.potion_bt_t6` `content.<realm>.item.potion_restore_t7_g1` `content.<realm>.item.potion_restore_t7_g2` `content.<realm>.item.potion_restore_t7_g3` `content.<realm>.item.potion_bt_t7` `content.<realm>.item.potion_restore_t8_g1` `content.<realm>.item.potion_restore_t8_g2` `content.<realm>.item.potion_restore_t8_g3` `content.<realm>.item.potion_bt_t8` `content.<realm>.item.potion_restore_t9_g1` `content.<realm>.item.potion_restore_t9_g2` `content.<realm>.item.potion_restore_t9_g3` `content.<realm>.item.potion_bt_t9`
- scroll(36):`content.<realm>.item.scroll_strike_t1` `content.<realm>.item.scroll_guard_t1` `content.<realm>.item.scroll_move_t1` `content.<realm>.item.scroll_inner_t1` `content.<realm>.item.scroll_strike_t2` `content.<realm>.item.scroll_guard_t2` `content.<realm>.item.scroll_move_t2` `content.<realm>.item.scroll_inner_t2` `content.<realm>.item.scroll_strike_t3` `content.<realm>.item.scroll_guard_t3` `content.<realm>.item.scroll_move_t3` `content.<realm>.item.scroll_inner_t3` `content.<realm>.item.scroll_strike_t4` `content.<realm>.item.scroll_guard_t4` `content.<realm>.item.scroll_move_t4` `content.<realm>.item.scroll_inner_t4` `content.<realm>.item.scroll_strike_t5` `content.<realm>.item.scroll_guard_t5` `content.<realm>.item.scroll_move_t5` `content.<realm>.item.scroll_inner_t5` `content.<realm>.item.scroll_strike_t6` `content.<realm>.item.scroll_guard_t6` `content.<realm>.item.scroll_move_t6` `content.<realm>.item.scroll_inner_t6` `content.<realm>.item.scroll_strike_t7` `content.<realm>.item.scroll_guard_t7` `content.<realm>.item.scroll_move_t7` `content.<realm>.item.scroll_inner_t7` `content.<realm>.item.scroll_strike_t8` `content.<realm>.item.scroll_guard_t8` `content.<realm>.item.scroll_move_t8` `content.<realm>.item.scroll_inner_t8` `content.<realm>.item.scroll_strike_t9` `content.<realm>.item.scroll_guard_t9` `content.<realm>.item.scroll_move_t9` `content.<realm>.item.scroll_inner_t9`
- map(9):`content.<realm>.item.map_t1` `content.<realm>.item.map_t2` `content.<realm>.item.map_t3` `content.<realm>.item.map_t4` `content.<realm>.item.map_t5` `content.<realm>.item.map_t6` `content.<realm>.item.map_t7` `content.<realm>.item.map_t8` `content.<realm>.item.map_t9`
- key(9):`content.<realm>.item.key_t1` `content.<realm>.item.key_t2` `content.<realm>.item.key_t3` `content.<realm>.item.key_t4` `content.<realm>.item.key_t5` `content.<realm>.item.key_t6` `content.<realm>.item.key_t7` `content.<realm>.item.key_t8` `content.<realm>.item.key_t9`
- ore(9):`content.<realm>.item.ore_t1` `content.<realm>.item.ore_t2` `content.<realm>.item.ore_t3` `content.<realm>.item.ore_t4` `content.<realm>.item.ore_t5` `content.<realm>.item.ore_t6` `content.<realm>.item.ore_t7` `content.<realm>.item.ore_t8` `content.<realm>.item.ore_t9`
- herb(9):`content.<realm>.item.herb_t1` `content.<realm>.item.herb_t2` `content.<realm>.item.herb_t3` `content.<realm>.item.herb_t4` `content.<realm>.item.herb_t5` `content.<realm>.item.herb_t6` `content.<realm>.item.herb_t7` `content.<realm>.item.herb_t8` `content.<realm>.item.herb_t9`

### 任务模板(task,全世界共用)

- deliver(9):`content.<realm>.task.deliver_t1` `content.<realm>.task.deliver_t2` `content.<realm>.task.deliver_t3` `content.<realm>.task.deliver_t4` `content.<realm>.task.deliver_t5` `content.<realm>.task.deliver_t6` `content.<realm>.task.deliver_t7` `content.<realm>.task.deliver_t8` `content.<realm>.task.deliver_t9`
- find(9):`content.<realm>.task.find_t1` `content.<realm>.task.find_t2` `content.<realm>.task.find_t3` `content.<realm>.task.find_t4` `content.<realm>.task.find_t5` `content.<realm>.task.find_t6` `content.<realm>.task.find_t7` `content.<realm>.task.find_t8` `content.<realm>.task.find_t9`
- slay(9):`content.<realm>.task.slay_t1` `content.<realm>.task.slay_t2` `content.<realm>.task.slay_t3` `content.<realm>.task.slay_t4` `content.<realm>.task.slay_t5` `content.<realm>.task.slay_t6` `content.<realm>.task.slay_t7` `content.<realm>.task.slay_t8` `content.<realm>.task.slay_t9`
- gather(9):`content.<realm>.task.gather_t1` `content.<realm>.task.gather_t2` `content.<realm>.task.gather_t3` `content.<realm>.task.gather_t4` `content.<realm>.task.gather_t5` `content.<realm>.task.gather_t6` `content.<realm>.task.gather_t7` `content.<realm>.task.gather_t8` `content.<realm>.task.gather_t9`
- reach(9):`content.<realm>.task.reach_t1` `content.<realm>.task.reach_t2` `content.<realm>.task.reach_t3` `content.<realm>.task.reach_t4` `content.<realm>.task.reach_t5` `content.<realm>.task.reach_t6` `content.<realm>.task.reach_t7` `content.<realm>.task.reach_t8` `content.<realm>.task.reach_t9`

### NPC(id,无 content_key)

NPC 用 ID `<realm>:char:<local>`,八原型齐:师父 `master_t2..t9`(每阶都有更高阶者可学)、店家 `merchant_t3`、修理匠 `repairer_t2`、守卫 `guard_t3`、任务发布者 `quest_giver`、巡逻者 `patroller_t3`、怪物 `monster_t1..t9`、首关对手 `tutorial_opponent_t1`。NPC 展示名走 `person.npc·body.<body>·npc.<archetype>·tierN·stageN` 签名(标签词表 §8.1),不逐个起键名。

