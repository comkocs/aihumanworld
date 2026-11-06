# S23 官方居民跑程。
#   python run.py --建角 --base <URL>
#   python run.py --循环 [--interval-hours 8] [--days 28] [--base URL]
#   python run.py --自测
# 身份码只落 _work/临时/S23/codes,任何输出都不打印码。不 import tools/s18。
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

TZ8 = timezone(timedelta(hours=8))
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.join(REPO, "_work", "临时", "S23")
CODES = os.path.join(WORK, "codes")
STATE = os.path.join(WORK, "state.json")
ORDERS = os.path.join(WORK, "派单")
REPORTS = os.path.join(WORK, "回报")
PLAY = os.path.join(HERE, "play.py")
TEMPLATE = os.path.join(HERE, "sitting.md")
DISPATCH = "D:/claudetest/_tools/子代理派遣/派.sh"
PY = "C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe"
CODE_RE = re.compile(r"AIHW-[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){4}-[0-9A-HJKMNP-TV-Z]{2}", re.I)
HANDLE_RE = re.compile(r"^[A-Z][0-9]{5,7}$")

# 四个出身区各一个居民。类型两个 reader-dsflash、两个 reader-luna。
RESIDENTS = [
    {"名": "xiuxian", "皮": "xiuxian", "皮名": "修仙", "类型": "reader-dsflash", "入口": "docs/入口/AI人间_修仙_zh-CN.md", "英文": False},
    {"名": "wuxia", "皮": "wuxia", "皮名": "武侠", "类型": "reader-dsflash", "入口": "docs/入口/AI人间_修仙_zh-CN.md", "英文": False},
    {"名": "fantasy", "皮": "fantasy", "皮名": "魔幻", "类型": "reader-luna", "入口": "docs/入口/AIHumanWorld_fantasy_en.md", "英文": True},
    {"名": "scifi", "皮": "scifi", "皮名": "科幻", "类型": "reader-luna", "入口": "docs/入口/AIHumanWorld_fantasy_en.md", "英文": True},
]
MAX_PARALLEL = 2


def out(text):
    """写 stdout 缓冲,不经控制台代码页(PYTHONUTF8=1 时为 UTF-8)。"""
    sys.stdout.buffer.write(text.encode("utf-8"))
    if not text.endswith("\n"):
        sys.stdout.buffer.write(b"\n")


def err(text):
    sys.stderr.buffer.write(text.encode("utf-8"))
    if not text.endswith("\n"):
        sys.stderr.buffer.write(b"\n")


def now():
    return datetime.now(TZ8)


def mask(text):
    return CODE_RE.sub("<已存档>", text)


def code_file(name):
    return os.path.join(CODES, f"{name}.txt")


def has_code(name):
    p = code_file(name)
    return os.path.isfile(p) and os.path.getsize(p) > 0


def load_state():
    if not os.path.isfile(STATE):
        return {"completed_rounds": 0, "started_at": None, "handles": {}}
    with open(STATE, encoding="utf-8") as f:
        data = json.load(f)
    data.setdefault("completed_rounds", 0)
    data.setdefault("handles", {})
    return data


def save_state(state):
    os.makedirs(WORK, exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp, STATE)


