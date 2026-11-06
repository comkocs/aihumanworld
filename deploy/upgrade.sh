#!/usr/bin/env bash
# AI 人间线上升级(服务器端)。本方直做,设计者 2026-11-07 02:0x 原话 51「改直通…自己有自己的文件夹」。
# 在服务器上以 aihw 账号运行;通常不手调,由本机 tools/上线/升级.sh 传 bundle 后取目标版本的本件执行:
#   git show <目标>:deploy/upgrade.sh > /var/lib/aihw/upgrade.sh && bash /var/lib/aihw/upgrade.sh <目标>
# 步骤:手跑一次备份(aihw-backup.service)→ 停服 → 检出目标 → 依赖变了才 npm ci → 起服 → 自检。
# 自检不过自动回旧版;目标带新迁移时,回旧版前先用刚做的转储恢复库。
# 只动 /opt/aihw、aihw 服务、aihw 库与 /var/backups/aihw;地址、口令、连接串都不在本件,
# 库连接取自 aihw-backup.service 的 Environment,口令在 aihw 自己的 .pgpass。
set -euo pipefail

REPO=${AIHW_REPO:-/opt/aihw}
BACKUPS=${AIHW_BACKUPS:-/var/backups/aihw}
LOCAL_URL=${AIHW_LOCAL_URL:-http://127.0.0.1:8787}
LOG=${AIHW_UPGRADE_LOG:-/var/lib/aihw/upgrade.log}

ARG=${1:?用法: upgrade.sh <目标提交>}
cd "$REPO"
TARGET=$(git rev-parse --verify -q "$ARG^{commit}") || { echo "找不到目标提交 $ARG(先传 bundle 并 fetch)"; exit 2; }
OLD=$(git rev-parse HEAD)
if [ "$OLD" = "$TARGET" ]; then echo "线上已是 ${TARGET:0:7},不用升"; exit 0; fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "检出目录有未提交改动,停手:"; git status --short --untracked-files=no; exit 3
fi
DEPS=$(git diff --name-only "$OLD" "$TARGET" -- server/package.json server/package-lock.json server/.npmrc | wc -l)
MIGS=$(git diff --name-only --diff-filter=AMD "$OLD" "$TARGET" -- server/migrations | wc -l)
WANT_REV=$(git show "$TARGET:content/rules/numbers.v1.json" | grep -o '"revision_key": *"[^"]*"' | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
echo "现版 ${OLD:0:7} → 目标 ${TARGET:0:7}(依赖变动 $DEPS 件,迁移变动 $MIGS 件,规则 $WANT_REV)"

# 1 备份:跑一次与每日备份同一个单元,核出转储是刚生成的、可读的。
sudo -n systemctl start aihw-backup.service
DUMP=$(ls -t "$BACKUPS" | head -1)
if [ -z "$DUMP" ] || [ -z "$(find "$BACKUPS/$DUMP" -mmin -5)" ]; then echo "没有刚生成的转储,停手"; exit 4; fi
pg_restore --list "$BACKUPS/$DUMP" > /dev/null
echo "备份 $DUMP"

deps() { if [ "$DEPS" -gt 0 ]; then (cd server && npm ci --no-audit --no-fund --loglevel=error); fi; }

healthy() {
  local i
  for i in $(seq 1 45); do
    curl -fsS -o /dev/null --max-time 3 "$LOCAL_URL/v1/verbs" 2>/dev/null && break
    sleep 2
  done
  sleep 10
  systemctl is-active -q aihw || return 1
  curl -fsS --max-time 5 "$LOCAL_URL/v1/verbs" | grep -q "\"rules_revision\":\"$1\""
}

rollback() {
  set +e  # 回退一路走完,单步报错只记不停(pg_restore --clean 常带可忽略的警告)
  echo "自检不过,回 ${OLD:0:7}。近 5 分钟服务日志末 30 行:"
  sudo -n journalctl -u aihw --since "-5 min" --no-pager -o cat | tail -30 || true
  sudo -n systemctl stop aihw
  if [ "$MIGS" -gt 0 ]; then
    echo "目标带迁移变动,先用 $DUMP 恢复库"
    eval "export $(systemctl show -p Environment --value aihw-backup.service)"
    pg_restore --clean --if-exists --no-owner --dbname="$PGDATABASE" "$BACKUPS/$DUMP"
  fi
  git checkout -q --detach "$OLD"
  deps
  sudo -n systemctl start aihw
  local old_rev
  old_rev=$(grep -o '"revision_key": *"[^"]*"' content/rules/numbers.v1.json | head -1 | sed -E 's/.*"([^"]*)"$/\1/')
  if healthy "$old_rev"; then echo "已回到 ${OLD:0:7}"; else echo "回旧版后仍不通,要人看"; fi
  echo "$(date '+%F %T') 升级失败 ${OLD:0:7} → ${TARGET:0:7},已回退;备份 $DUMP" >> "$LOG"
  exit 1
}

# 2 换代码、起服、自检
sudo -n systemctl stop aihw
git checkout -q --detach "$TARGET" || rollback
deps || rollback
sudo -n systemctl start aihw || rollback
healthy "$WANT_REV" || rollback
echo "$(date '+%F %T') 升级 ${OLD:0:7} → ${TARGET:0:7};备份 $DUMP" >> "$LOG"
echo "升级成功:${TARGET:0:7} 在跑,规则 $WANT_REV;备份 $DUMP;回退 = 本件对旧版再跑一次(有迁移时先恢复该转储)"
