// 本地 DeepSeek/OpenAI 兼容假服务（零费用、仅 127.0.0.1，不访问任何公网）
// 用途：验证费用闸门与记账链路，并本地复现 DeepSeek 的多轮工具调用协议要求
// （assistant 带 tool_calls 时须回传 reasoning_content）。这不构成对真实 DeepSeek 行为的证明。
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const MOCK_ACTUAL_MODEL = 'DeepSeek-V3.1-mock-20261003';

function toolCallEchoVerification(messages) {
  const withToolCalls = (messages || []).filter((m) => m && m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0);
  if (withToolCalls.length === 0) return { required: false, ok: true, missing: 0 };
  const missing = withToolCalls.filter((m) => typeof m.reasoning_content !== 'string' || m.reasoning_content.length === 0).length;
  return { required: true, ok: missing === 0, missing };
}

function usageFor(marker) {
  const prompt = marker.inputTokens ?? 1200;
  const completion = marker.outputTokens ?? 800;
  const cached = marker.cachedTokens ?? Math.floor(prompt * 0.5);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cached }
  };
}

export function startMockDeepSeek(options = {}) {
  const listenPort = Number.isInteger(options.port) ? options.port : 0;
  // 默认仍只绑 127.0.0.1；用例 E 需要跨容器可达，显式传 host='0.0.0.0' + 本地证书（纯内网，零费用）
  const listenHost = options.host ?? '127.0.0.1';
  const tlsOptions = options.tlsCert && options.tlsKey
    ? { cert: readFileSync(options.tlsCert), key: readFileSync(options.tlsKey) }
    : null;
  const captureFile = options.captureFile ?? null;
  const failTimes = Number(options.failTimes ?? 0);
  const state = { requests: [], echoes: [], captures: [] };
  let served = 0;
  const handler = (req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const auth = req.headers.authorization ?? '';
      let parsed = {};
      try { parsed = JSON.parse(raw || '{}'); } catch { parsed = {}; }
      served += 1;

      // 抓样：只留请求体顶层字段与消息统计，authorization 永不落盘
      if (captureFile) {
        const { messages, ...rest } = parsed;
        const capture = {
          n: served,
          at: new Date().toISOString(),
          path: req.url,
          method: req.method,
          authorizationHeaderPresent: Boolean(req.headers.authorization),
          bodyBytes: Buffer.byteLength(raw, 'utf8'),
          bodySha256: createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16),
          bodyFields: Object.keys(rest).sort(),
          bodyWithoutMessages: rest,
          messageCount: Array.isArray(messages) ? messages.length : 0,
          messageRoles: Array.isArray(messages) ? messages.map((m) => m?.role) : []
        };
        state.captures.push(capture);
        try { appendFileSync(captureFile, JSON.stringify(capture) + '\n'); } catch { /* 抓样失败不影响判定 */ }
      }

      // 前 failTimes 次固定返回 500，用于验证客户端不会自动重发付费请求
      if (failTimes > 0 && served <= failTimes) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'server_error', message: `mock forced failure ${served}` } }));
        return;
      }

      const markerText = JSON.stringify(parsed.messages ?? []);
      // 请求显式关闭思考模式时，响应不再产生 reasoning_content，
      // 也就不能再要求多轮回传（贴近 thinking.type=disabled 的真实形态）。
      const thinkingDisabled = parsed.thinking?.type === 'disabled';
      const marker = {
        noUsage: markerText.includes('MOCK:NO_USAGE'),
        noModel: markerText.includes('MOCK:NO_MODEL'),
        badUsage: markerText.includes('MOCK:CACHED_GT_INPUT'),
        inputTokens: Number((markerText.match(/MOCK:INPUT=(\d+)/) || [])[1] || 0) || null,
        outputTokens: Number((markerText.match(/MOCK:OUTPUT=(\d+)/) || [])[1] || 0) || null,
        cachedTokens: Number((markerText.match(/MOCK:CACHED=(\d+)/) || [])[1] || -1) === -1 ? null : Number((markerText.match(/MOCK:CACHED=(\d+)/) || [])[1])
      };
      const echo = thinkingDisabled
        ? { required: false, ok: true, missing: 0 }
        : toolCallEchoVerification(parsed.messages);
      state.requests.push({ path: req.url, hasAuth: auth.startsWith('Bearer '), bytes: raw.length, stream: !!parsed.stream, model: parsed.model });
      state.echoes.push(echo);

      if (echo.required && !echo.ok) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `assistant tool_calls 消息缺少 reasoning_content（缺失 ${echo.missing} 条）——多轮工具调用协议不满足` } }));
        return;
      }

      const usage = marker.noUsage ? undefined : usageFor(marker);

      // 演练真实写文件链路：首轮返回 write_file 工具调用，收到 tool 结果后返回文本
      // 触发方式：提示词含 MOCK:TOOL_WRITE=<path>（仅离线演练用，真实冒烟提示词不含该标记）
      const toolWritePath = (markerText.match(/MOCK:TOOL_WRITE=([^\s"'\\]+)/) || [])[1];
      const toolWrite = options.toolWrite ?? (toolWritePath
        ? { filePath: toolWritePath, content: 'IFPLAY_DEEPSEEK_SMOKE_OK', matchText: 'SMOKE.txt' }
        : null);
      const hasToolResult = (parsed.messages ?? []).some((m) => m && m.role === 'tool');
      const wantToolCall = Boolean(toolWrite) && !hasToolResult
        && markerText.includes(toolWrite.matchText ?? 'SMOKE.txt');
      const toolCallMessage = () => ({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_mock_write_1',
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ file_path: toolWrite.filePath, content: toolWrite.content })
          }
        }]
      });

      if (marker.badUsage) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'cmpl-mock-bad', model: MOCK_ACTUAL_MODEL,
          choices: [{ index: 0, message: { role: 'assistant', content: 'x' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 500 } }
        }));
        return;
      }

      if (parsed.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
        const tc = wantToolCall ? toolCallMessage() : null;
        send({ id: 'cmpl-mock', model: MOCK_ACTUAL_MODEL, choices: [{ index: 0, delta: thinkingDisabled ? { role: 'assistant' } : { role: 'assistant', reasoning_content: '思考中' } }] });
        if (wantToolCall) {
          send({ id: 'cmpl-mock', model: MOCK_ACTUAL_MODEL, choices: [{ index: 0, delta: { tool_calls: tc.tool_calls } }] });
          send({ id: 'cmpl-mock', model: MOCK_ACTUAL_MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          send({ id: 'cmpl-mock', model: MOCK_ACTUAL_MODEL, choices: [{ index: 0, delta: { content: '已完成' } }] });
          send({ id: 'cmpl-mock', model: MOCK_ACTUAL_MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
        }
        if (usage && parsed.stream_options?.include_usage) {
          send({ id: 'cmpl-mock', model: MOCK_ACTUAL_MODEL, choices: [], usage });
        } else if (usage) {
          send({ id: 'cmpl-mock', model: MOCK_ACTUAL_MODEL, choices: [] });
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const message = { role: 'assistant', content: '你好' };
      if (marker.noUsage) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 'cmpl-mock-nousg', model: MOCK_ACTUAL_MODEL, choices: [{ index: 0, message, finish_reason: 'stop' }] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'cmpl-mock',
        model: marker.noModel ? undefined : MOCK_ACTUAL_MODEL,
        choices: [{
          index: 0,
          message: wantToolCall
            ? tc
            : (thinkingDisabled ? message : { ...message, reasoning_content: '思考中' }),
          finish_reason: wantToolCall ? 'tool_calls' : 'stop'
        }],
        usage
      }));
    });
  };
  // 注意必须是 https.createServer 而不是 tls.createServer：后者的监听器收到的是裸 TLS
  // socket（不是 req/res），HTTP 请求会被完全忽略、客户端永久等待（彩排 E 实测踩过）。
  const server = tlsOptions ? https.createServer(tlsOptions, handler) : http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(listenPort, listenHost, () => {
      const { port } = server.address();
      if (options.readyFile) {
        try { writeFileSync(options.readyFile, String(port)); } catch { /* 就绪标记失败不影响服务 */ }
      }
      resolve({
        port,
        baseUrl: `${tlsOptions ? 'https' : 'http'}://${listenHost}:${port}/v1`,
        state,
        actualModel: MOCK_ACTUAL_MODEL,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

// 独立运行：node runner/mock-deepseek.mjs --port 80 --capture <file> --ready <file>
// 跨容器演练：--host 0.0.0.0 --tls-cert /tls/relay.pem --tls-key /tls/relay.key
if (process.argv[1] && process.argv[1].endsWith('mock-deepseek.mjs')) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : dflt;
  };
  const mock = await startMockDeepSeek({
    port: Number(arg('port', 0)),
    host: arg('host', '127.0.0.1'),
    tlsCert: arg('tls-cert', null),
    tlsKey: arg('tls-key', null),
    captureFile: arg('capture', null),
    readyFile: arg('ready', null),
    failTimes: Number(arg('fail-times', 0))
  });
  console.log(`[mock-deepseek] listening ${mock.baseUrl} capture=${arg('capture', 'off')}`);
}
