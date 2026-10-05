// 受闸门保护的调用链路：付费开关 → 凭证 → 调用前预检查 → 请求 → usage 记账
// 真实生成时主 Agent 由 OpenGame 自身发起；本模块用于（a）闸门链路验证，
// （b）runner 侧必要直连调用（如方案/评审补数）。任何真实调用都必须走本链路。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPaidCallsAllowed, collectSecrets, redact } from './credentials.mjs';
import { matchTarget } from './egress-rules.mjs';

const MOCK_HOSTS = ['127.0.0.1', 'localhost'];
const pocRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// 目标域名以 egress 白名单为唯一事实来源，避免两处配置漂移
export function assertTargetAllowed(baseUrl, allowlistFile = join(pocRoot, 'config/egress-allowlist.json')) {
  let u;
  try { u = new URL(baseUrl); } catch { throw new Error(`baseUrl 非法：${baseUrl}`); }
  if (u.protocol === 'http:' && MOCK_HOSTS.includes(u.hostname)) return; // 仅本地假服务允许明文
  if (u.protocol !== 'https:') throw new Error(`只允许 HTTPS 或本地假服务（当前 ${u.protocol}//${u.hostname}）`);
  if (MOCK_HOSTS.includes(u.hostname)) throw new Error('真实调用不得指向本地地址');
  const port = u.port ? Number(u.port) : 443;
  const allowlist = JSON.parse(readFileSync(allowlistFile, 'utf8'));
  const match = matchTarget(allowlist, u.hostname, port);
  if (!match) throw new Error(`目标 ${u.hostname}:${port} 不在 egress 白名单内，拒绝发起真实调用`);
  return match;
}

export function estimateInputTokens(messages = []) {
  const chars = JSON.stringify(messages).length;
  return Math.ceil((chars * 0.9) / 4); // 保守中英混合近似；真实 token 以返回 usage 为准
}

function parseUsagePayload(payload) {
  return {
    input: payload?.prompt_tokens ?? payload?.input_tokens,
    output: payload?.completion_tokens ?? payload?.output_tokens,
    cached: payload?.prompt_tokens_details?.cached_tokens ?? payload?.cached_tokens ?? payload?.cache_read_input_tokens ?? 0
  };
}

function parseSseFinalUsage(text) {
  let usage = null;
  let model = null;
  let content = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const chunk = line.slice(5).trim();
    if (!chunk || chunk === '[DONE]') continue;
    let obj;
    try { obj = JSON.parse(chunk); } catch { continue; }
    if (obj?.usage) usage = obj.usage;
    if (obj?.model) model = obj.model;
    const delta = obj?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') content += delta;
  }
  return { usage, model, content };
}

export async function callGated({
  env = process.env,
  ledger,
  category = 'agent',
  baseUrl,
  model,
  messages,
  images = 0,
  maxTokens = null,
  repairRound = null,
  fetchImpl = globalThis.fetch,
  stream = true
} = {}) {
  assertPaidCallsAllowed(env);
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY，拒绝调用（不回退其他模型、不使用默认值）');
  assertTargetAllowed(baseUrl);
  if (!ledger) throw new Error('必须传入统一账本（CostLedger），否则费用不进同一额度）');
  if (!model) throw new Error('必须显式指定模型名，禁止使用默认模型');

  const gate = ledger.preCheck({
    inputTokens: estimateInputTokens(messages),
    outputTokens: maxTokens ?? ledger.maxOutputTokens,
    images
  });

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model,
    messages,
    max_tokens: maxTokens ?? ledger.maxOutputTokens,
    stream
  };
  if (stream) body.stream_options = { include_usage: true };

  let resp;
  try {
    resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error(redact(`调用失败：${e.message}`, collectSecrets(env)));
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(redact(`HTTP ${resp.status}：${text.slice(0, 400)}`, collectSecrets(env)));
  }

  let usagePayload = null;
  let actualModel = null;
  let content = '';
  if (stream) {
    const sse = parseSseFinalUsage(text);
    usagePayload = sse.usage;
    actualModel = sse.model;
    content = sse.content;
  } else {
    let json = null;
    try { json = JSON.parse(text); } catch { throw new Error(redact('响应不是合法 JSON', collectSecrets(env))); }
    usagePayload = json?.usage ?? null;
    actualModel = json?.model ?? null;
    content = json?.choices?.[0]?.message?.content ?? '';
  }

  // 交给账本判定：usage 或实际模型标识缺失都会触发强制停止（不按 0 元处理）
  const rec = ledger.record({
    category,
    usage: usagePayload ?? {},
    images,
    actualModel: actualModel ?? null,
    modelSource: actualModel ? 'vendor-response' : null,
    repairRound
  });
  const u = parseUsagePayload(usagePayload);
  return { content, usage: u, actualModel, cost: rec.cost, spent: rec.spent, warning: rec.warning, gate };
}
