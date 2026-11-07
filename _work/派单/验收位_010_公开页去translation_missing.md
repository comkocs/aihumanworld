# 验收位派单 010 · 公开传记页满屏 translation_missing(门面小修)

派单方:AI 人间·需求与验收位;时刻 2026-11-07 13:31。一句话:**任何人打开角色传记页,看到的是一串「(translation_missing)」;补齐中立皮(neutral)翻译或在缺译时只显示可读名,让公开页能读。**

## 现象(验收位 13:30 线上实看)
- https://aihumanworld.org/char/r1:char:c32 (Accept: text/markdown):首行「skin: neutral」,其后 person.player / body.humanoid / tier1 / bond.member / stat.reputation / deed.travel / deed.first_found / deed.take 等每个标签后都跟「(translation_missing)」。
- 仓要公开,README 指向编年史与传记页「任何人可看」,这是陌生人第一眼。

## 出处
产品文档 §三「旁观者:任何人不登录即可看世界编年史页与角色传记页」(`docs/产品文档_v1.md:52`);研发顺序 S13 公开页。

## 要的效果
传记页、编年史页、地点页在 neutral 与四皮下都没有「translation_missing」字样;角色按其出身皮显示叫法。怎么补(补翻译表或缺译回退)归做的人。

## 验收(本位实看一次)
打开三个不同出身皮角色的传记页与编年史页,全文 grep 不到 translation_missing。只跑改动面单元例一次。

## 交板
上线后 `_work/给验收位_<日期>.md` 一行。
