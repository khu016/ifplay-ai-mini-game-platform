import type { GameplayModule } from '@/modules/contract';
import type { GameBundle, ValidationResult } from '@/core/schema';
import { storyQuizConfigSchema, validateStoryGraph, type StoryQuizConfig } from './config';
import { createInitialState, reduce, type StoryQuizState } from './logic';
import { view } from './view';

function validateConfig(config: unknown): ValidationResult {
  const r = storyQuizConfigSchema.safeParse(config);
  if (!r.success) {
    return { ok: false, errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
  return validateStoryGraph(r.data);
}

// 跨字段校验：节点/选项引用的 ending id 必须存在于 bundle.progression.endings
function validateBundle(config: unknown, bundle: GameBundle): ValidationResult {
  const c = config as StoryQuizConfig;
  const endingIds = new Set(bundle.progression.endings.map((e) => e.id));
  const errors: Array<{ path: string; message: string }> = [];
  for (const n of c.nodes) {
    if (n.ending && !endingIds.has(n.ending)) {
      errors.push({ path: `nodes.${n.id}.ending`, message: `结局不存在: ${n.ending}` });
    }
    for (const ch of n.choices) {
      if (ch.ending && !endingIds.has(ch.ending)) {
        errors.push({ path: `nodes.${n.id}.choices.${ch.id}.ending`, message: `结局不存在: ${ch.ending}` });
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export const storyQuizModule: GameplayModule<StoryQuizConfig, StoryQuizState> = {
  id: 'story-quiz',
  version: '1.0.0',
  validateConfig,
  validateBundle,
  createInitialState,
  reduce,
  serialize: (s) => s,
  deserialize: (json) => json as StoryQuizState,
  view,
};
