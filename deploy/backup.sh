#!/usr/bin/env bash
# AI 人间每日备份:pg_dump 自定义格式到本机目录,按保留天数清理。
# 用法:backup.sh <备份目录> <保留天数>
# 连接信息只走环境变量 PGHOST / PGPORT / PGUSER / PGDATABASE / PGPASSFILE,
# 本脚本不接受、不回显任何口令。建议由 /etc/aihw/backup.env(权限 600)注入,
# 口令放 ~/.pgpass(权限 600)或 PGPASSFILE 所指文件,不进本脚本、不进仓。
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "用法: backup.sh <备份目录> <保留天数>" >&2
  exit 2
fi

dest="$1"
keep="$2"

case "$keep" in
  ''|*[!0-9]*) echo "保留天数必须是非负整数" >&2; exit 2 ;;
esac

for var in PGHOST PGPORT PGUSER PGDATABASE; do
  if [ -z "${!var:-}" ]; then
    echo "缺少环境变量 $var" >&2
    exit 2
  fi
done

mkdir -p "$dest"

stamp="$(date +%Y%m%d-%H%M%S)"
out="$dest/aihw-${stamp}.dump"

pg_dump --format=custom --no-password --file="$out" "$PGDATABASE"

# 只删本脚本自己写出的转储,不动同目录其他文件。
find "$dest" -maxdepth 1 -type f -name 'aihw-*.dump' -mtime +"$keep" -print -delete
