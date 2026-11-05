#!/usr/bin/env bash
# 三端配置分发：笔记本渲染 → 路由器作发布端 → 其余端拉取
#
#   ./deploy.sh              渲染 + 校验 + 推路由器 + 发布 + 自检
#   ./deploy.sh --dry-run    只渲染与校验，不碰任何设备
#   ./deploy.sh --publish   只把 dist/ 重新发布到路由器（不重启 mihomo）
#
# 路由器侧布局：
#   /etc/mihomo/config.yaml     ← dist/router.yaml（重启 mihomo 生效）
#   /etc/clash/pub/{laptop,phone}.yaml  ← 供其余端拉取
#   /etc/clash/pub.conf         TOKEN=<随机>
#   /www/cgi-bin/clash-pub      取配置的端点
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8)
ROUTER=${CLASH_ROUTER:-root@192.168.6.1}
ROUTER_IP=${CLASH_ROUTER_IP:-192.168.6.1}
TOKEN_FILE="$ROOT/.pub-token"
DRY_RUN=0
PUBLISH_ONLY=0

for a in "$@"; do
  case $a in
    --dry-run)   DRY_RUN=1 ;;
    --publish)   PUBLISH_ONLY=1 ;;
    -h|--help)   sed -n '2,12p' "$0"; exit 0 ;;
    *) printf '未知参数：%s\n' "$a" >&2; exit 2 ;;
  esac
done

die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m· %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
rsh()  { ssh "${SSH_OPTS[@]}" "$ROUTER" "$@"; }

# 1. 渲染 + 校验（校验不通过就中止，绝不让坏配置上机）
[[ $PUBLISH_ONLY -eq 1 ]] || { info "渲染三端配置"; "$ROOT/gen.sh"; }

# 2. 推送到路由器
if [[ $DRY_RUN -eq 0 ]]; then
  rsh 'mkdir -p /etc/clash/pub' || die "连不上路由器 $ROUTER"

  info "发布 laptop / phone 到路由器 /etc/clash/pub"
  scp -q "${SSH_OPTS[@]}" "$ROOT/dist/laptop.yaml" "$ROOT/dist/phone.yaml" \
      "$ROUTER:/etc/clash/pub/" || die "发布失败"

  if [[ ! -f $TOKEN_FILE ]]; then
    info "首次运行：生成发布 token"
    ( umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$TOKEN_FILE" )
    printf 'TOKEN=%s\n' "$(cat "$TOKEN_FILE")" | rsh 'cat > /etc/clash/pub.conf && chmod 600 /etc/clash/pub.conf'
  elif ! rsh 'grep -q "^TOKEN=" /etc/clash/pub.conf 2>/dev/null'; then
    printf 'TOKEN=%s\n' "$(cat "$TOKEN_FILE")" | rsh 'cat > /etc/clash/pub.conf && chmod 600 /etc/clash/pub.conf'
  fi

  info "安装取配置端点 /www/cgi-bin/clash-pub"
  scp -q "${SSH_OPTS[@]}" "$ROOT/router/cgi-clash-pub" "$ROUTER:/www/cgi-bin/clash-pub.tmp" \
    && rsh 'chmod 755 /www/cgi-bin/clash-pub.tmp && mv /www/cgi-bin/clash-pub.tmp /www/cgi-bin/clash-pub' \
    || die "端点安装失败"

  # 3. 路由器自身配置：先在路由器上校验再替换，失败自动回滚
  if [[ $PUBLISH_ONLY -eq 0 ]]; then
    info "更新路由器 mihomo 配置"
    scp -q "${SSH_OPTS[@]}" "$ROOT/dist/router.yaml" "$ROUTER:/tmp/clash-router.yaml"
    rsh '
      set -e
      ts=$(date +%Y%m%d-%H%M%S)
      cp /etc/mihomo/config.yaml /etc/mihomo/config.yaml.bak-sync-$ts
      # 内核本体平时解压在 /tmp（冷启动才解开），测试时先确保它在
      BIN=/tmp/mihomo/mihomo
      if [ ! -x "$BIN" ]; then
        mkdir -p /tmp/mihomo
        gzip -dc /etc/mihomo/mihomo.gz > "$BIN" && chmod 755 "$BIN"
      fi
      if ! "$BIN" -t -f /tmp/clash-router.yaml -d /etc/mihomo >/tmp/clash-test.log 2>&1; then
        echo "路由器侧校验失败："; tail -3 /tmp/clash-test.log; exit 1
      fi
      cp /tmp/clash-router.yaml /etc/mihomo/config.yaml
      /etc/init.d/mihomo restart >/dev/null 2>&1
      echo restarted
    ' || die "路由器配置更新失败（原配置未被替换或已自动保留）"
    sleep 2
    rsh '/etc/init.d/mihomo status' >/dev/null 2>&1 && ok "路由器 mihomo 已重启" || info "请手动确认 mihomo 状态"
  fi

  # 4. 自检：从本机拉一次，确认发布端真的能取到
  tok=$(cat "$TOKEN_FILE")
  for p in laptop phone; do
    got=$(curl -fsS --noproxy "*" --max-time 8 "http://$ROUTER_IP/cgi-bin/clash-pub?p=$p&t=$tok" 2>/dev/null | tail -1 || true)
    [[ -n $got ]] || die "自检失败：$p 拉不到"
  done
  ok "发布端自检通过（$ROUTER_IP/cgi-bin/clash-pub）"

  printf '\n接下来处理两端：\n'
  printf '  笔记本（Clash Verge）：订阅 → 新建 → 远程，粘贴\n'
  printf '    http://%s/cgi-bin/clash-pub?p=laptop&t=%s\n' "$ROUTER_IP" "$tok"
  if [[ -f $ROOT/phone-pull.sh ]]; then
    printf '  手机（root shell）：\n'
    printf '    sh %s\n' "$ROOT/phone-pull.sh"
  else
    printf '  手机（root shell）：把下面这份存到 box 的 clash 配置目录后重启 box\n'
    printf '    curl -fsS "http://%s/cgi-bin/clash-pub?p=phone&t=%s" -o <box>/clash/config.yaml\n' "$ROUTER_IP" "$tok"
  fi
else
  info "dry-run：已渲染并校验，未接触任何设备"
fi
