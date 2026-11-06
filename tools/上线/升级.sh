#!/usr/bin/env bash
# 本机一键升级线上 aihumanworld.org(设计者 2026-11-07 原话 51「改直通」)。
# 用法: bash tools/上线/升级.sh [目标提交,缺省 HEAD]
# 做法:本机打 git bundle → 传到服务器 aihw 自己的目录 → fetch → 取目标版本的 deploy/upgrade.sh 执行
#      (备份、换版、自检、不过自动回退)→ 机外 curl 复核。
# 连接配置在本方 gitignore 目录 _work/临时/主机/aihw-us.conf(地址只在那里,不进仓、件、聊天);
# 输出里出现的 IP 一律替换成 <地址>。只登 aihw 账号,不碰同机其他项目。
set -euo pipefail
ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
CONF=${AIHW_SSH_CONF:-$ROOT/_work/临时/主机/aihw-us.conf}
HOST=${AIHW_SSH_HOST:-aihw-us}
SITE=${AIHW_SITE:-https://aihumanworld.org}
T=$(git -C "$ROOT" rev-parse --verify "${1:-HEAD}^{commit}")
git -C "$ROOT" merge-base --is-ancestor "$T" main || { echo "目标 ${T:0:7} 不在本地 main 上"; exit 2; }
[ -f "$CONF" ] || { echo "缺连接配置 $CONF"; exit 2; }
scrub() { sed -E 's/[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}/<地址>/g'; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
git -C "$ROOT" bundle create -q "$TMP/aihw.bundle" main
echo "传 bundle($(du -h "$TMP/aihw.bundle" | cut -f1))→ 目标 ${T:0:7}"
scp -q -F "$CONF" "$TMP/aihw.bundle" "$HOST:/var/lib/aihw/aihw.bundle" 2>&1 | scrub
ssh -F "$CONF" "$HOST" "cd /opt/aihw && git fetch -q /var/lib/aihw/aihw.bundle main && git show $T:deploy/upgrade.sh > /var/lib/aihw/upgrade.sh && bash /var/lib/aihw/upgrade.sh $T" 2>&1 | scrub

echo "机外复核:"
WANT=$(git -C "$ROOT" show "$T:content/rules/numbers.v1.json" | grep -o '"revision_key": *"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
GOT=$(curl -fsS --max-time 15 "$SITE/v1/verbs" | grep -o '"rules_revision":"[^"]*"' | head -1)
echo "  /v1/verbs $GOT(应为 $WANT)"
echo "  /v1/online total 行数 $(curl -fsS --max-time 15 "$SITE/v1/online" | grep -c '"total"')"
echo "  /start.md 首行 $(curl -fsS --max-time 15 "$SITE/start.md" | head -1)"
[ "$GOT" = "\"rules_revision\":\"$WANT\"" ] && echo "复核通过" || { echo "复核不符"; exit 1; }
