# AI 人间部署手册(S17a)

上机由 Panedesk 0 号窗照本件施工。件里没有地址、口令、连接串,一律用占位与环境变量(借机六条第 6 条)。每一步都标了「照做」或「当场定」,当场定的事汇总在文末。

命令都以仓根在 `/opt/aihw` 为例;服务入口 `npm start` = `node src/main.ts`(server/package.json),Node 直接跑 .ts,无编译步骤。

## 1. 前置

- Node ≥ 24.12(server/package.json 的 `engines`)。`node --version` 核对。
- PostgreSQL ≥ 14(迁移只用 14 起就有的语法,server/README.md)。`psql --version` 核对。
- 反向代理:机上已有 nginx 走 §8.1,没有走 §8.2(Caddy)。
- 磁盘配额:开工时定,填这里 → **磁盘配额:____**(借机六条第 2 条)。

## 2. 建系统账号与目录

独立账号,不给 sudo,不进 docker 等特权组,读不到 Panedesk 的仓、密钥与 CI 用户(借机六条第 3 条)。

```
useradd --system --create-home --home-dir /var/lib/aihw --shell /usr/sbin/nologin aihw
mkdir -p /opt/aihw /etc/aihw /var/log/aihw /var/backups/aihw
chown aihw:aihw /var/lib/aihw /var/log/aihw /var/backups/aihw
```

核对: `id aihw` 的组列表里只有 `aihw`;`sudo -l -U aihw` 应无授权。

## 3. 取代码与装依赖

在 `/opt/aihw` 检出本仓(地址按 Panedesk 侧已有的取法,不写在这里)。然后:

```
cd /opt/aihw/server
npm ci
```

`npm ci` 照锁文件装,`.npmrc` 固定官方源。不要 `npm install`。

## 4. 建库与库账号

两种都给,开工时二选一(借机六条第 4 条)。库名、账号名用 `aihw` / `aihw_app`,口令当场生成,只进 `/etc/aihw/aihw.env` 与 `~aihw/.pgpass`,不进本手册。

### 4.1 共用本机已有的 PostgreSQL 实例

用实例的管理账号进 psql 执行:

```
CREATE ROLE aihw_app LOGIN PASSWORD '<库口令>';
CREATE DATABASE aihw OWNER aihw_app;
REVOKE ALL ON DATABASE aihw FROM PUBLIC;
```

确认 `aihw_app` 没有 SUPERUSER / CREATEDB / CREATEROLE。连接走 `127.0.0.1`,不走 peer 认证,这样口令只在环境文件里。

### 4.2 独立 PostgreSQL 实例

本机另起一个实例(独立端口、独立数据目录),监听只绑本机回环。端口当场定,填这里 → **独立实例端口:____**。建库语句与 4.1 相同,只是连到新实例上执行。

两种写法的差别只在 `AIHW_DATABASE_URL` 的主机与端口:共用写 `127.0.0.1:5432`,独立写 `127.0.0.1:<上面临时定的端口>`。

## 5. 环境变量文件

```
cp /opt/aihw/deploy/aihw.env.example /etc/aihw/aihw.env
chown aihw:aihw /etc/aihw/aihw.env
chmod 600 /etc/aihw/aihw.env
```

编辑 `/etc/aihw/aihw.env`,把 `AIHW_DATABASE_URL=<连接串>` 换成真实串,形如 `postgres://aihw_app:<库口令>@127.0.0.1:<端口>/aihw`。口令里有 `@ : /` 等字符先做百分号编码。其余变量的含义见 `aihw.env.example`,与 server/README.md「配置字段」一一对应。

`chmod` 之后再核一次:`stat -c %a /etc/aihw/aihw.env` 应为 `600`。

## 6. 首启:迁移与内容导入

不需要单独的迁移命令。`src/app.ts` 启动顺序是:开库 → 跑 `migrations/*.sql`(已跑过的记在 `schema_migrations`,不重跑)→ 种子 → 导入 `content/world/*.json`。所以第一次 `systemctl start aihw`(§7)就是首启。

想先手动看一遍再交给 systemd 时,用账号自己跑一次前台:

```
cd /opt/aihw/server
set -a; . /etc/aihw/aihw.env; set +a
npm start
```

日志出现 `migrations applied` 与 `world ready` 即成,Ctrl-C 停掉再走 §7。`content_dir` 缺省指向仓内 `content/world`,不用改;想跳过导入才把 `AIHW_CONTENT_DIR=null`。

## 7. systemd

```
cp /opt/aihw/deploy/aihw.slice /etc/systemd/system/aihw.slice
cp /opt/aihw/deploy/aihw.service /etc/systemd/system/aihw.service
systemctl daemon-reload
systemctl enable --now aihw.service
```

