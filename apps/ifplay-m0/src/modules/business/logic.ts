import type { BusinessConfig } from './config';
import type { Rng } from '@/core/rng';
import type { NormalizedInput } from '@/core/input';
import type { ModuleContext } from '@/core/context';
import { evaluateCondition, type EffectContext } from '@/core/effects';

export interface CustomerInstance {
  customerId: string;
  patience: number;
}

export interface BusinessState {
  phase: 'play' | 'result';
  turn: number;
  money: number;
  reputation: number;
  battery: number;
  inventory: Record<string, number>;
  queue: CustomerInstance[];
  currentCustomerId: string | null;
  upgradesOwned: string[];
  messages: string[];
  endingId: string | null;
  endingName: string | null;
  endingDesc: string | null;
}

export function createInitialState(config: BusinessConfig, _seed: number, rng: Rng): BusinessState {
  const state: BusinessState = {
    phase: 'play',
    turn: 1,
    money: config.startMoney,
    reputation: config.startReputation,
    battery: config.batteryStart,
    inventory: { ...config.initialParts },
    queue: [],
    currentCustomerId: null,
    upgradesOwned: [],
    messages: [],
    endingId: null,
    endingName: null,
    endingDesc: null,
  };
  spawnCustomers(state, config, rng);
  return state;
}

function spawnCustomers(state: BusinessState, config: BusinessConfig, rng: Rng): void {
  for (let i = 0; i < config.customersPerTurn; i++) {
    const c = rng.pick(config.customers);
    state.queue.push({ customerId: c.id, patience: c.patience });
  }
}

function checkEndings(state: BusinessState, ctx: ModuleContext): boolean {
  for (const e of ctx.bundle.progression.endings) {
    if (!e.condition) continue; // 叙事类结局不在此处理
    const ectx: EffectContext = {
      resources: { money: state.money, reputation: state.reputation, battery: state.battery },
      flags: {},
      turn: state.turn,
      messages: [],
    };
    if (evaluateCondition(e.condition, ectx)) {
      state.phase = 'result';
      state.endingId = e.id;
      state.endingName = e.name;
      state.endingDesc = e.desc;
      ctx.bus.emit({ type: 'game:ended', endingId: e.id });
      return true;
    }
  }
  return false;
}

function removeCustomer(state: BusinessState, customerId: string): void {
  state.queue = state.queue.filter((q) => q.customerId !== customerId);
}

function serve(state: BusinessState, config: BusinessConfig, customerId: string): void {
  const inst = state.queue.find((q) => q.customerId === customerId);
  if (!inst) {
    state.messages.push('这位顾客已经离开了');
    return;
  }
  if (state.battery <= 0) {
    state.messages.push('能量电池耗尽，无法开工');
    return;
  }
  state.currentCustomerId = customerId;
  const c = config.customers.find((cc) => cc.id === customerId);
  state.messages.push(`正在接待：${c?.name ?? '顾客'}`);
}

function choosePart(state: BusinessState, config: BusinessConfig, partId: string): void {
  if (!state.currentCustomerId) return;
  const customer = config.customers.find((c) => c.id === state.currentCustomerId);
  if (!customer) return;
  if (state.battery <= 0) {
    state.messages.push('能量电池耗尽，无法开工');
    return;
  }
  if (partId === customer.requiredPartId) {
    if ((state.inventory[partId] ?? 0) < 1) {
      const p = config.parts.find((pp) => pp.id === partId);
      state.messages.push(`零件不足：${p?.name ?? partId}`);
      return;
    }
    state.inventory[partId] -= 1;
    state.money += customer.reward;
    state.reputation += config.reputationGainPerRepair;
    state.battery -= 1;
    state.messages.push(`修好了！${customer.name} 满意离开，获得 ${customer.reward} 报酬`);
    removeCustomer(state, customer.id);
  } else {
    state.battery -= 1;
    state.reputation -= config.reputationLossPerBadRepair;
    state.messages.push(`换错了零件，${customer.name} 气呼呼地走了，口碑下降`);
    removeCustomer(state, customer.id);
  }
  state.currentCustomerId = null;
}

