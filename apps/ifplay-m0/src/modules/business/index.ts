import type { GameplayModule } from '@/modules/contract';
import type { ValidationResult } from '@/core/schema';
import { businessConfigSchema, type BusinessConfig } from './config';
import { createInitialState, reduce, type BusinessState } from './logic';
import { view } from './view';

function validateConfig(config: unknown): ValidationResult {
  const r = businessConfigSchema.safeParse(config);
  if (r.success) return { ok: true };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}

export const businessModule: GameplayModule<BusinessConfig, BusinessState> = {
  id: 'business',
  version: '1.0.0',
  validateConfig,
  createInitialState,
  reduce,
  serialize: (s) => s,
  deserialize: (json) => json as BusinessState,
  view,
};
