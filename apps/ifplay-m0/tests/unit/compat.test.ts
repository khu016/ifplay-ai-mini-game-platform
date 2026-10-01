import { describe, it, expect } from 'vitest';
import { createGame } from '@/core/runtime';
import { validateBundle } from '@/core/schema';
import { bundles } from '@/bundles';

describe('四玩法兼容矩阵', () => {
  it('四款样例 bundle 全部通过校验', () => {
    expect(bundles).toHaveLength(4);
    for (const b of bundles) {
      expect(validateBundle(b.bundle).ok, `${b.bundle.manifest.id} 校验失败`).toBe(true);
    }
  });

  it('四个玩法模块 id 齐全且能创建运行', () => {
    const ids = bundles.map((b) => b.bundle.primaryModule.id).sort();
    expect(ids).toEqual(['business', 'drag-merge', 'story-quiz', 'timing']);
    for (const b of bundles) {
      const rt = createGame(b.bundle, { seed: 42 });
      expect(rt.view().title).toBe(b.bundle.manifest.name);
    }
  });

  it('M0/M1 四款回归：均可推进', () => {
    const alien = createGame(bundles[0].bundle, { seed: 1 }); // business
    alien.step({ kind: 'action', actionId: 'nextTurn' });
    expect((alien.state as { turn: number }).turn).toBe(2);

    const toilet = createGame(bundles[1].bundle, { seed: 1 }); // timing
    toilet.tick(100);
    expect((toilet.state as { marker: number }).marker).toBeGreaterThan(0);

    const pie = createGame(bundles[2].bundle, { seed: 1 }); // drag-merge
    pie.step({ kind: 'action', actionId: 'drag', params: { itemId: 'boss_pie', slotId: 'left' } });
    expect((pie.state as { step: number }).step).toBe(1);

    const dragon = createGame(bundles[3].bundle, { seed: 1 }); // story-quiz
    dragon.step({ kind: 'action', actionId: 'choose', params: { choiceId: 'c_redpacket' } });
    expect((dragon.state as { currentNodeId: string }).currentNodeId).toBe('rp');
  });

  it('v0.2 与 v0.3 运行时版本共存', () => {
    const versions = bundles.map((b) => b.bundle.manifest.runtimeVersion).sort();
    expect(versions).toEqual(['0.2', '0.3', '0.3', '0.3']);
  });
});
