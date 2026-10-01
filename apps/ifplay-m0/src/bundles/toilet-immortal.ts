import type { GameBundle } from '@/core/schema';

// 《在公司厕所偷偷修仙》—— 点击时机样例。
// 题材内容（灵气 / 憋气 / 暴露度 / 文案）只存在于本配置中，引擎不感知题材。
export const toiletImmortalBundle: GameBundle = {
  manifest: {
    id: 'toilet-immortal',
    name: '在公司厕所偷偷修仙',
    version: '1.0.0',
    author: 'IfPlay',
    language: 'zh-CN',
    runtimeVersion: '0.2',
  },
  experience: {
    playerRole: '在工位上偷偷修炼的上班族',
    goal: '在安全窗口点击运气，攒满灵气完成小周天',
    estimatedMinutes: 3,
    difficulty: 1,
    intro: ['观察巡查条的节奏', '在安全窗口内点击运气', '别让暴露度爆表', '攒满灵气完成小周天'],
  },
  scenes: [
    { id: 'menu', type: 'menu', layoutId: 'portrait' },
    { id: 'play', type: 'play', layoutId: 'portrait' },
    { id: 'result', type: 'result', layoutId: 'portrait' },
  ],
  primaryModule: {
    id: 'timing',
    version: '1.0.0',
    config: {
      labels: { spirit: '灵气', breath: '憋气', exposure: '暴露度', combo: '连击' },
      cycleMs: 2400,
      windowCenter: 0.5,
      windowWidth: 0.3,
      jitter: 0.15,
      tiers: { perfect: 0.4, good: 0.7 },
      spirit: { start: 0, target: 100 },
      exposure: { start: 0, max: 100 },
      breath: { start: 100, max: 100 },
      successGain: { perfect: 22, good: 14, normal: 8 },
      missPenalty: 16,
      comboMultiplier: 0.08,
      hold: { slowFactor: 0.5, breathDrainPerMs: 0.02 },
      breathRecoveryPerMs: 0.01,
      tapHint: '在绿色安全区点击运气',
    },
  },
  auxiliaryModules: [],
  entities: [],
  rules: [],
  progression: {
    tasks: [],
    upgrades: [],
    endings: [
      { id: 'enlightened', name: '小周天圆满', desc: '灵气圆满，你在工位上完成了小周天，解锁了新的功法。', condition: { type: 'resourceReached', params: { resource: 'spirit', value: 100 } } },
      { id: 'caught', name: '被老板发现', desc: '暴露度爆表，老板端着咖啡推开了厕所门。', condition: { type: 'resourceReached', params: { resource: 'exposure', value: 100 } } },
    ],
  },
  uiLayout: {
    theme: { accent: '#2fb5a8' },
    playLayout: 'portrait',
  },
  assets: { placeholder: '🧘' },
  saveSchema: {
    version: 1,
    keys: ['phase', 'spirit', 'exposure', 'breath', 'combo', 'marker', 'windowStart', 'windowEnd', 'windowCenter', 'holding', 'lastTier', 'messages', 'endingId'],
  },
  testPlan: {
    cases: [
      { name: '安全窗口点击', type: 'timing', steps: ['在窗口内点击'], expect: '灵气上升、连击增加' },
      { name: '攒满灵气', type: 'timing', steps: ['连续窗口内点击'], expect: '达成小周天结局' },
    ],
  },
};
