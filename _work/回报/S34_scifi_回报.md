模型:GLM-5.3(builder-glm);2026-11-06 13:09

## 产出
- `D:/aihumanworld/content/skins/scifi/en.json` — 21101 字节,258 entries
- `D:/aihumanworld/content/skins/scifi/zh-CN.json` — 21143 字节,258 entries
- `D:/aihumanworld/docs/设定/科幻_出身区.md` — 1337 字节(出身区中英各一段 + 组织中英各一份)
- 暂存件(生成器 + 验收脚本,可删):`D:/claudetest/_work/builder/S34_scifi_gen.py`、`S34_scifi_check.py`

## 覆盖
- 固定原子键 177 枚全覆盖,缺 0(§2~§7 全部:place 11 / feature 9 / danger+combat 8 / item 16 / category+socket 9 / person+body+npc+class 20 / bond 4 / deed 40 / tier+stage+grade+element 24 / skill+task+task_kind+goal 15 / region+stat+org+org_rank+wanted 21)。
- 另补短名 81 条:装备九类 kind(blade/blunt/ranged/staff/light/heavy/robe/ring/charm)× 九阶 `item.<kind>·tierN`。
- class.* 四键按通用名收录(原子键本身);科幻皮 class=null,未写任何 `title·tierN·class.*` / `skill.<base>·class.*` 覆盖行。
- 九阶照第十六节:Cadet/Ensign/Lieutenant/Lieutenant Commander/Commander/Captain/Commodore/Admiral/Fleet Admiral;小段 Mk.I~IV(中文「一型~四型」);deed.ascend = 升维 Transcend。

## 出身区与组织
- 出身区:子午港 Meridian Port;中文段 88 字(含括注,≤100)。首关 = 模拟舱靶机战(靶机 = npc.tutorial_opponent,对应木人巷)。
- 组织清单:舰队登记处 Fleet Registry(默认登记)/ 深空测绘团 Deep Survey Corps / 轨道商团 Orbital Trade Compact / 残带回收队 Rustfield Salvage Crew。

## 验收(命令跑一次;首跑因控制台 GBK 乱码与正则两处抽取偏差重跑同一命令,判据未变)
命令:`PYTHONIOENCODING=utf-8 "C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe" "D:/claudetest/_work/builder/S34_scifi_check.py"`(脚本原文见暂存件;逻辑:解析两 JSON、验 schema/skin/locale、key 集合相同、key 唯一/name 非空/仅三字段、从标签词表 §2~§7 各表第一列抽固定原子键比对覆盖、首字节验 BOM、数出身区段字数)
输出:
```
[1] en.json BOM=False schema=aihw.translation.v1 skin=scifi locale=en entries=258 -> OK
[1] zh-CN.json BOM=False schema=aihw.translation.v1 skin=scifi locale=zh-CN entries=258 -> OK
[2] en: 重复键=0 空名=0 多余字段=0 -> OK
[2] zh-CN: 重复键=0 空名=0 多余字段=0 -> OK
[2] 两份 key 集合相同 -> OK
[3] 标签词表 §2~§7 固定原子键 177 枚, 缺 0 枚 OK
[4] 出身区段字数(含标点与英文括注, 去空白)= 88 -> OK (<=100)
RESULT: ALL OK
```

## 拿不准的命名(≤5)
1. element.water 译「冷媒 Coolant」、element.earth 译「动能 Kinetic」——给科幻装备标签的等价物,若嫌暗示效果可换直译「水体/岩质」。
2. place.hall 译「指挥厅 Command Hall」——登记组织驻地的军味叫法,或可改「舰队厅」。
3. item.ranged 译「能量枪 Blaster」——Blaster 为通用类型词,非禁用作品专名。
4. npc.tutorial_opponent 译「靶机 Target Drone」——与「木人巷」对位;若嫌「机」字暗示机械体,可改「模拟对手」(body 由事实定,名字不约束形态)。
5. stat.xp 译「经验 XP」、grade3 译「原型机 Prototype」——直给通行词,未加科幻皮味。

改动面:仅上述 3 个产出文件,git status 核对其余未跟踪件均属并行施工员,未触碰。
