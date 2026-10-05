// 用例 E 的客户端（零费用，纯内网）：向验证转发器发一条"形状完全合规"的请求，
// 用来彩排真实冒烟里【转发器 → egress 白名单代理 → 上游】这一跳。
// 只连本机/内网转发器，绝不自己解析公网域名；Key 用明显假值，只验证头部透传。
import https from 'node:https';
import { readFileSync } from 'node:fs';

const url = process.env.CLIENT_URL ?? 'https://127.0.0.1:443/v1/chat/completions';
const caPath = process.env.CLIENT_CA ?? '/tls/ca.pem';
const body = {
  model: 'deepseek-flash',
  messages: [
    { role: 'system', content: '你是测试用最小助手。' },
    { role: 'user', content: 'CHAIN-E 彩排请求 MOCK:INPUT=100 MOCK:OUTPUT=50 MOCK:CACHED=0' }
  ],
  max_tokens: 512,
  thinking: { type: 'disabled' },
  stream: true,
  stream_options: { include_usage: true }
};
const raw = Buffer.from(JSON.stringify(body), 'utf8');
const u = new URL(url);

const req = https.request(
  {
    host: u.hostname, port: u.port || 443, path: u.pathname, method: 'POST',
    servername: 'api.deepseek.com',
    ca: readFileSync(caPath),
    headers: {
      'content-type': 'application/json',
      'content-length': String(raw.length),
      accept: 'text/event-stream',
      authorization: `Bearer ${process.env.CLIENT_KEY ?? 'POC_LOCAL_FAKE_KEY_NOT_A_CREDENTIAL'}`
    }
  },
  (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let usage = null, actualModel = null, done = false;
      for (const block of text.split('\n\n')) {
        const line = block.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { done = true; continue; }
        try {
          const obj = JSON.parse(payload);
          if (obj.usage) usage = obj.usage;
          if (obj.model && !actualModel) actualModel = obj.model;
        } catch { /* 忽略非 JSON 行 */ }
      }
      console.log(JSON.stringify({
        clientOk: res.statusCode === 200 && usage && done,
        status: res.statusCode, usage, actualModel, sseDone: done, bytes: text.length
      }));
      process.exit(res.statusCode === 200 && usage && done ? 0 : 1);
    });
  }
);
req.on('error', (err) => {
  console.log(JSON.stringify({ clientOk: false, errorName: err.code ?? err.name, errorMessage: String(err.message).slice(0, 200) }));
  process.exit(1);
});
req.end(raw);
