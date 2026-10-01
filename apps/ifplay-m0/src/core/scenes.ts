import type { GameBundle } from '@/core/schema';

export type ScenePhase = 'menu' | 'play' | 'result';

// 场景路由：按阶段类型找到 bundle 中声明的场景 id。
export function resolveScene(bundle: GameBundle, phase: ScenePhase): string {
  const scene = bundle.scenes.find((s) => s.type === phase);
  return scene?.id ?? phase;
}
