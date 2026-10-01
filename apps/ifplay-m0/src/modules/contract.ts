import type { Rng } from '@/core/rng';
import type { GameBundle, ValidationResult } from '@/core/schema';
import type { NormalizedInput } from '@/core/input';
import type { ModuleView } from '@/core/viewModel';
import type { ModuleContext } from '@/core/context';

// 玩法模块统一契约：所有玩法模块都必须实现该接口，由运行时按 bundle 的 primaryModule.id 调用。
export interface GameplayModule<C = unknown, S = Record<string, unknown>> {
  id: string;
  version: string;
  validateConfig(config: unknown): ValidationResult;
  // 可选：跨字段校验（需要访问整个 bundle，如 story-quiz 的结局引用）
  validateBundle?(config: unknown, bundle: GameBundle): ValidationResult;
  createInitialState(config: C, seed: number, rng: Rng): S;
  reduce(state: S, input: NormalizedInput, ctx: ModuleContext): void;
  tick?(state: S, dt: number, ctx: ModuleContext): void;
  serialize(state: S): unknown;
  deserialize(json: unknown, config: C): S;
  view(state: S, config: C): ModuleView;
}
