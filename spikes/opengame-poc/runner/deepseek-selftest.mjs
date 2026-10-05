// 阶段二 · DeepSeek 接入零费用自动测试（全部使用本地假服务或纯函数，绝不发起真实调用）
// 运行：node runner/deepseek-selftest.mjs   （任一失败 → 退出码 1）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostLedger, RepairRoundTracker } from './budget.mjs';
import { assertPaidCallsAllowed, assertCredentials, paidGateStatus, redact, collectSecrets, loadProviders } from './credentials.mjs';
import { textRatesPer1kCny, textCostCny, imagePriceCny, pricingReadiness } from './pricing.mjs';
import { callGated, estimateInputTokens, assertTargetAllowed } from './gated-call.mjs';
import { startMockDeepSeek } from './mock-deepseek.mjs';
import { matchTarget } from './egress-rules.mjs';

const pocRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
let failed = 0;

function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail });
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${name} | ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}

function throws(fn) {
  try { fn(); return { threw: false, message: null }; }
  catch (e) { return { threw: true, message: e.message }; }
}

async function throwsAsync(fn) {
  try { await fn(); return { threw: false, message: null }; }
  catch (e) { return { threw: true, message: e.message }; }
}

const PAID_ON = { ENABLE_PAID_API: 'true', COST_AUTHORIZED: 'true', OPENAI_API_KEY: 'sk-MOCKONLY-0123456789abcdef', OPENAI_MODEL: 'deepseek-flash', OPENAI_BASE_URL: 'https://api.deepseek.com' };
const providers = loadProviders();
const rates = textRatesPer1kCny('deepseek-flash', providers);

// 1) 缺少 Key 时拒绝启动（且不得静默回退其他模型）
{
  const r1 = throws(() => assertCredentials({ env: { ENABLE_PAID_API: 'true', COST_AUTHORIZED: 'true' } }));
  const r2 = throws(() => assertCredentials({ env: { ...PAID_ON, OPENAI_MODEL: undefined } }));
  const r3 = throws(() => assertCredentials({ env: { ...PAID_ON, OPENAI_BASE_URL: 'https://api.openai.com/v1' } }));
  check('01 缺少 Key / 模型名 / 错误 baseUrl 一律拒绝启动',
    r1.threw && /OPENAI_API_KEY/.test(r1.message) && r2.threw && /deepseek-flash/.test(r2.message) && r3.threw,
    { 无Key: r1.message, 无模型名: r2.message, 错baseUrl: r3.message });
}

// 2) 未开启双重付费闸门时拒绝真实调用，且不触碰网络
{
  let networkTouched = 0;
  const env = { OPENAI_API_KEY: PAID_ON.OPENAI_API_KEY };
  const g1 = paidGateStatus(env);
  const g2 = paidGateStatus({ ...env, ENABLE_PAID_API: 'true' });
  const g3 = paidGateStatus({ ...env, COST_AUTHORIZED: 'true' });
  const callErr = await throwsAsync(() => callGated({ env, ledger: new CostLedger(), baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], fetchImpl: async () => { networkTouched += 1; return { ok: true, status: 200, text: async () => '{}' }; } }));
  check('02 双重付费开关任一未开 → 拒绝真实调用且不触网',
    !g1.allowPaidCalls && !g2.allowPaidCalls && !g3.allowPaidCalls && callErr.threw && networkTouched === 0,
    { 两个都关: g1.reason, 只开ENABLE: g2.reason, 只开COST: g3.reason, 调用被拒: callErr.message, networkTouched });
}

