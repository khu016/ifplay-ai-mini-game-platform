import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  applyEffect,
  applyEffects,
  isKnownConditionType,
  isKnownEffectType,
  type EffectContext,
} from '@/core/effects';

function ctx(over: Partial<EffectContext> = {}): EffectContext {
  return { resources: { money: 10, reputation: 5 }, flags: {}, turn: 3, messages: [], ...over };
}

describe('白名单条件 / 效果执行器', () => {
  it('条件：always / resourceBelow / resourceAbove / resourceReached / resourceDepleted / turnReached', () => {
    expect(evaluateCondition({ type: 'always' }, ctx())).toBe(true);
    expect(evaluateCondition({ type: 'resourceBelow', params: { resource: 'money', value: 20 } }, ctx())).toBe(true);
    expect(evaluateCondition({ type: 'resourceBelow', params: { resource: 'money', value: 5 } }, ctx())).toBe(false);
    expect(evaluateCondition({ type: 'resourceAbove', params: { resource: 'reputation', value: 4 } }, ctx())).toBe(true);
    expect(evaluateCondition({ type: 'resourceReached', params: { resource: 'money', value: 10 } }, ctx())).toBe(true);
    expect(evaluateCondition({ type: 'resourceDepleted', params: { resource: 'reputation', value: 5 } }, ctx())).toBe(true);
    expect(evaluateCondition({ type: 'turnReached', params: { value: 3 } }, ctx())).toBe(true);
    expect(evaluateCondition({ type: 'turnReached', params: { value: 4 } }, ctx())).toBe(false);
  });

  it('效果：addResource / setFlag / message / endGame', () => {
    const c = ctx();
    applyEffects(
      [
        { type: 'addResource', params: { resource: 'money', amount: 5 } },
        { type: 'setFlag', params: { flag: 'win', value: true } },
        { type: 'message', params: { text: '你好' } },
        { type: 'endGame', params: { endingId: 'end1' } },
      ],
      c,
    );
    expect(c.resources.money).toBe(15);
    expect(c.flags.win).toBe(true);
    expect(c.messages).toContain('你好');
    expect(c.ended).toBe('end1');
  });

  it('白名单之外的类型被拒绝', () => {
    expect(() => evaluateCondition({ type: 'evil' }, ctx())).toThrow(/unknown condition/);
    expect(() => applyEffect({ type: 'evil' }, ctx())).toThrow(/unknown effect/);
    expect(isKnownConditionType('resourceBelow')).toBe(true);
    expect(isKnownConditionType('evil')).toBe(false);
    expect(isKnownEffectType('addResource')).toBe(true);
    expect(isKnownEffectType('evil')).toBe(false);
  });
});
