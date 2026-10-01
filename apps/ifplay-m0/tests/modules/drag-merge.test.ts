import { describe, it, expect } from 'vitest';
import { createGame, type GameRuntime } from '@/core/runtime';
import { makeBundle } from '../helpers';
import type { DragMergeConfig } from '@/modules/drag-merge/config';
import type { DragMergeState } from '@/modules/drag-merge/logic';
import type { GameBundle } from '@/core/schema';
import { bossPieBundle } from '@/bundles/boss-pie';

const config: DragMergeConfig = {
  labels: { score: '得分', steps: '步骤', combo: '连击' },
  maxSteps: 10,
  targetScore: 30,
  wrongPenalty: 5,
  comboMultiplier: 0,
  items: [
    { id: 'a', name: '物品A' },
    { id: 'b', name: '物品B' },
    { id: 'c', name: '物品C' },
  ],
  slots: [
    { id: 's1', name: '格1', accepts: ['a', 'c'] },
    { id: 's2', name: '格2' },
  ],
  initialItems: { a: 20, b: 20, c: 2 },
  recipes: [
    { id: 'r1', name: 'AB', inputs: { s1: 'a', s2: 'b' }, score: 20, resultName: '成品AB' },
    { id: 'r2', name: 'CC', inputs: { s1: 'c', s2: 'c' }, score: 0, resultName: '特殊', flag: 'special' },
  ],
};

const endings: GameBundle['progression']['endings'] = [
  { id: 'success', name: '成功', desc: '', condition: { type: 'resourceReached', params: { resource: 'score', value: 30 } } },
  { id: 'fail', name: '失败', desc: '', condition: { type: 'resourceReached', params: { resource: 'step', value: 10 } } },
  { id: 'hidden', name: '隐藏', desc: '', condition: { type: 'flagIs', params: { flag: 'special', value: true } } },
];

function stateOf(rt: GameRuntime): DragMergeState {
  return rt.state as unknown as DragMergeState;
}
function drag(rt: GameRuntime, itemId: string, slotId: string): void {
  rt.step({ kind: 'action', actionId: 'drag', params: { itemId, slotId } });
}

describe('拖拽合成模块', () => {
  it('合法配方合成：得分上升', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2');
    expect(stateOf(rt).score).toBe(20);
    expect(stateOf(rt).produced).toContain('成品AB');
  });

  it('错误组合：扣分（下限 0）且连击清零', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'a', 's1');
    drag(rt, 'c', 's2');
    expect(stateOf(rt).score).toBe(0);
    expect(stateOf(rt).combo).toBe(0);
  });

  it('无效放置：不接受该物品的格子被拒绝', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'b', 's1'); // s1 只接受 a/c
    expect(stateOf(rt).step).toBe(0);
    expect(stateOf(rt).slots.s1).toBeNull();
  });

  it('凑够目标分触发成功结局', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2'); // +20
    drag(rt, 'a', 's1');
    drag(rt, 'b', 's2'); // +20 = 40 >= 30
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('success');
  });

  it('隐藏配方触发隐藏结局', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    drag(rt, 'c', 's1');
    drag(rt, 'c', 's2'); // 触发 flag special
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('hidden');
  });

  it('步骤耗尽触发失败结局', () => {
    const rt = createGame(makeBundle('drag-merge', config, endings), { seed: 1 });
    let guard = 0;
    while (!rt.ended && guard < 20) {
      drag(rt, 'a', 's1');
      rt.step({ kind: 'action', actionId: 'clear', params: { slotId: 's1' } });
      guard += 1;
    }
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('fail');
  });

  it('真实样例：相同 seed 与相同操作 → 相同结果', () => {
    const run = () => {
      const rt = createGame(bossPieBundle, { seed: 7 });
      drag(rt, 'boss_pie', 'left');
      drag(rt, 'chicken_blood', 'right');
      drag(rt, 'boss_pie', 'left');
      drag(rt, 'chicken_blood', 'right');
      return JSON.stringify(rt.state);
    };
    expect(run()).toBe(run());
  });
});
