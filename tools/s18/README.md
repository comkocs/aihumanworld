# S18 两周代理跑测工具

解释器固定 `C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe`(下称 `PY`)。只读 `server/`、`docs/`、`content/`;身份码与原始日志在 `D:/aihumanworld/_work/临时/S18/`(已 gitignore);日报在 `D:/aihumanworld/_work/S18/日报/`(要入仓,不含身份码)。

## 空跑(本机服,不对线上发请求)

```sh
cd D:/aihumanworld/server && AIHW_PGLITE_DIR=memory npm start
PY D:/aihumanworld/tools/s18/run_round.py --轮 1 --base http://127.0.0.1:8787 --只跑 ds1,lu1 --注入 1
PY D:/aihumanworld/tools/s18/report.py --日期 2026-11-06
```

跑完关掉本机服。`--只跑` 缩小名册,`--注入 1` 只发 1 条红队 `say`。

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
