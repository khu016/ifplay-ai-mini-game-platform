// 定价换算：USD/1M → CNY/1k，显式汇率，输入/缓存输入/输出分别计价。
// 定价或汇率缺失 → 抛错（安全失败），绝不按 0 元估算。
import { loadProviders } from './credentials.mjs';

export function fxRate(p = loadProviders()) {
  const fx = p.pricing?.fx;
  if (!fx || typeof fx.usdCny !== 'number' || fx.usdCny <= 0) {
    throw new Error('汇率未显式配置（pricing.fx.usdCny），拒绝估算。');
  }
  return { usdCny: fx.usdCny, status: fx.status, asOf: fx.asOf };
}

export function textRatesPer1kCny(model, p = loadProviders()) {
  const t = p.pricing?.text;
  if (!t || t.currency !== 'USD' || t.unit !== 'per_1m_tokens') {
    throw new Error('文本定价结构不是 USD/per_1m_tokens，拒绝按此换算。');
  }
  const m = t.models?.[model ?? t.defaultModel];
  if (!m) throw new Error(`模型 ${model ?? t.defaultModel} 无定价配置，拒绝调用（不当作 0 元）。`);
  const need = ['cacheHitInputPer1M', 'cacheMissInputPer1M', 'outputPer1M'];
  for (const k of need) {
    if (typeof m[k] !== 'number' || m[k] <= 0) throw new Error(`文本定价 ${k} 缺失或非正数，拒绝调用。`);
  }
  const { usdCny } = fxRate(p);
  const per1k = (usdPer1M) => (usdPer1M / 1000) * usdCny;
  return {
    model: model ?? t.defaultModel,
    tier: t.tier,
    currency: 'CNY',
    per1k: {
      cacheHitInput: per1k(m.cacheHitInputPer1M),
      cacheMissInput: per1k(m.cacheMissInputPer1M),
      output: per1k(m.outputPer1M)
    },
    usdPer1M: {
      cacheHitInput: m.cacheHitInputPer1M,
      cacheMissInput: m.cacheMissInputPer1M,
      output: m.outputPer1M
    }
  };
}

export function imagePriceCny(p = loadProviders()) {
  const i = p.pricing?.image;
  const v = i?.pricePerImage;
  if (typeof v !== 'number' || v <= 0) {
    throw new Error(`图片单张价未确认（${i?.status ?? '未配置'}），图片调用被拒绝，不按 0 元处理。`);
  }
  return v;
}

// 文本费用：prompt_tokens 含缓存命中部分，需拆分
export function textCostCny(rates, { inputTokens = 0, cachedInputTokens = 0, outputTokens = 0 }) {
  if (cachedInputTokens > inputTokens) {
    throw new Error(`缓存命中 token ${cachedInputTokens} 大于输入 token ${inputTokens}，usage 自相矛盾，停止记账。`);
  }
  const miss = inputTokens - cachedInputTokens;
  return Number((
    (miss / 1000) * rates.per1k.cacheMissInput +
    (cachedInputTokens / 1000) * rates.per1k.cacheHitInput +
    (outputTokens / 1000) * rates.per1k.output
  ).toFixed(6));
}

export function pricingReadiness(p = loadProviders()) {
  const out = {};
  try { out.text = { ready: true, ...textRatesPer1kCny(undefined, p) }; } catch (e) { out.text = { ready: false, reason: e.message }; }
  try { out.image = { ready: true, pricePerImageCny: imagePriceCny(p) }; } catch (e) { out.image = { ready: false, reason: e.message }; }
  out.fx = { configured: true, ...fxRate(p) };
  return out;
}