// 3) 模拟 DeepSeek usage → 人民币换算与累计（含流式）
{
  const mock = await startMockDeepSeek();
  try {
    const ledger = new CostLedger({ stateFile: null });
    const res = await callGated({ env: PAID_ON, ledger, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: 'MOCK:INPUT=1200 MOCK:OUTPUT=800 MOCK:CACHED=600 你好' }], stream: false, fetchImpl: globalThis.fetch });
    const expected = textCostCny(rates, { inputTokens: 1200, cachedInputTokens: 600, outputTokens: 800 });
    check('03a 非流式 usage 换算人民币并累计',
      Math.abs(res.cost - expected) < 1e-9 && Math.abs(ledger.spent - expected) < 1e-9 && res.actualModel === mock.actualModel,
      { cost: res.cost, expected, spent: ledger.spent, actualModel: res.actualModel });

    const ledger2 = new CostLedger();
    const res2 = await callGated({ env: PAID_ON, ledger: ledger2, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: 'MOCK:INPUT=1200 MOCK:OUTPUT=800 MOCK:CACHED=600 你好' }], stream: true, fetchImpl: globalThis.fetch });
    check('03b 流式（stream_options.include_usage）末块 usage 被采集',
      Math.abs(res2.cost - expected) < 1e-9 && res2.usage.cached === 600,
      { cost: res2.cost, usage: res2.usage });

    const ledger3 = new CostLedger();
    await callGated({ env: PAID_ON, ledger: ledger3, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: '第一笔' }], stream: false, fetchImpl: globalThis.fetch });
    await callGated({ env: PAID_ON, ledger: ledger3, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: '第二笔' }], stream: false, fetchImpl: globalThis.fetch });
    check('03c 多笔调用累计在同一账本', Math.abs(ledger3.spent - 2 * ledger3.entries[0].cost) < 1e-9 && ledger3.calls === 2, { spent: ledger3.spent, calls: ledger3.calls });
  } finally { await mock.close(); }
}

// 4) 输入 / 缓存输入 / 输出分别计价（USD/1M × 显式汇率）
{
  const fx = providers.pricing.fx.usdCny;
  const expectCacheMiss = (providers.pricing.text.models['deepseek-flash'].cacheMissInputPer1M / 1000) * fx;
  const expectCacheHit = (providers.pricing.text.models['deepseek-flash'].cacheHitInputPer1M / 1000) * fx;
  const expectOutput = (providers.pricing.text.models['deepseek-flash'].outputPer1M / 1000) * fx;
  const splitCost = textCostCny(rates, { inputTokens: 1000, cachedInputTokens: 400, outputTokens: 1000 });
  const allMiss = textCostCny(rates, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 1000 });
  check('04 三档分别计价且按显式汇率换算',
    Math.abs(rates.per1k.cacheMissInput - expectCacheMiss) < 1e-12
    && Math.abs(rates.per1k.cacheHitInput - expectCacheHit) < 1e-12
    && Math.abs(rates.per1k.output - expectOutput) < 1e-12
    && rates.per1k.cacheHitInput < rates.per1k.cacheMissInput
    && splitCost < allMiss && Math.abs(splitCost - ((600 / 1000) * expectCacheMiss + (400 / 1000) * expectCacheHit + (1000 / 1000) * expectOutput)) < 1e-6,
    { ratesPer1k: rates.per1k, fx, 全命中缓存更便宜: true, splitCost, allMiss, tier: rates.tier });
}

// 5) usage 缺失 → 强制失败（不按 0 元）
{
  const mock = await startMockDeepSeek();
  try {
    const ledger = new CostLedger();
    const err = await callGated({ env: PAID_ON, ledger, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: 'MOCK:NO_USAGE' }], stream: false, fetchImpl: globalThis.fetch }).catch((e) => e.message);
    check('05a 非流式缺 usage → 立即停止', /usage/.test(String(err)) && ledger.aborted, { err: String(err).slice(0, 80), spent: ledger.spent });

    const ledgerS = new CostLedger();
    const errS = await callGated({ env: PAID_ON, ledger: ledgerS, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: 'MOCK:NO_USAGE' }], stream: true, fetchImpl: globalThis.fetch }).catch((e) => e.message);
    check('05b 流式缺 usage 末块 → 立即停止', /usage/.test(String(errS)) && ledgerS.aborted, String(errS).slice(0, 80));

    const ledgerB = new CostLedger();
    const errB = await callGated({ env: PAID_ON, ledger: ledgerB, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: 'MOCK:CACHED_GT_INPUT' }], stream: false, fetchImpl: globalThis.fetch }).catch((e) => e.message);
    check('05c 缓存 token 大于输入（自相矛盾 usage）→ 停止', /矛盾|缓存/.test(String(errB)) && ledgerB.aborted, String(errB).slice(0, 80));

    const ledgerM = new CostLedger();
    const errM = await callGated({ env: PAID_ON, ledger: ledgerM, baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: [{ role: 'user', content: 'MOCK:NO_MODEL' }], stream: false, fetchImpl: globalThis.fetch }).catch((e) => e.message);
    check('05d 缺实际模型标识 → 停止（滚动名必须留证）', /模型/.test(String(errM)) && ledgerM.aborted, String(errM).slice(0, 90));
  } finally { await mock.close(); }
}

