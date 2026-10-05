// OpenGame PoC · 管线编排（阶段一：零费用空跑）
// 生成(stub)→构建→浏览器测试→报告→费用/修复计量；阶段一 generate 为 stub，不调用任何模型。
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostTracker, RepairRoundTracker, selfTest } from './budget.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pocRoot = join(__dirname, '..');
const config = JSON.parse(await readFile(join(pocRoot, 'config/opengame.json'), 'utf8'));
const selftestDir = join(pocRoot, 'fixtures/selftest');

function run(cmd, args) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 180_000 });
    return { ok: true, output: out };
  } catch (e) {
    return { ok: false, output: (e.stdout || '') + (e.stderr || ''), error: e.message };
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  phase: '阶段一（零费用空跑）',
  opengame: { repo: config.opengame.repo, shaLocked: config.opengame.shaLocked, candidateSha: config.opengame.candidateSha },
  isolation: config.isolation,
  steps: []
};

// 1) 生成（stub，明确不真实生成）
report.steps.push({
  step: 'generate',
  status: 'SKIPPED',
  note: '阶段一无真实生成：不调模型、不计费、不读任何 Key。阶段二经确认后在容器内真实执行。'
});

// 2) 构建关：真实依赖安装 + 正式构建，保存退出码与日志摘要（阶段二改容器内执行）
const build = run('node', [join(pocRoot, 'evaluators/build.mjs'), selftestDir]);
report.steps.push({
  step: 'build-evaluator',
  fixture: 'fixtures/selftest（评估器自测，非 OpenGame 生成）',
  pass: build.ok,
  detail: build.ok ? JSON.parse(build.output) : build.output
});

// 3) 浏览器关：本地静态服务器 + 外网请求直接阻断 + 点击交互断言
const browser = run('node', [
  join(pocRoot, 'evaluators/browser.mjs'), selftestDir, '--click', '#serve', '--expect', '#round'
]);
report.steps.push({
  step: 'browser-evaluator',
  fixture: 'fixtures/selftest（评估器自测，非 OpenGame 生成）',
  pass: browser.ok,
  detail: browser.ok ? JSON.parse(browser.output) : browser.output
});

// 4) 费用闸门 + 修复轮次自测（模拟 token，不产生真实调用）
const metering = selfTest();
report.steps.push({
  step: 'metering-selftest',
  note: '模拟验证：预算预检查/超预算中止/usage 缺失停止/图片计费/最多 2 轮修复确定性计数。非真实调用。',
  detail: metering
});

// 5) 阶段二 DeepSeek 接入闸门自测（本地假服务 + 纯函数，零费用、零真实调用）
const deepseek = run('node', [join(pocRoot, 'runner/deepseek-selftest.mjs')]);
let deepseekSummary = null;
if (deepseek.ok) {
  const idx = deepseek.output.indexOf('{\n  "generatedAt"');
  try { deepseekSummary = JSON.parse(deepseek.output.slice(idx)); } catch { deepseekSummary = null; }
}
report.steps.push({
  step: 'deepseek-gate-selftest',
  note: '零费用：缺 Key 拒启 / 双重付费闸门 / usage 换算 / 分档计价 / 缺 usage 停止 / 2.55 预警 / 3 元硬停 / 修复 2 轮 / 图片 3 张 / 白名单规则 / 密钥脱敏 / CLI usage 回灌 / apps 零改动',
  pass: deepseek.ok,
  detail: deepseekSummary ? { passed: deepseekSummary.passed, total: deepseekSummary.total, failed: deepseekSummary.failed, realApiCalled: deepseekSummary.realApiCalled, costCny: deepseekSummary.costCny } : deepseek.output.slice(0, 400)
});

// 5b) 付费闸门在本环境必须是关闭的（空跑证明拒绝真实调用）
const gate = run('node', ['-e', `import(${JSON.stringify(join(pocRoot, 'runner/credentials.mjs'))}).then((m)=>console.log(JSON.stringify(m.paidGateStatus(process.env))))`]);
let gateStatus = null;
try { gateStatus = JSON.parse(gate.output); } catch { gateStatus = null; }
report.steps.push({
  step: 'paid-gate',
  note: 'dry-run 环境必须两开关皆关；任一开启而不带 --execute 也不会发起调用（真实调用需用户明确费用授权）',
  pass: gate.ok && gateStatus && gateStatus.allowPaidCalls === false,
  detail: gateStatus ?? gate.output.slice(0, 200)
});

// 6) 写报告
const reportPath = join(pocRoot, 'reports', `空跑演练-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await mkdir(join(pocRoot, 'reports'), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));

report.reportFile = reportPath;
report.summary = {
  buildPass: build.ok,
  browserPass: browser.ok,
  costGatePreCheck: metering.preCheckAbort?.triggered === true,
  costGateOverBudget: metering.overBudgetAbort?.triggered === true,
  noUsageStops: metering.noUsage?.stopped === true,
  imageLimitEnforced: metering.imageLimit?.triggered === true,
  repairRoundsDeterministic: metering.repairRounds?.finalState === 'failed',
  repairStateRecoverable: metering.repairPersistence?.recoveredRepairsUsed === 2 && metering.repairPersistence?.next === 'failed',
  generationSkipped: true,
  noPaidApiCalled: true,
  deepseekGateSelftest: deepseekSummary ? `${deepseekSummary.passed}/${deepseekSummary.total}` : 'FAILED',
  deepseekRealApiCalled: false,
  paidGateClosedInDryRun: gateStatus ? gateStatus.allowPaidCalls === false : null,
  isolationMode: config.isolation.mode,
  egressMode: config.egress?.mode
};

console.log(JSON.stringify(report, null, 2));
