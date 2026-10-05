// 自测夹具的"正式构建"脚本（仅用于验证构建验收器，非 OpenGame 生成产物）
// 模拟一次真实构建：生成 dist/index.html 与构建信息，供 build.mjs 校验退出码与日志摘要。
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
await mkdir(join(__dirname, 'dist'), { recursive: true });
await copyFile(join(__dirname, 'index.html'), join(__dirname, 'dist/index.html'));
await writeFile(join(__dirname, 'dist/build-info.json'), JSON.stringify({ builtAt: new Date().toISOString(), fixture: true }, null, 2));
console.log('selftest build ok → dist/index.html');
