import type { GameBundle } from '@/core/schema';

// 《在公司厕所偷偷修仙》—— 点击时机样例（M1.1 深度增强）。
// 题材内容只存在于本配置；引擎与模块不感知题材。
export const toiletImmortalBundle: GameBundle = {
  manifest: {
    id: 'toilet-immortal',
    name: '在公司厕所偷偷修仙',
    version: '1.1.0',
    author: 'IfPlay',
    language: 'zh-CN',
    runtimeVersion: '0.3',
  },
  experience: {
    playerRole: '在工位上偷偷修炼的上班族',
    goal: '闯过三个越来越难的阶段，完成小周天',
    estimatedMinutes: 3,
    difficulty: 2,
    intro: ['在绿色安全窗口内点击运气', '长按能缓慢攒灵气，但会耗憋气', '每闯过一阶段解锁一个技能', '别让暴露度爆表'],
  },
  scenes: [
    { id: 'menu', type: 'menu', layoutId: 'portrait' },
    { id: 'play', type: 'play', layoutId: 'portrait' },
    { id: 'result', type: 'result', layoutId: 'portrait' },
  ],
  primaryModule: {
    id: 'timing',
    version: '1.1.0',
    config: {
      labels: { spirit: '灵气', breath: '憋气', exposure: '暴露度', combo: '连击', stage: '阶段', rating: '评价' },
      cycleMs: 3000,
      windowCenter: 0.5,
      windowWidth: 0.36,
      jitter: 0.1,
      tiers: { perfect: 0.4, good: 0.7 },
      spirit: { start: 0, target: 180 },
      exposure: { start: 0, max: 100 },
      breath: { start: 100, max: 100 },
      successGain: { perfect: 14, good: 9, normal: 6 },
      missPenalty: 14,
      comboMultiplier: 0.08,
      hold: { slowFactor: 0.5, breathDrainPerMs: 0.03 },
      breathRecoveryPerMs: 0.02,
      tapHint: '绿色窗口内点击运气；长按可缓慢攒灵气但耗憋气',
      stages: [
        { cycleMs: 3000, windowWidth: 0.36, jitter: 0.1, targetSpirit: 60 },
        { cycleMs: 2600, windowWidth: 0.28, jitter: 0.15, targetSpirit: 60 },
        { cycleMs: 2200, windowWidth: 0.2, jitter: 0.2, targetSpirit: 60 },
      ],
      holdGainPerMs: 0.02,
      exposureRecoverPerMs: 0.004,
      skills: [
        { id: 'clear_mind', name: '清心咒', desc: '清掉一半暴露度', stageIndex: 0, effect: { type: 'clearExposure', amount: 50 } },
        { id: 'breath_back', name: '回气诀', desc: '恢复憋气', stageIndex: 1, effect: { type: 'healBreath', amount: 60 } },
      ],
      rating: { s: 220, a: 180, b: 120, c: 0 },
      failHintExposure: '暴露度太高被发现了。建议：只在绿色窗口点击，用「清心咒」降低暴露。',
      failHintBreath: '憋气太久憋不住了。建议：长按别太久，或及时松开回气。',
    },
  },
  auxiliaryModules: [],
  entities: [],
  rules: [],
  progression: {
    tasks: [],
    upgrades: [],
    endings: [
      { id: 'caught', name: '被老板发现', desc: '暴露度爆表，老板端着咖啡推开了厕所门。', condition: { type: 'resourceReached', params: { resource: 'exposure', value: 100 } } },
      { id: 'enlightened', name: '小周天圆满', desc: '灵气圆满，你在工位上完成了小周天，解锁了新的功法。', condition: { type: 'resourceReached', params: { resource: 'spirit', value: 180 } } },
    ],
  },
  uiLayout: {
    theme: { accent: '#2fb5a8' },
    playLayout: 'portrait',
  },
  assets: { placeholder: '🧘' },
  saveSchema: {
    version: 1,
    keys: ['phase', 'spirit', 'exposure', 'breath', 'combo', 'stageIndex', 'marker', 'windowStart', 'windowEnd', 'windowCenter', 'holding', 'lastTier', 'skillsUnlocked', 'skillsUsed', 'messages', 'endingId'],
  },
  testPlan: {
    cases: [
      { name: '窗口内点击', type: 'timing', steps: ['在窗口内点击'], expect: '灵气上升、连击增加' },
      { name: '闯三阶段圆满', type: 'timing', steps: ['连续窗口内点击闯过三阶段'], expect: '达成圆满结局' },
    ],
  },
};
