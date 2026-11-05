# clash —— 三端统一配置

一份 `base.yaml` + 各端 `overlays/*.yaml`，渲染出路由器 / 笔记本 / 手机三份配置。
路由器既是网关也是发布端，其余两端从它拉取。

```
                     ┌──────────────────────────────┐
   改 base.yaml ────▶│ clash/deploy.sh              │
   （唯一真源）      │ gen.sh 渲染 → 校验 → 分发     │
                     └───────────┬──────────────────┘
                                 │ scp
                     ┌───────────▼──────────────────┐
                     │ 路由器 192.168.6.1            │
                     │  /etc/mihomo/config.yaml      │ ← 自己的那份，重启 mihomo
                     │  /etc/clash/pub/{laptop,phone}.yaml   ← 发布目录
                     │  /cgi-bin/clash-pub?p=&t=     ← 带 token 的取配置端点
                     └───────┬───────────────┬──────┘
                        pull │               │ pull
                  ┌──────────▼──┐     ┌──────▼─────────┐
                  │ 笔记本       │     │ 手机            │
                  │ Verge 远程订阅│     │ box / mihomo    │
                  └─────────────┘     └────────────────┘
```

## 文件

| 文件 | 作用 |
|---|---|
| `base.yaml` | 节点、分组、规则、DNS 策略、通用开关。**唯一需要日常维护的文件** |
| `overlays/router.yaml` | 路由器：tproxy/redir 端口、allow-lan、external-controller、DNS 监听 0.0.0.0:1053 |
| `overlays/laptop.yaml` | 笔记本：7897、仅本机、DNS 只听回环 |
| `overlays/phone.yaml` | 手机：7890 + `lan-allowed-ips` 白名单（容器能连、Wi‑Fi 其它设备不能） |
| `gen.sh` | 渲染 + `mihomo -t` 校验，产物在 `dist/` |
| `deploy.sh` | 渲染 → 校验 → 推路由器 → 发布 → 自检 |
| `router/cgi-clash-pub` | 装在路由器 `/www/cgi-bin/` 的发布端点 |
| `phone-pull.sh` | 手机 root shell 里自助拉取（需要有线的替代方案） |

## 日常改动

```bash
# 改节点/规则/分流：只动 base.yaml，然后
cd ~/nixos-config/clash && ./deploy.sh

# 只想预览渲染结果、不碰设备
./deploy.sh --dry-run

# 只重新发布（改了 laptop/phone 的 overlay，不想重启路由器 mihomo）
./deploy.sh --publish
```

`deploy.sh` 的三道保险：本机 `mihomo -t` 校验 → 路由器侧再校验一次 → 失败就不替换原文件。
路由器上的旧配置会自动备份成 `config.yaml.bak-sync-<时间戳>`。

## 三端怎么拿到新配置

- **路由器**：`deploy.sh` 直接替换 + 重启 mihomo（全屋断流约 2 秒）。
- **笔记本**：Clash Verge 里订阅名「路由器发布」，远程订阅，12 小时自动更新；
  UI 里点「更新」可立即拉取。订阅地址形如
  `http://192.168.6.1/cgi-bin/clash-pub?p=laptop&t=<token>`
- **手机**：`adb push dist/phone.yaml` 或手机 root shell 里
  `sh phone-pull.sh <token>`；两者都会先 `mihomo -t` 再替换、再 `box.service restart`。

token 在 `clash/.pub-token`（已被 gitignore），路由器上在 `/etc/clash/pub.conf`（600 权限）。

## ⚠️ base.yaml 不能进公开仓库

`nixos-config` 是 **public** 仓库，而 `base.yaml` 里是节点的 UUID / 密码明文。
当前 `base.yaml` 与 `.pub-token` 都写在 `.gitignore` 里，只在本地和路由器上存在。
换机器时用 `deploy.sh --publish` 之外的方式恢复：先手工准备 `base.yaml`（可从路由器
`/etc/mihomo/config.yaml` 拆出），再跑 `gen.sh`。

## 路由器与推理机的分工

- **路由器**（24h 常开、在流量必经路径上）：mihomo 分流 + tproxy 全屋透明代理 + 配置发布端
- **推理机**：AdGuardHome 做广告/追踪过滤与缓存（规则表大、查询日志重，适合放算力机）

全屋 DNS 链路（2026-11-05 接通）：

```
设备 → 路由器 dnsmasq(192.168.6.1:53)
     → 推理机 AdGuard(192.168.6.118:53)   广告/追踪过滤 + 缓存
     → 路由器 mihomo(192.168.6.1:1053)    国内外分流 + DoH 上游
```

AdGuard 的上游必须指向 `192.168.6.1:1053` 而不是直连 `223.5.5.5`，否则国外域名拿到的是
未经分流的解析结果。fallback 保留 `223.5.5.5 / 119.29.29.29`，路由器 DNS 出问题时仍能解析国内域名。

**已知取舍**：路由器 dnsmasq 现在是单上游。推理机一挂，全屋 DNS 就断（回滚见下）。
dnsmasq 的 `local-service` 默认开启，所以经 Tailscale 来的查询会被拒——这是既存行为，
笔记本走自己的 Verge DNS 不受影响。

### 推理机侧的临时状态

推理机的 `/etc/nixos/adguard.nix` 已改成新上游，但 `nixos-rebuild` 被 sops-nix 的
age 私钥缺失挡住了（那是另一个会话未完成的改动）。所以当前用一个 `/run` 下的
systemd drop-in 停掉了会用 nix store 配置覆盖运行时 yaml 的 `ExecStartPre`：

```
/run/systemd/system/adguardhome.service.d/10-runtime-config.conf   # ExecStartPre=
```

它是临时的：**机器重启后消失**，届时会退回旧的 `223.5.5.5` 上游。
等 sops 密钥就位、`nixos-rebuild switch` 把 adguard.nix 的新值固化后，就再也不需要它。

### 回滚

```sh
# 全屋 DNS 回退到路由器 mihomo（秒级）
ssh root@192.168.6.1 "uci -q delete dhcp.@dnsmasq[0].server; \
  uci add_list dhcp.@dnsmasq[0].server='127.0.0.1#1053'; \
  uci commit dhcp; /etc/init.d/dnsmasq restart"

# 推理机 AdGuard 恢复默认上游
ssh root@100.108.37.113 "cp /root/AdGuardHome.yaml.bak-aghchain-* /var/lib/private/AdGuardHome/AdGuardHome.yaml && \
  chown 65534:65534 /var/lib/private/AdGuardHome/AdGuardHome.yaml && systemctl restart adguardhome"
```

注意两个坑：`uci set` 会把 `server` 写成标量导致生成器不出 `server=` 行（必须 `add_list`）；
AdGuard 以 DynamicUser 运行，手改 yaml 后属主必须是 `65534:65534` + `600`，否则启动即 `permission denied`。
