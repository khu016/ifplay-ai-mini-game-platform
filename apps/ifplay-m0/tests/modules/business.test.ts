import { describe, it, expect } from 'vitest';
import { createGame, type GameRuntime } from '@/core/runtime';
import { makeBundle } from '../helpers';
import type { BusinessConfig } from '@/modules/business/config';
import type { BusinessState } from '@/modules/business/logic';
import type { GameBundle } from '@/core/schema';
import { alienRepairBundle } from '@/bundles/alien-repair';

const config: BusinessConfig = {
  labels: { money: '资金', reputation: '口碑', battery: '电池', turn: '回合' },
  startMoney: 50,
  startReputation: 30,
  totalTurns: 5,
  customersPerTurn: 2,
  patienceDecay: 1,
  reputationLossPerLeave: 20,
  reputationGainPerRepair: 5,
  reputationLossPerBadRepair: 5,
  batteryStart: 100,
  batteryCost: 10,
  batteryRefill: 50,
  initialParts: { part_a: 5, part_b: 5 },
  parts: [
    { id: 'part_a', name: '零件A', cost: 5 },
    { id: 'part_b', name: '零件B', cost: 5 },
  ],
  customers: [
    { id: 'cust_a', name: '顾客A', fault: '故障A', requiredPartId: 'part_a', reward: 20, patience: 2 },
    { id: 'cust_b', name: '顾客B', fault: '故障B', requiredPartId: 'part_b', reward: 20, patience: 2 },
  ],
  upgrades: [],
  events: [],
};

const endings: GameBundle['progression']['endings'] = [
  { id: 'bankrupt', name: '破产', desc: '', condition: { type: 'resourceDepleted', params: { resource: 'money', value: 0 } } },
  { id: 'badrep', name: '差评', desc: '', condition: { type: 'resourceDepleted', params: { resource: 'reputation', value: 0 } } },
  { id: 'success', name: '成功', desc: '', condition: { type: 'turnReached', params: { value: 5 } } },
];

function stateOf(rt: GameRuntime): BusinessState {
  return rt.state as unknown as BusinessState;
}

function serveAllCorrectly(rt: GameRuntime, cfg: BusinessConfig): void {
  // 逐个接待队列里的顾客并用正确零件修好
  let guard = 0;
  while (stateOf(rt).queue.length > 0 && guard < 50) {
    const inst = stateOf(rt).queue[0];
    rt.step({ kind: 'action', actionId: 'serve', params: { customerId: inst.customerId } });
    const customer = cfg.customers.find((c) => c.id === inst.customerId)!;
    rt.step({ kind: 'action', actionId: 'choosePart', params: { partId: customer.requiredPartId } });
    guard += 1;
  }
}

describe('经营模拟模块', () => {
  it('正确修理：资金与口碑上升，顾客离店', () => {
    const bundle = makeBundle('business', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    const queueBefore = stateOf(rt).queue.length;
    const moneyBefore = stateOf(rt).money;
    const repBefore = stateOf(rt).reputation;
    serveAllCorrectly(rt, config);
    const after = stateOf(rt);
    expect(after.queue.length).toBeLessThan(queueBefore);
    expect(after.money).toBeGreaterThan(moneyBefore);
    expect(after.reputation).toBeGreaterThan(repBefore);
  });

  it('进货与升级扣减资金', () => {
    const bundle = makeBundle('business', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    const m0 = stateOf(rt).money;
    const inv0 = stateOf(rt).inventory.part_a;
    rt.step({ kind: 'action', actionId: 'buyPart', params: { partId: 'part_a' } });
    expect(stateOf(rt).money).toBe(m0 - 5);
    expect(stateOf(rt).inventory.part_a).toBe(inv0 + 1);
  });

  it('只结束回合不服务 → 口碑耗尽触发失败结局', () => {
    const bundle = makeBundle('business', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    let guard = 0;
    while (!rt.ended && guard < 30) {
      rt.step({ kind: 'action', actionId: 'nextTurn' });
      guard += 1;
    }
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('badrep');
  });

  it('持续正确服务 → 撑到目标回合触发成功结局', () => {
    const bundle = makeBundle('business', config, endings);
    const rt = createGame(bundle, { seed: 1 });
    let guard = 0;
    while (!rt.ended && guard < 30) {
      serveAllCorrectly(rt, config);
      rt.step({ kind: 'action', actionId: 'nextTurn' });
      guard += 1;
    }
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('success');
  });

  it('真实样例：相同 seed 与相同操作 → 相同结果', () => {
    const run = () => {
      const rt = createGame(alienRepairBundle, { seed: 42 });
      for (let i = 0; i < 6; i++) rt.step({ kind: 'action', actionId: 'nextTurn' });
      return JSON.stringify(rt.state);
    };
    expect(run()).toBe(run());
  });
});
