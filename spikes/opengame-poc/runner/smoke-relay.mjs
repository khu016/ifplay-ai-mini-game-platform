// 冒烟验证转发器（TLS 终止 + 断言 + 取证），零第三方依赖，只用 node 内置模块。
//
// 为什么需要它：OpenGame 的 OpenAI 客户端没有接代理（provider/default.ts:31-46 只传
// apiKey/baseURL/timeout/maxRetries/defaultHeaders），Node 20 的 fetch 也不读 HTTPS_PROXY，
// 所以单靠 CONNECT 白名单代理无法约束 CLI 容器的出网目标；同时我们也必须在真实付费调用发生
// 【之前】证明 thinking/max_tokens 真的进入了最终 HTTP 请求体，并在之后拿到真实 usage。
// 本转发器对 CLI 伪装成 api.deepseek.com（本地签发证书 + 容器内 /etc/hosts 固定解析），
// 逐条断言请求形状，不合规则直接拒绝且绝不转发（不产生费用）；合规请求经 egress 白名单代理
// 的 CONNECT 隧道转发到真正的 api.deepseek.com:443（上游证书按系统 CA 正常校验）。
// 这是有意为之的中间人取证，会在报告中如实披露；Authorization 值只透传、从不落盘或打印。
//
// env:
//   RELAY_UPSTREAM_MODE   mock|real（默认 mock；real 只允许 api.deepseek.com:443）
//   RELAY_PORT RELAY_CERT RELAY_KEY RELAY_EVIDENCE
//   PROXY_HOST PROXY_PORT                      real 模式下的 egress 白名单代理
//   RELAY_MOCK_HOST RELAY_MOCK_PORT            mock 模式下的本地假服务
//   RELAY_EXPECT_MODEL RELAY_EXPECT_MAX_TOKENS RELAY_REQUIRE_THINKING
//   RELAY_MAX_REQUESTS（允许转发的次数上限）   RELAY_MAX_BODY_BYTES
//   RELAY_MAX_TOTAL_EST_TOKENS（转发前的累计最坏预检）
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { appendFileSync, readFileSync } from 'node:fs';

const env = process.env;
const cfg = {
  port: Number(env.RELAY_PORT ?? 443),
  cert: env.RELAY_CERT,
  key: env.RELAY_KEY,
  mode: env.RELAY_UPSTREAM_MODE ?? 'mock',
  targetHost: env.RELAY_UPSTREAM_HOST ?? 'api.deepseek.com',
  targetPort: Number(env.RELAY_UPSTREAM_PORT ?? 443),
  mockHost: env.RELAY_MOCK_HOST ?? '127.0.0.1',
  mockPort: Number(env.RELAY_MOCK_PORT ?? 80),
  proxyHost: env.PROXY_HOST ?? '',
  proxyPort: Number(env.PROXY_PORT ?? 3128),
  evidence: env.RELAY_EVIDENCE ?? '/work/relay-evidence.jsonl',
  expectModel: env.RELAY_EXPECT_MODEL ?? 'deepseek-flash',
  expectMaxTokens: Number(env.RELAY_EXPECT_MAX_TOKENS ?? 512),
  requireThinkingDisabled: env.RELAY_REQUIRE_THINKING !== '0',
  maxRequests: Number(env.RELAY_MAX_REQUESTS ?? 1),
  maxBodyBytes: Number(env.RELAY_MAX_BODY_BYTES ?? 40000),
  maxTotalEstTokens: Number(env.RELAY_MAX_TOTAL_EST_TOKENS ?? 30000),
  // 上游空闲超时（不是总时长）：SSE 有数据就重置。没有它，隧道对端不回 HTTP 时
  // 转发器会无限等待，CLI 只能靠自己的 420s 超时兜底（彩排 E 实测踩过这种挂起）。
  upstreamTimeoutMs: Number(env.RELAY_UPSTREAM_TIMEOUT_MS ?? 120000)
};

if (!cfg.cert || !cfg.key) throw new Error('转发器缺少证书/私钥路径（RELAY_CERT / RELAY_KEY）');
if (cfg.mode === 'real') {
  if (cfg.targetHost !== 'api.deepseek.com' || cfg.targetPort !== 443) {
    throw new Error(`real 模式只允许 api.deepseek.com:443，当前为 ${cfg.targetHost}:${cfg.targetPort}`);
  }
  if (!cfg.proxyHost) throw new Error('real 模式必须经 egress 白名单代理出口（PROXY_HOST 未设置）');
}

