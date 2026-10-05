// 费用计量 + 自动修复轮次（阶段一自测为模拟，不产生真实调用）
// 费用闸门规则（对应 config/opengame.json 的 budget/metering）：
//   1) 调用前预检查：按剩余预算 + maxOutputTokens + 输入 token 估算最坏成本，超有效预算则不发调用
//   2) 单次调用必须设置最大输出 token
//   3) 文本/推理/图片/自动修复费用全部计入单款 3 元
//   4) 响应缺少 usage 时默认停止（不能按 0 元处理）
//   5) 达到预算前预留安全余量 safetyMargin
//   6) 图片数量上限 maxImages（超上限即停）
// 注：阶段二起闸门语义按 2.55 元预警 / 3.00 元硬停执行，见下方 CostLedger（阶段一的
//     effectiveBudget=perGame*(1-safetyMargin) 硬停口径已由预警线取代）。
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { loadProviders } from './credentials.mjs';
import { textRatesPer1kCny, textCostCny, imagePriceCny } from './pricing.mjs';

export const LEDGER_CATEGORIES = ['agent', 'reasoning', 'repair', 'image'];

export class CostTracker {
  constructor({
    perGameCny = 3.0,
    pricing = { input: 0.002, output: 0.006 },
    imagePrice = 0.0,
    safetyMargin = 0.15,
    maxOutputTokens = 4096,
    maxImages = 3
  }) {
    this.perGameCny = perGameCny;
    this.pricing = pricing;
    this.imagePrice = imagePrice;
    this.safetyMargin = safetyMargin;
    this.maxOutputTokens = maxOutputTokens;
    this.maxImages = maxImages;
    this.effectiveBudget = perGameCny * (1 - safetyMargin); // 预留安全余量后的有效预算
    this.spent = 0;
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.images = 0;
    this.aborted = false;
    this.abortReason = null;
  }

  // 调用前预检查：估算单次调用最坏成本，超有效预算则中止（不发起调用）
  preCheck({ inputTokens = 0, images = 0 } = {}) {
    if (this.images + images > this.maxImages) {
      this.aborted = true;
      this.abortReason = `图片数量超上限：累计 ${this.images + images} > ${this.maxImages}`;
      throw new Error(this.abortReason);
    }
    const worstInput = (inputTokens / 1000) * this.pricing.input;
    const worstOutput = (this.maxOutputTokens / 1000) * this.pricing.output;
    const imgCost = images * this.imagePrice;
    const worst = worstInput + worstOutput + imgCost;
    if (this.spent + worst > this.effectiveBudget) {
      this.aborted = true;
      this.abortReason = `预检查中止：本次最坏 ${worst.toFixed(4)} 元，累计将达 ${(this.spent + worst).toFixed(4)} 元 > 有效预算 ${this.effectiveBudget.toFixed(4)} 元`;
      throw new Error(this.abortReason);
    }
    return { worst, spent: this.spent, effectiveBudget: this.effectiveBudget, remaining: this.effectiveBudget - this.spent };
  }

  // 调用后记账：usage 缺失默认停止；计入文本/图片成本；超有效预算中止
  account(usage, images = 0) {
    if (this.images + images > this.maxImages) {
      this.aborted = true;
      this.abortReason = `图片数量超上限：累计 ${this.images + images} > ${this.maxImages}`;
      throw new Error(this.abortReason);
    }
    const input = usage?.input_tokens ?? usage?.prompt_tokens;
    const output = usage?.output_tokens ?? usage?.completion_tokens;
    if (input === undefined || input === null || output === undefined || output === null) {
      this.aborted = true;
      this.abortReason = '响应缺少 usage，按停止处理（不能按 0 元）';
      throw new Error(this.abortReason);
    }
    if (output > this.maxOutputTokens) {
      this.aborted = true;
      this.abortReason = `输出 token ${output} 超过单次上限 ${this.maxOutputTokens}`;
      throw new Error(this.abortReason);
    }
    this.inputTokens += input;
    this.outputTokens += output;
    this.images += images;
    const cost = (input / 1000) * this.pricing.input + (output / 1000) * this.pricing.output + images * this.imagePrice;
    this.spent += cost;
    if (this.spent >= this.effectiveBudget) {
      this.aborted = true;
      this.abortReason = `累计 ${this.spent.toFixed(4)} 元 ≥ 有效预算 ${this.effectiveBudget.toFixed(4)} 元`;
      throw new Error(this.abortReason);
    }
    return { input, output, images, cost, spent: this.spent };
  }