// 6) 2.55 元预警（不停止）
{
  const ledger = new CostLedger();
  let firstWarn = null;
  for (let i = 0; i < 400 && !firstWarn; i++) {
    const r = ledger.record({ category: 'agent', usage: { prompt_tokens: 60000, completion_tokens: 4000 }, actualModel: mockModelName(), modelSource: 'vendor-response' });
    if (r.warning) firstWarn = { round: i + 1, spent: r.spent, warning: r.warning };
  }
  check('06 累计达 2.55 元触发预警但未中止',
    firstWarn && firstWarn.spent >= 2.55 && ledger.warned && !ledger.aborted,
    firstWarn ?? { spent: ledger.spent });
}

// 7) 3 元强制停止
{
  const ledger = new CostLedger();
  let err = null;
  for (let i = 0; i < 4000 && !err; i++) {
    try { ledger.record({ category: 'agent', usage: { prompt_tokens: 60000, completion_tokens: 4000 }, actualModel: mockModelName(), modelSource: 'vendor-response' }); }
    catch (e) { err = e.message; }
  }
  check('07 累计达 3.00 元强制中止', ledger.aborted && err && /硬停/.test(err) && ledger.spent >= 3.0, { spent: Number(ledger.spent.toFixed(4)), err: String(err).slice(0, 80) });
}

// 8) 预估将越过剩余额度 → 调用前拒发（不产生费用）
{
  const ledger = new CostLedger();
  const before = ledger.spent;
  const err = throws(() => ledger.preCheck({ inputTokens: 40_000_000, outputTokens: ledger.maxOutputTokens }));
  check('08 预检查：预估越额直接拒发调用', err.threw && /预检查拒绝发起/.test(err.message) && ledger.spent === before, err.message);
}

// 9) 修复最多 2 轮 + 修复费用进同一账本
{
  const tracker = new RepairRoundTracker(2);
  const seq = [tracker.onResult(false), tracker.onResult(false), tracker.onResult(false)];
  const ledger = new CostLedger();
  ledger.record({ category: 'agent', usage: { prompt_tokens: 1000, completion_tokens: 500 }, actualModel: mockModelName(), modelSource: 'vendor-response' });
  ledger.record({ category: 'repair', usage: { prompt_tokens: 1000, completion_tokens: 500 }, actualModel: mockModelName(), modelSource: 'vendor-response', repairRound: 1 });
  ledger.record({ category: 'repair', usage: { prompt_tokens: 1000, completion_tokens: 500 }, actualModel: mockModelName(), modelSource: 'vendor-response', repairRound: 2 });
  const s = ledger.summary();
  check('09 修复上限 2 轮，且修复费用与主 Agent 同账本',
    seq.map((x) => x.status).join(',') === 'repair,repair,failed'
    && s.repairsUsed === 2
    && s.byCategory.repair.calls === 2
    && Math.abs(s.spentCny - Number((s.byCategory.agent.spent + s.byCategory.repair.spent).toFixed(4))) < 1e-6,
    { seq: seq.map((x) => x.status), repairsUsed: s.repairsUsed, byCategory: { agent: s.byCategory.agent.spent, repair: s.byCategory.repair.spent }, spent: s.spentCny });
}

