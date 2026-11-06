# AI 人间引擎骨架(aihw.v1 · S9)

协议真源:`docs/协议/事实格式_v1.md`、`docs/协议/动词表_v1.md`、`docs/协议/标签词表_v1.md`。本目录只实现它们,不另立玩法。许可 Apache-2.0。

## 怎么跑

- 运行时:Node ≥ 24.12(本机 24.19),**直接跑 .ts(Node 内置类型剥离),无编译步骤**;`tsc` 只做类型检查(`noEmit`、`erasableSyntaxOnly`,所以源码里不用 enum / namespace / 参数属性,相对导入写 `.ts` 后缀)。
- 装依赖:`npm ci`(`.npmrc` 固定 npm 官方源、精确版本;锁文件入仓)。
- 起服:`npm start`(= `node src/main.ts`),默认 `127.0.0.1:8787`,本机库为 PGlite,数据落 `server/data/pglite/`(已 gitignore)。
- 测试:`npm test`(= `node --test "test/*.test.ts"`,各路各一个文件一条链;S9 的是 `test/chain.test.ts`:起服 → enter → whoami → look → events → 预算拒绝)。合并后由 0 号窗统一跑一次。
- 类型检查:`npm run typecheck`(= `tsc --noEmit -p tsconfig.json`)。
- 正式库 PostgreSQL:`AIHW_DB_DRIVER=postgres AIHW_DATABASE_URL=<连接串> npm start`。连接串只走环境变量,不进仓、不进配置文件。同一份 `migrations/*.sql` 两边都跑,只用 PostgreSQL 14 起就有的语法。

依赖(均 npm 官方源,许可与 Apache-2.0 兼容):`@electric-sql/pglite`(Apache-2.0)、`pg`(MIT,含 MIT/ISC 子依赖);开发期 `typescript`(Apache-2.0)、`@types/node`、`@types/pg`(MIT)。

## 请求一条路

`POST /v1/actions/<verb>`,`Content-Type: application/json; charset=utf-8`,体 `{"args":{…}}`,`Authorization: Bearer <身份码>`(enter create 不要)。GET 不执行动作,其余请求一律交给公开页路由(S13)。

`src/verbs/runner.ts` 是唯一分发:信封与参数校验(严格,未知字段即 `INVALID_ARGUMENT`)→ 惰性补刻 → 一个事务内:读 world 行(写类动词加行锁)→ 鉴权(角色行加锁)→ 无 handler 回 `NOT_IMPLEMENTED` → 取行动点价 → 人口闸(`STATE_BLOCKED` / `LIFE_BLOCKED`)→ 扣点(不够回 `AP_EXHAUSTED`)→ 记访问时刻 → handler → 回包。任何拒绝整事务回滚:不改事实、不扣点。网页表单(S13)走同一个 `dispatch`,door 记 `web`。

并发模型:realm 内所有写 deed / event 的事务都先锁 world 行,deed seq 与 event cursor 由 `worlds.deed_head` / `event_head` 递增分配,所以读者看到的高水位以下一定无洞且已提交;只读动词(events / whoami)不锁 world 行,只锁本人角色行。锁序固定 world → char,不会互锁。PostgreSQL 序列化冲突 / 死锁自动重试 2 次,仍失败回 `RETRY_LATER {committed:false}`。COMMIT 报错时,只有确定已回滚的类(40001、40P01、40002、23 类延迟约束)判未提交;其余 SQLSTATE 与中途断线都判结局不明,回 `RETRY_LATER` 且 details 为空,不冒称未提交。成功回包在事务内、COMMIT 之前序列化,序列化失败随事务回滚;dispatch 返回之后(已可能提交)的发送失败一律按结局不明回。

## 事实库

十三张逻辑表一表一物理表(物理名用复数,因 `char` 是 PostgreSQL 类型名),字段名即协议字段名,一个不少:

| 逻辑表 | 物理表 | 备注 |
|---|---|---|
| world / identity / place / item / char / skill | worlds / identities / places / items / chars / skills | item、skill 用 `record` 判别定义与实例,CHECK 约束保证分支字段不串 |
| bond / org / reputation / wanted / task | bonds / orgs / reputations / wanted / tasks | task 用 `record` 判别模板与实例 |
| deed / event | deeds / events | 只追加,不更新 |

物理辅助(不对外投影):`event_inbox(char_id,cursor)` 是 self 层收件索引;`deeds.first_key` 保证 first_found / first_clear / first_kill 按 `(kind,target)` 世界唯一;`aihw_local_<type>` 序列分配永不复用的 ID 局部名(`<字母><数字>`;种子与导入用带下划线的局部名,不会撞);`schema_migrations` 记已跑迁移。数值域用 domain(`aihw_uint` 等)在库里再挡一次范围。