  summary() {
    return {
      perGameCny: this.perGameCny,
      safetyMargin: this.safetyMargin,
      effectiveBudget: Number(this.effectiveBudget.toFixed(4)),
      maxOutputTokens: this.maxOutputTokens,
      maxImages: this.maxImages,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      images: this.images,
      spent: Number(this.spent.toFixed(4)),
      aborted: this.aborted,
      abortReason: this.abortReason
    };
  }
}

// 自动修复轮次确定性计数（可持久化恢复）：
//   首轮生成→验收→(失败)修复#1→(失败)修复#2→(仍失败)判定失败
// state 落盘到 stateFile，进程重启后 load 恢复。
export class RepairRoundTracker {
  constructor(maxRepairs = 2, stateFile = null) {
    this.maxRepairs = maxRepairs;
    this.stateFile = stateFile;
    this.attempts = 0;
    this.repairsUsed = 0;
    if (stateFile && existsSync(stateFile)) {
      const s = JSON.parse(readFileSync(stateFile, 'utf8'));
      this.attempts = s.attempts ?? 0;
      this.repairsUsed = s.repairsUsed ?? 0;
    }
  }

  _persist() {
    if (this.stateFile) writeFileSync(this.stateFile, JSON.stringify({ attempts: this.attempts, repairsUsed: this.repairsUsed, maxRepairs: this.maxRepairs }));
  }

  onResult(pass) {
    this.attempts += 1;
    if (pass) {
      this._persist();
      return { status: 'passed', attempts: this.attempts, repairsUsed: this.repairsUsed };
    }
    if (this.repairsUsed < this.maxRepairs) {
      this.repairsUsed += 1;
      this._persist();
      return { status: 'repair', round: this.repairsUsed, attempts: this.attempts, repairsUsed: this.repairsUsed };
    }
    this._persist();
    return { status: 'failed', attempts: this.attempts, repairsUsed: this.repairsUsed };
  }
}

// 统一账本：主 Agent / reasoning / 图片 / 自动修复四类费用共用一份单款额度。
// 2.55 元预警、3.00 元硬停；调用前预估可能越过剩余额度则不发调用；
// usage 缺失或实际模型标识缺失即停止；状态落盘可恢复。
export class CostLedger {
  constructor({ providers = loadProviders(), model = null, stateFile = null } = {}) {
    this.providers = providers;
    const b = providers.budget;
    this.model = model ?? providers.model.modelRequested;
    this.perGameCny = b.perGameCny;
    this.warnCny = b.warnCny;
    this.hardStopCny = b.hardStopCny ?? b.perGameCny;
    this.maxOutputTokens = b.maxOutputTokensPerCall;
    this.maxImages = b.maxImagesPerGame;
    this.textRates = textRatesPer1kCny(this.model, providers);
    this.stateFile = stateFile;
    this.spent = 0;
    this.warned = false;
    this.aborted = false;
    this.abortReason = null;
    this.images = 0;
    this.calls = 0;
    this.repairsUsed = 0;
    this.tokens = { input: 0, cachedInput: 0, output: 0 };
    this.byCategory = Object.fromEntries(LEDGER_CATEGORIES.map((c) => [c, { calls: 0, spent: 0, images: 0, tokens: { input: 0, cachedInput: 0, output: 0 } }]));
    this.entries = [];
    this.actualModels = new Set();
    if (stateFile && existsSync(stateFile)) {
      const s = JSON.parse(readFileSync(stateFile, 'utf8'));
      this.spent = s.spent ?? 0;
      this.warned = s.warned ?? false;
      this.aborted = s.aborted ?? false;
      this.abortReason = s.abortReason ?? null;
      this.images = s.images ?? 0;
      this.calls = s.calls ?? 0;
      this.repairsUsed = s.repairsUsed ?? 0;
      this.tokens = s.tokens ?? this.tokens;
      this.byCategory = s.byCategory ?? this.byCategory;
      this.entries = s.entries ?? [];
      this.actualModels = new Set(s.actualModels ?? []);
    }
  }

