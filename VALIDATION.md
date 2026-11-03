# 验证记录

2026-11-03，本机 macOS arm64：Clash Verge Rev 2.5.8；其内置 `verge-mihomo` 报告 Mihomo Meta v1.19.32。

## 结果

- JavaScript 语法检查通过（`node --check`）。
- 7 项自动检查全部通过，包含普通节点、集合节点、空节点三种配置的实际内核 `-t` 检查。
- 隔离内核使用临时目录、随机本地端口，TUN 明确关闭；未修改运行中的客户端配置或系统路由/DNS。
- 真实内核验证集合中的 `type: direct` 节点被 sunshine-dns-break 排除；即使业务规则为 `MATCH,DIRECT`，TXT 查询仍经本地模拟 SOCKS 代理尝试连接 `1.1.1.1:443` 和 `8.8.4.4:443`。
- 模拟 SOCKS 拒绝连接时，真实上游查询返回 DNS 错误；Fake-IP A 查询返回 198.18 段，AAAA 查询返回空记录，这两种不需要真实上游查询。
- 集合只有直连节点时，真实内核 API 显示 sunshine-dns-break 的可选项及当前选择均为 REJECT，没有回退到 DIRECT/COMPATIBLE。
- 重复应用不会重复生成组和拒绝规则；已有同名节点、集合、非本脚本生成的业务策略组会明确报错。保留原有节点、集合与业务分流。
- 为兼容 Clash Verge 应用设置的字段优先级，脚本保留传入的 TUN 配置，也不在 TUN 配置缺失时注入受应用接管的字段；这项行为由回归检查覆盖。TUN 接管参数需在客户端界面设置。
- 独立复核对两个加密引导地址各进行一次 `example.com` DoH 请求：均为 HTTP 200、`application/dns-message`、TLS 校验通过。没有关闭证书验证。

## 复现

```sh
node --check sunshine-dns-break.js
node --test test.mjs
```

在此目录执行。测试使用本机安装的内核；换机器可用 `MIHOMO_BINARY` 环境变量指定对应可执行文件。测试无第三方 JavaScript 包依赖。

## 尚未验证

没有安装到用户的当前全局扩展脚本，没有使用真实订阅节点验证联网，没有在真实联网网卡上抓包。因此本记录证明配置解析与隔离行为，不证明实际系统零泄漏。应用设置回写、macOS 局域网 DNS、多网卡、浏览器自带 DoH、系统 IPv6 和关闭 TUN 后的网络行为，按 README 配套检查。
