#!/system/bin/sh
# 手机侧自助拉取（root）。在 KernelSU 的 root shell 里跑：
#   sh phone-pull.sh <token>
# token 见笔记本上的 clash/.pub-token，或 deploy.sh 运行结束时打印的地址。
set -e

TOKEN=${1:?用法: sh phone-pull.sh <token>}
BOX=/data/adb/box
TMP=/data/local/tmp/phone.yaml
URL="http://192.168.6.1/cgi-bin/clash-pub?p=phone&t=$TOKEN"

echo "拉取 $URL"
curl -fsS --max-time 20 "$URL" -o "$TMP" || { echo "拉取失败（手机这会儿在路由器网内吗？）"; exit 1; }
grep -q "^proxies:" "$TMP" || { echo "返回内容不像配置，中止"; exit 1; }

echo "校验"
"$BOX/bin/clash" -t -d "$BOX/clash" -f "$TMP" 2>&1 | tail -1 | grep -q successful \
	|| { echo "校验失败，保留原配置"; exit 1; }

ts=$(date +%Y%m%d-%H%M%S)
cp "$BOX/clash/config.yaml" "$BOX/clash/config.yaml.bak-sync-$ts"
cp "$TMP" "$BOX/clash/config.yaml"
chown root:net_admin "$BOX/clash/config.yaml"
chmod 644 "$BOX/clash/config.yaml"

echo "重启 box"
sh "$BOX/scripts/box.service" restart 2>&1 | tail -2
echo "完成（旧配置备份：config.yaml.bak-sync-$ts）"
