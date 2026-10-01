import { describe, it, expect } from 'vitest';
import { createGame, type GameRuntime } from '@/core/runtime';
import { makeBundle } from '../helpers';
import type { TimingConfig } from '@/modules/timing/config';
import type { TimingState } from '@/modules/timing/logic';
import type { GameBundle } from '@/core/schema';
import { toiletImmortalBundle } from '@/bundles/toilet-immortal';

const config: TimingConfig = {
  labels: { spirit: '灵气', breath: '憋气', exposure: '暴露', combo: '连击' },
  cycleMs: 1000,
  windowCenter: 0.5,
  windowWidth: 0.4,
  jitter: 0,
  tiers: { perfect: 0.5, good: 0.8 },
  spirit: { start: 0, target: 50 },
  exposure: { start: 0, max: 100 },
  breath: { start: 100, max: 100 },
  successGain: { perfect: 20, good: 15, normal: 10 },
  missPenalty: 20,
  comboMultiplier: 0,
  hold: { slowFactor: 0.5, breathDrainPerMs: 0 },
  breathRecoveryPerMs: 0,
  tapHint: '点击',
};

const endings: GameBundle['progression']['endings'] = [
  { id: 'win', name: '圆满', desc: '', condition: { type: 'resourceReached', params: { resource: 'spirit', value: 50 } } },
  { id: 'caught', name: '暴露', desc: '', condition: { type: 'resourceReached', params: { resource: 'exposure', value: 100 } } },
];

function stateOf(rt: GameRuntime): TimingState {
  return rt.state as unknown as TimingState;
}

// 把 marker 推进到 windowStart（进入安全窗口），step = 0.1 / tick（dt=100, cycleMs=1000）
function advanceToWindow(rt: GameRuntime): void {
  let guard = 0;
  while (stateOf(rt).marker < stateOf(rt).windowStart && guard < 100) {
    rt.tick(100);
    guard += 1;
  }
}

describe('点击时机模块', () => {
  it('窗口内点击：灵气上升、连击增加', () => {
    const bundle = makeBundle('timing', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    const spirit0 = stateOf(rt).spirit;
    advanceToWindow(rt);
    rt.step({ kind: 'release', heldMs: 0 });
    expect(stateOf(rt).spirit).toBeGreaterThan(spirit0);
    expect(stateOf(rt).combo).toBe(1);
  });

  it('窗口外点击：暴露度上升、连击清零', () => {
    const bundle = makeBundle('timing', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    // 不推进 marker（此时 marker=0，在窗口 [0.3,0.7] 之外）直接点击
    rt.step({ kind: 'release', heldMs: 0 });
    const s = stateOf(rt);
    expect(s.exposure).toBeGreaterThan(0);
    expect(s.combo).toBe(0);
  });

  it('不点击只推进 → 错过时机触发失败结局', () => {
    const bundle = makeBundle('timing', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    let guard = 0;
    while (!rt.ended && guard < 500) {
      rt.tick(100);
      guard += 1;
    }
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('caught');
  });

  it('持续窗口内点击 → 攒满灵气触发成功结局', () => {
    const bundle = makeBundle('timing', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    let guard = 0;
    while (!rt.ended && guard < 100) {
      advanceToWindow(rt);
      rt.step({ kind: 'release', heldMs: 0 });
      guard += 1;
    }
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('win');
  });

  it('真实样例：相同 seed 与相同操作 → 相同结果', () => {
    const run = () => {
      const rt = createGame(toiletImmortalBundle, { seed: 7 });
      for (let i = 0; i < 40; i++) rt.tick(100);
      rt.step({ kind: 'release', heldMs: 0 });
      return JSON.stringify(rt.state);
    };
    expect(run()).toBe(run());
  });
});
