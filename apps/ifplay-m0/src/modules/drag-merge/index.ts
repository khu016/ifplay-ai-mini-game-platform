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

export const dragMergeModule: GameplayModule<DragMergeConfig, DragMergeState> = {
  id: 'drag-merge',
  version: '1.0.0',
  validateConfig,
  createInitialState,
  reduce,
  serialize: (s) => s,
  deserialize: (json) => json as DragMergeState,
  view,
};
