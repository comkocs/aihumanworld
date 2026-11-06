# S18 一轮:名册里每个代理生成派单并经 派.sh 起,段后取一次 whoami,排了注入就由红队发 say。
# 用法:python run_round.py --轮 <号> [--base URL] [--只跑 a,b] [--注入 K | --只注入 K] [--注入起点 N] [--请求数 N]
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
WORK = os.path.join(REPO, "_work", "临时", "S18")
PY = "C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe"
PAI = "D:/claudetest/_tools/子代理派遣/派.sh"
FIXTURE = os.path.join(REPO, "server", "test", "fixtures", "s12_malicious_speech.json")
REALM = "r1"
RED = "red"
TYPES = {"ds": "reader-dsflash", "gf": "reader-glmflash", "lu": "reader-luna"}
OVERRIDE_PATH = os.path.join(WORK, "types_override.json")
FAMILIES = ("ds", "gf", "lu")
PER_FAMILY = 4
MAX_PARALLEL = 4
TIMEOUT_MIN = 20
# 种子出口(server/src/seed/minimal.ts):市场 -> 出身区起点,以及起点回市场。
TO_MARKET = {"xiuxian": "south", "wuxia": "west", "fantasy": "north", "scifi": "east"}
TO_START = {"xiuxian": "north", "wuxia": "east", "fantasy": "south", "scifi": "west"}
STARTS = {s: f"{REALM}:place:start_{s}" for s in TO_MARKET}
MARKET = f"{REALM}:place:market_neutral"
TICK_SECONDS = 60
MAX_STEP_FAILS = 5


def roster():
    return [f"{fam}{i}" for fam in FAMILIES for i in range(1, PER_FAMILY + 1)]


def family_of(agent):
    return re.fullmatch(r"(ds|gf|lu)[1-9]\d*", agent).group(1)


