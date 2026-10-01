import type { DragMergeConfig } from './config';
import type { Rng } from '@/core/rng';
import type { NormalizedInput } from '@/core/input';
import type { ModuleContext } from '@/core/context';
import { evaluateCondition, type EffectContext } from '@/core/effects';

export interface DragMergeState {
  phase: 'play' | 'result';
  score: number;
  step: number;
  combo: number;
  inventory: Record<string, number>;
  slots: Record<string, string | null>;
  produced: string[];
  flags: Record<string, unknown>;
  messages: string[];
  endingId: string | null;
  endingName: string | null;
  endingDesc: string | null;
}

export function createInitialState(config: DragMergeConfig, _seed: number, _rng: Rng): DragMergeState {
  const slots: Record<string, string | null> = {};
  for (const s of config.slots) slots[s.id] = null;
  return {
    phase: 'play',
    score: 0,
    step: 0,
    combo: 0,
    inventory: { ...config.initialItems },
    slots,
    produced: [],
    flags: {},
    messages: [],
    endingId: null,
    endingName: null,
    endingDesc: null,
  };
}

function checkEndings(state: DragMergeState, ctx: ModuleContext): boolean {
  for (const e of ctx.bundle.progression.endings) {
    if (!e.condition) continue;
    const ectx: EffectContext = {
      resources: { score: state.score, step: state.step },
      flags: state.flags,
      turn: 0,
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

function allSlotsFilled(state: DragMergeState): boolean {
  return Object.values(state.slots).every((v) => v !== null);
}

function resolveRecipes(state: DragMergeState, config: DragMergeConfig): void {
  const recipe = config.recipes.find((r) =>
    Object.entries(r.inputs).every(([slotId, itemId]) => state.slots[slotId] === itemId),
  );
  if (recipe) {
    const gain = Math.round(recipe.score * (1 + state.combo * config.comboMultiplier));
    state.score += gain;
    state.combo += 1;
    state.produced.push(recipe.resultName);
    if (recipe.flag) state.flags[recipe.flag] = true;
    state.messages.push(`合成成功：${recipe.resultName}（+${gain} 分）`);
  } else {
    state.score = Math.max(0, state.score - config.wrongPenalty);
    state.combo = 0;
    state.messages.push('合成失败，糊了！');
  }
  for (const k of Object.keys(state.slots)) state.slots[k] = null;
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
    const item = config.items.find((i) => i.id === itemId);
    state.messages.push(`放入：${item?.name ?? itemId}`);
  }
  checkEndings(state, ctx);
}

function clearSlot(state: DragMergeState, config: DragMergeConfig, slotId: string): void {
  const itemId = state.slots[slotId];
  if (!itemId) return;
  state.slots[slotId] = null;
  state.inventory[itemId] = (state.inventory[itemId] ?? 0) + 1;
  const item = config.items.find((i) => i.id === itemId);
  state.messages.push(`取回：${item?.name ?? itemId}`);
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
    default:
      state.messages.push(`未知操作：${input.actionId}`);
  }
}
