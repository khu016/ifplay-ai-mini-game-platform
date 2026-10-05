// 冒烟费用记账：调用前最坏预检 + 调用后按转发器取证逐条入账（唯一费用真相来源）。
// 定价与汇率全部来自 config/providers.json 的 smoke 段（1 USD = 7.5 CNY 只是保守熔断折算值）。
// 用法：
//   node runner/smoke-account.mjs precheck --planned-requests 3 --est-input-tokens-per-call 7600 [--state f] [--json f]
//   node runner/smoke-account.mjs record   --evidence generated/smoke-run/relay-evidence.jsonl [--state f] [--json f]
import { readFileSync, writeFileSync } from 'node:fs';
import { loadProviders } from './credentials.mjs';
import { CostLedger } from './budget.mjs';

const [, , cmd, ...rest] = process.argv;
const arg = (n, d) => { const i = rest.indexOf(`--${n}`); return i > -1 ? rest[i + 1] : d; };

function smokeProviders() {
  const p = loadProviders();
  if (!p.smoke?.budget || !p.smoke?.fx) throw new Error('providers.json 缺少 smoke.budget/smoke.fx，冒烟拒绝继续');
  if (p.smoke.budget.maxImagesPerGame !== 0) throw new Error('冒烟预算必须把图片数量设为 0（本次不授权图片）');
  if (p.smoke.budget.maxRepairRounds !== 0) throw new Error('冒烟预算必须把自动修复轮数设为 0');
  if (p.smoke.budget.maxOutputTokensPerCall !== 512) throw new Error('冒烟预算单次输出上限必须是 512');
  return {
    ...p,
    pricing: { ...p.pricing, fx: p.smoke.fx },
    budget: { ...p.budget, ...p.smoke.budget }
  };
}

const providers = smokeProviders();
const model = arg('model', providers.model.modelRequested);
const stateFile = arg('state', null);
const ledger = new CostLedger({ providers, model, stateFile });
const out = { cmd, model, fxUsdCny: providers.pricing.fx.usdCny, fxStatus: providers.pricing.fx.status, ratesCnyPer1k: ledger.textRates.per1k };

if (cmd === 'precheck') {
  const planned = Number(arg('planned-requests', '3'));
  const perCallInput = Number(arg('est-input-tokens-per-call', '0'));
  if (!Number.isInteger(planned) || planned < 1) throw new Error('planned-requests 必须是正整数');
  if (!Number.isInteger(perCallInput) || perCallInput < 1) throw new Error('est-input-tokens-per-call 必须是正整数（用彩排实测请求体字节/3 取整向上）');
  const worstPerCall = ledger.estimateCall({
    inputTokens: perCallInput, cachedInputTokens: 0,
    outputTokens: providers.budget.maxOutputTokensPerCall, images: 0
  });
  const worstTotal = Number((worstPerCall * planned).toFixed(6));
  out.plannedRequests = planned;
  out.estInputTokensPerCall = perCallInput;
  out.estOutputTokensPerCall = providers.budget.maxOutputTokensPerCall;
  out.worstPerCallCny = worstPerCall;
  out.worstTotalCny = worstTotal;
  out.warnCny = ledger.warnCny;
  out.hardStopCny = ledger.hardStopCny;
  out.allowed = worstTotal <= ledger.hardStopCny;
  out.warningExpected = worstTotal >= ledger.warnCny;
  out.note = '全按 cache-miss 高峰价估算，不依赖缓存命中与 off-peak 优惠';
} else if (cmd === 'record') {
  const file = arg('evidence', null);
  if (!file) throw new Error('record 需要 --evidence <relay-evidence.jsonl>');
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const forwards = rows.filter((r) => r.at === 'forward');
  const refuses = rows.filter((r) => r.at === 'refuse');
  if (!forwards.length) throw new Error('转发器取证里没有任何已转发请求，无法记账（绝不按 0 元处理）');
  const accounted = [];
  for (const f of forwards) {
    if (f.responseStatus !== 200) {
      out.abnormalStatus = out.abnormalStatus ?? [];
      out.abnormalStatus.push({ n: f.n, status: f.responseStatus });
    }
    if (!f.usage || typeof f.usage.prompt_tokens !== 'number' || typeof f.usage.completion_tokens !== 'number') {
      throw new Error(`第 ${f.n} 次转发缺少 usage（prompt_tokens/completion_tokens），立即停止，不按 0 元处理`);
    }
    if (f.usage.prompt_tokens_details?.cached_tokens > f.usage.prompt_tokens) {
      throw new Error(`第 ${f.n} 次 usage 自相矛盾：cached_tokens > prompt_tokens`);
    }
    if (!f.actualModel) throw new Error(`第 ${f.n} 次响应没有 model 字段，实际模型版本未取得`);
    if (f.requestedModel && f.requestedModel !== model) throw new Error(`第 ${f.n} 次请求模型名 ${f.requestedModel} 与授权模型 ${model} 不一致`);
    if (f.toolNames?.some((n) => /image|asset/i.test(n))) throw new Error(`第 ${f.n} 次请求工具面出现图片类工具：${f.toolNames.join(',')}`);
    const r = ledger.record({
      category: 'agent',
      usage: f.usage,
      images: 0,
      actualModel: f.actualModel,
      modelSource: 'vendor-response'
    });
    accounted.push({ n: f.n, costCny: r.cost, spentCny: r.spent, warning: r.warning, input: f.usage.prompt_tokens, cachedInput: f.usage.prompt_tokens_details?.cached_tokens ?? 0, output: f.usage.completion_tokens, actualModel: f.actualModel });
  }
  out.accounted = accounted;
  out.refusedCount = refuses.length;
  out.refusedCodes = [...new Set(refuses.map((r) => r.code))];
  out.summary = ledger.summary();
  out.withinHardStop = ledger.spent <= ledger.hardStopCny;
} else {
  throw new Error('未知子命令，可用：precheck | record');
}

const json = JSON.stringify(out, null, 2);
console.log(json);
const jsonFile = arg('json', null);
if (jsonFile) writeFileSync(jsonFile, json + '\n');
if (cmd === 'precheck' && !out.allowed) process.exit(1);
