import { describe, it, expect } from 'vitest';
import { createGame, type GameRuntime } from '@/core/runtime';
import { makeBundle } from '../helpers';
import type { DragMergeConfig } from '@/modules/drag-merge/config';
import type { DragMergeState } from '@/modules/drag-merge/logic';
import type { GameBundle } from '@/core/schema';
import { bossPieBundle } from '@/bundles/boss-pie';

const config: DragMergeConfig = {
  labels: { score: '得分', steps: '步骤', combo: '连击', orders: '订单', discovered: '图鉴' },
  maxSteps: 20,
  wrongPenalty: 5,
  comboMultiplier: 0,
  items: [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { id: 'ab', name: 'AB' },
    { id: 'ac', name: 'AC' },
    { id: 'abc', name: 'ABC' },
    { id: 'junk', name: 'JUNK' },
  ],
  slots: [
    { id: 's1', name: '格1' },
    { id: 's2', name: '格2' },
  ],
  initialItems: { a: 5, b: 5, c: 5 },
  recipes: [
    { id: 'r_ab', name: 'AB', inputs: { s1: 'a', s2: 'b' }, output: { itemId: 'ab', count: 1 }, score: 10, resultName: 'AB', hint: 'A 配 B' },
    { id: 'r_abc', name: 'ABC', inputs: { s1: 'ab', s2: 'c' }, output: { itemId: 'abc', count: 1 }, score: 30, resultName: 'ABC', hint: 'AB 配 C' },
    { id: 'r_ac', name: 'AC', inputs: { s1: 'a', s2: 'c' }, output: { itemId: 'ac', count: 1 }, score: 15, resultName: 'AC', hint: 'A 配 C' },
    { id: 'r_acb', name: 'ABC2', inputs: { s1: 'ac', s2: 'b' }, output: { itemId: 'abc', count: 1 }, score: 25, resultName: 'ABC', hint: 'AC 配 B' },
    { id: 'r_hidden', name: 'JUNK', inputs: { s1: 'c', s2: 'c' }, output: { itemId: 'junk', count: 1 }, score: 0, resultName: 'JUNK', flag: 'special' },
  ],
  orders: [{ id: 'o1', name: '订单ABC', targetItemId: 'abc', deadlineStep: 10, reward: 50 }],
  goal: { type: 'ordersFulfilled', value: 1 },
};

const endings: GameBundle['progression']['endings'] = [
  { id: 'success', name: '成功', desc: '', condition: { type: 'resourceReached', params: { resource: 'ordersFulfilled', value: 1 } } },
  { id: 'fail', name: '失败', desc: '', condition: { type: 'resourceReached', params: { resource: 'step', value: 20 } } },
  { id: 'hidden', name: '隐藏', desc: '', condition: { type: 'flagIs', params: { flag: 'special', value: true } } },
];

function stateOf(rt: GameRuntime): DragMergeState {
  return rt.state as unknown as DragMergeState;
}
function drag(rt: GameRuntime, itemId: string, slotId: string): void {
  rt.step({ kind: 'action', actionId: 'drag', params: { itemId, slotId } });
}
function deliver(rt: GameRuntime, orderId: string): void {
  rt.step({ kind: 'action', actionId: 'deliver', params: { orderId } });
}

