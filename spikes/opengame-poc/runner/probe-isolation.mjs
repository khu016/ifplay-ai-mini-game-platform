// 隔离能力探针（可复跑）：验证 sandbox-exec 在 macOS 上的四项隔离能力
// 运行：node runner/probe-isolation.mjs
// 输出：JSON（同时落盘 reports/隔离探针-<ts>.json）
import { execFileSync, spawn } from 'node:child_process';
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(__dirname, '..', 'reports');
const NODE = process.execPath;
// 用 /private/tmp（真实路径，避免 macOS /tmp->/private/tmp 符号链接导致 subpath 不匹配）
const allowedDir = '/private/tmp/opengame-poc-allowed';
const forbiddenDir = '/private/tmp/opengame-poc-forbidden';

// profile A：实用隔离（allow-default + 禁网 + 禁写，仅白名单可写）
const profileA = `(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write* (subpath "${allowedDir}"))\n`;
// profile B：严格白名单（deny-default）——用于演示子进程 exec 控制与 Node 崩溃
const profileB = `(version 1)\n(deny default)\n(allow process-fork)\n(allow process-exec (literal "/bin/ls"))\n(allow file-read*)\n(deny network*)\n`;

function sb(profile, cmd, args) {
  const file = join(tmpdir(), `opengame-probe-${Date.now()}-${Math.random().toString(36).slice(2)}.sb`);
  writeFileSyncSafe(file, profile);
  try {
    const out = execFileSync('sandbox-exec', ['-f', file, cmd, ...args], { encoding: 'utf8', timeout: 15000 });
    return { ok: true, exit: 0, output: out.trim() };
  } catch (e) {
    return { ok: false, exit: e.status ?? 'signal', output: (e.stdout || '') + (e.stderr || '') };
  }
}

import { writeFileSync, rmSync } from 'node:fs';
function writeFileSyncSafe(p, c) { writeFileSync(p, c); }

await mkdir(allowedDir, { recursive: true });
await mkdir(forbiddenDir, { recursive: true });

const results = {};

// 1. 网络阻断（DNS+TCP）
{
  const r = sb(profileA, NODE, ['-e', 'require("https").get("https://example.com", r=>console.log("CONNECTED")).on("error",e=>console.log("ERR:"+e.code))']);
  results.network = { pass: !/CONNECTED/.test(r.output) && /ERR:|ECONN|ENOTFOUND|ETIMEDOUT/i.test(r.output), evidence: r };
}

// 2. 文件写：白名单目录允许
{
  const p = join(allowedDir, 'probe.txt');
  const r = sb(profileA, NODE, ['-e', `require("fs").writeFileSync("${p}","x")`]);
  results.fileWriteAllow = { pass: r.ok, evidence: r };
}

// 3. 文件写：非白名单目录拒绝
{
  const p = join(forbiddenDir, 'probe.txt');
  const r = sb(profileA, NODE, ['-e', `require("fs").writeFileSync("${p}","x")`]);
  results.fileWriteDeny = { pass: !r.ok && /EPERM|not permitted|Operation not permitted/i.test(r.output), evidence: r };
}

// 4. 子进程 exec 控制（严格白名单下，非白名单二进制被拒）
{
  const r = sb(profileB, '/bin/cat', ['/etc/hostname']);
  results.subprocessExecDeny = { pass: !r.ok && /Operation not permitted|not permitted/i.test(r.output), evidence: r };
}

// 5. Node 在严格白名单(deny-default)下崩溃（解释为何需 allow-default）
{
  const r = sb(profileB.replace('(literal "/bin/ls")', `(literal "${NODE}")`), NODE, ['-e', 'console.log("hi")']);
  results.nodeUnderDenyDefault = { pass: !r.ok, evidence: r, meaning: 'V8 在 deny-default 下崩溃（LowLevelAlloc 溢出），故严格白名单无法承载 Node/npm 构建负载' };
}

// 6. 超时强制终止（runner 用 child_process timeout）
{
  const t0 = Date.now();
  const p = spawn('sh', ['-c', 'sleep 60'], { timeout: 2000, killSignal: 'SIGKILL' });
  const code = await new Promise((res) => p.on('exit', (c, s) => res({ c, s })));
  results.timeout = { pass: code.s === 'SIGKILL' && (Date.now() - t0) < 3500, ms: Date.now() - t0, evidence: code };
}

// 清理
try { rmSync(forbiddenDir, { recursive: true, force: true }); } catch {}
try { rmSync(allowedDir, { recursive: true, force: true }); } catch {}

const report = {
  generatedAt: new Date().toISOString(),
  platform: `macOS ${process.platform}`,
  results,
  summary: {
    networkBlocked: results.network.pass,
    fileWriteRestricted: results.fileWriteAllow.pass && results.fileWriteDeny.pass,
    subprocessExecControllable: results.subprocessExecDeny.pass,
    strictWhitelistBreaksNode: results.nodeUnderDenyDefault.pass,
    timeoutEnforced: results.timeout.pass
  }
};

await mkdir(reportsDir, { recursive: true });
const out = join(reportsDir, `隔离探针-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
