# sunshine dns break

适用于 Clash Verge Rev 的全局扩展脚本，默认让普通域名的加密 DNS 查询固定经过独立代理组；钉钉、淘宝、网易及下述指定资源域名使用国内加密 DNS；钉钉添加优先直连规则，淘宝和网易沿用订阅业务分流。

已在 macOS arm64、Clash Verge Rev 2.5.8、2.5.9 / Mihomo 1.19.32 上检查。

## 使用

下载 [sunshine-dns-break.js](sunshine-dns-break.js)，或打开 [原始脚本](https://raw.githubusercontent.com/derekli4718/sunshine-dns-break/main/sunshine-dns-break.js)。

1. 打开 `sunshine-dns-break.js`，复制全部内容，粘贴到 Clash Verge Rev 的「订阅 → 全局扩展脚本」，保存。已有全局脚本时，请先保留副本；此文件只有一个 `main(config)`，不能简单接在另一个 main 后面。
2. 在客户端开启服务模式（需要时）和 TUN/虚拟网卡，使用「规则」模式。TUN 设置确认：自动路由开启、自动检测出口开启、严格路由开启、DNS 劫持包含 `any:53` 和 `tcp://any:53`、路由排除列表为空；其他进程/网卡排除项也应检查。协议栈可用 mixed；已有 gvisor 工作正常也可以继续使用。**这些选项必须在客户端设置界面配置，脚本保留传入的 TUN 设置。**
3. 在客户端设置关闭 IPv6；DNS 覆写若开启，其 IPv6 也关闭。脚本不改写顶层 IPv6，因为 Verge 会用应用设置覆盖它。
4. 关闭浏览器自带的「安全 DNS / DNS over HTTPS」，让浏览器使用系统解析。其他 VPN、DNS 代理、企业配置描述文件也可能有独立 DNS 路径，应在实际使用环境核实。
5. 在代理页面的 `sunshine-dns-break` 组选择一个可用、可信的实际代理节点。该组不含 DIRECT 和现有策略组；没有节点时拒绝解析。默认使用第一个可选节点；它与日常上网的节点可以不同。
6. 重新加载配置，查看最终生效配置和日志，确认下述检查项。订阅扩展脚本在全局脚本之后执行，可能再次覆盖本脚本；这种情况将此脚本作为该订阅最后的扩展脚本使用。

下载文件不会自动安装或改变网络。脚本在 Clash Verge 内运行后会修改生成的内核配置；TUN、系统 DNS、IPv6 和防火墙仍需按本文检查。

## 解析路径

| 查询 | 使用的上游 | 网络出口 |
|---|---|---|
| 默认普通域名，包括未列入下述例外的国内直连网站 | Cloudflare `1.1.1.1`、Google `8.8.4.4` 的 DoH | 固定经过 `sunshine-dns-break` 代理节点 |
| 钉钉、淘宝、网易及指定资源域名（见下表） | 阿里 `223.5.5.5`、腾讯 `1.12.12.12` 的 DoH | 直连、TLS 校验证书 |
| 代理节点域名，以及部分内核自身下载/引导请求 | 阿里 `223.5.5.5`、腾讯 `1.12.12.12` 的 DoH | 直连、TLS 校验证书 |
| DNS 服务器域名的引导解析 | 同上；当前上游 URL 全部使用 IP，通常不需要这一步 | 直连加密，无 UDP/TCP 明文上游 |

国内加密 DNS 例外范围：

| 域名 | 匹配范围 |
|---|---|
| `dingtalk.com`、`dingtalkapps.com` | 域名自身及子域名 |
| `g.alicdn.com`、`at.alicdn.com`、`retcode.alicdn.com` | 仅这些主机 |
| `alidocs-body.oss-cn-zhangjiakou.aliyuncs.com` | 仅此钉钉附件主机 |
| `taobao.com`、`163.com`、`126.com`、`127.net`、`netease.com` | 域名自身及子域名 |
| `gw.alicdn.com` | 仅此淘宝图标跳转主机 |

钉钉及其指定资源域名同时添加优先的 `DIRECT` 规则。淘宝、网易及 `gw.alicdn.com` 仅增加 DNS 策略，沿用订阅中的业务规则；本机订阅将这些流量直连。未把整个 `alicdn.com` 或 `aliyuncs.com` 纳入例外，其他域名保留原业务分流及默认代理 DNS。国内 DNS 服务商可以看到上述例外域名的查询和本地公网出口；查询使用 HTTPS 并校验证书。这是明确的加密直连例外，并非代理故障后的回退。

节点域名需要先解析才能连接节点，因此这里有明确的加密直连例外。引导 DNS 服务商可以看到节点域名及本地公网出口；部分内核自身下载（例如集合下载）也可能使用这个解析器。它不是全部浏览域名的解析出口。若要求连节点域名也不对引导解析器暴露，需要可信的节点 IP 配置并保持正确 SNI/证书，不能靠循环使用尚未连接的代理解决。

非例外域名解析不设置直连 fallback；sunshine-dns-break 节点不可用时，这些查询失败，不自动切到本地 DNS。已有缓存或 Fake-IP 响应可能仍返回，因此“暂时能打开页面”不能证明发生了 DNS 回退。空节点集合显式回退 REJECT，避免内核默认的 COMPATIBLE 直连行为。

## 最终配置检查

```yaml
dns:
  enable: true
  listen: 127.0.0.1:1053
  ipv6: false
  nameserver:
    - https://1.1.1.1/dns-query#sunshine-dns-break
    - https://8.8.4.4/dns-query#sunshine-dns-break
  direct-nameserver:
    - https://1.1.1.1/dns-query#sunshine-dns-break
    - https://8.8.4.4/dns-query#sunshine-dns-break
  direct-nameserver-follow-policy: true
  nameserver-policy:
    "+.dingtalk.com": &domestic-doh
      - https://223.5.5.5/dns-query#DIRECT
      - https://1.12.12.12/dns-query#DIRECT
    "+.dingtalkapps.com": *domestic-doh
    "g.alicdn.com": *domestic-doh
    "at.alicdn.com": *domestic-doh
    "retcode.alicdn.com": *domestic-doh
    "alidocs-body.oss-cn-zhangjiakou.aliyuncs.com": *domestic-doh
    "+.taobao.com": *domestic-doh
    "+.163.com": *domestic-doh
    "+.126.com": *domestic-doh
    "+.127.net": *domestic-doh
    "+.netease.com": *domestic-doh
    "gw.alicdn.com": *domestic-doh
tun:
  enable: true
  auto-route: true
  strict-route: true
  dns-hijack:
    - any:53
    - tcp://any:53
```

sunshine-dns-break 的 `include-all` 必须为 true，`empty-fallback` 必须为 REJECT，`exclude-type` 必须包含 Direct、Compatible、Pass 等非代理类型；没有订阅节点时组里只能出现 REJECT。普通 DNS 不应出现 `system`、无加密的上游或直连 fallback；`nameserver-policy` 应只有上述十二个匹配项。`direct-nameserver-follow-policy: true` 确保直连流量采用这些例外，其余直连域名仍使用原代理 DoH。原有业务分流规则保留，前面依次增加 53/853 端口及 IPv6 拒绝规则、钉钉直连规则。

Verge 2.5.8 的应用设置优先级高于扩展脚本，TUN 开关、保存过的 TUN 设置、IPv6 等字段可能被回写。当前脚本不写入 TUN 字段，避免与应用设置冲突；上面的 TUN 片段是客户端配置完成后应检查的最终值，不是脚本自动写入的内容。DNS 覆写通常在脚本前合并，无需为了此脚本专门打开；但其 IPv6 选项及后续订阅扩展仍应检查。

如果出现橙色提示“扩展配置或脚本写入了由应用设置接管的字段……这些值已被丢弃”，表示扩展改写了客户端管理的设置，最终采用客户端界面中的值。它不能证明发生了 DNS 泄漏。当前脚本已移除 TUN 改写；若仍提示 `tun.device`、`tun.mtu` 等字段，检查其他全局/订阅扩展是否还在写入这些字段。

## macOS 的验证

仅粘贴脚本不等于完成系统层面的验证。macOS 发给路由器等局域网 DNS 的请求可能绕过 TUN。启用 TUN 后先只读查看：

```sh
scutil --dns
```

如果仍有用于公共域名解析的路由器/局域网 DNS，不能据此宣称已防漏，需要先修正系统 DNS 接管路径。不要把系统 DNS 简单填成 `127.0.0.1`：系统默认向 53 端口发请求，本脚本监听的是 1053，二者不是同一个入口。

再用新域名触发解析并检查实际联网网卡，而非只看 utun。以下命令只抓 DNS 53/853 相关包、不会改变网络配置；把 `<实际网卡>` 替换为联网网卡名（如 en0），在本机终端运行时可能需要系统管理员权限：

```sh
sudo tcpdump -ni <实际网卡> '(udp port 53 or tcp port 53 or port 853)'
```

普通查询不应在物理网卡产生直连 53/853 流量。此检查不覆盖 HTTPS 443 内的 DoH；还应查看内核日志中 DoH 连接的策略，并使用 DNS 泄漏检测网站交叉验证。网站显示的是递归 DNS 的出口，未必与代理 IP 相同，仅凭显示哪个国家不能作最终判断。不要分享含浏览域名或其他个人信息的完整抓包。

## 功能边界及影响

- 这是内核配置防护，不是操作系统 kill switch。TUN 关闭、内核退出、应用绕过路由、其他网络服务及系统未被接管的 IPv6，不在脚本可强制控制范围内。关闭客户端后也要断网，需另行配置系统防火墙。
- 在内核已接管的流量中，53 端口剩余流量拒绝、853 端口拒绝；任意 HTTPS 443 流量无法仅凭端口区分 DoH 和普通网页，所以要求关闭浏览器独立安全 DNS。脚本不声称拦截所有第三方应用自带 DoH。
- 关闭客户端 IPv6 仅影响 Mihomo。脚本另加 IPv6 拒绝规则，但不会关闭 macOS 系统 IPv6；需要严格 IPv6 防泄漏时应在系统层处理并验证路由。
- 不新增局域网/企业域名明文 DNS 例外；`.lan`、`.local` 的 fake-ip-filter 只决定是否返回真实地址，不表示查询会直连。企业内网域名、部分设备发现和门户认证可能需要单独设计受控例外。
- 除明确列出的国内加密 DNS 例外外，普通 DNS 经过境外代理，国内 CDN 定位可能变化、延迟可能增加；节点断开时新域名解析可能失败。这些例外用于避免国内直连访问被境外 DNS 调度到海外入口。其他国内网站若出现同类问题，应先核实实际域名、DNS 及分流，不能仅凭检测站的“国内”标签推断出口。
- 脚本保留原有节点和非例外域名的业务分流，不会把原有国内直连改成全量代理，也不会新增第三方规则订阅。保留名称 `sunshine-dns-break` 由脚本管理；不要用于其他策略组、节点或集合。其他订阅/节点本身仍需可信。

## 检查依据

- Clash Verge 扩展接口及优先级：https://www.clashverge.dev/guide/extend.html
- Mihomo DNS 字段与显式代理：https://wiki.metacubex.one/config/dns/
- Mihomo TUN 的系统差异：https://wiki.metacubex.one/config/inbound/tun/
- v1.19.32 代理组类型过滤及空组行为：https://github.com/MetaCubeX/mihomo/blob/v1.19.32/adapter/outboundgroup/groupbase.go

自动验证及其边界见 [VALIDATION.md](VALIDATION.md)。测试文件为 [test.mjs](test.mjs)，无第三方 JavaScript 包依赖。
