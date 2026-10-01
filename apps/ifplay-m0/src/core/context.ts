import type { Rng } from '@/core/rng';
import type { Bus } from '@/core/bus';
import type { Clock } from '@/core/clock';
import type { GameBundle } from '@/core/schema';

// 模块在 reduce/tick 中可用的运行上下文（全部由运行时注入，模块不接触 DOM / 时钟细节）。
export interface ModuleContext {
  rng: Rng;
  bus: Bus;
  clock: Clock;
  bundle: GameBundle;
}
