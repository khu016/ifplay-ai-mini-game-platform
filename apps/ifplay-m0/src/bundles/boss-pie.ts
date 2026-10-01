import type { GameBundle } from '@/core/schema';

// 《把老板画的饼拖进微波炉炼成年终奖》—— 拖拽合成样例（M1.1 深度增强）。
// 题材内容只存在于本配置；引擎与模块不感知题材。
export const bossPieBundle: GameBundle = {
  manifest: {
    id: 'boss-pie',
    name: '把老板画的饼拖进微波炉炼成年终奖',
    version: '1.1.0',
    author: 'IfPlay',
    language: 'zh-CN',
    runtimeVersion: '0.3',
  },
  experience: {
    playerRole: '年底加班到眼神涣散的员工',
    goal: '把各种饼炼成「年终奖」和「养生大师」，交付两张订单',
    estimatedMinutes: 3,
    difficulty: 2,
    intro: ['把物品拖进微波炉两格，合成新东西', '合成「年终奖」和「养生大师」', '在期限内交付订单', '小心别把饼炼糊了'],
  },
  scenes: [
    { id: 'menu', type: 'menu', layoutId: 'portrait' },
    { id: 'play', type: 'play', layoutId: 'portrait' },
    { id: 'result', type: 'result', layoutId: 'portrait' },
  ],
  primaryModule: {
    id: 'drag-merge',
    version: '1.1.0',
    config: {
      labels: { score: '得分', steps: '步骤', combo: '连击', orders: '订单', discovered: '图鉴' },
      maxSteps: 24,
      wrongPenalty: 8,
      comboMultiplier: 0.1,
      items: [
        { id: 'boss_pie', name: '大饼' },
        { id: 'chicken_blood', name: '鸡血' },
        { id: 'sentiment', name: '情怀' },
        { id: 'empty_check', name: '空头支票' },
        { id: 'thermos', name: '保温杯' },
        { id: 'bonus_proto', name: '年终奖雏形' },
        { id: 'bigger_pie', name: '更大的饼' },
        { id: 'bonus', name: '年终奖' },
        { id: 'health_master', name: '养生大师' },
        { id: 'frog', name: '温水煮青蛙' },
        { id: 'runaway', name: '跑路计划' },
      ],
      slots: [
        { id: 'left', name: '微波炉左格' },
        { id: 'right', name: '微波炉右格' },
      ],
      recipes: [
        { id: 'proto', name: '年终奖雏形', inputs: { left: 'boss_pie', right: 'chicken_blood' }, output: { itemId: 'bonus_proto', count: 1 }, score: 40, resultName: '年终奖雏形', hint: '大饼配鸡血，似乎能炼出点东西' },
        { id: 'bonus_a', name: '年终奖', inputs: { left: 'bonus_proto', right: 'sentiment' }, output: { itemId: 'bonus', count: 1 }, score: 80, resultName: '年终奖', hint: '雏形再注入一点情怀' },
        { id: 'bigger', name: '更大的饼', inputs: { left: 'boss_pie', right: 'empty_check' }, output: { itemId: 'bigger_pie', count: 1 }, score: 25, resultName: '更大的饼', hint: '大饼配空头支票，越吹越大' },
        { id: 'bonus_b', name: '年终奖', inputs: { left: 'bigger_pie', right: 'chicken_blood' }, output: { itemId: 'bonus', count: 1 }, score: 60, resultName: '年终奖', hint: '更大的饼再打点鸡血' },
        { id: 'health', name: '养生大师', inputs: { left: 'thermos', right: 'sentiment' }, output: { itemId: 'health_master', count: 1 }, score: 20, resultName: '养生大师', hint: '保温杯泡情怀' },
        { id: 'frog_r', name: '温水煮青蛙', inputs: { left: 'boss_pie', right: 'thermos' }, output: { itemId: 'frog', count: 1 }, score: 5, resultName: '温水煮青蛙', hint: '大饼配保温杯，温水煮青蛙' },
        { id: 'runaway_r', name: '跑路计划', inputs: { left: 'empty_check', right: 'empty_check' }, output: { itemId: 'runaway', count: 1 }, score: 0, resultName: '跑路计划', flag: 'runaway', hint: '两张空头支票，好像能兑出点什么' },
      ],
      supply: {
        pool: [
          { itemId: 'boss_pie', weight: 3 },
          { itemId: 'chicken_blood', weight: 2 },
          { itemId: 'sentiment', weight: 2 },
          { itemId: 'empty_check', weight: 2 },
          { itemId: 'thermos', weight: 2 },
        ],
        initialDraw: 4,
        restockEvery: 4,
        restockCount: 2,
      },
      initialItems: { boss_pie: 2, chicken_blood: 1, sentiment: 1, empty_check: 1, thermos: 1 },
      orders: [
        { id: 'order_bonus', name: '年终奖订单', targetItemId: 'bonus', deadlineStep: 18, reward: 100 },
        { id: 'order_health', name: '养生订单', targetItemId: 'health_master', deadlineStep: 12, reward: 40 },
      ],
      goal: { type: 'ordersFulfilled', value: 2 },
    },
  },
  auxiliaryModules: [],
  entities: [],
  rules: [],
  progression: {
    tasks: [],
    upgrades: [],
    endings: [
      { id: 'success', name: '年终奖到手', desc: '你炼出了年终奖和养生大师，两张订单全部交付，过年有底了。', condition: { type: 'resourceReached', params: { resource: 'ordersFulfilled', value: 2 } } },
      { id: 'fail', name: '饼糊了', desc: '步骤用完了，微波炉里只剩一滩糊掉的饼。', condition: { type: 'resourceReached', params: { resource: 'step', value: 24 } } },
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
    keys: ['phase', 'score', 'step', 'combo', 'inventory', 'slots', 'discovered', 'orders', 'produced', 'flags', 'messages', 'endingId'],
  },
  testPlan: {
    cases: [
      { name: '多级合成年终奖', type: 'general', steps: ['大饼+鸡血', '雏形+情怀'], expect: '炼出年终奖' },
      { name: '交付两张订单', type: 'general', steps: ['炼出年终奖与养生大师并交付'], expect: '达成成功结局' },
    ],
  },
};