// 10) 图片最多 3 张 + 单价未确认时安全失败
{
  const priced = { ...providers, pricing: { ...providers.pricing, image: { currency: 'CNY', unit: 'per_image', pricePerImage: 0.2 } } };
  const ledger = new CostLedger({ providers: priced });
  ledger.record({ category: 'agent', usage: { prompt_tokens: 100, completion_tokens: 100 }, actualModel: mockModelName(), modelSource: 'vendor-response' });
  ledger.record({ category: 'image', images: 3, actualModel: 'wan2.5-t2i-preview', modelSource: 'vendor-response' });
  const fourth = throws(() => ledger.record({ category: 'image', images: 1, actualModel: 'wan2.5-t2i-preview', modelSource: 'vendor-response' }));
  const ledgerMixed = new CostLedger({ providers: priced });
  const mixedAbortsSameLedger = ledgerMixed.summary().byCategory.image !== undefined
    && (() => { ledgerMixed.record({ category: 'image', images: 1, actualModel: 'wan2.5-t2i-preview', modelSource: 'vendor-response' }); return Math.abs(ledgerMixed.spent - 0.2) < 1e-9; })();
  check('10a 第 4 张图片被拒绝（上限 3 张，图片费用进同一账本）',
    fourth.threw && /图片数量超上限/.test(fourth.message) && ledger.summary().byCategory.image.spent === 0.6 && mixedAbortsSameLedger,
    { err: fourth.message, imageSpent: ledger.summary().byCategory.image.spent, totalSpent: ledger.spent });

  const pendingPrice = throws(() => imagePriceCny(loadProviders()));
  const pendingLedger = new CostLedger();
  const imgCall = throws(() => pendingLedger.preCheck({ images: 1 }));
  check('10b 万相单张价未确认 → 图片调用被拒绝（不按 0 元）',
    pendingPrice.threw && /图片单张价未确认/.test(pendingPrice.message) && imgCall.threw,
    { err: pendingPrice.message.slice(0, 60) });
}

// 11) 账本状态落盘可恢复
{
  const stateFile = '/tmp/opengame-ledger-state-test.json';
  try {
    const a = new CostLedger({ stateFile });
    a.record({ category: 'agent', usage: { prompt_tokens: 1000, completion_tokens: 500 }, actualModel: mockModelName(), modelSource: 'vendor-response' });
    const spentA = a.spent;
    const b = new CostLedger({ stateFile });
    check('11 账本进程重启后可恢复', Math.abs(b.spent - spentA) < 1e-9 && b.calls === 1 && b.entries.length === 1, { spentA, restored: b.spent, calls: b.calls });
  } finally { if (existsSync(stateFile)) unlinkSync(stateFile); }
}

// 12) 网络白名单规则：DeepSeek 放行，其他模型域 / RUM / 非 443 / IP 拒绝
{
  const allow = JSON.parse(readFileSync(join(pocRoot, 'config/egress-allowlist.json'), 'utf8'));
  const cases = [
    { host: 'api.deepseek.com', port: 443, expect: 'model' },
    { host: 'dashscope.aliyuncs.com', port: 443, expect: 'image' },
    { host: 'api.openai.com', port: 443, expect: null },
    { host: 'ark.cn-beijing.volces.com', port: 443, expect: null },
    { host: 'dashscope-intl.aliyuncs.com', port: 443, expect: null },
    { host: 'gb4w8c3ygj-default-sea.rum.aliyuncs.com', port: 443, expect: null },
    { host: 'rum.aliyuncs.com', port: 443, expect: null },
    { host: 'api.deepseek.com', port: 80, expect: null },
    { host: 'api.deepseek.com', port: 8443, expect: null },
    { host: 'apdeepseek.com.evil.example', port: 443, expect: null },
    { host: '1.1.1.1', port: 443, expect: null },
    { host: '2606:4700::6810:1f1f', port: 443, expect: null }
  ];
  const bad = cases.filter((c) => (matchTarget(allow, c.host, c.port)?.category ?? null) !== c.expect);
  const emptyDeny = matchTarget({ default: 'deny', categories: {} }, 'api.deepseek.com', 443) === null;
  check('12 白名单规则：仅 model/image 分组 443 放行，RUM/其他模型/错端口/IP 全拒',
    bad.length === 0 && emptyDeny,
    { 用例数: cases.length, 失败: bad, 空白名单安全失败: emptyDeny });
}