let received = 0;
let forwarded = 0;
let estTokensTotal = 0;

function evidence(rec) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...rec });
  try { appendFileSync(cfg.evidence, line + '\n'); } catch { /* 取证写盘失败不影响判定 */ }
  console.log(line);
}

// 只回显不含敏感值的最小信息
function failReason(body) {
  const reasons = [];
  if (body.model !== cfg.expectModel) reasons.push(`model=${String(body.model)} 期望 ${cfg.expectModel}`);
  if (Number(body.max_tokens) !== cfg.expectMaxTokens) reasons.push(`max_tokens=${String(body.max_tokens)} 期望 ${cfg.expectMaxTokens}`);
  if (cfg.requireThinkingDisabled && body.thinking?.type !== 'disabled') {
    reasons.push(`thinking=${JSON.stringify(body.thinking ?? null)} 必须为 {"type":"disabled"}`);
  }
  if (body.reasoning_effort !== undefined) reasons.push(`仍带 reasoning_effort=${String(body.reasoning_effort)}`);
  if (body.stream !== true) reasons.push('必须 stream=true');
  if (body.stream_options?.include_usage !== true) reasons.push('必须 stream_options.include_usage=true（否则取不到 usage）');
  if (body.n !== undefined && Number(body.n) !== 1) reasons.push(`n=${String(body.n)} 必须为 1`);
  if (Array.isArray(body.tools)) {
    const names = body.tools.map((t) => t?.function?.name).filter(Boolean);
    if (names.some((n) => /image|asset|generate_game_assets/i.test(n))) reasons.push(`工具面含图片类：${names.join(',')}`);
  }
  const text = JSON.stringify(body.messages ?? []);
  if (/"type"\s*:\s*"image_url"/.test(text)) reasons.push('消息含 image_url（图片输入未授权）');
  return reasons;
}

function parseSseSummary(buf) {
  const out = { usage: null, actualModel: null, finishReasons: [], sse: true, chunks: 0 };
  for (const block of buf.toString('utf8').split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    const payload = line.slice(6).trim();
    if (payload === '[DONE]') continue;
    let obj = null;
    try { obj = JSON.parse(payload); } catch { continue; }
    out.chunks += 1;
    if (obj.model && !out.actualModel) out.actualModel = obj.model;
    if (obj.usage) out.usage = obj.usage;
    for (const c of obj.choices ?? []) if (c.finish_reason) out.finishReasons.push(c.finish_reason);
  }
  return out;
}

function summarize(buf, contentType) {
  if (/text\/event-stream/.test(contentType || '')) return parseSseSummary(buf);
  try {
    const obj = JSON.parse(buf.toString('utf8'));
    return {
      sse: false,
      usage: obj.usage ?? null,
      actualModel: obj.model ?? null,
      finishReasons: (obj.choices ?? []).map((c) => c.finish_reason).filter(Boolean),
      errorCode: obj.error?.code ?? obj.error?.type ?? null,
      errorMessage: obj.error?.message ? String(obj.error.message).slice(0, 200) : null
    };
  } catch {
    return { sse: false, usage: null, actualModel: null, finishReasons: [], parseError: true };
  }
}

function tunnelConnect() {
  return new Promise((resolve, reject) => {
    const s = net.connect({ host: cfg.proxyHost, port: cfg.proxyPort });
    const fail = (e) => { s.destroy(); reject(e instanceof Error ? e : new Error(String(e))); };
    s.setTimeout(15000, () => fail(new Error('代理 CONNECT 超时')));
    s.once('error', fail);
    s.on('connect', () => s.write(`CONNECT ${cfg.targetHost}:${cfg.targetPort} HTTP/1.1\r\nHost: ${cfg.targetHost}:${cfg.targetPort}\r\n\r\n`));
    s.once('data', (buf) => {
      if (!/^HTTP\/1\.[01] 200/.test(buf.toString('latin1'))) return fail(new Error('egress 代理拒绝了隧道'));
      s.setTimeout(0);
      const t = tls.connect({ socket: s, servername: cfg.targetHost, ALPNProtocols: ['http/1.1'] }, () => {
        s.removeListener('error', fail);
        t.setTimeout(0);
        resolve(t);
      });
      t.setTimeout(30000, () => fail(new Error('上游 TLS 空闲超时')));
      t.once('error', fail);
    });
  });
}

