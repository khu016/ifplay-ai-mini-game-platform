// egress 白名单容器内真实链路验收（零第三方依赖，node 内置模块实现）
// 运行位置：--internal 网络内的临时容器（唯一出口是白名单代理）
// env: PROXY_HOST PROXY_PORT EGRESS_MODE=none|strict|model  ALLOW_HOST
//   none   ：代理持空白名单 → 任何 CONNECT 必须 403（安全失败）
//   strict ：本体构建白名单 → 仅 registry.npmjs.org:443 放行，其余全拒；并验证无法绕过代理直连
//   model  ：阶段二模型白名单 → api.deepseek.com:443（文本）/ dashscope.aliyuncs.com:443（图片）放行，
//            其他模型域、RUM 遥测域、非 443 端口、明文 HTTP、直连 IP 全拒。零费用：只做 TLS 连接 + 无凭据 HEAD，不发模型请求。
import net from 'node:net';
import tls from 'node:tls';

const PROXY_HOST = process.env.PROXY_HOST ?? 'poc-proxy';
const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3128);
const MODE = process.env.EGRESS_MODE ?? 'strict';
const ALLOWED = process.env.ALLOW_HOST ?? 'registry.npmjs.org';
const DEEPSEEK = 'api.deepseek.com';
const DASHSCOPE = 'dashscope.aliyuncs.com';
const RUM = 'gb4w8c3ygj-default-sea.rum.aliyuncs.com'; // 阿里云 RUM 用量上报域名，必须被拒

let fails = 0;
function check(name, pass, detail) {
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${detail}`);
  if (!pass) fails += 1;
}

function connect(host, port, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (r) => { s.destroy(); resolve(r); };
    s.setTimeout(timeoutMs);
    s.on('connect', () => done({ ok: true }));
    s.on('timeout', () => done({ ok: false, err: 'TIMEOUT' }));
    s.on('error', (e) => done({ ok: false, err: e.code ?? e.message }));
  });
}

// 经代理发 CONNECT，只取响应状态码（不继续传输）
function proxyConnect(targetHost, targetPort) {
  return new Promise((resolve) => {
    const s = net.connect({ host: PROXY_HOST, port: PROXY_PORT });
    const done = (r) => { s.destroy(); resolve(r); };
    s.setTimeout(8000);
    s.on('connect', () => s.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`));
    s.on('timeout', () => done({ err: 'TIMEOUT' }));
    s.on('error', (e) => done({ err: e.code ?? e.message }));
    s.once('data', (buf) => {
      const m = buf.toString('latin1').match(/^HTTP\/1\.1 (\d+)/);
      done(m ? { status: Number(m[1]) } : { err: 'NO_STATUS' });
    });
  });
}

// 完整正样本：CONNECT 建隧道 → TLS 握手 → HEAD /，期望拿到任意 HTTP 状态码
function proxyTlsHead(targetHost, path) {
  return new Promise((resolve) => {
    const s = net.connect({ host: PROXY_HOST, port: PROXY_PORT });
    const done = (r) => { s.destroy(); resolve(r); };
    s.setTimeout(15000);
    s.on('timeout', () => done({ err: 'TIMEOUT' }));
    s.on('error', (e) => done({ err: e.code ?? e.message }));
    s.on('connect', () => s.write(`CONNECT ${targetHost}:443 HTTP/1.1\r\nHost: ${targetHost}:443\r\n\r\n`));
    s.once('data', (buf) => {
      if (!/^HTTP\/1\.1 200/.test(buf.toString('latin1'))) { done({ err: 'TUNNEL_DENIED' }); return; }
      const t = tls.connect({ socket: s, servername: targetHost, ALPNProtocols: ['http/1.1'] }, () => {
        t.write(`HEAD ${path} HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`);
      });
      t.setTimeout(12000);
      t.once('data', (d) => {
        const m = d.toString('latin1').match(/^HTTP\/1\.[01] (\d+)/);
        done(m ? { status: Number(m[1]) } : { err: 'NO_HTTP_STATUS' });
      });
      t.on('timeout', () => done({ err: 'TLS_TIMEOUT' }));
      t.on('error', (e) => done({ err: e.code ?? e.message }));
    });
  });
}