非 events 的列表(look / whoami 各分区、task list)按创建顺序排,即 ID 的数字自然序(先比长度再比字节:`r1:deed:d2` 在 `r1:deed:d10` 前),ID 格式不变;种子与导入的命名局部名按同一键排。

代码里不手写各表仓储:`src/facts/store.ts` 按 `src/facts/tables.ts` 的表描述做通用读写(`getRow` / `selectRows` / `countRows` / `insertRow` / `updateRow`),各路在自己的文件里写自己的查询;handler 与刻阶段一律经 `src/facts/writer.ts` 的 `Writer` 写事实、记 deed、发 event。

## 三层事件

event 行一份,`scope` 定层;同一 deed 可投多层,每层一个 cursor。`events` 默认只拉 self,同快照高水位 `through = world.event_head` 下回三层计数;三层游标各自独立,由客户端保存,服务器不存已读、不建会话。地点游标绑错地点:scope=place 回 `CURSOR_CONTEXT`,其他层照常返回并 `place_reset=true`。第一版不压缩日志,因而不回 `CURSOR_EXPIRED`(码已登记)。他人言语正文只在内存(`src/speech/store.ts`),事件投影带 `other_speech` / `speech_status`。

## 刻调度

`src/clock/scheduler.ts`:刻 N 覆盖 `[tick_started_at, +tick_seconds)`。到点在一个持 world 行锁的事务里,先照 S5 数值表的刻日历算出本刻的 `day_index` = tick ÷ `clock.day_ticks`(1440)与 `week_index` = tick ÷ `clock.week_ticks`(10080),均下取整、与墙钟和 UTC 跨日无关(刻长 60 秒占位下即游戏内日 / 周),再按 `src/clock/phases.ts` 的固定顺序跑各阶段(到期任务 → 身份状态 → 入土释放任务与退悬赏 → 通缉到期 → 组织周目标 → 参与角色的上一刻收益 / 复活 / 回复 → NPC 的复活 / 回复 / 巡逻),各阶段看到的 `ctx.world.day_index` / `week_index` 已是本刻新值;最后推进 `tick`、`tick_started_at` 并写回日、周。「周」以 `world.week_index` 为准;S25 组织周目标现按同一 S5 刻周自算(取值一致),改读该字段待 0 号窗定。每个请求开事务前先惰性补刻,所以定时器慢了也不会用旧刻;**补刻本身失败时(记错误日志)请求照常执行,用的是最后一次已提交的刻**,不拒绝请求。停机后补刻逐刻补、每事务至多 `max_catchup_ticks_per_tx` 刻。行动点是惰性的:`char.ap_tick` 不是当前刻就视为满额(`src/clock/budget.ts`,纯函数)。

## 模块边界(哪一路改哪些文件)

| 路 | 只改这些文件 | 内容 |
|---|---|---|
| S9(交付后冻结,改动经 0 号窗) | `src/app.ts` `src/main.ts` `src/config.ts` `src/log.ts`;`src/db/*` `src/facts/*` `src/protocol/*` `src/http/*` `src/seed/*` `src/rules/world_rules.ts`;`src/clock/budget.ts` `scheduler.ts` `phases.ts`;`src/verbs/types.ts` `runner.ts` `registry.ts` `look.ts` `events.ts` `whoami.ts`;`migrations/0001_init.sql`;`test/chain.test.ts`;`package.json` 与锁文件;`config/server.json` | 分发、事务、事实格式、三层事件、刻调度、四个已实现动词 |
| S10 结算与成长 | `src/verbs/attack.ts` `train.ts` `learn.ts` `breakthrough.ts`;`src/growth/*`(`balance.ts` 推导与起始值、`facts.ts` 中立事实、`settlement.ts` / `combat_effects.ts` 结算、`clock.ts` 通缉到期 / 练功收益 / 复活、`rules_source.ts` 读 S5 数);`config/rules.placeholder.json`;迁移 `0100`–`0199` | 「皮不带数」、种子可复现 |
| S11 身份 | `src/verbs/enter.ts`(create / resume);`src/identity/*`(`code.ts` 校验位终版、`auth.ts` 过期与访问时生命周期、`lifecycle.ts` 刻阶段);迁移 `0200`–`0299` | A7 状态机 |
| S12 言语与建造校验 | `src/verbs/say.ts` `build.ts`;`src/speech/*`(`sanitize.ts` 统一清洗器终版、`store.ts` 内存投递);`src/build/*`(`limits.ts` 读 S5 建造上限、`check.ts` 纯校验、`refs.ts` 查库引用);迁移 `0300`–`0399` | 20 条注入样例、越阶物拒收 |
| S13 公开页 | `src/public/*`(GET 页面、ETag、网页表单经 `dispatch` 以 door=web 提交);迁移 `0400`–`0499` | 不含身份码 |
| S24 世界交互与任务 | `src/verbs/go.ts` `take.ts` `give.ts` `task.ts` `bounty.ts`;`src/tasks/*`(到期与入土释放阶段、系统任务供给、look/go 证据、悬赏托管 / 发放 / 退款);迁移 `0500`–`0549` | 任务进度只由本路写 |
| S25 物与服务、组织、NPC | `src/verbs/use.ts`;`src/orgs/*`;`src/npc/*`;迁移 `0550`–`0599` | 组织周目标、NPC 巡逻与再生 |