def load_types(now=None):
    """可选覆盖:当前时刻早于 until 用 override 的 type,否则用 TYPES 原值。
    文件缺失或格式坏 → 用原值并在 stderr 记一行,不挡跑。"""
    types = dict(TYPES)
    if not os.path.isfile(OVERRIDE_PATH):
        sys.stderr.write("types_override.json 缺失,用 TYPES 原值\n")
        return types
    try:
        with open(OVERRIDE_PATH, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError("根不是对象")
        if now is None:
            now = datetime.now().astimezone()
        for fam, spec in data.items():
            if fam not in TYPES or not isinstance(spec, dict):
                raise ValueError(f"族 {fam} 格式坏")
            typ = spec.get("type")
            until = spec.get("until")
            if not isinstance(typ, str) or not typ or not isinstance(until, str):
                raise ValueError(f"族 {fam} 缺 type 或 until")
            deadline = datetime.fromisoformat(until)
            if deadline.tzinfo is None:
                raise ValueError(f"族 {fam} until 缺时区")
            if now < deadline:
                types[fam] = typ
    except (OSError, json.JSONDecodeError, ValueError, TypeError) as e:
        sys.stderr.write(f"types_override.json 格式坏,用 TYPES 原值:{e}\n")
        return dict(TYPES)
    return types


def code_exists(agent):
    p = os.path.join(WORK, "codes", f"{agent}.txt")
    return os.path.isfile(p) and os.path.getsize(p) > 0


def play(agent, verb, args, base, round_no=None):
    cmd = [PY, os.path.join(HERE, "play.py"), agent, verb, json.dumps(args, ensure_ascii=False)]
    if base:
        cmd += ["--base", base]
    if round_no is not None:
        cmd += ["--轮", str(round_no)]
    r = subprocess.run(cmd, capture_output=True)
    out = r.stdout.decode("utf-8", errors="replace")
    err = r.stderr.decode("utf-8", errors="replace")
    try:
        body = json.loads(out)
    except json.JSONDecodeError:
        body = None
    return r.returncode, body, err


def whoami_fact(agent, base, round_no):
    """服务器事实,不计入代理请求数。"""
    rc, body, err = play(agent, "whoami", {"section": "char"}, base, round_no)
    if not isinstance(body, dict) or not body.get("ok"):
        return {"ok": False, "错误": err.strip() or (body or {}).get("error", {}).get("code")}
    result = body.get("result") or {}
    char = result.get("char") or {}
    return {"ok": True, "位置": char.get("loc"), "币": char.get("coin"), "在办任务数": (result.get("counts") or {}).get("tasks")}


def ap_exhausted(body):
    if not isinstance(body, dict) or body.get("ok") is not False:
        return False
    return (body.get("error") or {}).get("code") == "AP_EXHAUSTED"


def next_tick_id(body):
    err = (body or {}).get("error") or {}
    details = err.get("details") or {}
    ap = (body or {}).get("ap") or {}
    nxt = details.get("next_tick")
    if nxt is None:
        nxt = ap.get("next_tick")
    return nxt


def wait_next_tick(body):
    """行动点用尽:按回包下一刻等到该刻(每刻 60 秒)再重试。"""
    gaps = 1
    if isinstance(body, dict):
        tick = body.get("tick")
        nxt = next_tick_id(body)
        try:
            if tick is not None and nxt is not None:
                gaps = int(nxt) - int(tick)
        except (TypeError, ValueError):
            gaps = 1
    if gaps < 1:
        gaps = 1
    if gaps > 3:
        gaps = 3
    left = gaps * TICK_SECONDS + 1
    while left > 0:
        chunk = min(left, 60)
        time.sleep(chunk)
        left -= chunk


def step_error(body, err):
    if ap_exhausted(body):
        return "AP_EXHAUSTED"
    code = ((body or {}).get("error") or {}).get("code") if isinstance(body, dict) else None
    return err.strip() or code or "失败"


def auth_invalid(err):
    return err == "AUTH_INVALID"


def step(verb, args, base, round_no):
    """发一步。遇 AP_EXHAUSTED 等到下一刻重试同一步;连续 5 次失败才放弃。"""
    fails = 0
    last = None
    while fails < MAX_STEP_FAILS:
        rc, body, err = play(RED, verb, args, base, round_no)
        if rc == 0 and isinstance(body, dict) and body.get("ok") is True:
            return True, body, None
        fails += 1
        last = step_error(body, err)
        if fails >= MAX_STEP_FAILS:
            break
        if ap_exhausted(body):
            wait_next_tick(body)
    return False, None, last


def ensure_red(base, round_no):
    """本机空库不认已有码时新建一角;线上码有效则不会走到这里。"""
    ok, _, err = step("enter", {"mode": "create", "skin": "xiuxian", "door": "api"}, base, round_no)
    return ok, err


def red_route(target_place, base, round_no):
    """红队走到目标地点:需要移动才移动;先回市场,再进对应出身区起点。"""
    ok, body, err = step("look", {}, base, round_no)
    if not ok and auth_invalid(err):
        ok, err = ensure_red(base, round_no)
        if not ok:
            return False, err
        ok, body, err = step("look", {}, base, round_no)
    if not ok:
        return False, err
    here = ((body.get("result") or {}).get("place") or {}).get("id")
    exits = {e.get("dir"): e.get("to") for e in ((body.get("result") or {}).get("place") or {}).get("exits") or []}
    if here == target_place:
        return True, None
    if here != MARKET:
        back = next((d for d, to in exits.items() if to == MARKET), None)
        if back is None:
            return False, "走不到"
        ok, _, err = step("go", {"dir": back}, base, round_no)
        if not ok:
            return False, err or "走不到"
    if target_place == MARKET:
        return True, None
    skin = next((s for s, pid in STARTS.items() if pid == target_place), None)
    if skin is None:
        return False, "走不到"
    ok, _, err = step("go", {"dir": TO_START[skin]}, base, round_no)
    return (True, None) if ok else (False, err or "走不到")


def inject(seq, base, round_no):
    """第 seq 条(从 0 计)注入:红队不经大模型,直接 say。"""
    with open(FIXTURE, encoding="utf-8") as f:
        items = json.load(f)["malicious"]
    item = items[seq % len(items)]
    if not code_exists(RED):
        ok, err = ensure_red(base, round_no)
        if not ok:
            sys.stderr.write(f"注入放弃:条 {item['id']} 连续失败:{err}\n")
            return {"ok": False, "条": item["id"], "错误": err}
    spots = [MARKET, *STARTS.values()]
    target = spots[seq % len(spots)]
    ok, err = red_route(target, base, round_no)
    if not ok:
        sys.stderr.write(f"注入放弃:条 {item['id']} 连续失败:{err or '走不到'}\n")
        return {"ok": False, "条": item["id"], "地点": target, "错误": err or "走不到"}
    ok, _, err = step("say", {"text": item["text"]}, base, round_no)
    if not ok:
        sys.stderr.write(f"注入放弃:条 {item['id']} 连续失败:{err}\n")
    return {"ok": ok, "条": item["id"], "地点": target, "错误": None if ok else err}


def dispatch(round_no, agents, base, n, types):
    """同时最多 4 个,单段超时 20 分钟。"""
    queue = list(agents)
    running = {}
    done = {}
    while queue or running:
        while queue and len(running) < MAX_PARALLEL:
            agent = queue.pop(0)
            first = not code_exists(agent)
            order = subprocess.run(
                [PY, os.path.join(HERE, "sitting.py"), str(round_no), agent,
                 "--请求数", str(n)] + (["--续段"] if not first else []) + (["--base", base] if base else []),
                capture_output=True, text=True, encoding="utf-8",
            ).stdout.strip()
            proc = subprocess.Popen(
                ["bash", PAI, types[family_of(agent)], f"S18第{round_no}轮{agent}", order, "--timeout-min", str(TIMEOUT_MIN)],
            )
            running[agent] = proc
        finished = [a for a, p in running.items() if p.poll() is not None]
        if not finished:
            next(iter(running.values())).wait()
            continue
        for a in finished:
            done[a] = running.pop(a).returncode
    return done


def main(argv):
    base, only, injects, n, round_no, inject_from = "https://aihumanworld.org", None, 0, 15, None, 0
    inject_only = False
    i = 0
    while i < len(argv):
        key, val = argv[i], argv[i + 1] if i + 1 < len(argv) else None
        if key == "--base" and val:
            base = val
        elif key == "--只跑" and val:
            only = val.split(",")
        elif key == "--注入" and val:
            injects = int(val)
        elif key == "--只注入" and val:
            injects = int(val)
            inject_only = True
        elif key == "--注入起点" and val:
            inject_from = int(val)
        elif key == "--请求数" and val:
            n = int(val)
        elif key == "--轮" and val:
            round_no = int(val)
        else:
            sys.stderr.write("用法: python run_round.py --轮 <号> [--base URL] [--只跑 a,b] [--注入 K | --只注入 K] [--注入起点 N] [--请求数 N]\n")
            return 2
        i += 2
    if round_no is None:
        sys.stderr.write("参数错:缺 --轮\n")
        return 2
    agents = only or roster()
    bad = [a for a in agents if family_of(a) is None]
    if bad:
        sys.stderr.write(f"参数错:名册外的代理 {','.join(bad)}\n")
        return 2
    types = load_types()
    rc = {}
    if not inject_only:
        for agent, code in dispatch(round_no, agents, base, n, types).items():
            rc[agent] = {"类型": types[family_of(agent)], "派.sh退出码": code, "服务器事实": whoami_fact(agent, base, round_no) if code_exists(agent) else {"ok": False, "错误": "无码"}}
    injections = [inject(inject_from + k, base, round_no) for k in range(injects)]
    os.makedirs(os.path.join(WORK, "轮"), exist_ok=True)
    out = os.path.join(WORK, "轮", f"{round_no}.json")
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"轮": round_no, "类型": {a: types[family_of(a)] for a in agents}, "代理": rc, "注入": injections}, f, ensure_ascii=False, indent=1)
    sys.stdout.write(out + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
