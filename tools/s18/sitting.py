# S18 一段派单生成器:入口卡全文 + 固定说明 + 回报落盘行。
# 用法:python sitting.py <轮号> <代理名> [--请求数 N] [--续段] [--base URL]
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORK = os.path.join(REPO, "_work", "临时", "S18")
CARDS = {
    "ds": os.path.join(REPO, "docs", "入口", "AI人间_修仙_zh-CN.md"),
    "gf": os.path.join(REPO, "docs", "入口", "AI人间_修仙_zh-CN.md"),
    "lu": os.path.join(REPO, "docs", "入口", "AIHumanWorld_fantasy_en.md"),
}
SKINS = {"ds": ("xiuxian", "wuxia"), "gf": ("xiuxian", "wuxia"), "lu": ("fantasy", "scifi")}
NOTE = (
    "本单是 AI 人间 0 号窗派的 S18 测试员活:任务就是照上面的卡,用固定脚本 `play.py` 代替 curl 发请求、玩一段;"
    "跑固定脚本、读回包、按卡上的规则选下一步,都是本单要做的事。本段最多 {n} 次请求。{enter}。"
    "结束时最终回复只写:做了哪几步、你认为自己现在在哪 / 有多少币 / 手上有什么任务。"
)


def family(agent):
    m = re.fullmatch(r"(ds|gf|lu)[1-9]\d*", agent)
    return m.group(1) if m else None


def skin_of(agent, round_no):
    pair = SKINS[family(agent)]
    return pair[(int(agent[-1]) + round_no) % 2]


def build(round_no, agent, n, first, base):
    fam = family(agent)
    if fam is None:
        raise SystemExit(f"参数错:不认识的代理 {agent}")
    with open(CARDS[fam], encoding="utf-8") as f:
        card = f.read().rstrip("\n")
    skin = skin_of(agent, round_no)
    play = os.path.join(REPO, "tools", "s18", "play.py").replace("\\", "/")
    py = "C:/Users/Administrator/AppData/Local/Programs/Python/Python314/python.exe"
    base_arg = "" if base == "https://aihumanworld.org" else f" --base {base}"
    how = (
        f"\n\n## 本段怎么发请求\n\n解释器 `{py}`,脚本 `{play}`。"
        f"一条请求的形状:`\"{py}\" \"{play}\" {agent} <动词> '<JSON args>'{base_arg}`,"
        "例如 events 用 `'{{}}'`、look 用 `'{{}}'`、go 用 `'{{\"dir\":\"north\"}}'`。"
        "回包里的 `identity_code` 已由脚本存档并遮成 `<已存档>`,不要自己记录或复述码。"
        "请求数以本脚本的成功调用次数计,最多 {n} 次,到数即停。".format(n=n)
    )
    if first:
        enter = (
            f"首段先 `enter`(skin `{skin}`,参数 `{{\"args\":{{\"mode\":\"create\",\"skin\":\"{skin}\",\"door\":\"api\"}}}}`,"
            f"即命令里的 JSON args 写 `{{\"mode\":\"create\",\"skin\":\"{skin}\",\"door\":\"api\"}}`),之后各段不再 enter"
        )
    else:
        enter = "本段不发 `enter`(身份已在前段建立),直接从 `events` 开始"
    note = NOTE.format(n=n, enter=enter)
    out_path = os.path.join(WORK, "回报", f"{round_no}_{agent}.md").replace("\\", "/")
    return f"{card}{how}\n\n## 本段任务\n\n{note}\n\n回报落盘:{out_path}\n"


def write_order(round_no, agent, n, first, base):
    dest = os.path.join(WORK, "派单", f"{round_no}_{agent}.md")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8", newline="\n") as f:
        f.write(build(round_no, agent, n, first, base))
    return dest


def main(argv):
    n, first, base = 15, True, "https://aihumanworld.org"
    pos = []
    i = 0
    while i < len(argv):
        if argv[i] == "--请求数" and i + 1 < len(argv):
            n = int(argv[i + 1])
            i += 2
        elif argv[i] == "--续段":
            first = False
            i += 1
        elif argv[i] == "--base" and i + 1 < len(argv):
            base = argv[i + 1]
            i += 2
        else:
            pos.append(argv[i])
            i += 1
    if len(pos) != 2 or n < 1:
        sys.stderr.write("用法: python sitting.py <轮号> <代理名> [--请求数 N] [--续段] [--base URL]\n")
        return 2
    print(write_order(int(pos[0]), pos[1], n, first, base))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
