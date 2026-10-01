import type { GameBundle } from '@/core/schema';

// 《凌晨三点在业主群竞选小区龙王》—— 剧情问答样例。
// 题材内容只存在于本配置；引擎与模块不感知题材。
export const dragonKingBundle: GameBundle = {
  manifest: {
    id: 'dragon-king',
    name: '凌晨三点在业主群竞选小区龙王',
    version: '1.0.0',
    author: 'IfPlay',
    language: 'zh-CN',
    runtimeVersion: '0.3',
  },
  experience: {
    playerRole: '深夜还在业主群潜水的住户',
    goal: '在业主群竞选「小区龙王」，赢得大家的票',
    estimatedMinutes: 3,
    difficulty: 1,
    intro: ['凌晨三点的业主群突然热闹', '做选择积累威望、幽默、靠谱', '票数由你的声望决定', '传说还有隐藏的龙王转世结局'],
  },
  scenes: [
    { id: 'menu', type: 'menu', layoutId: 'portrait' },
    { id: 'play', type: 'play', layoutId: 'portrait' },
    { id: 'result', type: 'result', layoutId: 'portrait' },
  ],
  primaryModule: {
    id: 'story-quiz',
    version: '1.0.0',
    config: {
      labels: { score: '人气' },
      attributes: [
        { id: 'prestige', name: '威望' },
        { id: 'humor', name: '幽默' },
        { id: 'reliable', name: '靠谱' },
      ],
      startNodeId: 'start',
      nodes: [
        {
          id: 'start',
          speaker: '业主群',
          text: '凌晨三点，业主群突然热闹起来：有人提议选个「小区龙王」调解邻里纠纷。你决定参选。',
          choices: [
            { id: 'c_redpacket', text: '先发个红包热场', effects: [{ type: 'addAttribute', attribute: 'humor', amount: 1 }, { type: 'addAttribute', attribute: 'prestige', amount: 1 }, { type: 'addScore', amount: 5 }], next: 'rp' },
            { id: 'c_soup', text: '甩出一张深夜鸡汤图', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 1 }], next: 'soup' },
            { id: 'c_lurk', text: '潜水观察局势', effects: [{ type: 'addAttribute', attribute: 'reliable', amount: 1 }], next: 'lurk' },
            { id: 'c_claim', text: '晒出「龙王转世」截图', effects: [{ type: 'addFlag', flag: 'claimed' }, { type: 'addAttribute', attribute: 'prestige', amount: 2 }], next: 'claim', once: true },
          ],
        },
        {
          id: 'rp',
          speaker: '业主群',
          text: '红包一秒被抢光，有人喊「龙王大气」。',
          choices: [
            { id: 'c_program1', text: '趁热打铁，宣布竞选纲领', next: 'program' },
            { id: 'c_rp2', text: '再发一个，雨露均沾', effects: [{ type: 'addAttribute', attribute: 'humor', amount: 2 }, { type: 'addScore', amount: 10 }], next: 'rp2', once: true },
          ],
        },
        {
          id: 'rp2',
          speaker: '业主群',
          text: '第二个红包也秒光，有人质疑你「是不是家里有矿」。',
          choices: [
            { id: 'c_admit', text: '坦然承认：有矿，但更想当龙王', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 1 }], next: 'program' },
          ],
        },
        {
          id: 'soup',
          speaker: '业主群',
          text: '鸡汤图发出去，点赞寥寥，有人回「大半夜喝鸡汤不睡觉吗」。',
          choices: [
            { id: 'c_joke', text: '回一句「龙王不睡觉」，赢得一笑', effects: [{ type: 'addAttribute', attribute: 'humor', amount: 1 }], next: 'program' },
            { id: 'c_serious', text: '认真解释养生的好处', effects: [{ type: 'addAttribute', attribute: 'reliable', amount: 1 }], next: 'serious' },
          ],
        },
        {
          id: 'serious',
          speaker: '业主群',
          text: '你认真科普了一篇养生文，群里安静了。',
          choices: [
            { id: 'c_stop', text: '见好就收，宣布竞选', next: 'program' },
          ],
        },
        {
          id: 'lurk',
          speaker: '业主群',
          text: '你潜着，看大家吵了半小时。有人 @你「你怎么看」。',
          choices: [
            { id: 'c_watch', text: '「我在看谁配当龙王」', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 1 }], next: 'program' },
            { id: 'c_lurk2', text: '继续潜水', effects: [{ type: 'addAttribute', attribute: 'reliable', amount: 1 }], next: 'lurk2' },
          ],
        },
        {
          id: 'lurk2',
          speaker: '业主群',
          text: '你继续潜水，大家开始怀疑你掉线了。',
          choices: [
            { id: 'c_back', text: '「在呢，刚在观察」', next: 'program' },
          ],
        },
        {
          id: 'claim',
          speaker: '业主群',
          text: '你晒出「龙王转世」截图，群里炸了：一半人膜拜，一半人要求打假。',
          choices: [
            { id: 'c_hold', text: '坚持到底：转世不需要解释', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 1 }], next: 'program' },
          ],
        },
        {
          id: 'program',
          speaker: '你',
          text: '你正式宣布竞选纲领：「邻里事，龙王管。」',
          choices: [
            { id: 'c_repair', text: '承诺帮大家修水管', effects: [{ type: 'addAttribute', attribute: 'reliable', amount: 2 }], next: 'repair' },
            { id: 'c_money', text: '承诺每周发一次红包', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 1 }, { type: 'addAttribute', attribute: 'humor', amount: 1 }], next: 'money' },
            { id: 'c_dance', text: '承诺解决广场舞扰民', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 2 }], next: 'dance' },
          ],
        },
        {
          id: 'repair',
          speaker: '业主群',
          text: '有人接话：「先把三号楼的水管修了吧」。',
          choices: [
            { id: 'c_do', text: '当场拍板：明天就修', effects: [{ type: 'addAttribute', attribute: 'reliable', amount: 1 }], next: 'vote' },
          ],
        },
        {
          id: 'money',
          speaker: '业主群',
          text: '有人问「红包有多大」。',
          choices: [
            { id: 'c_rain', text: '「雨露均沾，人人有份」', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 1 }], next: 'vote' },
          ],
        },
        {
          id: 'dance',
          speaker: '广场舞大妈代表',
          text: '广场舞大妈代表发来一个问号。',
          choices: [
            { id: 'c_hotline', text: '提出「龙王调解热线」', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 1 }], next: 'vote' },
          ],
        },
        {
          id: 'vote',
          speaker: '业主群',
          text: '投票开始了，群里进入紧张的沉默。',
          choices: [
            { id: 'c_hidden', text: '亮出转世证明，全场膜拜', condition: { type: 'flagIs', flag: 'claimed', value: true }, ending: 'hidden' },
            { id: 'c_success', text: '高票当选，发表龙王感言', condition: { type: 'attributeReached', attribute: 'prestige', value: 3 }, ending: 'success' },
            { id: 'c_fail', text: '票数不够，灰溜溜退选', ending: 'fail' },
          ],
        },
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
      { id: 'success', name: '当选小区龙王', desc: '你高票当选，从此三号楼的邻里纠纷都归你管。' },
      { id: 'fail', name: '竞选失败', desc: '票数不够，你退出了竞选，回家继续潜水。' },
      { id: 'hidden', name: '龙王转世', desc: '隐藏结局：你亮出转世证明，业主们连夜给你修了座龙王庙。' },
    ],
  },
  uiLayout: {
    theme: { accent: '#3d7eff' },
    playLayout: 'portrait',
  },
  assets: { placeholder: '🐉' },
  saveSchema: {
    version: 1,
    keys: ['phase', 'currentNodeId', 'attributes', 'score', 'flags', 'usedChoices', 'history', 'messages', 'endingId'],
  },
  testPlan: {
    cases: [
      { name: '选择推进剧情', type: 'general', steps: ['选择一个选项'], expect: '跳转到下一个节点' },
      { name: '声望达标当选', type: 'general', steps: ['积累威望到 3 再投票'], expect: '达成当选结局' },
    ],
  },
};