单元里已写: `User=aihw`、`Slice=aihw.slice`、`CPUQuota=400%`、`MemoryMax=4G`、`CPUWeight=50`、`IOWeight=50`、`ProtectSystem=strict`。slice 独立,不进 `panedesk-ci` 与 `user-1000`。

核对:`systemctl status aihw` 为 active;`systemctl show aihw -p Slice -p CPUQuotaPerSecUSec -p MemoryMax` 看得到 slice 与上限。

## 8. 反向代理与 TLS

域名 `aihumanworld.org`,A 记录已指向本机。服务只听 `127.0.0.1:8787`,对外只走 443。

### 8.1 机上已有 nginx

`deploy/nginx-site.conf.example` 放进 `sites-available`,软链到 `sites-enabled`,证书路径按本机现状改(件里写的是 certbot 默认路径)。然后:

```
nginx -t && systemctl reload nginx
```

### 8.2 机上没有 nginx,用 Caddy

```
cp /opt/aihw/deploy/Caddyfile.example /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy 自己申请与续期证书,不用另放证书文件。

## 9. 每日备份与保留

`deploy/backup.sh`,用法 `backup.sh <备份目录> <保留天数>`。连接只走 `PGHOST` `PGPORT` `PGUSER` `PGDATABASE`,口令放 `~aihw/.pgpass`(权限 600),脚本里没有口令。

保留天数当场定,填这里 → **备份保留天数:____**。

每天跑一次(用 aihw 的 crontab,或另写一个定时器,当场选):

```
PGHOST=127.0.0.1 PGPORT=<端口> PGUSER=aihw_app PGDATABASE=aihw \
  /opt/aihw/deploy/backup.sh /var/backups/aihw <保留天数>
```

恢复用 `pg_restore --no-owner --dbname=aihw <转储文件>`,先停服务再进新库。

## 10. 日志

服务只往 stdout / stderr 写 JSON 行(src/log.ts),由 journald 收,不另写文件:

```
journalctl -u aihw -n 100 --no-pager
```

日志不含请求体、请求头、身份码(src/log.ts 头注释)。保留期用 journald 现有配置,不在本单元另定。

## 11. 升级与回滚

升级:

```
systemctl stop aihw
cd /opt/aihw && git pull --ff-only   # 取法照 §3,此处示意
cd /opt/aihw/server && npm ci
systemctl start aihw
```

新迁移在启动时自动跑,旧迁移不重跑、不改。

回滚:停服务,`git checkout <上一版>`,再 `npm ci`,起服务。已跑过的迁移不会自动撤回;数据库退回上一版靠 §9 的转储用 `pg_restore` 恢复。所以升级前先手跑一次 §9。

## 12. 压爆后迁独立 VPS

触发:内存耗尽或 Panedesk 的 CI 明显变慢,当天迁(借机六条第 5 条)。支出由设计者定。

1. 备份:在旧机跑 §9,确认转储文件可被 `pg_restore --list` 读出。
2. 新机装:新 VPS 上照 §1 至 §8 整套做一遍(独立实例,不存在共用问题)。
3. 恢复:新机停着服务,`pg_restore` 进新库,再 `systemctl start aihw`。
4. 改 DNS:把 `aihumanworld.org` 的 A 记录改到新机地址,等解析生效后旧机 `systemctl disable --now aihw`。旧库保留到下一次备份周期再清。

## 13. 上机后验收(只做一次)

1. 公开页可读:`curl -fsS https://aihumanworld.org/chronicle` 返回 markdown。
2. enter 拿码: `POST /v1/actions/enter`,`Content-Type: application/json; charset=utf-8`,体 `{"args":{"mode":"create","skin":"wuxia","door":"api"}}`,响应里有 `identity_code`。身份码只这一次出现,不进日志、不进网址。
3. events 通:带 `Authorization: Bearer <身份码>` `POST /v1/actions/events`,体 `{"args":{}}`,返回 2xx。
4. look 通:同样的头 `POST /v1/actions/look`,体 `{"args":{}}`,返回 2xx。

四项过了即收,不重复跑。

## 留给 Panedesk 0 号窗当场定

1. 磁盘配额(§1)。
2. 共用已有 PostgreSQL 还是独立实例;独立的话端口是多少(§4)。
3. 备份保留天数,以及用 crontab 还是 systemd 定时器(§9)。
4. 反向代理走 nginx 还是 Caddy;nginx 的证书路径(§8)。
5. 代码检出的具体取法(§3)。
6. 迁 VPS 的支出(§12,设计者定)。
