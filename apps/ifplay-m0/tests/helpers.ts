import type { GameBundle, ModuleId } from '@/core/schema';

// 构造最小可用 GameBundle（用于模块测试夹具）。
export function makeBundle(
  id: ModuleId,
  config: unknown,
  endings: GameBundle['progression']['endings'],
): GameBundle {
  return {
    manifest: {
      id: `fixture-${id}`,
      name: 'Fixture',
      version: '1.0.0',
      author: 'test',
      language: 'zh-CN',
      runtimeVersion: '0.2',
    },
    experience: {
      playerRole: '测试者',
      goal: '测试目标',
      estimatedMinutes: 1,
      difficulty: 1,
      intro: [],
    },
    scenes: [
      { id: 'menu', type: 'menu', layoutId: 'portrait' },
      { id: 'play', type: 'play', layoutId: 'portrait' },
      { id: 'result', type: 'result', layoutId: 'portrait' },
    ],
    primaryModule: { id, version: '1.0.0', config },
    auxiliaryModules: [],
    entities: [],
    rules: [],
    progression: { tasks: [], upgrades: [], endings },
    uiLayout: { theme: { accent: '#fff' }, playLayout: 'portrait' },
    assets: { placeholder: '?' },
    saveSchema: { version: 1, keys: ['phase'] },
    testPlan: { cases: [] },
  };
}
