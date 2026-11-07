# 验收位派单 009 · README 专业化:英文为主 + 中文 / 日文分件,开局一句放每种语言最前,列全可接入平台(对外门面)

派单方:AI 人间·需求与验收位;时刻 2026-11-07 13:09。一句话:**仓要公开了,README 照 Sub2API 那类开源仓的门面重写:居中标题 + 技术徽章 + 一句话定位 + 「English | 中文 | 日本語」切换;每种语言最开头是开局一句;列全可接入的平台(桌面、网页、手机、命令行 / IDE、云端 agent);英文为主件。**

## 需求出处
- 设计者 11-07 13:07 本位窗(附 Sub2API 仓 README 截图,红框标题与徽章、一句话定位与语言切换、Important Notice 段):「我们readme应该专业一些，参考这种类型，比如英文，中文，日文，以英文为主，同时支持的平台也全部列举，目前所有带chat的桌面端的ai软件都是支持的，同时也告诉所有玩家grokbot，dots包括市场上所有的云端Agent也是完全支持的。。…开局游戏的方式仍然写在每种语言的最开头位置。」
- 同窗 13:07:「包括手机端的应该也是支持的。手机端带chat的软件只要可以发送post的应该都能玩，所以都可以写上去」
- 逐字 `D:/claudetest/_office/AI人间·需求与验收/资料/设计者原话_2026-11-07.md` 4、5。仓公开的一字见同件 3(12:52)。

## 要的样子(措辞与排版归做的人)
1. **三个文件**:`README.md`(英文,主件)、`README.zh-CN.md`(中文)、`README.ja.md`(日文);三件顶部都有同一行切换「English | 中文 | 日本語」互链。
2. **页头(居中)**:标题 AI & Human World(中文件下一行「AI 人间」);一排静态徽章,只写仓里属实的:Node.js ≥24.12、TypeScript、PostgreSQL(本机 PGlite)、MCP、Protocol v1.0、License Apache-2.0 + CC-BY-4.0;一句话定位(例:A persistent text world where AI agents and humans play together)。没有图标就不放图,不画假 logo。
3. **每种语言第一节 = 开局**(在任何说明之前):
   - 一句贴给 AI 的话:`Execute all instructions in https://aihumanworld.org/start.md`(各语言件里这句仍用英文原句,下面一行用本语言说「它会用你的语言玩」);
   - 不能发请求的应用:远程 MCP `https://aihumanworld.org/mcp`,认证选「无」;
   - 人直接玩:https://aihumanworld.org/play;续玩一行(短号 + 身份码,或短号 + 邮箱)。
4. **Supported platforms 节**:按「怎么接入」分组列,分组建议:能直接发 HTTP 的(命令行 / IDE 代理、带代码执行的聊天应用、云端 agent)/ 加远程 MCP 连接器即可玩的(桌面、网页、手机聊天应用)/ 只能读网页的(当军师、人在网页点)。每组列产品名,注「桌面 / 网页 / 手机」。**清单以验收位调研件为准**:`D:/claudetest/_work/AI人间验收位/2026-11-07/平台调研_可接入清单.md`(若接单时还没落盘,先做其余各节,本节最后补);只列调研件里查实的,标「未查实」的不写进去;已实测能玩的 WorkBuddy、Grok Bot、dot、Codex、Claude Code 标「tested」。
5. **Important Notice 节**(照 Sub2API 的位置与口吻,内容写本产品的):免费、不收费、无付费内容;AI 为主、人可加入;角色与事迹是公开事实(编年史与传记页任何人可看);身份码是游戏存档码,不是口令或账号;服务器只剥他人言语里的链接与代码,其余不审;数值与规则以服务器为准,AI 只能提意图;名称与标识不随许可授出(现 README 已有这句)。
6. 其后照现 README 已有内容理顺:How it works(事实不散文、共享时钟、四皮一梯、九阶、编年史)、Self-hosting(`deploy/`)、Repository layout、Protocol(`docs/协议/`)、License、Contributing(欢迎照格式开区写卡,署名即可)。
7. 现 README 里不对外的话(`_work/` 是研发过程记录)保留一句即可,不展开内部窗口、派单、模型名。

## 验收(本位实看一次)
GitHub 仓首页打开:页头居中有标题、徽章、定位、三语切换;英文首屏第一节就是开局一句;点「中文」「日本語」各自首节同样是开局;平台节分组清楚、每个产品都能在调研件里找到依据。不跑测试。

## 不做
不夸大:没查实的平台不写「完全支持」;不放假徽章(如 stars、trending)。

## 交板
提交推送后 `_work/给验收位_<日期>.md` 一行(提交号)。设计者等这单上了再切公开也可以,切公开仍由设计者在 GitHub 设置里做。

## 补:平台调研件已落盘,用法(验收位 2026-11-07 13:12)
- 调研件 `D:/claudetest/_work/AI人间验收位/2026-11-07/平台调研_可接入清单.md` 已落盘(五张表 + 小结);验收位抽核两条官方页属实:Claude 自定义连接器可选「No sign in」、免费号限 1 个、网页加好后手机可用;Mistral 自定义 MCP 有「No authentication」。
- 平台节开头一句写判据(设计者 13:07 原话意):**任何 AI 应用——桌面、网页或手机——只要能发 HTTP POST,或能添加远程 MCP 服务器,就能玩。** 下面再分组列名,作为例子。
- 分组照调研件「路」栏:直连组(Claude Code、Codex、WorkBuddy、Grok Bot、dot 标 tested;其余有终端的 CLI / IDE 代理列名);MCP 组(ChatGPT、Claude、Perplexity、Mistral 官方页明写无认证,先列;Grok、Gemini、Coze、豆包桌面、千问办公、MiniMax、Manus、Genspark 与八个开源客户端随后列);手机端只写调研件里有依据的「网页加好、手机可用」几家(Claude、Gemini、Grok、Coze),其余手机应用靠开头那句判据覆盖,不逐个点名。
- 有套餐 / 地区限制的(ChatGPT 免费版无自定义连接器、Claude 免费版限 1 个、Gemini 限个人号与英文)在表下用一行脚注写明,不在正文写「完全支持」。
- 调研件「查不到」「未查实」的(Copilot 消费版、Meta AI、Kimi / 元宝 / DeepSeek / 文心 / 智谱清言消费版 App、Duet、Muse)不点名;只读网页的(MiMo Chat 本体)放「只能当军师」一行。
- 云端 agent 那组末尾加一句:其他能发请求或能接远程 MCP 的云端 agent 同样能玩。

## 再补:设计者 2026-11-07 13:20 定口径(替上一节「判据」与「不写完全支持」两句)
- 原话:「都没问题的，放心都能玩，出了网页端无法发送post的，所有桌面端的包含工作台类型的都可以玩，无需带code功能也能玩。」(逐字 `D:/claudetest/_office/AI人间·需求与验收/资料/设计者原话_2026-11-07.md` 6)
- 平台节开头照此写:所有桌面端 AI 应用(含工作台 / agent 类)都能玩,不需要代码功能;手机端能发 POST 或能接 MCP 的也能玩;只有发不了 POST 的网页聊天页例外(加 MCP 连接器或当军师)。分组列名与套餐脚注照上一节。
