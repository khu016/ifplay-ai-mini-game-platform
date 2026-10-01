import type { GameplayModule } from '@/modules/contract';
import type { ValidationResult } from '@/core/schema';
import { timingConfigSchema, type TimingConfig } from './config';
import { createInitialState, reduce, tick, type TimingState } from './logic';
import { view } from './view';

function validateConfig(config: unknown): ValidationResult {
  const r = timingConfigSchema.safeParse(config);
  if (r.success) return { ok: true };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

export const timingModule: GameplayModule<TimingConfig, TimingState> = {
  id: 'timing',
  version: '1.0.0',
  validateConfig,
  createInitialState,
  reduce,
  tick,
  serialize: (s) => s,
  deserialize: (json) => json as TimingState,
  view,
};