class TunnelAgent extends https.Agent {
  createConnection(_options, oncreate) {
    tunnelConnect().then((sock) => oncreate(null, sock), (err) => oncreate(err));
  }
}
const realAgent = cfg.mode === 'real' ? new TunnelAgent({ keepAlive: false }) : null;

const server = https.createServer(
  { cert: readFileSync(cfg.cert), key: readFileSync(cfg.key) },
  (req, res) => {
    received += 1;
    const t0 = Date.now();
    const chunks = [];
    let bytes = 0;
    let aborted = false;
    let started = false;

    const deny = (status, code, message, extra = {}) => {
      if (aborted || started) return;
      aborted = true;
      evidence({
        n: received, at: 'refuse', upstreamMode: cfg.mode, path: req.url,
        httpStatus: status, code, reason: message, forwarded: false,
        authorizationHeaderPresent: Boolean(req.headers.authorization),
        bodyBytes: bytes, ms: Date.now() - t0, ...extra
      });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code, message } }));
    };

    res.on('error', () => { /* 客户端被 SDK 中断时忽略 */ });

    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > cfg.maxBodyBytes * 4) return deny(413, 'SMOKE_BODY_TOO_LARGE', `请求体超过 ${cfg.maxBodyBytes * 4} 字节硬上限`);
      chunks.push(c);
    });

    req.on('end', () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks);
      let body = null;
      try { body = JSON.parse(raw.toString('utf8')); } catch { /* 交给下面的形状检查 */ }

      const base = {
        n: received, upstreamMode: cfg.mode, method: req.method, path: req.url,
        authorizationHeaderPresent: Boolean(req.headers.authorization),
        bodyBytes: bytes,
        requestedModel: body?.model ?? null,
        maxTokens: body?.max_tokens ?? null,
        thinking: body?.thinking ?? null,
        reasoningEffort: body?.reasoning_effort ?? null,
        stream: body?.stream ?? null,
        includeUsage: body?.stream_options?.include_usage ?? null,
        toolNames: Array.isArray(body?.tools) ? body.tools.map((t) => t?.function?.name).filter(Boolean) : [],
        messageCount: Array.isArray(body?.messages) ? body.messages.length : 0
      };

      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        return deny(400, 'SMOKE_PATH_NOT_ALLOWED', `只允许 POST /v1/chat/completions，收到 ${req.method} ${req.url}`, base);
      }
      if (!body) return deny(400, 'SMOKE_BODY_UNPARSEABLE', '请求体不是合法 JSON', base);

      const reasons = failReason(body);
      if (reasons.length) {
        return deny(400, 'SMOKE_REQUEST_NOT_CONFORMING', reasons.join('；'), base);
      }

      // 单任务锁：转发次数一旦到达上限，后续请求一律本地拒绝，不再生成任何费用
      if (forwarded >= cfg.maxRequests) {
        return deny(429, 'SMOKE_SINGLE_ATTEMPT_LOCK', `已转发 ${forwarded} 次，达到本次授权的 ${cfg.maxRequests} 次上限，拒绝再次发起付费请求`, base);
      }

      // 转发前的最坏预检：按 1 token / 3 字节保守估算输入，累计可能超预算就不发送
      const estTokens = Math.ceil(bytes / 3);
      if (estTokensTotal + estTokens > cfg.maxTotalEstTokens) {
        return deny(429, 'SMOKE_PRECHECK_OVER_BUDGET', `最坏预检超限：累计估算输入 ${estTokensTotal + estTokens} token > ${cfg.maxTotalEstTokens}`, { ...base, estTokens });
      }
      estTokensTotal += estTokens;

      forwarded += 1;
      const transport = cfg.mode === 'real' ? https : http;
      const upstreamOptions = cfg.mode === 'real'
        ? { agent: realAgent, host: cfg.targetHost, port: cfg.targetPort, path: req.url, method: 'POST', servername: cfg.targetHost }
        : { agent: false, host: cfg.mockHost, port: cfg.mockPort, path: req.url, method: 'POST' };
      const headers = {
        'content-type': req.headers['content-type'] ?? 'application/json',
        'content-length': String(raw.length),
        accept: req.headers.accept ?? 'application/json'
      };
      // Authorization 只透传，不进入任何记录
      if (req.headers.authorization) headers.authorization = req.headers.authorization;

      const upReq = transport.request({ ...upstreamOptions, headers }, (upRes) => {
        started = true;
        const outHeaders = { ...upRes.headers };
        delete outHeaders.connection;
        delete outHeaders['transfer-encoding'];
        res.writeHead(upRes.statusCode, outHeaders);
        const acc = [];
        let respBytes = 0;
        upRes.on('data', (c) => { acc.push(c); respBytes += c.length; res.write(c); });
        upRes.on('end', () => {
          const buf = Buffer.concat(acc);
          const s = summarize(buf, upRes.headers['content-type']);
          evidence({
            ...base, at: 'forward', forwarded: true, estTokens,
            upstream: cfg.mode === 'real' ? `${cfg.targetHost}:${cfg.targetPort}(经 egress 代理 CONNECT)` : `${cfg.mockHost}:${cfg.mockPort}(本地假服务)`,
            responseStatus: upRes.statusCode, responseBytes: respBytes,
            actualModel: s.actualModel, usage: s.usage, finishReasons: s.finishReasons,
            sse: s.sse, errorCode: s.errorCode ?? null, errorMessage: s.errorMessage ?? null,
            ms: Date.now() - t0
          });
          res.end();
        });
        upRes.on('error', () => res.destroy());
      });
      upReq.setTimeout(cfg.upstreamTimeoutMs, () => {
        evidence({
          ...base, at: 'upstream-timeout', forwarded: true, estTokens,
          timeoutMs: cfg.upstreamTimeoutMs, responseStatus: null, ms: Date.now() - t0
        });
        upReq.destroy(new Error(`上游空闲超过 ${cfg.upstreamTimeoutMs}ms`));
      });
      upReq.on('error', (err) => {
        evidence({
          ...base, at: 'upstream-error', forwarded: true, estTokens,
          responseStatus: null, errorName: err.code ?? err.name, errorMessage: String(err.message).slice(0, 200), ms: Date.now() - t0
        });
        deny(502, 'SMOKE_UPSTREAM_FAIL', '上游请求失败（不会自动重发）', { ...base, forwardedAgain: false });
      });
      upReq.end(raw);
    });

    req.on('error', () => { /* 上游/客户端断开 */ });
  }
);