// 13) 日志不回显 Key
{
  const key = PAID_ON.OPENAI_API_KEY;
  const raw = `请求失败 Authorization: Bearer ${key}; base=${PAID_ON.OPENAI_BASE_URL}`;
  const red = redact(raw, collectSecrets(PAID_ON));

  // 模拟"底层错误里带 Key"（某些 SDK 会回显请求），闸门必须脱敏后再抛
  const leakyFetch = async () => { throw new Error(`fetch failed: bearer ${key} rejected`); };
  const leakyErr = await throwsAsync(() => callGated({
    env: PAID_ON, ledger: new CostLedger(), baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash',
    messages: [{ role: 'user', content: 'hi' }], fetchImpl: leakyFetch
  }));

  // 服务返回 4xx 且错误体里回显了凭据时，错误信息同样脱敏
  const echoErrFetch = async () => ({ ok: false, status: 400, text: async () => `invalid_request_error | sent-with: Bearer ${key}` });
  let httpErrMsg = '';
  await callGated({ env: PAID_ON, ledger: new CostLedger(), baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], stream: false, fetchImpl: echoErrFetch })
    .catch((e) => { httpErrMsg = String(e.message); });

  check('13 密钥不进日志（脱敏生效；底层错误与 HTTP 错误均不回显 Key）',
    !red.includes(key) && red.includes('***REDACTED***')
    && !String(leakyErr.message).includes(key) && /REDACTED/.test(String(leakyErr.message))
    && httpErrMsg.length > 0 && !httpErrMsg.includes(key) && /REDACTED/.test(httpErrMsg),
    { 脱敏样例: red.slice(0, 52), 底层错误: String(leakyErr.message).slice(0, 52), http错误: httpErrMsg.slice(0, 40) });
}

// 14) 多轮工具调用的 reasoning_content 回传（本地协议自测，不代表真实供应商已验证）
{
  const mock = await startMockDeepSeek();
  try {
    const withoutReasoning = [{ role: 'user', content: 'build' }, { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'ok' }];
    const withReasoning = [{ role: 'user', content: 'build' }, { role: 'assistant', content: null, reasoning_content: '我先看目录', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: 'ok' }];
    const wideLedger = () => new CostLedger({ providers: { ...providers, budget: { ...providers.budget, maxOutputTokensPerCall: 100000 } } });
    const err = await callGated({ env: PAID_ON, ledger: wideLedger(), baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: withoutReasoning, stream: false, fetchImpl: globalThis.fetch }).catch((e) => e.message);
    const ok = await callGated({ env: PAID_ON, ledger: wideLedger(), baseUrl: mock.baseUrl, model: 'deepseek-flash', messages: withReasoning, stream: false, fetchImpl: globalThis.fetch });
    check('14 本地协议自测：缺 reasoning_content 被拒 / 带回则通过（真实供应商行为仍待验证）',
      /reasoning_content/.test(String(err)) && ok.spent > 0,
      { 缺字段被拒: String(err).slice(0, 70), 带回通过: ok.actualModel });
  } finally { await mock.close(); }
}

// 15) 输入 token 预估函数保守为正（闸门可用）
check('15 调用前输入 token 预估计为正数', estimateInputTokens([{ role: 'user', content: 'x'.repeat(4000) }]) > 0, { est: estimateInputTokens([{ role: 'user', content: 'x'.repeat(4000) }]) });

