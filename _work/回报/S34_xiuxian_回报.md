模型：GLM-5.3（builder-glm）

## 结论
S3 翻译表 + S4 出身区设定全部产出，验收 PASS（原子键 177 全覆盖、缺键 0、无 BOM、设定段 92/80 字 ≤100）。

## 产出（新建，字节数）
- D:/aihumanworld/content/skins/xiuxian/zh-CN.json — 17427 B，258 entries
- D:/aihumanworld/content/skins/xiuxian/en.json — 17424 B，258 entries
- D:/aihumanworld/docs/设定/修仙_出身区.md — 1635 B
- D:/aihumanworld/docs/设定/中立区与元设定.md — 1125 B

## 要点
- entries = 词表 §2~§7 固定原子键 177 + 短名候选键 81（武器 4 / 护具 3 / 饰件 2 共 9 kind × 9 tier）；两文件 key 集合相同；class 四键仅备键，未写任何职业覆盖行（修仙皮 class 恒 null）。
- 九阶照产品文档第十六节：练气→渡劫，stage4=大圆满；轮回键（deed.ascend）译「飞升/Ascension」。
- 组织名：登箓院（默认登记，Hall of Enrollment）、太华剑宗（Taihua Sword Sect）、九还丹阁（Ninefold Elixir Pavilion）、云篆符楼（Cloud-Script Sigil Tower）；出身区=青冥洲（Azure Expanse），新手村=青溪村，首关=试道木廊；中立区=归墟（The Confluence）。

## 验收（命令原文 + 输出）
命令（共跑两次：首跑发现提取正则漏键名中的「.」致原子键只提到 16 个，属脚本缺陷无效跑；修正后复跑一次有效，未加新测试项）：
```
PYTHONIOENCODING=utf-8 "C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe" -I "D:/claudetest/_work/builder/verify_xiuxian_s34.py"
```
输出（GBK 终端下中文标签显示乱码，数值与结论为原文）：
```
词表固定原子键提取数: 177
翻译表 entries 数(zh/en): 258 / 258
缺键数: 0
出身区段 字符数(含标点): 92
中立区段 字符数(含标点): 80
结果: PASS   (exit=0)
```
JSON 首三字节 7b 22 73（`{"s`，无 BOM）。

## 拿不准的命名（≤5）
1. region.fantasy「幻灵洲」、region.scifi「天机界」为修仙视角称呼，与魔幻/科幻施工员自起区名可能不同（口径允许各皮叫法不同）。
2. 英文阶名取凡人系通行英译（Deity Transformation、Body Integration 等），「通行」按网文英译惯例判断，未逐源核对。
3. combat.pve 译「降妖」带打怪味，若引擎侧需更中性可换「对敌」。
4. stat.potential 译「灵机」偏文学，通行叫法为「潜能」。
5. item.core「灵珠」与通货「灵石」一字之差，同屏展示需留意区分。

暂存件：D:/claudetest/_work/builder/{gen_xiuxian_s34.py, verify_xiuxian_s34.py}。未 add / commit / push。
