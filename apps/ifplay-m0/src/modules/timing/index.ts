import type { GameplayModule } from '@/modules/contract';
import type { ValidationResult } from '@/core/schema';
import { timingConfigSchema, type TimingConfig } from './config';
import { createInitialState, reduce, tick, type TimingState } from './logic';
import { view } from './view';

function validateConfig(config: unknown): ValidationResult {
  const r = timingConfigSchema.safeParse(config);
  if (r.success) return { ok: true };
  return { ok: false, errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
}

// 旧存档兼容：缺新字段时用默认值补齐
function normalizeState(json: unknown, config: TimingConfig): TimingState {
  const s = (json ?? {}) as Partial<TimingState>;
  return {
    phase: s.phase === 'result' ? 'result' : 'play',
    spirit: s.spirit ?? config.spirit.start,
    exposure: s.exposure ?? config.exposure.start,
    breath: s.breath ?? config.breath.start,
    combo: s.combo ?? 0,
    stageIndex: s.stageIndex ?? 0,
    marker: s.marker ?? 0,
    windowStart: s.windowStart ?? 0,
    windowEnd: s.windowEnd ?? 0,
    windowCenter: s.windowCenter ?? config.windowCenter,
    holding: s.holding ?? false,
    lastTier: s.lastTier ?? null,
    skillsUnlocked: Array.isArray(s.skillsUnlocked) ? s.skillsUnlocked : [],
    skillsUsed: Array.isArray(s.skillsUsed) ? s.skillsUsed : [],
    rating: s.rating ?? null,
    failReason: s.failReason ?? null,
    messages: Array.isArray(s.messages) ? s.messages : [],
    endingId: s.endingId ?? null,
    endingName: s.endingName ?? null,
    endingDesc: s.endingDesc ?? null,
  };
}

export const timingModule: GameplayModule<TimingConfig, TimingState> = {
  id: 'timing',
  version: '1.1.0',
  validateConfig,
  createInitialState,
  reduce,
  tick,
  serialize: (s) => s,
  deserialize: (json, config) => normalizeState(json, config),
  view,
  scoreOf: (s) => s.spirit,
};