server.listen(cfg.port, '0.0.0.0', () => {
  evidence({
    at: 'listen', mode: cfg.mode, port: cfg.port,
    expectModel: cfg.expectModel, expectMaxTokens: cfg.expectMaxTokens,
    requireThinkingDisabled: cfg.requireThinkingDisabled,
    maxRequests: cfg.maxRequests, maxBodyBytes: cfg.maxBodyBytes,
    maxTotalEstTokens: cfg.maxTotalEstTokens,
    upstream: cfg.mode === 'real' ? `${cfg.targetHost}:${cfg.targetPort}` : `${cfg.mockHost}:${cfg.mockPort}`
  });
  if (cfg.mode === 'real') void proxyPrecheck();
});

// real 模式启动自检（零费用）：只解析代理容器名并做一次 TCP 连接，不发 CONNECT、不发请求体。
// 为什么必须存在：阶段二真实冒烟曾因"中继与代理不在同一网络 → 容器名无法解析"而在转发时
// 报 getaddrinfo EAI_AGAIN poc-smoke-proxy，白白花掉一次转发额度还拿不到 usage。
// 预检失败即进程退出，编排脚本据此在 CLI 启动【之前】停止，不发送任何付费请求。
async function proxyPrecheck() {
  const t0 = Date.now();
  const okTarget = `${cfg.proxyHost}:${cfg.proxyPort}`;
  try {
    await new Promise((resolve, reject) => {
      const s = net.connect({ host: cfg.proxyHost, port: cfg.proxyPort });
      s.setTimeout(8000, () => { s.destroy(); reject(new Error('代理 TCP 连接超时')); });
      s.once('error', reject);
      s.on('connect', () => { s.destroy(); resolve(); });
    });
    evidence({ at: 'proxy-precheck', ok: true, proxy: okTarget, ms: Date.now() - t0 });
  } catch (err) {
    evidence({
      at: 'proxy-precheck', ok: false, proxy: okTarget,
      errorName: err.code ?? err.name, errorMessage: String(err.message).slice(0, 200),
      ms: Date.now() - t0
    });
    console.error(`[relay] 代理预检失败（${okTarget}）：${err.code ?? err.name} ${String(err.message).slice(0, 200)}`);
    process.exit(1);
  }
}
