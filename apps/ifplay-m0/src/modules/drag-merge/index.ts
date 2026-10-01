import type { GameplayModule } from '@/modules/contract';
import type { ValidationResult } from '@/core/schema';
import { dragMergeConfigSchema, type DragMergeConfig } from './config';
import { createInitialState, reduce, type DragMergeState } from './logic';
import { view } from './view';

function validateConfig(config: unknown): ValidationResult {
  const r = dragMergeConfigSchema.safeParse(config);
  if (r.success) return { ok: true };
  return { ok: false, errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

// 旧存档兼容：缺新字段时用默认值补齐
function normalizeState(json: unknown, config: DragMergeConfig): DragMergeState {
  const s = (json ?? {}) as Partial<DragMergeState>;
  const slots: Record<string, string | null> = {};
  for (const sl of config.slots) slots[sl.id] = null;
  return {
    phase: s.phase === 'result' ? 'result' : 'play',
    score: s.score ?? 0,
    step: s.step ?? 0,
    combo: s.combo ?? 0,
    inventory: { ...(s.inventory ?? {}) },
    slots: { ...slots, ...(s.slots ?? {}) },
    discovered: Array.isArray(s.discovered) ? s.discovered : [],
    orders: Array.isArray(s.orders)
      ? s.orders
      : (config.orders ?? []).map((o) => ({ id: o.id, fulfilled: false, expired: false })),
    produced: Array.isArray(s.produced) ? s.produced : [],
    flags: { ...(s.flags ?? {}) },
    messages: Array.isArray(s.messages) ? s.messages : [],
    endingId: s.endingId ?? null,
    endingName: s.endingName ?? null,
    endingDesc: s.endingDesc ?? null,
  };
}

export const dragMergeModule: GameplayModule<DragMergeConfig, DragMergeState> = {
  id: 'drag-merge',
  version: '1.1.0',
  validateConfig,
  createInitialState,
  reduce,
  serialize: (s) => s,
  deserialize: (json, config) => normalizeState(json, config),
  view,
  scoreOf: (s) => s.score,
};