function buyPart(state: BusinessState, config: BusinessConfig, partId: string): void {
  const part = config.parts.find((p) => p.id === partId);
  if (!part) return;
  if (state.money < part.cost) {
    state.messages.push('资金不足');
    return;
  }
  state.money -= part.cost;
  state.inventory[partId] = (state.inventory[partId] ?? 0) + 1;
  state.messages.push(`进货：${part.name}`);
}

function buyBattery(state: BusinessState, config: BusinessConfig): void {
  if (state.money < config.batteryCost) {
    state.messages.push('资金不足，买不起电池');
    return;
  }
  state.money -= config.batteryCost;
  state.battery += config.batteryRefill;
  state.messages.push(`补充能量电池 +${config.batteryRefill}`);
}

function buyUpgrade(state: BusinessState, config: BusinessConfig, upgradeId: string): void {
  const up = config.upgrades.find((u) => u.id === upgradeId);
  if (!up) return;
  if (state.upgradesOwned.includes(upgradeId)) {
    state.messages.push('已经升级过了');
    return;
  }
  if (state.money < up.cost) {
    state.messages.push('资金不足');
    return;
  }
  state.money -= up.cost;
  state.upgradesOwned.push(upgradeId);
  for (const eff of up.effects) {
    if (eff.type === 'addReputation') state.reputation += eff.amount ?? 0;
    if (eff.type === 'addMoney') state.money += eff.amount ?? 0;
  }
  state.messages.push(`升级完成：${up.name}`);
}

function triggerEvent(state: BusinessState, config: BusinessConfig, rng: Rng): void {
  if (config.events.length === 0) return;
  const total = config.events.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = rng.next() * total;
  let picked = config.events[config.events.length - 1];
  for (const e of config.events) {
    r -= e.weight ?? 1;
    if (r <= 0) {
      picked = e;
      break;
    }
  }
  state.messages.push(`【事件】${picked.name}`);
  for (const eff of picked.effects) {
    if (eff.type === 'addMoney') state.money += eff.amount ?? 0;
    if (eff.type === 'addReputation') state.reputation += eff.amount ?? 0;
    if (eff.type === 'message') state.messages.push(eff.text ?? '');
  }
}

function nextTurn(state: BusinessState, config: BusinessConfig, rng: Rng): void {
  const survivors: CustomerInstance[] = [];
  for (const q of state.queue) {
    const np = q.patience - config.patienceDecay;
    if (np <= 0) {
      state.reputation -= config.reputationLossPerLeave;
      const c = config.customers.find((cc) => cc.id === q.customerId);
      state.messages.push(`${c?.name ?? '顾客'} 等不及走了，口碑下降`);
    } else {
      survivors.push({ customerId: q.customerId, patience: np });
    }
  }
  state.queue = survivors;
  state.currentCustomerId = null;

  state.turn += 1;
  if (state.turn <= config.totalTurns) {
    spawnCustomers(state, config, rng);
  }
  triggerEvent(state, config, rng);
}

export function reduce(state: BusinessState, input: NormalizedInput, ctx: ModuleContext): void {
  if (state.phase === 'result') return;
  if (input.kind !== 'action') return;
  const config = ctx.bundle.primaryModule.config as BusinessConfig;
  const params = input.params ?? {};

  switch (input.actionId) {
    case 'serve':
      serve(state, config, params.customerId ?? '');
      break;
    case 'choosePart':
      choosePart(state, config, params.partId ?? '');
      break;
    case 'buyPart':
      buyPart(state, config, params.partId ?? '');
      break;
    case 'buyBattery':
      buyBattery(state, config);
      break;
    case 'buyUpgrade':
      buyUpgrade(state, config, params.upgradeId ?? '');
      break;
    case 'nextTurn':
      nextTurn(state, config, ctx.rng);
      break;
    default:
      state.messages.push(`未知操作：${input.actionId}`);
  }
  checkEndings(state, ctx);
}
