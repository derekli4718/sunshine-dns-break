# 验证记录

2026-11-03，本机 macOS arm64：Clash Verge Rev 2.5.8、2.5.9；其内置 `verge-mihomo` 报告 Mihomo Meta v1.19.32。

## 结果

- JavaScript 语法检查通过（`node --check`）。
- 9 项自动检查全部通过，包含普通节点、集合节点、空节点三种配置的实际内核 `-t` 检查。
- 自动测试的隔离内核使用临时目录、随机本地端口，TUN 明确关闭；这些测试不修改运行中的客户端配置或系统路由/DNS。
- 真实内核验证集合中的 `type: direct` 节点被 sunshine-dns-break 排除；即使业务规则为 `MATCH,DIRECT`，TXT 查询仍经本地模拟 SOCKS 代理尝试连接 `1.1.1.1:443` 和 `8.8.4.4:443`。
- 模拟 SOCKS 拒绝连接时，真实上游查询返回 DNS 错误；Fake-IP A 查询返回 198.18 段，AAAA 查询返回空记录，这两种不需要真实上游查询。
- 集合只有直连节点时，真实内核 API 显示 sunshine-dns-break 的可选项及当前选择均为 REJECT，没有回退到 DIRECT/COMPATIBLE。
- 重复应用不会重复生成组和拒绝规则；已有同名节点、集合、非本脚本生成的业务策略组会明确报错。保留原有节点、集合及非例外域名的业务分流。
- 为兼容 Clash Verge 应用设置的字段优先级，脚本保留传入的 TUN 配置，也不在 TUN 配置缺失时注入受应用接管的字段；这项行为由回归检查覆盖。TUN 接管参数需在客户端界面设置。
- 独立复核对两个加密引导地址各进行一次 `example.com` DoH 请求：均为 HTTP 200、`application/dns-message`、TLS 校验通过。没有关闭证书验证。

## 钉钉例外验证

- 新增回归检查限定六个 DNS 匹配项：两个钉钉域名后缀、三个精确 CDN 主机、一个精确钉钉附件主机；没有扩大到整个 alicdn.com 或 aliyuncs.com。
- 隔离内核使用两个本地模拟 DNS，确认 docs.dingtalk.com、g.alicdn.com 采用例外解析；notdingtalk.com、other.alicdn.com 仍走默认解析。模拟 DNS 仅用于测试夹具，发布脚本中的真实上游始终为 HTTPS DoH。
- 隔离 HTTP 访问验证：即使订阅使用指向不可用代理的 MATCH 规则，钉钉请求仍能通过优先 DIRECT 规则及例外 DNS 成功到达本地目标。
- 已将相同修复应用到本机 Clash Verge Rev 2.5.9。生成配置与内核校验通过的候选配置一致，原钉钉文档从浏览器超时恢复为可打开，实时协作连接有双向数据。
- 本机钉钉文档首页和 Google HTTPS 请求均返回 200。默认 DNS 及上网节点选择保持原样。
- 文档中仍有图片显示占位，尚未确认所有附件内容均已加载；恢复验证不等于全部附件或长期稳定性验证。

## 复现

```sh
node --check sunshine-dns-break.js
node --test test.mjs
```

在此目录执行。测试使用本机安装的内核；换机器可用 `MIHOMO_BINARY` 环境变量指定对应可执行文件。测试无第三方 JavaScript 包依赖。

## 尚未验证

没有在真实联网网卡上抓包，未进行长期稳定性监测，也未确认全部文档附件加载。因此本记录证明配置解析、隔离分流行为及当次本机连通性恢复，不证明实际系统零泄漏。应用设置回写、macOS 局域网 DNS、多网卡、浏览器自带 DoH、系统 IPv6 和关闭 TUN 后的网络行为，按 README 配套检查。
