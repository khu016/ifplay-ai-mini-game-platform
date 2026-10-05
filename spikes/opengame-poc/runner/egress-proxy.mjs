// 供应商无关的 egress 白名单代理（骨架）
// 用法：node runner/egress-proxy.mjs --config <allowlist.json> --port <n>
// 行为：
//   - 默认全拒绝；仅放行 allowlist 中列出的域名（含可选端口）。
//   - 禁止直连任意公网 IP（host 为 IP 字面量一律拒绝）。
//   - 域名匹配后做一次 DNS 解析并连接解析到的 IP（缓解 DNS rebinding）。
//   - HTTP 重定向到非白名单目标时直接返回 403（禁止重定向绕过）。
//   - CONNECT(HTTPS) 建隧道前按 host:port 白名单校验，不在白名单不建隧道。
//   - 未配置任何域名（安全失败）= 全拒绝。
//   - 日志只记录类别/状态/目标主机/端口/耗时/字节数，不记录 Key、正文或完整查询。
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns';
import { readFile } from 'node:fs/promises';
import { matchTarget } from './egress-rules.mjs';

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  return { config: get('--config'), port: Number(get('--port') || 3128), bind: get('--bind') || '127.0.0.1' };
}
const { config, port, bind } = parseArgs();
if (!config) { console.error('用法: egress-proxy.mjs --config <allowlist.json> --port <n>'); process.exit(2); }

const allowlist = JSON.parse(await readFile(config, 'utf8'));
function log(category, status, host, port, ms, bytes) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), category: category || '-', status, host, port, ms, bytes }));
}

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  let target;
  try { target = new URL(req.url); } catch { res.writeHead(400); res.end('bad request'); return; }
  const hostname = target.hostname;
  const port = target.port ? Number(target.port) : (target.protocol === 'https:' ? 443 : 80);
  const match = matchTarget(allowlist, hostname, port);
  if (!match) { res.writeHead(403); res.end('forbidden by egress allowlist'); log(null, 'deny', hostname, port, Date.now() - t0, 0); return; }

  let ip;
  try { ip = await dns.promises.lookup(hostname, { family: 4 }); }
  catch { res.writeHead(502); res.end('dns fail'); log(match.category, 'dns-fail', hostname, port, Date.now() - t0, 0); return; }

  const headers = { ...req.headers, host: hostname };
  delete headers['proxy-connection'];
  const upstream = http.request({ host: ip.address, port, path: target.pathname + target.search, method: req.method, headers }, (upRes) => {
    // 重定向绕过拦截：3xx 且 Location 非白名单 → 403
    if (upRes.statusCode >= 300 && upRes.statusCode < 400 && upRes.headers.location) {
      let loc = null;
      try { loc = new URL(upRes.headers.location, `http://${hostname}:${port}`); } catch {}
      const locMatch = loc ? matchTarget(allowlist, loc.hostname, loc.port ? Number(loc.port) : 80) : null;
      if (!locMatch) { res.writeHead(403); res.end('redirect blocked'); upRes.resume(); log(match.category, 'redirect-deny', hostname, port, Date.now() - t0, 0); return; }
    }
    res.writeHead(upRes.statusCode, upRes.headers);
    let bytes = 0;
    upRes.on('data', (c) => { bytes += c.length; res.write(c); });
    upRes.on('end', () => { res.end(); log(match.category, 'allow', hostname, port, Date.now() - t0, bytes); });
  });
  upstream.on('error', () => { res.writeHead(502); res.end('upstream fail'); log(match.category, 'upstream-fail', hostname, port, Date.now() - t0, 0); });
  req.pipe(upstream);
});

server.on('connect', (req, clientSocket, head) => {
  const t0 = Date.now();
  const i = req.url.lastIndexOf(':');
  const hostname = req.url.slice(0, i);
  const port = Number(req.url.slice(i + 1));
  const match = matchTarget(allowlist, hostname, port);
  if (!match) { clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); clientSocket.destroy(); log(null, 'deny', hostname, port, Date.now() - t0, 0); return; }
  dns.promises.lookup(hostname, { family: 4 }).then((ip) => {
    const srv = net.connect(port, ip.address, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) srv.write(head);
      srv.pipe(clientSocket); clientSocket.pipe(srv);
      let bytes = 0;
      srv.on('data', (c) => bytes += c.length);
      srv.on('close', () => log(match.category, 'allow', hostname, port, Date.now() - t0, bytes));
    });
    srv.on('error', () => { clientSocket.destroy(); log(match.category, 'upstream-fail', hostname, port, Date.now() - t0, 0); });
  }).catch(() => { clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n'); clientSocket.destroy(); log(match.category, 'dns-fail', hostname, port, Date.now() - t0, 0); });
});

server.listen(port, bind, () => console.log(`[egress-proxy] listening on ${bind}:${port} (default deny)`));
