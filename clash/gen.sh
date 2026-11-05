#!/usr/bin/env bash
# 渲染三端 mihomo 配置：base.yaml + overlays/<target>.yaml -> dist/<target>.yaml
#
#   ./gen.sh              渲染 + 校验
#   ./gen.sh router       只渲染指定端
#
# 依赖：yq（优先用系统里的，没有则用 nix run 临时拉，不污染环境）
#       verge-mihomo（校验用，缺失则跳过校验并告警）
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BASE="${CLASH_BASE:-$ROOT/base.yaml}"
DIST="$ROOT/dist"
GEODATA="${CLASH_GEODATA:-$HOME/.cache/clash-geodata}"
ALL_TARGETS=(router laptop phone)

die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m· %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }

[[ -f $BASE ]] || die "找不到 base：$BASE（密钥版 base 见 README：它不进公开仓库）"

if command -v yq >/dev/null 2>&1; then
  yq_() { yq "$@"; }
else
  yq_() { nix run --extra-experimental-features 'nix-command flakes' nixpkgs#yq-go -- "$@"; }
fi

targets=("$@")
[[ ${#targets[@]} -eq 0 ]] && targets=("${ALL_TARGETS[@]}")

# external-controller 的 secret 不进公开仓库：overlay 里写占位符，渲染时注入
SECRET_FILE="$ROOT/.secret"
[[ -f $SECRET_FILE ]] || ( umask 077; head -c 32 /dev/urandom | base64 | tr -d '/+=' > "$SECRET_FILE" )
secret=$(tr -d '\n' < "$SECRET_FILE")

mkdir -p "$DIST"
base_sha=$(sha256sum "$BASE" | cut -c1-12)

for t in "${targets[@]}"; do
  overlay="$ROOT/overlays/$t.yaml"
  [[ -f $overlay ]] || die "找不到 overlay：$overlay"

  merged=$(yq_ eval-all '
      . as $item ireduce ({}; . * $item)
      | with_entries(select(.value != null))
    ' "$BASE" "$overlay")

  # 注入 secret 占位符（用 awk 而不是 sed，避免 secret 里出现特殊字符时被解释）
  merged=$(printf '%s\n' "$merged" | awk -v s="$secret" '{ sub(/__CLASH_SECRET__/, s); print }')

  {
    printf '# ---------------------------------------------------------------\n'
    printf '# 自动生成，请勿手改。改动请落在 clash/base.yaml 或 clash/overlays/%s.yaml\n' "$t"
    printf '# 生成时间：%s   base:=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$base_sha"
    printf '# ---------------------------------------------------------------\n'
    printf '%s\n' "$merged"
  } > "$DIST/$t.yaml"

  # 校验
  if command -v verge-mihomo >/dev/null 2>&1; then
    if [[ -f $GEODATA/geosite.dat ]]; then
      out=$(verge-mihomo -t -d "$GEODATA" -f "$DIST/$t.yaml" 2>&1 | tail -1)
      [[ $out == *"test is successful"* ]] || die "$t 校验失败：$out"
      ok "$t  $(wc -l < "$DIST/$t.yaml") 行  sha256:$(sha256sum "$DIST/$t.yaml" | cut -c1-12)"
    else
      info "$t 已渲染，但缺 $GEODATA/geosite.dat，跳过校验"
    fi
  else
    info "$t 已渲染，未装 verge-mihomo，跳过校验"
  fi
done
