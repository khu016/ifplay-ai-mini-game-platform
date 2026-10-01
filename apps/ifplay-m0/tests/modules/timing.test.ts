import { describe, it, expect } from 'vitest';
import { createGame, type GameRuntime } from '@/core/runtime';
import { makeBundle } from '../helpers';
import { timingModule } from '@/modules/timing';
import type { TimingConfig } from '@/modules/timing/config';
import type { TimingState } from '@/modules/timing/logic';
import type { GameBundle } from '@/core/schema';
import { toiletImmortalBundle } from '@/bundles/toilet-immortal';

const config: TimingConfig = {
  labels: { spirit: '灵气', breath: '憋气', exposure: '暴露', combo: '连击', stage: '阶段', rating: '评价' },
  cycleMs: 1000,
  windowCenter: 0.5,
  windowWidth: 0.4,
  jitter: 0,
  tiers: { perfect: 0.5, good: 0.8 },
  spirit: { start: 0, target: 60 },
  exposure: { start: 0, max: 100 },
  breath: { start: 100, max: 100 },
  successGain: { perfect: 20, good: 15, normal: 10 },
  missPenalty: 20,
  comboMultiplier: 0,
  hold: { slowFactor: 0.5, breathDrainPerMs: 0.05 },
  breathRecoveryPerMs: 0.02,
  tapHint: '点击',
  stages: [
    { cycleMs: 1000, windowWidth: 0.4, jitter: 0, targetSpirit: 20 },
    { cycleMs: 800, windowWidth: 0.3, jitter: 0, targetSpirit: 20 },
    { cycleMs: 600, windowWidth: 0.2, jitter: 0, targetSpirit: 20 },
  ],
  holdGainPerMs: 0.05,
  exposureRecoverPerMs: 0.01,
  skills: [
    { id: 'clear', name: '清心咒', stageIndex: 0, effect: { type: 'clearExposure', amount: 50 } },
    { id: 'heal', name: '回气', stageIndex: 1, effect: { type: 'healBreath', amount: 50 } },
  ],
  rating: { s: 70, a: 60, b: 40, c: 0 },
  failHintExposure: '暴露太高了',
};

const endings: GameBundle['progression']['endings'] = [
  { id: 'caught', name: '被发现', desc: '', condition: { type: 'resourceReached', params: { resource: 'exposure', value: 100 } } },
  { id: 'win', name: '圆满', desc: '', condition: { type: 'resourceReached', params: { resource: 'spirit', value: 60 } } },
];

function stateOf(rt: GameRuntime): TimingState {
  return rt.state as unknown as TimingState;
}
function tapInWindow(rt: GameRuntime): void {
  let guard = 0;
  while (stateOf(rt).marker < stateOf(rt).windowStart && guard < 100) {
    rt.tick(100);
    guard += 1;
  }
  rt.step({ kind: 'release', heldMs: 0 });
}

describe('点击时机模块（深度增强）', () => {
  it('三阶段推进：达成阶段目标进入下一阶段并解锁技能', () => {
    const rt = createGame(makeBundle('timing', config, endings), { seed: 1 });
    tapInWindow(rt); // +10
    tapInWindow(rt); // +10 → spirit 20，进入阶段 2
    expect(stateOf(rt).stageIndex).toBe(1);
    expect(stateOf(rt).skillsUnlocked).toContain('clear');
  });

  it('技能解锁后可一次性使用', () => {
    const rt = createGame(makeBundle('timing', config, endings), { seed: 1 });
    tapInWindow(rt);
    tapInWindow(rt); // 解锁 clear
    stateOf(rt).exposure = 90;
    rt.step({ kind: 'action', actionId: 'useSkill', params: { skillId: 'clear' } });
    expect(stateOf(rt).exposure).toBe(40);
    // 一次性：再使用无效
    rt.step({ kind: 'action', actionId: 'useSkill', params: { skillId: 'clear' } });
    expect(stateOf(rt).exposure).toBe(40);
  });

  it('长按带来收益同时消耗憋气', () => {
    const rt = createGame(makeBundle('timing', config, endings), { seed: 1 });
    const spirit0 = stateOf(rt).spirit;
    const breath0 = stateOf(rt).breath;
    rt.step({ kind: 'press' });
    rt.tick(1000);
    expect(stateOf(rt).spirit).toBeGreaterThan(spirit0);
    expect(stateOf(rt).breath).toBeLessThan(breath0);
  });

  it('长按过久憋不住气，暴露度上升（风险）', () => {
    const rt = createGame(makeBundle('timing', config, endings), { seed: 1 });
    rt.step({ kind: 'press' });
    for (let i = 0; i < 50; i++) rt.tick(100);
    expect(stateOf(rt).breath).toBe(0);
    expect(stateOf(rt).exposure).toBeGreaterThan(0);
  });

  it('暴露度随时间自然恢复', () => {
    const rt = createGame(makeBundle('timing', config, endings), { seed: 1 });
    stateOf(rt).exposure = 50;
    for (let i = 0; i < 10; i++) rt.tick(100); // 1s 不操作
    expect(stateOf(rt).exposure).toBeLessThan(50);
  });

  it('闯过三阶段达成圆满并给出评价', () => {
    const rt = createGame(makeBundle('timing', config, endings), { seed: 1 });
    let guard = 0;
    while (!rt.ended && guard < 200) {
      tapInWindow(rt);
      guard += 1;
    }
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('win');
    expect(['A', 'S']).toContain(stateOf(rt).rating);
  });

  it('暴露度爆表失败并给出改进建议', () => {
    const rt = createGame(makeBundle('timing', config, endings), { seed: 1 });
    let guard = 0;
    while (!rt.ended && guard < 500) {
      rt.tick(100);
      guard += 1;
    }
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('caught');
    expect(stateOf(rt).failReason).toContain('暴露');
  });

  it('旧存档兼容：缺新字段用默认值补齐', () => {
    const oldJson = {
      phase: 'play', spirit: 10, exposure: 5, breath: 80, combo: 2,
      marker: 0.3, windowStart: 0.3, windowEnd: 0.7, windowCenter: 0.5,
      holding: false, lastTier: null, messages: [],
      endingId: null, endingName: null, endingDesc: null,
    };
    const s = timingModule.deserialize(oldJson, config);
    expect(s.stageIndex).toBe(0);
    expect(s.skillsUnlocked).toEqual([]);
    expect(s.rating).toBeNull();
    expect(s.spirit).toBe(10);
  });

  it('真实样例：相同 seed 与相同操作 → 相同结果', () => {
    const run = () => {
      const rt = createGame(toiletImmortalBundle, { seed: 9 });
      for (let i = 0; i < 40; i++) rt.tick(100);
      rt.step({ kind: 'release', heldMs: 0 });
      return JSON.stringify(rt.state);
    };
    expect(run()).toBe(run());
  });
});
