# S18 动作代发器:POST /v1/actions/<动词>,身份码只落 _work/临时/S18/codes,任何输出都遮码。
# 用法:python play.py <代理名> <动词> '<JSON args>' [--base URL]
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

TZ8 = timezone(timedelta(hours=8))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.path.join(REPO, "_work", "临时", "S18")
CODE_RE = re.compile(r"identity_code\"\s*:\s*\"[^\"]*\"")
DEFAULT_BASE = "https://aihumanworld.org"


def now_text():
    return datetime.now(TZ8).strftime("%Y-%m-%d %H:%M:%S")


def code_path(agent):
    return os.path.join(WORK, "codes", f"{agent}.txt")


def log_path(agent):
    return os.path.join(WORK, "logs", f"{agent}.jsonl")


def read_code(agent):
    p = code_path(agent)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return f.read().strip() or None


def save_code(agent, code):
    os.makedirs(os.path.dirname(code_path(agent)), exist_ok=True)
    with open(code_path(agent), "w", encoding="utf-8", newline="\n") as f:
        f.write(code)


def mask(text):
    return CODE_RE.sub('identity_code": "<已存档>"', text)


def post(base, verb, args, code):
    url = f"{base.rstrip('/')}/v1/actions/{verb}"
    data = json.dumps({"args": args}, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if code:
        headers["Authorization"] = f"Bearer {code}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    ms = round((time.perf_counter() - t0) * 1000)
    return status, raw, ms


def redact_args(args):
    """日志里的 args 去掉任何码样字段。"""
    if not isinstance(args, dict):
        return args
    out = {}
    for k, v in args.items():
        if "code" in k.lower():
            out[k] = "<已存档>"
        else:
            out[k] = v
    return out


def reserve_request(agent, round_no):
    """先原子占用一次额度,连不上也算一次请求尝试。"""
    order = os.path.join(WORK, "派单", f"{round_no}_{agent}.md")
    limit = 15
    if os.path.isfile(order):
        with open(order, encoding="utf-8") as f:
            limits = re.findall(r"本段最多 (\d+) 次请求。", f.read())
        if limits:
            limit = int(limits[-1])
    db = os.path.join(REPO, "_work", "临时", "S18请求限额.sqlite3")
    os.makedirs(os.path.dirname(db), exist_ok=True)
    with sqlite3.connect(db, timeout=30) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS counts (round INTEGER, agent TEXT, n INTEGER NOT NULL, PRIMARY KEY (round, agent))")
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT n FROM counts WHERE round = ? AND agent = ?", (round_no, agent)).fetchone()
        if row and row[0] >= limit:
            return False
        conn.execute("INSERT INTO counts VALUES (?, ?, 1) ON CONFLICT(round, agent) DO UPDATE SET n = n + 1", (round_no, agent))
    return True


def run(agent, verb, args, base, round_no=None, segment_request=False):
    # run_round 代取 whoami 和红队调用不占代理额度;代理自己的 whoami 带 --段请求。
    if agent != "red" and verb == "whoami" and not segment_request and args != {"section": "char"}:
        sys.stderr.write("参数错:代理请求须带 --段请求\n")
        return 2
    if agent != "red" and (verb != "whoami" or segment_request):
        if round_no is None:
            sys.stderr.write("参数错:代理请求须带 --轮\n")
            return 2
        if not reserve_request(agent, round_no):
            sys.stdout.write("本段请求已用完\n")
            return 1
    code = read_code(agent)
    status, raw, ms = post(base, verb, args, code)
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        body = None
    err_code = None
    if isinstance(body, dict):
        if body.get("ok") is False and isinstance(body.get("error"), dict):
            err_code = body["error"].get("code")
        result = body.get("result")
        if verb == "enter" and isinstance(result, dict) and result.get("identity_code"):
            save_code(agent, result["identity_code"])
    text = mask(raw.decode("utf-8", errors="replace"))
    os.makedirs(os.path.dirname(log_path(agent)), exist_ok=True)
    line = {
        "时刻": now_text(),
        "代理": agent,
        "动词": verb,
        "args": redact_args(args),
        "http": status,
        "错误码": err_code,
        "字节": len(raw),
        "耗时ms": ms,
        "轮": round_no,
    }
    with open(log_path(agent), "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")
    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0 if status < 400 else 1


def main(argv):
    base, round_no, segment_request = DEFAULT_BASE, None, False
    args_in = []
    i = 0
    while i < len(argv):
        if argv[i] == "--base" and i + 1 < len(argv):
            base = argv[i + 1]
            i += 2
        elif argv[i] == "--轮" and i + 1 < len(argv):
            round_no = int(argv[i + 1])
            i += 2
        elif argv[i] == "--段请求":
            segment_request = True
            i += 1
        else:
            args_in.append(argv[i])
            i += 1
    if len(args_in) != 3:
        sys.stderr.write("用法: python play.py <代理名> <动词> '<JSON args>' [--base URL]\n")
        return 2
    agent, verb, raw_args = args_in
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", agent) or not re.fullmatch(r"[a-z]{1,32}", verb):
        sys.stderr.write("参数错:代理名或动词不合法\n")
        return 2
    try:
        args = json.loads(raw_args)
    except json.JSONDecodeError as e:
        sys.stderr.write(f"参数错:args 不是 JSON:{e.msg}\n")
        return 2
    if not isinstance(args, dict):
        sys.stderr.write("参数错:args 必须是 JSON 对象\n")
        return 2
    try:
        return run(agent, verb, args, base, round_no, segment_request)
    except urllib.error.URLError as e:
        sys.stderr.write(f"连不上:{e.reason}\n")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
