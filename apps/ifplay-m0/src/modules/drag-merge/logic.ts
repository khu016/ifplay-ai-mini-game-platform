import type { DragMergeConfig } from './config';
import type { Rng } from '@/core/rng';
import type { NormalizedInput } from '@/core/input';
import type { ModuleContext } from '@/core/context';
import { evaluateCondition, type EffectContext } from '@/core/effects';

export interface DragOrderState {
  id: string;
  fulfilled: boolean;
  expired: boolean;
}

export interface DragMergeState {
  phase: 'play' | 'result';
  score: number;
  step: number;
  combo: number;
  inventory: Record<string, number>;
  slots: Record<string, string | null>;
  discovered: string[];
  orders: DragOrderState[];
  produced: string[];
  flags: Record<string, unknown>;
  messages: string[];
  endingId: string | null;
  endingName: string | null;
  endingDesc: string | null;
}

function weightedPick(pool: { itemId: string; weight: number }[], rng: Rng): string {
  const total = pool.reduce((s, p) => s + p.weight, 0);
  let r = rng.next() * total;
  for (const p of pool) {
    r -= p.weight;
    if (r <= 0) return p.itemId;
  }
  return pool[pool.length - 1].itemId;
}

function drawSupply(state: DragMergeState, config: DragMergeConfig, rng: Rng, count: number): void {
  if (!config.supply) return;
  for (let i = 0; i < count; i++) {
    const itemId = weightedPick(config.supply.pool, rng);
    state.inventory[itemId] = (state.inventory[itemId] ?? 0) + 1;
  }
}

function itemName(config: DragMergeConfig, itemId: string): string {
  return config.items.find((i) => i.id === itemId)?.name ?? itemId;
}

export function createInitialState(config: DragMergeConfig, _seed: number, rng: Rng): DragMergeState {
  const slots: Record<string, string | null> = {};
  for (const s of config.slots) slots[s.id] = null;
  const state: DragMergeState = {
    phase: 'play',
    score: 0,
    step: 0,
    combo: 0,
    inventory: {},
    slots,
    discovered: [],
    orders: (config.orders ?? []).map((o) => ({ id: o.id, fulfilled: false, expired: false })),
    produced: [],
    flags: {},
    messages: [],
    endingId: null,
    endingName: null,
    endingDesc: null,
  };
  if (config.initialItems) {
    state.inventory = { ...config.initialItems };
  }
  if (config.supply) {
    drawSupply(state, config, rng, config.supply.initialDraw);
  }
  return state;
}

function checkEndings(state: DragMergeState, ctx: ModuleContext): boolean {
  const ectx: EffectContext = {
    resources: {
      score: state.score,
      step: state.step,
      ordersFulfilled: state.orders.filter((o) => o.fulfilled).length,
    },
    flags: state.flags,
    turn: 0,
    messages: [],
  };
  // 1. 自然结局（资源/步骤类）
  let endingId: string | null = null;
  for (const e of ctx.bundle.progression.endings) {
    if (!e.condition || e.condition.type === 'flagIs') continue;
    if (evaluateCondition(e.condition, ectx)) {
      endingId = e.id;
      break;
    }
  }
  if (!endingId) return false;
  // 2. 隐藏结局在自然结局之后再结算（flag 覆盖）
  for (const e of ctx.bundle.progression.endings) {
    if (!e.condition || e.condition.type !== 'flagIs') continue;
    if (evaluateCondition(e.condition, ectx)) {
      endingId = e.id;
      break;
    }
  }
  const ending = ctx.bundle.progression.endings.find((x) => x.id === endingId);
  state.phase = 'result';
  state.endingId = endingId;
  state.endingName = ending?.name ?? endingId;
  state.endingDesc = ending?.desc ?? '';
  ctx.bus.emit({ type: 'game:ended', endingId });
  return true;
}

function allSlotsFilled(state: DragMergeState): boolean {
  return Object.values(state.slots).every((v) => v !== null);
}

function failureHint(state: DragMergeState, config: DragMergeConfig): string {
  const undiscovered = config.recipes.find((r) => !state.discovered.includes(r.id) && r.hint);
  return undiscovered?.hint ? ` 提示：${undiscovered.hint}` : '';
}

