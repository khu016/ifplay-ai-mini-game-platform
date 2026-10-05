// 确定性「浏览器验收器」（渲染关 + 玩法关）
// 用法：node evaluators/browser.mjs <gameDir> [--click <sel>] [--expect <sel>]
// 判定：
//   渲染关 —— 390×844 竖屏可渲染、无致命 console/page 错误
//   网络关 —— 经本地静态服务器加载；发现任何未授权 http(s) 请求直接 route.abort() 阻断并记为违规
//   玩法关 —— 按脚本点击 <sel>，断言 <sel> 数值/文本发生变化
import { createServer } from 'node:http';
import { readFile, access, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) { console.error('用法: node browser.mjs <gameDir> [--click sel] [--expect sel]'); process.exit(2); }
function opt(name, dflt) { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; }
const clickSel = opt('--click', null);
const expectSel = opt('--expect', null);

async function exists(p) { try { await access(p); return true; } catch { return false; } }

let entry;
for (const c of ['dist/index.html', 'index.html']) {
  if (await exists(join(dir, c))) { entry = join(dir, c); break; }
}
if (!entry) { console.error('未找到 index.html'); process.exit(2); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// 最小本地静态服务器（仅服务 gameDir，绑定 127.0.0.1）
const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    let p = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^\/+/, '');
    const full = join(dir, p);
    if (!full.startsWith(dir)) { res.writeHead(403); res.end('forbidden'); return; }
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

const consoleErrors = [];
const pageErrors = [];
const blockedRequests = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();

page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));

// 只放行本地服务器；任何外部 http(s) 直接阻断（route.abort），并记为违规
await context.route('**/*', (route) => {
  const url = route.request().url();
  const host = new URL(url).hostname;
  if (host === '127.0.0.1' || host === 'localhost') {
    route.continue();
  } else {
    blockedRequests.push(url);
    route.abort('blockedbyclient');
  }
});

await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
const bodyText = (await page.evaluate(() => document.body.innerText)).trim();

let interaction = null;
if (clickSel && expectSel) {
  const read = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? (el.textContent || '').trim() : null; }, sel);
  const before = await read(expectSel);
  await page.click(clickSel).catch((e) => pageErrors.push('click 失败: ' + e.message));
  await page.waitForTimeout(150);
  const after = await read(expectSel);
  interaction = { clickSel, expectSel, before, after, changed: before !== null && after !== null && before !== after };
}

await browser.close();
server.close();

const result = {
  stage: 'browser',
  gameDir: dir,
  servedAt: baseUrl,
  viewport: '390×844',
  checks: {
    rendered: bodyText.length > 0,
    noFatalError: consoleErrors.length === 0 && pageErrors.length === 0,
    noExternalNetwork: blockedRequests.length === 0
  },
  consoleErrors,
  pageErrors,
  blockedRequests,
  interaction,
  pass: false
};

result.pass = result.checks.rendered && result.checks.noFatalError && result.checks.noExternalNetwork &&
  (interaction ? interaction.changed === true : true);

console.log(JSON.stringify(result, null, 2));
process.exit(result.pass ? 0 : 1);