async function plainForward(targetUrl) {
  return new Promise((resolve) => {
    const s = net.connect({ host: PROXY_HOST, port: PROXY_PORT });
    s.setTimeout(6000);
    s.on('timeout', () => { s.destroy(); resolve({ err: 'TIMEOUT' }); });
    s.on('error', (e) => resolve({ err: e.code ?? e.message }));
    s.on('connect', () => s.write(`GET ${targetUrl} HTTP/1.1\r\nHost: ${targetUrl.replace(/^http:\/\//, '')}\r\n\r\n`));
    s.once('data', (buf) => {
      const m = buf.toString('latin1').match(/^HTTP\/1\.1 (\d+)/);
      s.destroy();
      resolve(m ? { status: Number(m[1]) } : { err: 'NO_STATUS' });
    });
  });
}

// 阶段二模型白名单套件（零费用：仅 TLS 连接 + 无凭据 HEAD，绝不发带 Key 的模型请求）
async function modelSuite() {
  const a1 = await proxyTlsHead(DEEPSEEK, '/');
  check('model: allow api.deepseek.com via tunnel (HTTPS/443)', typeof a1.status === 'number' && a1.status < 500, JSON.stringify(a1));

  const a2 = await proxyTlsHead(DASHSCOPE, '/');
  check('model: allow dashscope.aliyuncs.com via tunnel (HTTPS/443)', typeof a2.status === 'number' && a2.status < 500, JSON.stringify(a2));

  for (const [label, host] of [['openai', 'api.openai.com'], ['doubao-ark', 'ark.cn-beijing.volces.com'], ['dashscope-intl', 'dashscope-intl.aliyuncs.com'], ['qwen-oauth', 'chat.qwen.ai']]) {
    const r = await proxyConnect(host, 443);
    check(`model: deny ${label} (${host}:443)`, r.status === 403, JSON.stringify(r));
  }

  const rum = await proxyConnect(RUM, 443);
  check('model: deny aliyun RUM telemetry domain', rum.status === 403, JSON.stringify(rum));

  const up = await proxyConnect(DEEPSEEK, 8443);
  check('model: deny allowlisted host on non-allowlisted port (:8443)', up.status === 403, JSON.stringify(up));

  const plain = await plainForward('http://api.deepseek.com/');
  check('model: deny plain-HTTP forward to model host (:80)', plain.status === 403, JSON.stringify(plain));

  const d1 = await connect('1.1.1.1', 443, 4000);
  check('model: no direct route to public IP (1.1.1.1:443)', d1.ok === false, JSON.stringify(d1));

  const d2 = await connect(DEEPSEEK, 443, 4000);
  check('model: no direct route bypassing proxy (api.deepseek.com:443)', d2.ok === false, JSON.stringify(d2));
}

// 冒烟白名单套件（egress-allowlist.smoke.json）：只放行 api.deepseek.com:443，
// 图片域 dashscope 本次未授权 → 必须被拒。零费用：仅 TLS 连接 + 无凭据 HEAD。
async function smokeSuite() {
  const a1 = await proxyTlsHead(DEEPSEEK, '/');
  check('smoke: allow api.deepseek.com via tunnel (HTTPS/443)', typeof a1.status === 'number' && a1.status < 500, JSON.stringify(a1));

  for (const [label, host] of [['dashscope-image(本次未授权)', DASHSCOPE], ['openai', 'api.openai.com'], ['doubao-ark', 'ark.cn-beijing.volces.com'], ['dashscope-intl', 'dashscope-intl.aliyuncs.com'], ['qwen-oauth', 'chat.qwen.ai'], ['npm-registry', 'registry.npmjs.org']]) {
    const r = await proxyConnect(host, 443);
    check(`smoke: deny ${label} (${host}:443)`, r.status === 403, JSON.stringify(r));
  }

  const rum = await proxyConnect(RUM, 443);
  check('smoke: deny aliyun RUM telemetry domain', rum.status === 403, JSON.stringify(rum));

  const up = await proxyConnect(DEEPSEEK, 8443);
  check('smoke: deny allowlisted host on non-allowlisted port (:8443)', up.status === 403, JSON.stringify(up));

  const plain = await plainForward('http://api.deepseek.com/');
  check('smoke: deny plain-HTTP forward to model host (:80)', plain.status === 403, JSON.stringify(plain));

  const d1 = await connect('1.1.1.1', 443, 4000);
  check('smoke: no direct route to public IP (1.1.1.1:443)', d1.ok === false, JSON.stringify(d1));

  const d2 = await connect(DEEPSEEK, 443, 4000);
  check('smoke: CLI has no route to the vendor except through the relay+proxy', d2.ok === false, JSON.stringify(d2));
}