// 16) apps/ifplay-m0/ 保持零改动
{
  const worktree = '/Users/a123/Documents/Codex/2026-09-15/ifplay-opengame-poc/worktree';
  const diff = execFileSync('git', ['-C', worktree, 'diff', '--stat', '--', 'apps/ifplay-m0/'], { encoding: 'utf8' }).trim();
  const status = execFileSync('git', ['-C', worktree, 'status', '--porcelain', '--', 'apps/ifplay-m0/'], { encoding: 'utf8' }).trim();
  check('16 apps/ifplay-m0/ 零改动', diff === '' && status === '', { diff, status });
}

// 17) 定价就绪度（供报告引用）
{
  const ready = pricingReadiness(providers);
  check('17 定价就绪度如实记录（文本=已配 peak 价，图片=待确认，汇率=显式占位待确认）',
    ready.text.ready === true && ready.image.ready === false && typeof ready.fx.usdCny === 'number',
    { text: ready.text.per1k, image: ready.image.reason?.slice(0, 40), fx: ready.fx });
}

// 18) OpenGame CLI usage 事件回灌统一账本（缺 usage 即停）
{
  const { ingestLogFile } = await import('./ingest-usage.mjs');
  const logFile = '/tmp/opengame-cli-usage-test.jsonl';
  writeFileSync(logFile, [
    JSON.stringify({ type: 'assistant', model: 'deepseek-flash', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, total_tokens: 1500 } }),
    JSON.stringify({ type: 'assistant', model: 'deepseek-flash', usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, total_tokens: 1500 } }),
    JSON.stringify({ type: 'assistant', model: 'deepseek-flash', usage: { input_tokens: 900 } }),
    'not-json'
  ].join('\n') + '\n');
  try {
    const ledger = new CostLedger();
    const stats = ingestLogFile(logFile, { ledger, category: 'agent' });
    const expected2 = 2 * textCostCny(rates, { inputTokens: 1000, cachedInputTokens: 200, outputTokens: 500 });
    check('18 CLI usage 事件回灌同一账本；缺 usage 的行触发停止',
      stats.recorded === 2 && stats.aborted === true && Math.abs(ledger.spent - expected2) < 1e-6 && ledger.aborted,
      { recorded: stats.recorded, skipped: stats.skipped, spent: ledger.spent, abortReason: String(stats.abortReason).slice(0, 40) });
  } finally { unlinkSync(logFile); }
}

// 19) 白名单未配置/空白名单 → 安全失败（默认拒绝，绝不放行）
{
  const noneFile = join(pocRoot, 'config/egress-allowlist.none.json');
  const r1 = throws(() => assertTargetAllowed('https://api.deepseek.com/v1', noneFile));
  const r2 = throws(() => assertTargetAllowed('https://api.deepseek.com/v1', join(pocRoot, 'config/__no_such_allowlist.json')));
  const r3 = matchTarget({ categories: {} }, 'api.deepseek.com', 443);
  const r4 = matchTarget({}, 'api.deepseek.com', 443);
  const ok = assertTargetAllowed('https://api.deepseek.com/v1');
  check('19 白名单未配置/空白名单一律安全失败（默认拒绝），已配置时才放行 model 分组',
    r1.threw && /白名单/.test(r1.message) && r2.threw && r3 === null && r4 === null && ok.category === 'model',
    { 空白名单: r1.message.slice(0, 46), 配置缺失: r2.threw, 空categories: r3, 无categories字段: r4, 已配置: ok });
}

function mockModelName() { return 'DeepSeek-V3.1-mock-20261003'; }

const out = {
  generatedAt: new Date().toISOString(),
  phase: '阶段二 · DeepSeek 接入准备（零费用测试）',
  costCny: 0,
  realApiCalled: false,
  passed: results.filter((r) => r.pass).length,
  total: results.length,
  failed: results.filter((r) => !r.pass).map((r) => r.name),
  results
};
console.log(`\n[deepseek-selftest] ${out.passed}/${out.total} PASS，真实调用 0 次，费用 0 元`);
console.log(JSON.stringify(out, null, 2));
process.exit(failed === 0 ? 0 : 1);
