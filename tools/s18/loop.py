# S18 两周循环:每 --interval-hours 小时一轮,每轮后出日报;按已完成轮号续,不重复。
# 用法:python loop.py [--interval-hours 8] [--days 14] [--base URL] [--只跑 a,b] [--每天注入 N]
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.join(REPO, "_work", "临时", "S18")
STATE = os.path.join(WORK, "loop_state.json")
PY = "C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe"
TZ8 = timezone(timedelta(hours=8))
ROUNDS_PER_DAY = 3


def now():
    return datetime.now(TZ8)


def sleep_until(moment):
    """分段睡,单次不超过 240 秒(D9-648 ④)。"""
    while True:
        left = (moment - now()).total_seconds()
        if left <= 0:
            return
        time.sleep(min(left, 240))


def load_state():
    if not os.path.isfile(STATE):
        return {"已完成轮": [], "注入已发": 0}
    with open(STATE, encoding="utf-8") as f:
        return json.load(f)


def save_state(state):
    os.makedirs(WORK, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)


def run_py(script, args):
    r = subprocess.run([PY, os.path.join(HERE, script), *args])
    return r.returncode


def main(argv):
    interval, days, base, only, per_day = 8.0, 14, None, None, 2
    i = 0
    while i < len(argv):
        key, val = argv[i], argv[i + 1] if i + 1 < len(argv) else None
        if key == "--interval-hours" and val:
            interval = float(val)
        elif key == "--days" and val:
            days = int(val)
        elif key == "--base" and val:
            base = val
        elif key == "--只跑" and val:
            only = val
        elif key == "--每天注入" and val:
            per_day = int(val)
        else:
            sys.stderr.write("用法: python loop.py [--interval-hours 8] [--days 14] [--base URL] [--只跑 a,b] [--每天注入 N]\n")
            return 2
        i += 2
    total = days * ROUNDS_PER_DAY
    state = load_state()
    done = set(state["已完成轮"])
    for k in range(1, total + 1):
        if k in done:
            continue
        nxt = state.get("下一轮最早")
        if nxt:
            sleep_until(datetime.fromisoformat(nxt))
        injects = per_day if (k - 1) % ROUNDS_PER_DAY == 0 and (k - 1) // ROUNDS_PER_DAY < 10 else 0
        args = ["--轮", str(k), "--注入", str(injects), "--注入起点", str(state["注入已发"])]
        if base:
            args += ["--base", base]
        if only:
            args += ["--只跑", only]
        if run_py("run_round.py", args) != 0:
            sys.stderr.write(f"第 {k} 轮失败,停在这里;再跑同一条命令即从本轮续\n")
            return 1
        state["已完成轮"].append(k)
        state["注入已发"] += injects
        state["下一轮最早"] = (now() + timedelta(hours=interval)).isoformat(timespec="seconds")
        save_state(state)
        day = now().strftime("%Y-%m-%d")
        if run_py("report.py", ["--日期", day]) != 0:
            sys.stderr.write(f"第 {k} 轮日报失败\n")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