describe('拖拽合成模块（深度增强）', () => {
  it('多级合成链 + 交付订单（路线 A）', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2'); // → ab
    expect(stateOf(rt).inventory.ab).toBe(1);
    drag(rt, 'ab', 's1');
    drag(rt, 'c', 's2'); // → abc
    expect(stateOf(rt).inventory.abc).toBe(1);
    deliver(rt, 'o1');
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('success');
  });

  it('另一条路线（路线 B）也能完成', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'a', 's1');
    drag(rt, 'c', 's2'); // → ac
    drag(rt, 'ac', 's1');
    drag(rt, 'b', 's2'); // → abc
    deliver(rt, 'o1');
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('success');
  });

  it('图鉴记录已发现配方，失败给出反馈', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2'); // 发现 r_ab
    expect(stateOf(rt).discovered).toContain('r_ab');
    // 失败组合（b+b 无配方）
    drag(rt, 'b', 's1');
    drag(rt, 'b', 's2');
    expect(stateOf(rt).messages.some((m) => m.includes('糊了'))).toBe(true);
  });

  it('订单过期后不可交付', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    let guard = 0;
    while (!stateOf(rt).orders[0].expired && guard < 30) {
      drag(rt, 'a', 's1');
      rt.step({ kind: 'action', actionId: 'clear', params: { slotId: 's1' } });
      guard += 1;
    }
    expect(stateOf(rt).orders[0].expired).toBe(true);
    // 手动塞入目标产物也不能交付过期订单
    stateOf(rt).inventory.abc = 1;
    deliver(rt, 'o1');
    expect(stateOf(rt).orders[0].fulfilled).toBe(false);
  });

  it('隐藏结局在自然结局之后结算', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    // 触发隐藏 flag，但尚未自然结局
    drag(rt, 'c', 's1');
    drag(rt, 'c', 's2'); // flag special
    expect(rt.ended).toBe(false);
    // 达成自然结局（交付订单），隐藏 flag 应覆盖
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2');
    drag(rt, 'ab', 's1');
    drag(rt, 'c', 's2');
    deliver(rt, 'o1');
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('hidden');
  });

  it('补给 seed 可复现', () => {
    const supplyConfig: DragMergeConfig = {
      labels: { score: '分', steps: '步', combo: '连' },
      maxSteps: 10,
      wrongPenalty: 5,
      comboMultiplier: 0,
      items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      slots: [{ id: 's1', name: '格1' }, { id: 's2', name: '格2' }],
      recipes: [{ id: 'r', name: 'AB', inputs: { s1: 'a', s2: 'b' }, score: 10 }],
      supply: { pool: [{ itemId: 'a', weight: 1 }, { itemId: 'b', weight: 1 }], initialDraw: 6, restockEvery: 1000, restockCount: 1 },
    };
    const g1 = createGame(makeBundle('drag-merge', supplyConfig, endings), { seed: 42 });
    const g2 = createGame(makeBundle('drag-merge', supplyConfig, endings), { seed: 42 });
    expect(JSON.stringify(stateOf(g1).inventory)).toBe(JSON.stringify(stateOf(g2).inventory));
  });

  it('旧配置（targetScore + resultName，无 output）兼容', () => {
    const oldConfig: DragMergeConfig = {
      labels: { score: '分', steps: '步', combo: '连' },
      maxSteps: 10,
      targetScore: 30,
      wrongPenalty: 5,
      comboMultiplier: 0,
      items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      slots: [{ id: 's1', name: '格1' }, { id: 's2', name: '格2' }],
      initialItems: { a: 20, b: 20 },
      recipes: [{ id: 'r', name: 'AB', inputs: { s1: 'a', s2: 'b' }, score: 20, resultName: '成品AB' }],
    };
    const oldEndings: GameBundle['progression']['endings'] = [
      { id: 'success', name: '成功', desc: '', condition: { type: 'resourceReached', params: { resource: 'score', value: 30 } } },
      { id: 'fail', name: '失败', desc: '', condition: { type: 'resourceReached', params: { resource: 'step', value: 10 } } },
    ];
    const rt = createGame(makeBundle('drag-merge', oldConfig, oldEndings), { seed: 1 });
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2');
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2');
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('success');
  });

  it('真实样例：相同 seed 与相同操作 → 相同结果', () => {
    const run = () => {
      const rt = createGame(bossPieBundle, { seed: 7 });
      drag(rt, 'boss_pie', 'left');
      drag(rt, 'chicken_blood', 'right');
      drag(rt, 'bonus_proto', 'left');
      drag(rt, 'sentiment', 'right');
      return JSON.stringify(rt.state);
    };
    expect(run()).toBe(run());
  });
});
