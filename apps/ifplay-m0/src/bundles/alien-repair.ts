import type { GameBundle } from '@/core/schema';

// 《我在三线城市给外星人修手机》—— 经营模拟样例。
// 题材内容（角色 / 零件 / 事件 / 结局文案）只存在于本配置中，引擎不感知题材。
export const alienRepairBundle: GameBundle = {
  manifest: {
    id: 'alien-repair',
    name: '我在三线城市给外星人修手机',
    version: '1.0.0',
    author: 'IfPlay',
    language: 'zh-CN',
    runtimeVersion: '0.2',
  },
  experience: {
    playerRole: '三线城市修手机小店的老板，专接外星顾客',
    goal: '经营 12 天，别破产、别差评倒闭，站稳脚跟',
    estimatedMinutes: 5,
    difficulty: 1,
    intro: ['接待外星顾客', '判断故障，选对零件修好手机', '进货、补电池、升级小店', '坚持 12 天不倒闭'],
  },
  scenes: [
    { id: 'menu', type: 'menu', layoutId: 'portrait' },
    { id: 'play', type: 'play', layoutId: 'portrait' },
    { id: 'result', type: 'result', layoutId: 'portrait' },
  ],
  primaryModule: {
    id: 'business',
    version: '1.0.0',
    config: {
      labels: { money: '资金', reputation: '口碑', battery: '能量电池', turn: '天数' },
      startMoney: 100,
      startReputation: 40,
      totalTurns: 12,
      customersPerTurn: 2,
      patienceDecay: 1,
      reputationLossPerLeave: 10,
      reputationGainPerRepair: 6,
      reputationLossPerBadRepair: 8,
      batteryStart: 12,
      batteryCost: 20,
      batteryRefill: 10,
      initialParts: {
        quantum_board: 1,
        anti_gravity: 1,
        signal_antenna: 1,
        waterproof_talisman: 1,
      },
      parts: [
        { id: 'quantum_board', name: '量子主板', desc: '能和地球磁场重新谈判的芯片', cost: 30 },
        { id: 'anti_gravity', name: '反重力电池', desc: '让手机老老实实待在桌上', cost: 20 },
        { id: 'signal_antenna', name: '星际信号天线', desc: '接得到母星的电话', cost: 15 },
        { id: 'waterproof_talisman', name: '防水护符贴纸', desc: '镇住液态屏幕', cost: 10 },
      ],
      customers: [
        { id: 'three_eye', name: '三眼顾客', fault: '手机和地球磁场冷战，一直自动关机', requiredPartId: 'quantum_board', reward: 80, patience: 4, desc: '三条眉毛都拧成了麻花' },
        { id: 'tentacle', name: '触手星人', fault: '手机不停飘上天花板', requiredPartId: 'anti_gravity', reward: 60, patience: 3, desc: '八只手都抓不住' },
        { id: 'silicon', name: '硅基生命', fault: '收不到母星的电话，急得发烫', requiredPartId: 'signal_antenna', reward: 50, patience: 5, desc: '体温快赶上烤箱了' },
        { id: 'liquid', name: '液态生物', fault: '屏幕进水，显示成一团浆糊', requiredPartId: 'waterproof_talisman', reward: 40, patience: 4, desc: '在地板上摊成一片' },
        { id: 'invisible', name: '隐形顾客', fault: '说手机没坏，只是隐形功能失灵了', requiredPartId: 'signal_antenna', reward: 55, patience: 3, desc: '只能看到一部悬空的手机' },
      ],
      upgrades: [
        { id: 'sign', name: '星际口碑招牌', desc: '路过外星人都想进来看看', cost: 60, effects: [{ type: 'addReputation', amount: 20 }] },
        { id: 'franchise', name: '银河加盟费', desc: '连锁经营，回笼资金', cost: 100, effects: [{ type: 'addMoney', amount: 60 }] },
      ],
      events: [
        { id: 'fine', name: '城管查占道', desc: '摊位摆到了人行道，被罚了款', weight: 1, effects: [{ type: 'addMoney', amount: -15 }] },
        { id: 'starship', name: '飞船深夜降落', desc: '一队外星游客慕名而来，小赚一笔', weight: 1, effects: [{ type: 'addMoney', amount: 20 }] },
        { id: 'gossip', name: '小圈子口碑', desc: '外星论坛上有人吐槽你家修机慢', weight: 1, effects: [{ type: 'addReputation', amount: -3 }] },
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
      { id: 'bankrupt', name: '破产关店', desc: '资金见底，小店只能关门大吉。', condition: { type: 'resourceDepleted', params: { resource: 'money', value: 0 } } },
      { id: 'bad_reputation', name: '差评倒闭', desc: '口碑崩盘，再也没有外星人敢上门修手机。', condition: { type: 'resourceDepleted', params: { resource: 'reputation', value: 0 } } },
      { id: 'success', name: '站稳脚跟', desc: '熬过了最难的起步期，你的小店成了三线城市的外星修机胜地。', condition: { type: 'turnReached', params: { value: 12 } } },
    ],
  },
  uiLayout: {
    theme: { accent: '#7c5cff' },
    playLayout: 'portrait',
  },
  assets: { placeholder: '🛠️' },
  saveSchema: {
    version: 1,
    keys: ['phase', 'turn', 'money', 'reputation', 'battery', 'inventory', 'queue', 'currentCustomerId', 'upgradesOwned', 'messages', 'endingId'],
  },
  testPlan: {
    cases: [
      { name: '正确修理顾客手机', type: 'business', steps: ['接待顾客', '选对零件'], expect: '资金与口碑上升，顾客离店' },
      { name: '经营到第 12 天', type: 'business', steps: ['持续正确修理并结束回合'], expect: '达成成功结局' },
    ],
  },
};