async function main() {
  console.log(`[egress-live-test] mode=${MODE} proxy=${PROXY_HOST}:${PROXY_PORT}`);

  if (MODE === 'smoke') {
    await smokeSuite();
    console.log(fails === 0 ? '[egress-live-test] ALL PASS' : `[egress-live-test] ${fails} FAILED`);
    process.exit(fails === 0 ? 0 : 1);
  }

  if (MODE === 'model') {
    await modelSuite();
    console.log(fails === 0 ? '[egress-live-test] ALL PASS' : `[egress-live-test] ${fails} FAILED`);
    process.exit(fails === 0 ? 0 : 1);
  }

  // 1) 空白名单安全失败 / 或放行域名可通
  if (MODE === 'none') {
    const r = await proxyConnect(ALLOWED, 443);
    check('empty-allowlist blocks registry CONNECT', r.status === 403, JSON.stringify(r));
  } else {
    const r = await proxyTlsHead(ALLOWED, '/');
    check('allowlist allows registry via tunnel (HTTPS/443)', typeof r.status === 'number' && r.status < 500, JSON.stringify(r));
  }

  // 2) 非白名单域名必须拒绝（CONNECT）
  if (MODE === 'strict') {
    const r = await proxyConnect('example.com', 443);
    check('deny non-allowlisted domain (example.com:443)', r.status === 403, JSON.stringify(r));
  }

  // 3) 阿里云 RUM 遥测域名必须拒绝（CONNECT）
  if (MODE === 'strict') {
    const r = await proxyConnect(RUM, 443);
    check('deny aliyun RUM telemetry domain', r.status === 403, JSON.stringify(r));
  }

  // 4) 非白名单端口必须拒绝（registry:8080）
  if (MODE === 'strict') {
    const r = await proxyConnect(ALLOWED, 8080);
    check('deny allowlisted host on non-allowlisted port (:8080)', r.status === 403, JSON.stringify(r));
  }

  // 5) HTTP 转发面：未授权域名经代理 GET 也应 403
  if (MODE === 'strict') {
    const r = await new Promise((resolve) => {
      const s = net.connect({ host: PROXY_HOST, port: PROXY_PORT });
      s.setTimeout(6000);
      s.on('timeout', () => { s.destroy(); resolve({ err: 'TIMEOUT' }); });
      s.on('error', (e) => resolve({ err: e.code ?? e.message }));
      s.on('connect', () => s.write('GET http://example.org/ HTTP/1.1\r\nHost: example.org\r\n\r\n'));
      s.once('data', (buf) => {
        const m = buf.toString('latin1').match(/^HTTP\/1\.1 (\d+)/);
        s.destroy();
        resolve(m ? { status: Number(m[1]) } : { err: 'NO_STATUS' });
      });
    });
    check('deny plain-HTTP forward to non-allowlisted host', r.status === 403, JSON.stringify(r));
  }

  // 6) 绕过代理直连公网 IP：--internal 网络应无路由（ENETUNREACH/EHOSTUNREACH/超时）
  const d1 = await connect('1.1.1.1', 443, 4000);
  check('no direct route to public IP (1.1.1.1:443)', d1.ok === false, JSON.stringify(d1));

  // 7) 绕过代理直连白名单域名（不经代理）：同样必须失败——网络层只有代理一条出口
  const d2 = await connect(ALLOWED, 443, 4000);
  check('no direct route bypassing proxy (registry:443)', d2.ok === false, JSON.stringify(d2));

  console.log(fails === 0 ? '[egress-live-test] ALL PASS' : `[egress-live-test] ${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
