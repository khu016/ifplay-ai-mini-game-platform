// Key 与付费闸门：只认运行时环境变量，任何情况下不回显密钥值。
// 阶段二骨架；本轮不发起任何真实调用。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pocRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadProviders(configFile = join(pocRoot, 'config/providers.json')) {
  return JSON.parse(readFileSync(configFile, 'utf8'));
}

// 双重付费开关：必须同时显式为 'true'
export function paidGateStatus(env = process.env) {
  const enable = env.ENABLE_PAID_API === 'true';
  const authorized = env.COST_AUTHORIZED === 'true';
  return {
    allowPaidCalls: enable && authorized,
    enablePaidApi: env.ENABLE_PAID_API ?? null,
    costAuthorized: env.COST_AUTHORIZED ?? null,
    reason: !enable
      ? 'ENABLE_PAID_API 未显式设为 true，禁止任何真实模型调用'
      : !authorized
        ? 'COST_AUTHORIZED 未显式设为 true，费用未获授权，禁止任何真实模型调用'
        : 'ok'
  };
}

export function assertPaidCallsAllowed(env = process.env) {
  const s = paidGateStatus(env);
  if (!s.allowPaidCalls) throw new Error(s.reason);
  return s;
}

// 只判断存在性与长度，绝不返回或打印值
export function keyPresence(env = process.env) {
  const model = typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.length >= 20;
  const image = typeof env.OPENGAME_IMAGE_API_KEY === 'string' && env.OPENGAME_IMAGE_API_KEY.length >= 20
    || typeof env.DASHSCOPE_API_KEY === 'string' && env.DASHSCOPE_API_KEY.length >= 20;
  return { model, image };
}

export function assertCredentials({ providers = loadProviders(), env = process.env, needImage = false } = {}) {
  assertPaidCallsAllowed(env);
  const missing = [];
  if (!env[providers.model.apiKeyEnvVar]) missing.push(providers.model.apiKeyEnvVar);
  if (needImage) {
    const hasImage = env[providers.image.apiKeyEnvVar] || env.DASHSCOPE_API_KEY;
    if (!hasImage) missing.push(providers.image.apiKeyEnvVar);
  }
  if (missing.length) {
    throw new Error(`缺少必需环境变量：${missing.join(', ')}。拒绝启动（不回退其他模型、不使用默认值）。`);
  }
  // 防静默回退：OpenGame 在 OPENAI_MODEL 缺省时落到 qwen3-coder-plus，必须显式钉死模型名
  if (env.OPENAI_MODEL !== providers.model.modelRequested) {
    throw new Error(`OPENAI_MODEL 必须显式等于 ${providers.model.modelRequested}（当前 ${env.OPENAI_MODEL ?? '未设置'}）。缺省会静默回退到其他模型，禁止。`);
  }
  const baseUrl = env.OPENAI_BASE_URL ?? providers.model.baseUrl;
  if (!baseUrl.startsWith(providers.model.baseUrl)) {
    throw new Error(`OPENAI_BASE_URL 必须以 ${providers.model.baseUrl} 开头（当前 ${baseUrl}）。`);
  }
  if (env[providers.model.apiKeyEnvVar] === providers.model.apiKeyEnvVar) {
    throw new Error(`${providers.model.apiKeyEnvVar} 看起来是占位值而非真实 Key。`);
  }
  return { baseUrl, model: providers.model.modelRequested };
}

// 日志/报告脱敏：把已知密钥值替换为 ***
export function redact(text, secrets = []) {
  let out = String(text ?? '');
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join('***REDACTED***');
  }
  return out;
}

export function collectSecrets(env = process.env) {
  return [env.OPENAI_API_KEY, env.OPENGAME_IMAGE_API_KEY, env.DASHSCOPE_API_KEY].filter(Boolean);
}
