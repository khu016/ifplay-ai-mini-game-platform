// 确定性「构建关」验收器
// 用法：node evaluators/build.mjs <gameDir>
// 阶段一：对固定自测夹具跑真实依赖安装 + 正式构建，保存退出码与构建日志摘要。
// 阶段二：本脚本整体在容器内执行（依赖安装 + 正式构建都在容器里）。
import { spawnSync } from 'node:child_process';
import { readFile, access, stat } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('用法: node build.mjs <gameDir>'); process.exit(2); }

async function exists(p) { try { await access(p); return true; } catch { return false; } }

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 180_000 });
  const log = (r.stdout || '') + (r.stderr || '');
  const lines = log.split('\n').filter(Boolean);
  return { exitCode: r.status, error: r.error?.message, logTail: lines.slice(-20).join('\n') };
}

const result = { stage: 'build', gameDir: dir, pass: false, reasons: [], steps: [] };

const hasPackageJson = await exists(join(dir, 'package.json'));

if (hasPackageJson) {
  // 真实依赖安装
  const install = run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error']);
  result.steps.push({ step: 'npm install', exitCode: install.exitCode, logTail: install.logTail });
  if (install.exitCode !== 0) {
    result.reasons.push(`依赖安装失败（exit=${install.exitCode}）`);
  } else {
    // 正式构建
    const build = run('npm', ['run', 'build']);
    result.steps.push({ step: 'npm run build', exitCode: build.exitCode, logTail: build.logTail });
    if (build.exitCode !== 0) {
      result.reasons.push(`正式构建失败（exit=${build.exitCode}）`);
    }
  }
} else {
  // 无 package.json：仅静态结构检查（仅限自测夹具；真实生成游戏应有 package.json 并走上面真实构建）
  result.steps.push({ step: 'static-check', note: '无 package.json，仅做静态产物检查（真实生成游戏应在容器内走 npm install + build）' });
}

// 构建产物检查（不只是"index.html 是否存在"：要求非空且为有效 HTML）
let entry = null;
for (const c of ['dist/index.html', 'index.html']) {
  if (await exists(join(dir, c))) { entry = join(dir, c); break; }
}
if (!entry) {
  result.reasons.push('构建产物缺失（无 dist/index.html 或 index.html）');
} else {
  const s = await stat(entry);
  const html = await readFile(entry, 'utf8');
  if (s.size === 0 || html.trim().length === 0) {
    result.reasons.push('构建产物为空');
  } else if (!/<html|<!doctype/i.test(html)) {
    result.reasons.push('构建产物不是有效 HTML');
  }
}
result.entry = entry;

// 汇总：构建退出码 + 日志摘要
const lastBuild = result.steps.find((s) => s.step === 'npm run build');
result.buildExitCode = lastBuild?.exitCode ?? (entry ? 0 : null);
result.buildLogSummary = lastBuild?.logTail || null;

result.pass = result.reasons.length === 0 && result.steps.some((s) => s.step === 'npm run build' && s.exitCode === 0);

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
