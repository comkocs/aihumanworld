#!/usr/bin/env bash
# 一次性开通(root 在服务器上跑一次):让 AI 人间 0 号窗以 aihw 账号自己升级线上,不再经 Panedesk 转。
# 依据:设计者 2026-11-07 02:0x 原话 51「改直通，你自己建立脚本即可…你不碰他项目即可，自己有自己的文件夹」。
# 用法: bash 开通直通.sh '<本方部署公钥一行,ssh-ed25519 开头>'
# 只动 aihw 自己的东西:
#   1 /opt/aihw 属主改为 aihw(服务单元 ProtectSystem=strict,运行中的服务仍只读代码,只有 aihw 登录能换版);
#   2 aihw 给登录壳,只认本方这把公钥(不开端口转发 / 代理转发);
#   3 /etc/sudoers.d/aihw 只许:起停 aihw 服务、跑一次 aihw-backup.service、看 aihw 服务日志。
# 不碰 Panedesk 的账号、目录、服务、CI 与 PostgreSQL 其他库。撤销:删 /etc/sudoers.d/aihw 与
# /var/lib/aihw/.ssh/authorized_keys,usermod -s /usr/sbin/nologin aihw,chown -R root:root /opt/aihw。
set -euo pipefail
KEY=${1:?用法: bash 开通直通.sh '<公钥>'}
case "$KEY" in "ssh-ed25519 "*) ;; *) echo "只收 ssh-ed25519 公钥一行"; exit 2;; esac
[ "$(id -u)" = 0 ] || { echo "须 root 跑"; exit 2; }
id aihw > /dev/null

chown -R aihw:aihw /opt/aihw
usermod -s /bin/bash aihw
install -d -m 700 -o aihw -g aihw /var/lib/aihw/.ssh
printf 'no-port-forwarding,no-agent-forwarding,no-X11-forwarding %s\n' "$KEY" > /var/lib/aihw/.ssh/authorized_keys
chown aihw:aihw /var/lib/aihw/.ssh/authorized_keys
chmod 600 /var/lib/aihw/.ssh/authorized_keys

SYSTEMCTL=$(command -v systemctl); JOURNALCTL=$(command -v journalctl)
cat > /etc/sudoers.d/aihw.tmp <<SUDO
# AI 人间 0 号窗直通升级(原话 51):只许起停本服务、跑本备份、看本服务日志。
aihw ALL=(root) NOPASSWD: $SYSTEMCTL start aihw, $SYSTEMCTL stop aihw, $SYSTEMCTL restart aihw, $SYSTEMCTL start aihw-backup.service, $JOURNALCTL -u aihw *
SUDO
chmod 440 /etc/sudoers.d/aihw.tmp
visudo -cf /etc/sudoers.d/aihw.tmp
mv /etc/sudoers.d/aihw.tmp /etc/sudoers.d/aihw

# 核对
sudo -l -U aihw | tail -3
ls -ld /opt/aihw /var/lib/aihw/.ssh
echo "开通完成"
