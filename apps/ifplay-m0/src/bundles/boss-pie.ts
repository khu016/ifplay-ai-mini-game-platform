import type { GameBundle } from '@/core/schema';

// 《把老板画的饼拖进微波炉炼成年终奖》—— 拖拽合成样例。
// 题材内容只存在于本配置；引擎与模块不感知题材。
export const bossPieBundle: GameBundle = {
  manifest: {
    id: 'boss-pie',
    name: '把老板画的饼拖进微波炉炼成年终奖',
    version: '1.0.0',
    author: 'IfPlay',
    language: 'zh-CN',
    runtimeVersion: '0.3',
  },
  experience: {
    playerRole: '年底加班到眼神涣散的员工',
    goal: '把老板画的各种饼拖进微波炉，炼出「年终奖」',
    estimatedMinutes: 3,
    difficulty: 1,
    intro: ['把物品拖进微波炉的两格', '正确的组合能炼出好东西', '凑够 150 分，年终奖到手', '别把饼炼糊了'],
  },
  scenes: [
    { id: 'menu', type: 'menu', layoutId: 'portrait' },
    { id: 'play', type: 'play', layoutId: 'portrait' },
    { id: 'result', type: 'result', layoutId: 'portrait' },
  ],
  primaryModule: {
    id: 'drag-merge',
    version: '1.0.0',
    config: {
      labels: { score: '得分', steps: '步骤', combo: '连击' },
      maxSteps: 20,
      targetScore: 150,
      wrongPenalty: 10,
      comboMultiplier: 0.1,
      items: [
        { id: 'boss_pie', name: '大饼' },
        { id: 'chicken_blood', name: '鸡血' },
        { id: 'sentiment', name: '情怀' },
        { id: 'empty_check', name: '空头支票' },
        { id: 'thermos', name: '保温杯' },
      ],
      slots: [
        { id: 'left', name: '微波炉左格' },
        { id: 'right', name: '微波炉右格' },
      ],
      initialItems: { boss_pie: 3, chicken_blood: 2, sentiment: 2, empty_check: 2, thermos: 2 },
      recipes: [
        { id: 'bonus', name: '年终奖', inputs: { left: 'boss_pie', right: 'chicken_blood' }, score: 100, resultName: '年终奖' },
        { id: 'banner', name: '满墙锦旗', inputs: { left: 'boss_pie', right: 'sentiment' }, score: 40, resultName: '满墙锦旗' },
        { id: 'manifesto', name: '打鸡血宣言', inputs: { left: 'empty_check', right: 'chicken_blood' }, score: 30, resultName: '打鸡血宣言' },
        { id: 'health', name: '养生大师', inputs: { left: 'thermos', right: 'sentiment' }, score: 20, resultName: '养生大师' },
        { id: 'bigger_pie', name: '更大的饼', inputs: { left: 'boss_pie', right: 'empty_check' }, score: 15, resultName: '更大的饼' },
        { id: 'frog', name: '温水煮青蛙', inputs: { left: 'boss_pie', right: 'thermos' }, score: 5, resultName: '温水煮青蛙' },
        { id: 'runaway', name: '跑路计划', inputs: { left: 'empty_check', right: 'empty_check' }, score: 0, resultName: '跑路计划', flag: 'runaway' },
      ],
    },
  },
  auxiliaryModules: [],
  entities: [],
  rules: [],
  progression: {
    tasks: [],
    upgrades: [],
    endings: [
      { id: 'success', name: '年终奖到手', desc: '你把老板画的饼炼成了沉甸甸的年终奖，过年有底了。', condition: { type: 'resourceReached', params: { resource: 'score', value: 150 } } },
      { id: 'fail', name: '饼糊了', desc: '步骤用完了，微波炉里只剩一滩糊掉的饼。', condition: { type: 'resourceReached', params: { resource: 'step', value: 20 } } },
      { id: 'hidden', name: '卷款跑路', desc: '隐藏结局：两张空头支票炼出了跑路计划，你带着微波炉连夜辞职。', condition: { type: 'flagIs', params: { flag: 'runaway', value: true } } },
    ],
  },
  uiLayout: {
    theme: { accent: '#ff9f43' },
    playLayout: 'portrait',
  },
  assets: { placeholder: '🥧' },
  saveSchema: {
    version: 1,
    keys: ['phase', 'score', 'step', 'combo', 'inventory', 'slots', 'produced', 'flags', 'messages', 'endingId'],
  },
  testPlan: {
    cases: [
      { name: '正确配方合成', type: 'general', steps: ['拖大饼入左格', '拖鸡血入右格'], expect: '合成年终奖，得分上升' },
      { name: '炼成年终奖', type: 'general', steps: ['凑够 150 分'], expect: '达成成功结局' },
    ],
  },
};