function resolveRecipes(state: DragMergeState, config: DragMergeConfig): void {
  const recipe = config.recipes.find((r) =>
    Object.entries(r.inputs).every(([slotId, itemId]) => state.slots[slotId] === itemId),
  );
  for (const k of Object.keys(state.slots)) state.slots[k] = null;

  if (recipe) {
    const gain = Math.round(recipe.score * (1 + state.combo * config.comboMultiplier));
    state.score += gain;
    state.combo += 1;
    if (!state.discovered.includes(recipe.id)) state.discovered.push(recipe.id);
    let producedName: string;
    if (recipe.output) {
      state.inventory[recipe.output.itemId] =
        (state.inventory[recipe.output.itemId] ?? 0) + recipe.output.count;
      producedName = itemName(config, recipe.output.itemId);
    } else {
      producedName = recipe.resultName ?? recipe.name;
    }
    state.produced.push(producedName);
    if (recipe.flag) state.flags[recipe.flag] = true;
    state.messages.push(`合成成功：${producedName}（+${gain} 分）`);
  } else {
    state.score = Math.max(0, state.score - config.wrongPenalty);
    state.combo = 0;
    state.messages.push(`合成失败，糊了！${failureHint(state, config)}`);
  }
}

function expireOrders(state: DragMergeState, config: DragMergeConfig): void {
  for (const inst of state.orders) {
    if (inst.fulfilled || inst.expired) continue;
    const order = config.orders?.find((o) => o.id === inst.id);
    if (order && state.step > order.deadlineStep) {
      inst.expired = true;
      state.messages.push(`订单过期：${order.name}`);
    }
  }
}

function drag(state: DragMergeState, config: DragMergeConfig, ctx: ModuleContext, itemId: string, slotId: string): void {
  const slot = config.slots.find((s) => s.id === slotId);
  if (!slot) return;
  if ((state.inventory[itemId] ?? 0) <= 0) {
    state.messages.push('这个物品已经用完了');
    return;
  }
  if (state.slots[slotId] !== null) {
    state.messages.push('这个位置已经放了东西');
    return;
  }
  if (slot.accepts && !slot.accepts.includes(itemId)) {
    state.messages.push('这里不能放这个');
    state.combo = 0;
    return;
  }
  state.inventory[itemId] -= 1;
  state.slots[slotId] = itemId;
  state.step += 1;

  if (allSlotsFilled(state)) {
    resolveRecipes(state, config);
  } else {
    state.messages.push(`放入：${itemName(config, itemId)}`);
  }

  if (config.supply && state.step % config.supply.restockEvery === 0) {
    drawSupply(state, config, ctx.rng, config.supply.restockCount);
    state.messages.push('补给到了，新物品上架');
  }
  expireOrders(state, config);
  checkEndings(state, ctx);
}

function clearSlot(state: DragMergeState, config: DragMergeConfig, slotId: string): void {
  const itemId = state.slots[slotId];
  if (!itemId) return;
  state.slots[slotId] = null;
  state.inventory[itemId] = (state.inventory[itemId] ?? 0) + 1;
  state.messages.push(`取回：${itemName(config, itemId)}`);
}

function deliver(state: DragMergeState, config: DragMergeConfig, ctx: ModuleContext, orderId: string): void {
  const order = config.orders?.find((o) => o.id === orderId);
  if (!order) return;
  const inst = state.orders.find((o) => o.id === orderId);
  if (!inst || inst.fulfilled || inst.expired) return;
  if ((state.inventory[order.targetItemId] ?? 0) <= 0) {
    state.messages.push('还没有这个产物');
    return;
  }
  state.inventory[order.targetItemId] -= 1;
  inst.fulfilled = true;
  state.score += order.reward;
  state.messages.push(`订单完成：${order.name}（+${order.reward} 分）`);
  checkEndings(state, ctx);
}

export function reduce(state: DragMergeState, input: NormalizedInput, ctx: ModuleContext): void {
  if (state.phase === 'result') return;
  if (input.kind !== 'action') return;
  const config = ctx.bundle.primaryModule.config as DragMergeConfig;
  const params = input.params ?? {};
  switch (input.actionId) {
    case 'drag':
      drag(state, config, ctx, params.itemId ?? '', params.slotId ?? '');
      break;
    case 'clear':
      clearSlot(state, config, params.slotId ?? '');
      break;
    case 'deliver':
      deliver(state, config, ctx, params.orderId ?? '');
      break;
    default:
      state.messages.push(`未知操作：${input.actionId}`);
  }
}