  _persist() {
    if (!this.stateFile) return;
    writeFileSync(this.stateFile, JSON.stringify({
      spent: this.spent, warned: this.warned, aborted: this.aborted, abortReason: this.abortReason,
      images: this.images, calls: this.calls, repairsUsed: this.repairsUsed, tokens: this.tokens,
      byCategory: this.byCategory, entries: this.entries, actualModels: [...this.actualModels],
      model: this.model, perGameCny: this.perGameCny, warnCny: this.warnCny, hardStopCny: this.hardStopCny
    }));
  }

  _abort(reason) {
    this.aborted = true;
    this.abortReason = reason;
    this._persist();
    throw new Error(reason);
  }

  estimateCall({ inputTokens = 0, cachedInputTokens = 0, outputTokens = this.maxOutputTokens, images = 0 } = {}) {
    const text = images === 0 || inputTokens > 0 || outputTokens > 0
      ? textCostCny(this.textRates, { inputTokens, cachedInputTokens, outputTokens })
      : 0;
    const img = images > 0 ? imagePriceCny(this.providers) * images : 0;
    return Number((text + img).toFixed(6));
  }

  // 调用前闸门：预估已可能越过剩余额度则拒绝发起
  preCheck(opts = {}) {
    if (this.aborted) throw new Error(`账本已中止：${this.abortReason}`);
    const images = opts.images ?? 0;
    if (this.images + images > this.maxImages) {
      this._abort(`图片数量超上限：累计 ${this.images + images} > ${this.maxImages}`);
    }
    const est = this.estimateCall(opts);
    if (this.spent + est > this.hardStopCny) {
      this._abort(`预检查拒绝发起：本次预估 ${est.toFixed(4)} 元，累计将达 ${(this.spent + est).toFixed(4)} 元 > 硬停 ${this.hardStopCny} 元`);
    }
    const warning = !this.warned && this.spent + est >= this.warnCny;
    return { est, spent: this.spent, remaining: Number((this.hardStopCny - this.spent).toFixed(4)), warning };
  }

