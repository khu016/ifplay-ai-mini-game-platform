// 把 OpenGame 非交互 JSON 输出的 usage 事件回灌统一账本（阶段二记账链路）
// 字段来源：packages/cli/src/nonInteractive/io/BaseJsonOutputAdapter.ts:180-205
//   usage.input_tokens / output_tokens / cache_read_input_tokens / total_tokens
// 注意：CLI 消息里的 model 是"请求名"（this.config.getModel()，同文件 :248），不是接口返回的实际模型标识；
//       因此入账 modelSource='cli-config'，滚动模型名的真实版本仍需 vendor-response 才能确认（见阶段二准备报告待办）。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CostLedger } from './budget.mjs';

const pocRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export function ingestLogFile(logPath, { ledger, category = 'agent', defaultModel = 'deepseek-flash' }) {
  const lines = readFileSync(logPath, 'utf8').split('\n').filter((l) => l.trim().startsWith('{'));
  const stats = { linesScanned: lines.length, recorded: 0, skipped: 0, warnings: [] };
  for (const line of lines) {
    let evt;
    try { evt = JSON.parse(line); } catch { stats.skipped += 1; continue; }
    const usage = evt?.usage ?? evt?.message?.usage ?? null;
    if (!usage) { stats.skipped += 1; continue; }
    const model = evt?.model ?? evt?.message?.model ?? defaultModel;
    try {
      const r = ledger.record({
        category,
        usage: CostLedger.usageFromCliEvent({ usage }),
        actualModel: model,
        modelSource: 'cli-config'
      });
      stats.recorded += 1;
      if (r.warning) stats.warnings.push(r.warning);
    } catch (e) {
      // usage 缺失/自相矛盾/账本中止：停止回灌，绝不按 0 元继续
      stats.aborted = true;
      stats.abortReason = e.message;
      break;
    }
  }
  if (stats.recorded === 0 && !stats.aborted) {
    stats.aborted = true;
    stats.abortReason = '日志里没有任何带 usage 的事件，费用无法确认，不按 0 元处理';
  }
  return stats;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const log = get('--log');
  const game = get('--game') ?? 'unknown';
  const category = get('--category') ?? 'agent';
  if (!log) { console.error('用法: node runner/ingest-usage.mjs --game <slug> --log <stream-json 文件> [--category agent|reasoning|repair]'); process.exit(2); }
  const stateFile = join(pocRoot, 'generated', 'ledger', `${game}.json`);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dirname(stateFile), { recursive: true });
  const ledger = new CostLedger({ stateFile });
  const stats = ingestLogFile(log, { ledger, category });
  const summary = ledger.summary();
  console.log(JSON.stringify({ game, stats, summary }, null, 2));
  if (summary.aborted) process.exit(1);
}
