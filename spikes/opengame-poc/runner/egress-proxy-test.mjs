// egress 白名单代理 · 本地免费自测（不调用真实模型，不访问公网）
// 验证：允许目标可访问、未允许目标被拦截、直连 IP 拦截、重定向绕过拦截、空白名单安全失败、CONNECT 拦截。
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAKE_PORT = 18081;
const PROXY_PORT = 13129;

// 1) 本地假"模型"服务
const fake = http.createServer((req, res) => {
  if (req.url === '/ok') { res.writeHead(200); res.end('fake-ok'); }
  else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://example.com/evil' }); res.end(); }
  else { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));

// 2) 临时白名单 + 空白名单
const tmp = await mkdtemp(join(tmpdir(), 'egress-test-'));
const allowPath = join(tmp, 'allow.json');
await writeFile(allowPath, JSON.stringify({ default: 'deny', allowRawIp: false, categories: { test: { domains: [`localhost:${FAKE_PORT}`] } } }));
const emptyPath = join(tmp, 'empty.json');
await writeFile(emptyPath, JSON.stringify({ default: 'deny', allowRawIp: false, categories: {} }));

function startProxy(configPath, port) {
  const p = spawn(process.execPath, [join(__dirname, 'egress-proxy.mjs'), '--config', configPath, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve) => {
    p.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(p); });
    p.stderr.on('data', () => {});
  });
}

// 3) HTTP 请求（经代理，绝对形式）
function viaProxy(proxyPort, targetUrl) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: proxyPort, path: targetUrl, method: 'GET', headers: { host: targetUrl } }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: -1, body: String(e) }));
    req.end();
  });
}

// 4) CONNECT 请求（应被拦截：不在白名单）
function connectTest(proxyPort, host, port) {
  return new Promise((resolve) => {
    const s = net.connect(proxyPort, '127.0.0.1', () => {
      s.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
    });
    let buf = '';
    s.on('data', (d) => buf += d);
    s.on('close', () => resolve(buf));
    s.on('error', () => resolve(buf));
    setTimeout(() => { s.destroy(); resolve(buf); }, 3000);
  });
}

const p1 = await startProxy(allowPath, PROXY_PORT);
const p2 = await startProxy(emptyPath, PROXY_PORT + 1);

const results = [];
async function check(name, fn, expect) {
  const got = await fn();
  const pass = JSON.stringify(got) === JSON.stringify(expect) || (typeof expect === 'function' ? expect(got) : got.status === expect.status && got.body === expect.body);
  results.push({ name, pass, got });
}

await check('允许目标可访问', () => viaProxy(PROXY_PORT, `http://localhost:${FAKE_PORT}/ok`), { status: 200, body: 'fake-ok' });
await check('未允许目标被拦截', () => viaProxy(PROXY_PORT, 'http://example.com/'), { status: 403, body: 'forbidden by egress allowlist' });
await check('直连 IP 被拦截', () => viaProxy(PROXY_PORT, `http://127.0.0.1:${FAKE_PORT}/ok`), { status: 403, body: 'forbidden by egress allowlist' });
await check('端口不在白名单被拦截', () => viaProxy(PROXY_PORT, 'http://localhost:19999/'), { status: 403, body: 'forbidden by egress allowlist' });
await check('重定向到非白名单被拦截', () => viaProxy(PROXY_PORT, `http://localhost:${FAKE_PORT}/redirect`), { status: 403, body: 'redirect blocked' });
await check('空白名单安全失败', () => viaProxy(PROXY_PORT + 1, `http://localhost:${FAKE_PORT}/ok`), { status: 403, body: 'forbidden by egress allowlist' });
{
  const r = await connectTest(PROXY_PORT, 'example.com', 443);
  results.push({ name: 'CONNECT 非白名单被拦截', pass: r.includes('403'), got: r.slice(0, 40) });
}

p1.kill(); p2.kill(); fake.close();

let fail = 0;
for (const r of results) { if (!r.pass) fail++; console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.pass ? '' : '→ ' + JSON.stringify(r.got)}`); }
console.log(`\n${fail === 0 ? '全部通过' : '存在失败'}: ${results.length - fail}/${results.length}`);
process.exit(fail === 0 ? 0 : 1);
