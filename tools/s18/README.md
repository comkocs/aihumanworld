# S18 两周代理跑测工具

解释器固定 `C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe`(下称 `PY`)。启动前须设置环境 `PYTHONUTF8=1`(如在 Git Bash 执行 `export PYTHONUTF8=1`),使子进程也继承 UTF-8 编码。只读 `server/`、`docs/`、`content/`;身份码与原始日志在 `D:/aihumanworld/_work/临时/S18/`(已 gitignore);日报在 `D:/aihumanworld/_work/S18/日报/`(要入仓,不含身份码)。

## 空跑(本机服,不对线上发请求)

```sh
cd D:/aihumanworld/server && AIHW_PGLITE_DIR=memory npm start
PY D:/aihumanworld/tools/s18/run_round.py --轮 1 --base http://127.0.0.1:8787 --只跑 ds1,lu1 --注入 1
PY D:/aihumanworld/tools/s18/report.py --日期 2026-11-06
```

跑完关掉本机服。`--只跑` 缩小名册,`--注入 1` 只发 1 条红队 `say`。

## 只补注入

红队每条注入需要移动才移动。行动点用尽(`AP_EXHAUSTED`)时读回包 `error.details.next_tick`(没有则读 `ap.next_tick`),等到下一刻(每刻 60 秒)再重试同一步,直到这条 `say` 成功;同一步连续 5 次失败才放弃,并在本轮结果里记一笔。一轮内多条按顺序发。

不派代理,只让红队把夹具里从起点起的若干条发出(文本仍取 `server/test/fixtures/s12_malicious_speech.json`,起点从 0 计):

```sh
PY D:/aihumanworld/tools/s18/run_round.py --轮 <号> --只注入 13 --注入起点 7
```

上面这条发第 8~20 条。正式跑自行加 `--base`;本机空跑才加 `--base http://127.0.0.1:8787`。

## 正式跑(线上,由 0 号窗启动)

```sh
PY D:/aihumanworld/tools/s18/loop.py --interval-hours 8 --days 14
```

名册 ds1–ds4、gf1–gf4、lu1–lu4。每天 3 轮,前 10 天每天首轮发 2 条注入,共 20 条。

## 停与续

`Ctrl-C` 即停。再跑同一条 `loop.py` 命令按 `_work/临时/S18/loop_state.json` 的已完成轮号续,不重复已完成的轮。

## 文件

| 件 | 作用 |
| --- | --- |
| `play.py` | 动作代发;码存 `_work/临时/S18/codes/<代理>.txt`,日志追加 `_work/临时/S18/logs/<代理>.jsonl` |
| `sitting.py` | 生成一段派单到 `_work/临时/S18/派单/<轮>_<代理>.md` |
| `run_round.py` | 跑一轮:派单、经 `派.sh` 起(同时最多 4 个,单段 20 分钟)、段后取 whoami、红队注入 |
| `loop.py` | 14 天循环,每轮后出日报 |
| `report.py` | 写 `_work/S18/日报/<日期>.md`,覆盖式,全文不含码 |