  // 调用后记账：usage / 实际模型标识缺失即停止；四类进同一账本
  // modelSource: 'vendor-response'（接口返回的 model 字段，首选） | 'cli-config'（只有请求名， provenance 不足）
  record({ category, usage, images = 0, actualModel, modelSource, inputTokensEstimate = 0, repairRound = null } = {}) {
    if (!LEDGER_CATEGORIES.includes(category)) {
      throw new Error(`未知费用类别 ${category}，必须是 ${LEDGER_CATEGORIES.join('/')} 之一`);
    }
    if (this.aborted) throw new Error(`账本已中止：${this.abortReason}`);
    if (this.images + images > this.maxImages) {
      this._abort(`图片数量超上限：累计 ${this.images + images} > ${this.maxImages}`);
    }
    const input = usage?.prompt_tokens ?? usage?.input_tokens;
    const output = usage?.completion_tokens ?? usage?.output_tokens;
    const isImageOnly = category === 'image' && !usage;
    if (!isImageOnly && (input === undefined || input === null || output === undefined || output === null)) {
      this._abort('响应缺少 usage，立即停止（绝不按 0 元处理）');
    }
    if (isImageOnly && images <= 0) {
      this._abort('图片记账必须给出实际产出张数（张数缺失=记账不完整）');
    }
    if (output > this.maxOutputTokens) {
      this._abort(`单次输出 ${output} token 超过上限 ${this.maxOutputTokens}`);
    }
    const cached = usage?.prompt_tokens_details?.cached_tokens ?? usage?.cached_tokens ?? usage?.cache_read_input_tokens ?? 0;
    if (!actualModel || !modelSource) {
      this._abort('缺少实际模型标识：deepseek-flash 是滚动模型名，必须记录模型来源（vendor-response/cli-config）与实际返回名，账本不完整即停止');
    }
    const effInput = isImageOnly ? 0 : input;
    const effOutput = isImageOnly ? 0 : output;
    let cost;
    try {
      cost = isImageOnly
        ? Number((imagePriceCny(this.providers) * images).toFixed(6))
        : Number((textCostCny(this.textRates, { inputTokens: effInput, cachedInputTokens: cached, outputTokens: effOutput })
          + (images > 0 ? imagePriceCny(this.providers) * images : 0)).toFixed(6));
    } catch (e) {
      this._abort(e.message);
      return;
    }

    this.spent = Number((this.spent + cost).toFixed(6));
    this.calls += 1;
    this.images += images;
    if (category === 'repair' && repairRound !== null) this.repairsUsed = Math.max(this.repairsUsed, repairRound);
    this.tokens.input += effInput;
    this.tokens.cachedInput += cached;
    this.tokens.output += effOutput;
    const cat = this.byCategory[category];
    cat.calls += 1;
    cat.images += images;
    cat.tokens.input += effInput;
    cat.tokens.cachedInput += cached;
    cat.tokens.output += effOutput;
    cat.spent = Number((cat.spent + cost).toFixed(6));
    this.actualModels.add(`${actualModel} <== ${modelSource}`);
    this.entries.push({ ts: new Date().toISOString(), category, model: this.model, actualModel, modelSource, input: effInput, cachedInput: cached, output: effOutput, images, cost, spent: this.spent, repairRound });

    if (!this.warned && this.spent >= this.warnCny) {
      this.warned = true;
      this._persist();
      return { cost, spent: this.spent, warning: `累计 ${this.spent.toFixed(4)} 元 ≥ 预警线 ${this.warnCny} 元` };
    }
    if (this.spent >= this.hardStopCny) {
      this._abort(`累计 ${this.spent.toFixed(4)} 元 ≥ 硬停线 ${this.hardStopCny} 元，强制中止`);
    }
    this._persist();
    return { cost, spent: this.spent, warning: null };
  }

  // OpenGame 非交互 JSON 输出的 usage 事件 → 账本入参
  // 字段来源：packages/cli/src/nonInteractive/io/BaseJsonOutputAdapter.ts:180-205
  static usageFromCliEvent(evt) {
    const u = evt?.usage ?? evt;
    return {
      prompt_tokens: u?.input_tokens,
      completion_tokens: u?.output_tokens,
      cached_tokens: u?.cache_read_input_tokens ?? 0
    };
  }

  summary() {
    return {
      model: this.model,
      actualModels: [...this.actualModels],
      tier: this.textRates.tier,
      perGameCny: this.perGameCny,
      warnCny: this.warnCny,
      hardStopCny: this.hardStopCny,
      maxOutputTokens: this.maxOutputTokens,
      maxImages: this.maxImages,
      spentCny: Number(this.spent.toFixed(4)),
      warned: this.warned,
      aborted: this.aborted,
      abortReason: this.abortReason,
      calls: this.calls,
      images: this.images,
      repairsUsed: this.repairsUsed,
      tokens: this.tokens,
      byCategory: this.byCategory,
      entryCount: this.entries.length,
      ratesCnyPer1k: this.textRates.per1k
    };
  }
}