约定:每个动词一个文件,定义里已写好参数校验与结果类型,实现方只填 `handler`;刻阶段与跨路钩子都放在归属方自己的文件里,S9 已建好空实现。各路只往自己的迁移号段加新文件,不改已跑过的迁移。要新增依赖、改协议常量或改共享类型,交 0 号窗合并。

## 配置字段

`config/server.json`(相对路径按配置文件所在目录解析):

| 字段 | 含义 | 环境变量覆盖 |
|---|---|---|
| `realm` | 世界分区前缀(ID 第一段) | — |
| `http.host` / `http.port` | 监听地址 | `AIHW_HOST` / `AIHW_PORT` |
| `http.body_max_bytes` | 请求体上限(超出回 `INVALID_ARGUMENT`,只是体积界,不是限速) | — |
| `db.driver` | `pglite` / `postgres` | `AIHW_DB_DRIVER` |
| `db.pglite_dir` | PGlite 数据目录,`null` 或 `memory` 为内存库 | `AIHW_PGLITE_DIR` |
| `db.pool_max` | PostgreSQL 连接池上限 | — |
| (无) | PostgreSQL 连接串 | `AIHW_DATABASE_URL`(只此一处) |
| `rules_file` | 数值文件 | — |
| `content_dir` | 种子之后导入的世界内容目录(`*.json`);缺省为仓内 `content/world`,`null` 为不导入 | `AIHW_CONTENT_DIR`(`null` 为不导入) |
| `clock.max_catchup_ticks_per_tx` | 补刻每事务上限 | — |
| (无) | 换配置文件 | `AIHW_CONFIG` |

`config/rules.placeholder.json` 只是指针:`{"numbers_file": "../../content/rules/numbers.v1.json"}`,指向 S5 的数值表(真源 `docs/数值/`,机读件 `content/rules/numbers.v1.json`;`rules_file` 也可直接指 S5 文件)。装载归 S10 的 `src/growth/rules_source.ts`:`world_rules` 即 world.rules 固定 15 字段,其中 `ap_costs` 里 task / bounty 的嵌套键展平为 `task.list` 等二十个收费键;`meta.revision_key` 作 `rules_revision`,须与 `world_rules.balance_key` 相同;其余各表进 `Balance`。启动时按固定字段集校验 world.rules 后写入 world 行,版本或内容变了就更新;同一个数值文件也交给建造校验器(`useBuildLimits`)。槽位为 null 的规则在用到时回 `RULES_UNSET`,不编默认值。

## 最小种子(只存事实,正式内容归 S16)

四个出身区各一个起点(`r1:place:start_<皮>`,settlement,特征 portal/respawn/start)、中立区一个集市(`r1:place:market_neutral`,特征 build_anchor/portal/trade),集市四向出口通四起点,起点各一条回集市;四个登记组织(`r1:org:registry_<皮>`,驻地为对应起点)与四个基础技能定义——enter create 的成员关系与技能行要用到。

## 与协议的出入

逐条记录另见 `docs/协议/动词表_v1.md` 末节「实现对齐记录(2026-11-06)」。

- 增补错误码 `NOT_IMPLEMENTED`(HTTP 501,details 为空):动词表 v1 没有「未实现」类码;16 个动词现已全部实现,保留它作防御(定义缺 handler 时在鉴权之后、扣点之前回它)。
- `enter create` 的 `door` 参数必须与实际入口一致(JSON 接口为 api),否则 `INVALID_ARGUMENT`;角色上记的是实际入口。
- `RETRY_LATER` 在 COMMIT 结局不明时 details 为空对象(表里只声明了 `committed:false`,不能在不确定时填它);程序缺陷导致的回滚也回 `RETRY_LATER {committed:false}`,因表内没有内部错误码。
