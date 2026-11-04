/**
 * Clash Verge Rev 全局扩展脚本：sunshine dns break
 * 针对 Clash Verge Rev 2.5.8 / Mihomo 1.19.32 检查。
 * 粘贴到「订阅 → 全局扩展脚本」，不是 YAML 扩展配置。
 *
 * 必须配合：TUN 开启、规则模式、UDP/TCP 53 DNS 劫持、严格路由；
 * 应用设置关闭 IPv6，浏览器关闭独立的安全 DNS。详见同目录 README.md。
 * TUN 字段由客户端设置管理，本脚本保留传入值，不重复覆写。
 * 国内域名规则库及指定例外使用国内加密 DNS；其他域名解析走 sunshine-dns-break。
 * 节点域名及部分内核下载/引导请求例外：使用直连、校验证书的 DoH。
 * 本脚本不是操作系统防火墙，也不能保证 TUN 关闭后的断网保护。
 */
function main(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("sunshine dns break：需要 Clash Verge 传入有效的配置对象。");
  }

  const groupName = "sunshine-dns-break"; // 保留名称；不要在订阅里另建同名节点/集合。
  const groups = Array.isArray(config["proxy-groups"]) ? config["proxy-groups"] : [];
  const providers = config["proxy-providers"] || {};
  const proxies = Array.isArray(config.proxies) ? config.proxies : [];
  if (proxies.some(function (proxy) { return proxy.name === groupName; }) ||
      Object.prototype.hasOwnProperty.call(providers, groupName)) {
    throw new Error("sunshine dns break：订阅节点/集合与保留名称 sunshine-dns-break 冲突，请先改名。");
  }

  // 不复用订阅中的策略组，防止其嵌套 DIRECT 或故障时切回直连。
  // include-all 不包含策略组；exclude-type 同时过滤集合内的直连类节点。
  // 空集合的默认 COMPATIBLE 会直连，必须显式改为 REJECT。
  const guardGroup = {
    name: groupName,
    type: "select",
    "include-all": true,
    "exclude-type": "Direct|Compatible|Pass|PassRule|Rematch|Dns|Reject|RejectDrop",
    "empty-fallback": "REJECT"
  };
  const groupKeys = Object.keys(guardGroup);
  if (groups.some(function (group) {
    return group.name === groupName &&
      (Object.keys(group).length !== groupKeys.length || groupKeys.some(function (key) {
        return group[key] !== guardGroup[key];
      }));
  })) {
    throw new Error("sunshine dns break：订阅存在同名业务策略组，请将原 sunshine-dns-break 组改名。");
  }
  config["proxy-groups"] = groups.filter(function (group) {
    return group.name !== groupName;
  }).concat([guardGroup]);

  const viaProxy = [
    "https://1.1.1.1/dns-query#" + groupName,
    "https://8.8.4.4/dns-query#" + groupName
  ];
  const bootstrap = [
    "https://223.5.5.5/dns-query#DIRECT",
    "https://1.12.12.12/dns-query#DIRECT"
  ];

  // 同一份国内域名集合同时服务 DNS 与路由；只下载数据，不执行远程代码。
  const domesticProviderName = "sunshine-cn-domains";
  const domesticProvider = {
    type: "http",
    behavior: "domain",
    format: "mrs",
    url: "https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/cn.mrs",
    path: "./ruleset/sunshine-cn-domains.mrs",
    interval: 86400,
    proxy: groupName
  };
  const ruleProviders = config["rule-providers"] || {};
  if (Object.prototype.hasOwnProperty.call(ruleProviders, domesticProviderName) &&
      (!ruleProviders[domesticProviderName] ||
       Object.keys(ruleProviders[domesticProviderName]).length !== Object.keys(domesticProvider).length ||
       Object.keys(domesticProvider).some(function (key) {
         return ruleProviders[domesticProviderName][key] !== domesticProvider[key];
       }))) {
    throw new Error("sunshine dns break：规则集合保留名称 sunshine-cn-domains 冲突。");
  }
  config["rule-providers"] = Object.assign({}, ruleProviders);
  config["rule-providers"][domesticProviderName] = domesticProvider;

  // 钉钉业务及已确认的静态资源使用国内 DoH，避免被调度到海外入口。
  // 资源仅匹配指定主机，不把整个 alicdn.com 加入例外。
  const dingTalkDomains = ["dingtalk.com", "dingtalkapps.com"];
  const dingTalkResources = ["g.alicdn.com", "at.alicdn.com", "retcode.alicdn.com", "alidocs-body.oss-cn-zhangjiakou.aliyuncs.com"];
  const dingTalkPolicy = {};
  dingTalkDomains.forEach(function (domain) {
    dingTalkPolicy["+." + domain] = bootstrap.slice();
  });
  dingTalkResources.forEach(function (domain) {
    dingTalkPolicy[domain] = bootstrap.slice();
  });

  // 淘宝、网易沿用订阅中的直连规则；只修正 DNS 调度到海外 CDN 的问题。
  ["taobao.com", "163.com", "126.com", "127.net", "netease.com"].forEach(function (domain) {
    dingTalkPolicy["+." + domain] = bootstrap.slice();
  });
  dingTalkPolicy["gw.alicdn.com"] = bootstrap.slice(); // 淘宝图标实际跳转的 CDN 主机。
  // MasterGo 沿用原直连规则，仅修正包含 static.mastergo.com 的 CDN 解析。
  dingTalkPolicy["+.mastergo.com"] = bootstrap.slice();
  dingTalkPolicy["rule-set:" + domesticProviderName] = bootstrap.slice();

  // 整体重建：国内集合与明确例外走国内 DoH，其他查询保持代理防护。
  // DNS URL 的显式 #策略优先于业务分流，不受国内网站 DIRECT 规则影响。
  config.dns = {
    enable: true,
    listen: "127.0.0.1:1053",
    ipv6: false,
    "prefer-h3": false,
    "respect-rules": false,
    "use-hosts": true,
    "use-system-hosts": false,
    "cache-algorithm": "arc",
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    "fake-ip-filter-mode": "blacklist",
    "fake-ip-filter": ["+.lan", "+.local", "localhost", "+.in-addr.arpa", "+.ip6.arpa"],
    "default-nameserver": bootstrap.slice(),
    "proxy-server-nameserver": bootstrap.slice(),
    nameserver: viaProxy.slice(),
    "direct-nameserver": viaProxy.slice(),
    "nameserver-policy": dingTalkPolicy,
    "direct-nameserver-follow-policy": true
  };

  // TUN 开关、协议栈、DNS 劫持、严格路由等由 Verge 的应用设置管理。
  // 此处不修改 config.tun，避免“应用设置接管的字段已被丢弃”提示。
  // 必须在界面设置 UDP/TCP 53 劫持并清空路由/进程排除项，详见 README。

  // 劫持成功的 53 流量先进入内部 DNS；剩余进入规则引擎的 53/853 拒绝。
  // 853 同时覆盖常用 DoT(TCP) 与 DoQ(UDP)，不能识别任意 HTTPS 内的 DoH。
  // IPv6 规则仅阻止已进入内核的连接，不能代替系统 IPv6/TUN 路由配置。
  const guardRules = [
    "DST-PORT,53,REJECT",
    "DST-PORT,853,REJECT",
    "IP-CIDR6,::/0,REJECT,no-resolve"
  ];
  const oldRules = Array.isArray(config.rules) ? config.rules : [];
  const dingTalkRules = dingTalkDomains.map(function (domain) {
    return "DOMAIN-SUFFIX," + domain + ",DIRECT";
  }).concat(dingTalkResources.map(function (domain) {
    return "DOMAIN," + domain + ",DIRECT";
  }));
  const priorityRules = guardRules.concat(dingTalkRules);
  const domesticRule = "RULE-SET," + domesticProviderName + ",DIRECT";
  const remainingRules = oldRules.filter(function (rule) {
    return priorityRules.indexOf(rule) === -1 && rule !== domesticRule;
  });
  // 保留订阅明确的域名/应用规则优先级；国内集合在地域/最终兜底前接管。
  const fallbackIndex = remainingRules.findIndex(function (rule) {
    return /^(GEOIP,CN,|MATCH,)/i.test(rule);
  });
  const insertionIndex = fallbackIndex === -1 ? remainingRules.length : fallbackIndex;
  const domesticRules = [domesticRule];
  if (!remainingRules.some(function (rule) { return /^GEOIP,CN,/i.test(rule); })) {
    domesticRules.push("GEOIP,CN,DIRECT");
  }
  remainingRules.splice.apply(remainingRules, [insertionIndex, 0].concat(domesticRules));
  config.rules = priorityRules.concat(remainingRules);
  return config;
}