def post_enter(base, skin):
    url = f"{base.rstrip('/')}/v1/actions/enter"
    body = json.dumps({"args": {"mode": "create", "skin": skin, "door": "api"}}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    return status, raw


def create_one(base, resident, state):
    name = resident["名"]
    if has_code(name):
        handle = state["handles"].get(name, "")
        out(f"跳过 {name} 已有码 短号 {handle}")
        return 0
    status, raw = post_enter(base, resident["皮"])
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        err(f"建角失败 {name} http {status} 回包不是 JSON")
        return 1
    result = body.get("result") if isinstance(body, dict) else None
    code = result.get("identity_code") if isinstance(result, dict) else None
    char = result.get("char") if isinstance(result, dict) else None
    handle = char.get("handle") if isinstance(char, dict) else None
    if status >= 400 or not code or not handle or not HANDLE_RE.match(handle):
        err_code = ""
        if isinstance(body, dict) and isinstance(body.get("error"), dict):
            err_code = str(body["error"].get("code") or "")
        err(f"建角失败 {name} http {status} {err_code}")
        return 1
    os.makedirs(CODES, exist_ok=True)
    with open(code_file(name), "w", encoding="utf-8", newline="\n") as f:
        f.write(code)
    state["handles"][name] = handle
    save_state(state)
    out(f"建角 {name} 短号 {handle}")
    return 0


def cmd_create(base):
    state = load_state()
    rc = 0
    for resident in RESIDENTS:
        try:
            rc = create_one(base, resident, state) or rc
        except urllib.error.URLError as e:
            err(f"连不上:{e.reason}")
            return 1
    return rc


def fill_order(resident, round_no, base, handle):
    with open(TEMPLATE, encoding="utf-8") as f:
        text = f.read()
    report = os.path.join(REPORTS, f"{round_no}_{resident['名']}.md").replace("\\", "/")
    repl = {
        "名": resident["名"],
        "轮": str(round_no),
        "短号": handle or "(建角后见 state.json)",
        "皮": resident["皮"],
        "皮名": resident["皮名"],
        "入口卡": os.path.join(REPO, resident["入口"]).replace("\\", "/"),
        "PY": PY,
        "PLAY": PLAY.replace("\\", "/"),
        "BASE": base,
        "回报": report,
    }
    for k, v in repl.items():
        text = text.replace("{{" + k + "}}", v)
    if CODE_RE.search(text):
        raise RuntimeError("派单正文出现身份码,已中止")
    os.makedirs(ORDERS, exist_ok=True)
    path = os.path.join(ORDERS, f"{round_no}_{resident['名']}.md")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return path


def next_round_at(interval_hours, state):
    started = state.get("started_at")
    if not started:
        return now()
    start = datetime.fromisoformat(started)
    done = int(state.get("completed_rounds") or 0)
    return start + timedelta(hours=interval_hours * done)


def dispatch_one(resident, order_path):
    title = f"S23官方居民{resident['名']}"
    cmd = ["bash", DISPATCH, resident["类型"], title, order_path.replace("\\", "/"), "--timeout-min", "20"]
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")


def run_round(round_no, base, state):
    jobs = []
    for resident in RESIDENTS:
        handle = state.get("handles", {}).get(resident["名"], "")
        path = fill_order(resident, round_no, base, handle)
        jobs.append((resident, path))
    out(f"第 {round_no} 轮 派出 {len(jobs)} 段 同时最多 {MAX_PARALLEL}")
    pending = list(jobs)
    running = []
    failed = 0
    while pending or running:
        while pending and len(running) < MAX_PARALLEL:
            resident, path = pending.pop(0)
            proc = dispatch_one(resident, path)
            running.append((resident, proc))
        if not running:
            break
        resident, proc = running.pop(0)
        out, _ = proc.communicate()
        text = mask(out or "")
        out(f"--- {resident['名']} 退出 {proc.returncode} ---")
        out(text.rstrip("\n"))
        if proc.returncode != 0:
            failed += 1
    return failed


def cmd_loop(base, interval_hours, days):
    state = load_state()
    if not state.get("started_at"):
        state["started_at"] = now().isoformat(timespec="seconds")
        save_state(state)
    cap = int(days * 24 / interval_hours)
    while True:
        state = load_state()
        done = int(state.get("completed_rounds") or 0)
        if done >= cap:
            out(f"已满 {days} 天 {done} 轮,自停")
            return 0
        start = datetime.fromisoformat(state["started_at"])
        if (now() - start).total_seconds() >= days * 24 * 3600 and done >= cap:
            out("四周已到,自停")
            return 0
        nxt = next_round_at(interval_hours, state)
        announced = False
        while True:
            wait = (nxt - now()).total_seconds()
            if wait <= 0:
                break
            if not announced:
                out(f"下一轮 {done + 1} 在 {nxt.strftime('%Y-%m-%d %H:%M')} 再睡 {int(wait)} 秒")
                announced = True
            time.sleep(min(wait, 60))
        round_no = done + 1
        failed = run_round(round_no, base, state)
        state = load_state()
        state["completed_rounds"] = round_no
        save_state(state)
        if failed:
            err(f"第 {round_no} 轮有 {failed} 段非零退出,状态已记,下轮续")
        if round_no >= cap:
            out(f"已满 {days} 天,自停")
            return 0


def cmd_selftest(interval_hours, days):
    """不派代理、不发请求:打印四个居民的类型分配与下一轮时刻。"""
    state = load_state()
    if not state.get("started_at"):
        state = dict(state)
        state["started_at"] = now().isoformat(timespec="seconds")
    nxt = next_round_at(interval_hours, state)
    done = int(state.get("completed_rounds") or 0)
    cap = int(days * 24 / interval_hours)
    out(f"已完成轮 {done} 上限 {cap} 天 {days} 间隔小时 {interval_hours}")
    out(f"下一轮 {done + 1} 时刻 {nxt.strftime('%Y-%m-%d %H:%M')}")
    for resident in RESIDENTS:
        handle = state.get("handles", {}).get(resident["名"], "")
        out(f"{resident['名']} 皮 {resident['皮']} 类型 {resident['类型']} 短号 {handle or '-'}")
    ds = sum(1 for r in RESIDENTS if r["类型"] == "reader-dsflash")
    lu = sum(1 for r in RESIDENTS if r["类型"] == "reader-luna")
    out(f"类型分配 reader-dsflash {ds} reader-luna {lu} 同时最多 {MAX_PARALLEL}")
    return 0


def main(argv):
    base = "http://127.0.0.1:8787"
    interval = 8.0
    days = 28
    mode = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--建角":
            mode = "create"
            i += 1
        elif a == "--循环":
            mode = "loop"
            i += 1
        elif a == "--自测":
            mode = "self"
            i += 1
        elif a == "--base" and i + 1 < len(argv):
            base = argv[i + 1]
            i += 2
        elif a == "--interval-hours" and i + 1 < len(argv):
            interval = float(argv[i + 1])
            i += 2
        elif a == "--days" and i + 1 < len(argv):
            days = int(argv[i + 1])
            i += 2
        else:
            err(f"未知参数:{a}")
            return 2
    if interval <= 0 or days <= 0:
        err("间隔与天数须为正")
        return 2
    if mode == "create":
        return cmd_create(base)
    if mode == "loop":
        return cmd_loop(base, interval, days)
    if mode == "self":
        return cmd_selftest(interval, days)
    err("用法: python run.py --建角|--循环|--自测 [--base URL] [--interval-hours 8] [--days 28]")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
