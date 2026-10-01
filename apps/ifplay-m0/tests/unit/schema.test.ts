import { describe, it, expect } from 'vitest';
import { validateBundle, type GameBundle } from '@/core/schema';
import { alienRepairBundle } from '@/bundles/alien-repair';
import { toiletImmortalBundle } from '@/bundles/toilet-immortal';

describe('GameBundle v0.2 校验', () => {
  it('两款真实样例通过校验', () => {
    expect(validateBundle(alienRepairBundle).ok).toBe(true);
    expect(validateBundle(toiletImmortalBundle).ok).toBe(true);
  });

  it('缺少 manifest.id 被拒绝', () => {
    const bad = JSON.parse(JSON.stringify(alienRepairBundle)) as GameBundle;
    (bad.manifest as { id: string }).id = '';
    const r = validateBundle(bad);
    expect(r.ok).toBe(false);
  });

  it('未知玩法模块被拒绝', () => {
    const bad = JSON.parse(JSON.stringify(alienRepairBundle)) as GameBundle;
    (bad.primaryModule as { id: string }).id = 'unknown';
    const r = validateBundle(bad);
    expect(r.ok).toBe(false);
  });

  it('结局少于 2 个被拒绝', () => {
    const bad = JSON.parse(JSON.stringify(alienRepairBundle)) as GameBundle;
    bad.progression.endings = [bad.progression.endings[0]];
    const r = validateBundle(bad);
    expect(r.ok).toBe(false);
  });

  it('辅助模块超过 2 个被拒绝', () => {
    const bad = JSON.parse(JSON.stringify(alienRepairBundle)) as GameBundle;
    bad.auxiliaryModules = [
      { id: 'a', version: '1', config: {} },
      { id: 'b', version: '1', config: {} },
      { id: 'c', version: '1', config: {} },
    ];
    const r = validateBundle(bad);
    expect(r.ok).toBe(false);
  });
});