// 自测（模拟，不调用任何 API）
export function selfTest() {
  const out = {};

  // 1) 费用中止：超预算触发
  {
    const t = new CostTracker({ perGameCny: 3.0, safetyMargin: 0.15, maxOutputTokens: 4096, maxImages: 3, pricing: { input: 0.002, output: 0.006 }, imagePrice: 0.1 });
    try {
      for (let i = 0; i < 500; i++) t.preCheck({ inputTokens: 10000 }) && t.account({ input_tokens: 10000, output_tokens: 3000 });
    } catch (e) { out.overBudgetAbort = { triggered: true, error: e.message, ...t.summary() }; }
    if (!out.overBudgetAbort) out.overBudgetAbort = { triggered: false, ...t.summary() };
  }

  // 2) 预检查：单次调用最坏成本超剩余预算 → 调用前即中止
  {
    const t = new CostTracker({ perGameCny: 3.0, safetyMargin: 0.15, maxOutputTokens: 4096, maxImages: 3, pricing: { input: 0.002, output: 0.006 }, imagePrice: 0.1 });
    t.preCheck({ inputTokens: 1000 }); t.account({ input_tokens: 1000, output_tokens: 3000 });
    try { t.preCheck({ inputTokens: 2_000_000 }); out.preCheckAbort = { triggered: false, ...t.summary() }; }
    catch (e) { out.preCheckAbort = { triggered: true, error: e.message, ...t.summary() }; }
  }

  // 3) usage 缺失 → 停止
  {
    const t = new CostTracker({ perGameCny: 3.0, safetyMargin: 0.15, maxOutputTokens: 4096, maxImages: 3, pricing: { input: 0.002, output: 0.006 } });
    try { t.account({}); out.noUsage = { stopped: false, ...t.summary() }; }
    catch (e) { out.noUsage = { stopped: true, error: e.message, ...t.summary() }; }
  }

  // 4) 图片数量上限：第 4 张图应中止
  {
    const t = new CostTracker({ perGameCny: 3.0, safetyMargin: 0.15, maxOutputTokens: 4096, maxImages: 3, pricing: { input: 0.002, output: 0.006 }, imagePrice: 0.1 });
    try {
      t.account({ input_tokens: 100, output_tokens: 100 }, 3);
      t.account({ input_tokens: 100, output_tokens: 100 }, 1); // 第 4 张
      out.imageLimit = { triggered: false, ...t.summary() };
    } catch (e) { out.imageLimit = { triggered: true, error: e.message, ...t.summary() }; }
  }

  // 5) 修复轮次确定性 + 持久化恢复
  {
    const seq = new RepairRoundTracker(2);
    const allFail = [seq.onResult(false), seq.onResult(false), seq.onResult(false)];
    const seq2 = new RepairRoundTracker(2);
    const passAfter = [seq2.onResult(false), seq2.onResult(false), seq2.onResult(true)];
    out.repairRounds = {
      maxRepairs: 2,
      allFailSequence: allFail.map((s) => s.status),
      finalState: allFail[allFail.length - 1].status,
      passAfterTwoRepairs: passAfter.map((s) => s.status)
    };
  }
  // 5b) 持久化：状态写盘后，新实例 load 恢复
  {
    const stateFile = '/tmp/opengame-repair-state-test.json';
    try {
      const a = new RepairRoundTracker(2, stateFile);
      a.onResult(false); a.onResult(false); // 已用 2 轮修复
      const b = new RepairRoundTracker(2, stateFile); // 重启后恢复
      out.repairPersistence = { recoveredAttempts: b.attempts, recoveredRepairsUsed: b.repairsUsed, next: b.onResult(false).status };
    } finally { try { unlinkSync(stateFile); } catch {} }
  }

  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(selfTest(), null, 2));
}
