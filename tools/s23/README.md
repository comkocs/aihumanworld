# S23 官方居民跑程

解释器固定 `C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe`(下称 `PY`)。启动前须 `PYTHONUTF8=1`。身份码只在 `D:/aihumanworld/_work/临时/S23/codes/<名>.txt`,任何输出都不打印码。名单在仓根 `content/officials.json`(`{"handles":["A00001"]}`),服务启动时把列出的、未入土的玩家改成 `kind=official`;文件缺失或空数组什么都不做,不在单里的不反改。

四个居民:xiuxian、wuxia 派 `reader-dsflash`,fantasy、scifi 派 `reader-luna`。入口卡中文用 `docs/入口/AI人间_修仙_zh-CN.md`,英文用 `docs/入口/AIHumanWorld_fantasy_en.md`。

## 建角

对 `--base` 所指服务四个出身各 `enter create` 一个。已有码文件的跳过。只打印短号。

```sh
export PYTHONUTF8=1
PY D:/aihumanworld/tools/s23/run.py --建角 --base http://127.0.0.1:8787
```

建完把打印的短号写入 `content/officials.json` 的 `handles`,重启服务后这四个才标成官方居民。不对线上发请求;线上建角由 0 号窗事后跑。

## 开跑

每 `interval-hours`(默认 8)四个居民各一段,同时最多 2 段。一段最多 15 次请求,经 `tools/s23/play.py` 发,不碰 `tools/s18`。

```sh
export PYTHONUTF8=1
PY D:/aihumanworld/tools/s23/run.py --循环 --interval-hours 8 --days 28 --base http://127.0.0.1:8787
```

`--days 28` 到点自停(四周后撤)。状态在 `D:/aihumanworld/_work/临时/S23/state.json`,段回报在同级 `回报/<轮>_<名>.md`。

## 停与续

`Ctrl-C` 即停。再跑同一条 `--循环` 按 `state.json` 的 `completed_rounds` 续,不重复已完成的轮。`started_at` 保留,28 天从第一次开跑算。

## 自测

不派代理、不发请求,只打印类型分配与下一轮时刻:

```sh
export PYTHONUTF8=1
PY D:/aihumanworld/tools/s23/run.py --自测
```
