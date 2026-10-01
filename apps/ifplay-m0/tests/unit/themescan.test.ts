import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 引擎与玩法模块源码中不得出现任何样例题材字样（题材只存在于 bundles/ 配置）。
const THEME_KEYWORDS = [
  '外星人',
  '三线城市',
  '修手机',
  '厕所',
  '修仙',
  '灵气',
  '憋气',
  '老板',
  'Excel',
  '母星',
  '小周天',
  '三眼',
  '触手',
  '硅基',
  '微波炉',
  '年终奖',
  '业主群',
  '龙王',
  '广场舞',
  '转世',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('引擎与模块不含题材专用字样', () => {
  it('core 与 modules 源码无题材关键词', () => {
    const root = fileURLToPath(new URL('../../src', import.meta.url));
    const dirs = [path.join(root, 'core'), path.join(root, 'modules')];
    const files = dirs.flatMap((d) => walk(d));
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const kw of THEME_KEYWORDS) {
        if (text.includes(kw)) offenders.push(`${f} -> ${kw}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
