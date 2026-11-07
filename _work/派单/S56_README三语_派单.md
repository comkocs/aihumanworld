# S56 README 三语专业化(2026-11-07 13:2x,乙·中,builder-terra)

模型:GPT-6.1 Terra(builder-terra)。回报首行写模型名,≤40 行。
仓:`D:/aihumanworld`(本地 main)。不 git add / commit / push,收口由 0 号窗提交。只改 README,不写码。另有两位施工员同时在本仓改代码 / 入口卡 / 协议 / 文书,除下面三个 README 外的文件你都不碰。

## 需求
先读验收位派单全文(含末尾两段「补」——13:20 那段替前一段的「判据」与「不写完全支持」两句,以最新为准):`D:/aihumanworld/_work/派单/验收位_009_README三语专业化.md`。
仓要公开了,设计者等这单上了再去 GitHub 设置里切公开。这是对外门面:专业、属实、不夸大、不放假徽章。

## 改动面
- `README.md`(英文主件,改写)、`README.zh-CN.md`(中文,新建)、`README.ja.md`(日文,新建)。三件顶部同一行语言切换互链。
- 页头、开局一节、Supported platforms、Important Notice、其后各节,照派单「要的样子」1~7 与两段「补」。
- 平台清单以验收位调研件为准(只读):`D:/claudetest/_work/AI人间验收位/2026-11-07/平台调研_可接入清单.md`。
- 徽章只写仓里属实的:写之前自己核——Node 版本看 `server/package.json` 的 `engines`;TypeScript;PostgreSQL / PGlite 看 `server/package.json` 依赖;MCP 看 `server/src/mcp/`;协议版本看 `docs/协议/`;许可看 `LICENSE`、`LICENSE-CC-BY-4.0.txt`、`NOTICE`。徽章用 shields.io 静态徽章(`https://img.shields.io/badge/...`),不放 stars / downloads / trending 这类动态或假徽章;没有 logo 就不放图。
- 开局一句、MCP 地址、网页地址照派单原样(`https://aihumanworld.org/start.md`、`https://aihumanworld.org/mcp`、`https://aihumanworld.org/play`);续玩一行(短号 + 身份码,或短号 + 邮箱)。不写任何服务器 IP、私钥、令牌、邮箱、身份码实值。
- 现 README 里有的事实(How it works、Self-hosting `deploy/`、Repository layout、Protocol、License、Contributing、名称与标识不随许可授出)保留并理顺;`_work/` 只留一句「研发过程记录」,不展开内部窗口、派单、模型名。
- 日文请写自然的日文(不是机翻腔);三件内容对等,英文为准。

## 验收
- 三件都存在、顶部切换链接互通(相对链接 `README.md` / `README.zh-CN.md` / `README.ja.md`)。
- 每件第一节就是开局。
- 平台节每个点名的产品都能在调研件里找到依据;回报里列「产品 → 调研件行号」对照(只列点名的)。
- `grep -nE "[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|@[a-z0-9-]+\.(com|org)|sk-|ghp_" README*.md` 无命中(徽章 URL 里的版本号除外,逐条说明)。
- 不跑测试。

## 不碰
- 除 `README.md`、`README.zh-CN.md`、`README.ja.md` 外的一切文件;`LICENSE*`、`NOTICE` 只读。

## 回报
结论 / 三件各几行 / 徽章逐个依据 / 平台对照表 / 存疑处。

回报落盘:D:/aihumanworld/_work/回报/S56README三语_回报.md
