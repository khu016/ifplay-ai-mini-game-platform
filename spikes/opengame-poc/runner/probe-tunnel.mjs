// 分层探针（零费用）：把"隧道 CONNECT → TLS → HTTP"三个阶段分开计时打印，
// 用于定位彩排/冒烟链路到底卡在哪一层。只在 --internal 内网运行。
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';

const proxyHost = process.env.PROXY_HOST ?? 'poc-e-proxy';
const proxyPort = Number(process.env.PROXY_PORT ?? 3128);
const target = process.env.PROBE_TARGET ?? 'api.deepseek.com:443';
const ca = process.env.PROBE_CA ?? '/tls/ca.pem';
const [host, portStr] = target.split(':');
const t0 = Date.now();
const step = (m) => console.log(`+${Date.now() - t0}ms ${m}`);

const s = net.connect({ host: proxyHost, port: proxyPort });
s.setTimeout(15000, () => { step('TIMEOUT: 代理 TCP 无响应'); process.exit(1); });
s.once('error', (e) => { step(`TCP_FAIL ${e.code}`); process.exit(1); });
s.once('connect', () => {
  step('TCP_OK');
  s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
});
s.once('data', (buf) => {
  step(`CONNECT_REPLY ${buf.toString('latin1').split('\r\n')[0]}`);
  const useAlpn = process.env.PROBE_ALPN !== '0';
  const opts = { socket: s, servername: host, ca: fs.readFileSync(ca) };
  if (useAlpn) opts.ALPNProtocols = ['http/1.1'];
  const t = tls.connect(opts, () => {
    step(`TLS_OK authorized=${t.authorized} alpn=${String(t.alpnProtocol)}`);
    const raw = Buffer.from(JSON.stringify({ model: 'probe', messages: [{ role: 'user', content: 'probe' }] }), 'utf8');
    t.write(`POST /v1/chat/completions HTTP/1.1\r\nHost: ${host}\r\ncontent-type: application/json\r\ncontent-length: ${raw.length}\r\naccept: text/event-stream\r\nauthorization: Bearer POC_LOCAL_FAKE_KEY_NOT_A_CREDENTIAL\r\n\r\n`);
    t.write(raw);
  });
  t.setTimeout(15000, () => { step('TLS_OR_HTTP_TIMEOUT'); process.exit(1); });
  t.once('error', (e) => { step(`TLS_OR_HTTP_FAIL ${e.code ?? e.name} ${String(e.message).slice(0, 160)}`); process.exit(1); });
  let first = true;
  t.on('data', (c) => {
    if (first) { first = false; step(`HTTP_RESPONSE_HEAD ${c.subarray(0, 60).toString('latin1').replace(/\r/g, '\\r')}`); }
  });
});
