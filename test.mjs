import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer, get } from "node:http";
import { createSocket } from "node:dgram";
import test from "node:test";

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, "sunshine-dns-break.js"), "utf8");
const core = process.env.MIHOMO_BINARY || "/Applications/Clash Verge.app/Contents/MacOS/verge-mihomo";
function apply(config) {
  const context = createContext({});
  runInContext(source, context);
  return JSON.parse(JSON.stringify(context.main(JSON.parse(JSON.stringify(config)))));
}
function base() {
  return {
    proxies: [{ name: "fixture-proxy", type: "socks5", server: "127.0.0.1", port: 1 }],
    "proxy-groups": [{ name: "原订阅策略", type: "select", proxies: ["DIRECT", "fixture-proxy"] }],
    rules: ["DOMAIN-SUFFIX,example.com,DIRECT", "MATCH,原订阅策略"]
  };
}
test("保留节点、原业务规则和应用管理的 TUN 设置；移除遗留的 DNS 直连策略", () => {
  const input = base();
  input["mixed-port"] = 7890;
  input.dns = { nameserver: ["system"], fallback: ["8.8.8.8"], "nameserver-policy": { "+.cn": "223.5.5.5" } };
  input.tun = { "exclude-interface": ["en0"], "route-exclude-address": ["0.0.0.0/0"] };
  const output = apply(input);
  assert.deepEqual(output.proxies, input.proxies);
  assert.deepEqual(output["proxy-groups"][0], input["proxy-groups"][0]);
  assert.deepEqual(output.rules.slice(9), input.rules);
  assert.equal(output["mixed-port"], 7890);
  assert.equal(output.dns.fallback, undefined);
  assert.equal(output.dns["nameserver-policy"]["+.cn"], undefined);
  assert.deepEqual(output.tun, input.tun);
});
test("普通与直连出口的解析显式走代理；引导解析仅使用 IP 地址加密 DoH", () => {
  const output = apply(base());
  for (const key of ["nameserver", "direct-nameserver"]) {
    for (const endpoint of output.dns[key]) {
      assert.match(endpoint, /^https:\/\/[\d.]+\/dns-query#sunshine-dns-break$/);
    }
  }
  for (const key of ["default-nameserver", "proxy-server-nameserver"]) {
    for (const endpoint of output.dns[key]) {
      assert.match(endpoint, /^https:\/\/[\d.]+\/dns-query#DIRECT$/);
      assert.ok(!endpoint.includes("skip-cert-verify"));
    }
  }
  assert.equal(output.dns.listen, "127.0.0.1:1053");
  assert.equal(output.dns.ipv6, false);
  assert.equal(output.tun, undefined); // 没有 TUN 配置时也不注入应用接管的字段。
});
test("钉钉 DNS 与直连规则只覆盖指定域名，且优先于订阅代理规则", () => {
  const input = base();
  input.rules.unshift("MATCH,fixture-proxy");
  const output = apply(input);
  const expected = [
    ["+.dingtalk.com", "DOMAIN-SUFFIX,dingtalk.com,DIRECT"],
    ["+.dingtalkapps.com", "DOMAIN-SUFFIX,dingtalkapps.com,DIRECT"],
    ["g.alicdn.com", "DOMAIN,g.alicdn.com,DIRECT"],
    ["at.alicdn.com", "DOMAIN,at.alicdn.com,DIRECT"],
    ["retcode.alicdn.com", "DOMAIN,retcode.alicdn.com,DIRECT"],
    ["alidocs-body.oss-cn-zhangjiakou.aliyuncs.com", "DOMAIN,alidocs-body.oss-cn-zhangjiakou.aliyuncs.com,DIRECT"]
  ];
  assert.deepEqual(Object.keys(output.dns["nameserver-policy"]), expected.map(([domain]) => domain));
  for (const [domain] of expected) {
    assert.deepEqual(output.dns["nameserver-policy"][domain], [
      "https://223.5.5.5/dns-query#DIRECT", "https://1.12.12.12/dns-query#DIRECT"
    ]);
  }
  assert.equal(output.dns["direct-nameserver-follow-policy"], true);
  assert.deepEqual(output.rules.slice(3, 9), expected.map(([, rule]) => rule));
  assert.deepEqual(output.rules.slice(9), input.rules);
});
test("可重复执行，组和前置拒绝规则不重复", () => {
  const first = apply(base());
  assert.deepEqual(apply(first), first);
  assert.equal(first["proxy-groups"].at(-1)["empty-fallback"], "REJECT");
  assert.equal(first["proxy-groups"].at(-1).proxies, undefined);
});
test("保留集合订阅；没有节点时仍生成拒绝回退；保留名冲突明确报错", () => {
  const providers = { fixture: { type: "inline", payload: [] } };
  assert.deepEqual(apply({ "proxy-providers": providers })["proxy-providers"], providers);
  assert.equal(apply({})["proxy-groups"][0]["empty-fallback"], "REJECT");
  assert.throws(() => apply({ proxies: [{ name: "sunshine-dns-break", type: "direct" }] }), /冲突/);
  assert.throws(() => apply({ "proxy-providers": { "sunshine-dns-break": {} } }), /冲突/);
  assert.throws(() => apply({ "proxy-groups": [{ name: "sunshine-dns-break", type: "select", proxies: ["DIRECT"] }] }), /同名业务策略组/);
});
test("本机 Mihomo 对普通/集合/空节点三种最终配置的解析检查", () => {
  const directory = mkdtempSync(join(tmpdir(), "dns-guard-check-"));
  try {
    const fixtures = [base(), {}, {
      "proxy-providers": { fixture: { type: "inline", payload: [
        { name: "unsafe-direct", type: "direct" },
        { name: "provider-proxy", type: "socks5", server: "127.0.0.1", port: 1 }
      ] } },
      rules: ["MATCH,DIRECT"]
    }];
    for (const [index, fixture] of fixtures.entries()) {
      const path = join(directory, `fixture-${index}.json`);
      writeFileSync(path, JSON.stringify(apply(fixture)));
      const result = spawnSync(core, ["-t", "-d", directory, "-f", path], { encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error || ""));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

async function tcpPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function udpPort() {
  const socket = createSocket("udp4");
  await new Promise(resolve => socket.bind(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  socket.close();
  return port;
}
async function runCore(config, callback) {
  const directory = mkdtempSync(join(tmpdir(), "dns-guard-runtime-"));
  const port = await tcpPort();
  const dnsPort = await udpPort();
  config.tun = { ...config.tun, enable: false }; // 测试夹具：绝不创建 TUN 或更改系统路由。
  config.dns.listen = `127.0.0.1:${dnsPort}`;
  config["external-controller"] = `127.0.0.1:${port}`;
  config.secret = "isolated-fixture-only";
  config["log-level"] = "debug";
  const path = join(directory, "config.json");
  writeFileSync(path, JSON.stringify(config));
  const process = spawn(core, ["-d", directory, "-f", path]);
  let logs = "";
  process.stdout.on("data", chunk => { logs += chunk; });
  process.stderr.on("data", chunk => { logs += chunk; });
  const api = async path => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Authorization: "Bearer isolated-fixture-only" },
      signal: AbortSignal.timeout(1000)
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { await api("/version"); ready = true; break; } catch {}
      if (process.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, logs);
    await callback({ api, dnsPort, logs: () => logs });
  } finally {
    process.kill("SIGTERM");
    if (process.exitCode === null) await new Promise(resolve => process.once("exit", resolve));
    rmSync(directory, { recursive: true, force: true });
  }
}
async function query(port, qtype) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x6431, 0);
  header.writeUInt16BE(0x100, 2);
  header.writeUInt16BE(1, 4);
  const labels = Buffer.from([7, ...Buffer.from("example"), 3, ...Buffer.from("com"), 0]);
  const tail = Buffer.from([0, qtype, 0, 1]);
  const socket = createSocket("udp4");
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("isolated DNS query timeout")), 12000);
      socket.once("error", error => { clearTimeout(timer); reject(error); });
      socket.once("message", message => { clearTimeout(timer); resolve(message); });
      socket.send(Buffer.concat([header, labels, tail]), port, "127.0.0.1");
    });
  } finally { socket.close(); }
}
test("隔离内核：钉钉按例外解析并直连，相似域名及其他 CDN 主机使用默认 DNS", { timeout: 15000 }, async () => {
  const domestic = createSocket("udp4");
  const ordinary = createSocket("udp4");
  const target = createHttpServer((_request, response) => response.end("direct fixture"));
  const lookups = new Map();
  function answer(server, ip) {
    server.on("message", (packet, remote) => {
      let offset = 12;
      const labels = [];
      while (packet[offset]) {
        const length = packet[offset++];
        labels.push(packet.subarray(offset, offset + length).toString());
        offset += length;
      }
      const name = labels.join(".");
      const qtype = packet.readUInt16BE(offset + 1);
      const header = Buffer.from(packet.subarray(0, 12));
      header.writeUInt16BE(0x8180, 2);
      header.writeUInt16BE(qtype === 1 ? 1 : 0, 6);
      header.writeUInt16BE(0, 8);
      header.writeUInt16BE(0, 10);
      const record = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, ...ip]);
      lookups.set(name, ip.join("."));
      server.send(Buffer.concat([header, packet.subarray(12, offset + 5), ...(qtype === 1 ? [record] : [])]), remote.port, remote.address);
    });
  }
  answer(domestic, [127, 0, 0, 1]);
  answer(ordinary, [127, 0, 0, 2]);
  try {
    await new Promise(resolve => domestic.bind(0, "127.0.0.1", resolve));
    await new Promise(resolve => ordinary.bind(0, "127.0.0.1", resolve));
    await new Promise(resolve => target.listen(0, "127.0.0.1", resolve));
    const config = apply({ ...base(), rules: ["MATCH,fixture-proxy"] });
    config["mixed-port"] = await tcpPort();
    // Only this isolated fixture substitutes local DNS responders for real DoH.
    config.dns.nameserver = config.dns["direct-nameserver"] = [`127.0.0.1:${ordinary.address().port}`];
    for (const domain of Object.keys(config.dns["nameserver-policy"])) {
      config.dns["nameserver-policy"][domain] = [`127.0.0.1:${domestic.address().port}`];
    }
    await runCore(config, async ({ api, logs }) => {
      for (const [name, ip] of [["docs.dingtalk.com", "127.0.0.1"], ["g.alicdn.com", "127.0.0.1"], ["notdingtalk.com", "127.0.0.2"], ["other.alicdn.com", "127.0.0.2"]]) {
        const result = await api(`/dns/query?name=${name}&type=A`);
        assert.ok(result.Answer.some(answer => answer.type === 1 && answer.data === ip));
        assert.equal(lookups.get(name), ip);
      }
      const body = await new Promise((resolve, reject) => {
        const request = get({ hostname: "127.0.0.1", port: config["mixed-port"], path: `http://docs.dingtalk.com:${target.address().port}/`, headers: { Host: `docs.dingtalk.com:${target.address().port}` }, agent: false }, response => {
          let text = "";
          response.on("data", chunk => { text += chunk; });
          response.on("end", () => resolve({ text, status: response.statusCode }));
        });
        request.setTimeout(5000, () => request.destroy(new Error("direct fixture timed out")));
        request.on("error", reject);
      });
      assert.equal(body.status, 200, logs());
      assert.equal(body.text, "direct fixture"); // Blanket proxy rule points to closed port 1.
    });
  } finally {
    domestic.close();
    ordinary.close();
    await new Promise(resolve => target.close(resolve));
  }
});
test("隔离内核：集合内直连被过滤、Fake-IP/AAAA 正常、真实查询尝试代理且失败不回退", { timeout: 20000 }, async () => {
  const destinations = [];
  const sockets = new Set();
  const socks = createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    let stage = 0;
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0 && buffer.length >= 2 + buffer[1]) {
        buffer = buffer.subarray(2 + buffer[1]);
        socket.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage === 1 && buffer.length >= 10) {
        assert.equal(buffer[3], 1); // DoH URL 是 IPv4，不依赖本地名称解析。
        destinations.push(`${[...buffer.subarray(4, 8)].join(".")}:${buffer.readUInt16BE(8)}`);
        stage = 2;
        socket.end(Buffer.from([5, 3, 0, 1, 0, 0, 0, 0, 0, 0]));
      }
    });
  });
  await new Promise(resolve => socks.listen(0, "127.0.0.1", resolve));
  try {
    const config = apply({
      "proxy-providers": { fixture: { type: "inline", payload: [
        { name: "unsafe-direct", type: "direct" },
        { name: "fixture-proxy", type: "socks5", server: "127.0.0.1", port: socks.address().port }
      ] } },
      rules: ["MATCH,DIRECT"] // 即使全部业务直连，普通 DNS 仍应固定走代理。
    });
    await runCore(config, async ({ api, dnsPort, logs }) => {
      const group = await api("/proxies/sunshine-dns-break");
      assert.deepEqual(group.all, ["fixture-proxy"]);
      const a = await query(dnsPort, 1);
      assert.equal(a.readUInt16BE(6), 1);
      assert.deepEqual([...a.subarray(-4, -2)], [198, 18]);
      const aaaa = await query(dnsPort, 28);
      assert.equal(aaaa.readUInt16BE(6), 0);
      assert.equal(destinations.length, 0); // Fake-IP / AAAA 不需访问真实上游。
      const txt = await query(dnsPort, 16); // TXT 迫使真实上游查询。
      assert.notEqual(txt.readUInt16BE(2) & 15, 0, logs());
      assert.ok(destinations.includes("1.1.1.1:443"), logs());
      assert.ok(destinations.includes("8.8.4.4:443"), logs());
      assert.ok(destinations.every(value => ["1.1.1.1:443", "8.8.4.4:443"].includes(value)));
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => socks.close(resolve));
  }
});
test("隔离内核：只有直连节点时 DNS 组回退 REJECT，不能回退 COMPATIBLE", { timeout: 10000 }, async () => {
  const config = apply({
    "proxy-providers": { fixture: { type: "inline", payload: [{ name: "unsafe-direct", type: "direct" }] } },
    rules: ["MATCH,DIRECT"]
  });
  await runCore(config, async ({ api }) => {
    const group = await api("/proxies/sunshine-dns-break");
    assert.deepEqual(group.all, ["REJECT"]);
    assert.equal(group.now, "REJECT");
  });
});
