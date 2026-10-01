import type { TimingConfig } from './config';
import type { Rng } from '@/core/rng';
import type { NormalizedInput } from '@/core/input';
import type { ModuleContext } from '@/core/context';
import { evaluateCondition, type EffectContext } from '@/core/effects';

export type Tier = 'perfect' | 'good' | 'normal' | 'miss' | null;

export interface TimingState {
  phase: 'play' | 'result';
  spirit: number;
  exposure: number;
  breath: number;
  combo: number;
  stageIndex: number;
  marker: number;
  windowStart: number;
  windowEnd: number;
  windowCenter: number;
  holding: boolean;
  lastTier: Tier;
  skillsUnlocked: string[];
  skillsUsed: string[];
  rating: string | null;
  failReason: string | null;
  messages: string[];
  endingId: string | null;
  endingName: string | null;
  endingDesc: string | null;
}

export const TAP_THRESHOLD_MS = 180;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function currentStage(config: TimingConfig, stageIndex: number): { cycleMs: number; windowWidth: number; jitter: number } {
  if (config.stages && config.stages.length > 0) {
    const idx = Math.min(stageIndex, config.stages.length - 1);
    return {
      cycleMs: config.stages[idx].cycleMs,
      windowWidth: config.stages[idx].windowWidth,
      jitter: config.stages[idx].jitter,
    };
  }
  return { cycleMs: config.cycleMs, windowWidth: config.windowWidth, jitter: config.jitter };
}

function cumulativeTargets(config: TimingConfig): number[] {
  if (config.stages && config.stages.length > 0) {
    const arr: number[] = [];
    let sum = 0;
    for (const st of config.stages) {
      sum += st.targetSpirit;
      arr.push(sum);
    }
    return arr;
  }
  return [config.spirit.target];
}

function newWindow(state: TimingState, config: TimingConfig, rng: Rng): void {
  const stage = currentStage(config, state.stageIndex);
  const jitter = (rng.next() * 2 - 1) * stage.jitter;
  const center = clamp(config.windowCenter + jitter, 0, 1);
  state.windowCenter = center;
  state.windowStart = clamp(center - stage.windowWidth / 2, 0, 1);
  state.windowEnd = clamp(center + stage.windowWidth / 2, 0, 1);
  state.marker = 0;
}

export function createInitialState(config: TimingConfig, _seed: number, rng: Rng): TimingState {
  const state: TimingState = {
    phase: 'play',
    spirit: config.spirit.start,
    exposure: config.exposure.start,
    breath: config.breath.start,
    combo: 0,
    stageIndex: 0,
    marker: 0,
    windowStart: 0,
    windowEnd: 0,
    windowCenter: config.windowCenter,
    holding: false,
    lastTier: null,
    skillsUnlocked: [],
    skillsUsed: [],
    rating: null,
    failReason: null,
    messages: [],
    endingId: null,
    endingName: null,
    endingDesc: null,
  };
  newWindow(state, config, rng);
  return state;
}

function ratingOf(config: TimingConfig, spirit: number): string {
  if (!config.rating) return '';
  if (spirit >= config.rating.s) return 'S';
  if (spirit >= config.rating.a) return 'A';
  if (spirit >= config.rating.b) return 'B';
  return 'C';
}

function checkEndings(state: TimingState, config: TimingConfig, ctx: ModuleContext): boolean {
  const ectx: EffectContext = {
    resources: { spirit: state.spirit, exposure: state.exposure, breath: state.breath },
    flags: {},
    turn: 0,
    messages: [],
  };
  for (const e of ctx.bundle.progression.endings) {
    if (!e.condition) continue;
    if (evaluateCondition(e.condition, ectx)) {
      state.phase = 'result';
      state.endingId = e.id;
      state.endingName = e.name;
      state.endingDesc = e.desc;
      state.rating = ratingOf(config, state.spirit);
      state.failReason =
        state.exposure >= config.exposure.max
          ? (config.failHintExposure ?? '暴露度爆表。建议：只在绿色窗口点击，别长按太久。')
          : null;
      ctx.bus.emit({ type: 'game:ended', endingId: e.id });
      return true;
    }
  }
  return false;
}

function checkStage(state: TimingState, config: TimingConfig, ctx: ModuleContext): void {
  const targets = cumulativeTargets(config);
  while (state.stageIndex < targets.length - 1 && state.spirit >= targets[state.stageIndex]) {
    state.stageIndex += 1;
    const unlocked = (config.skills ?? []).filter((s) => s.stageIndex === state.stageIndex - 1);
    for (const skill of unlocked) {
      if (!state.skillsUnlocked.includes(skill.id)) {
        state.skillsUnlocked.push(skill.id);
        state.messages.push(`解锁技能：${skill.name}`);
      }
    }
    newWindow(state, config, ctx.rng);
    state.messages.push(`进入第 ${state.stageIndex + 1} 阶段`);
  }
}

function resolveTap(state: TimingState, config: TimingConfig, ctx: ModuleContext): void {
  const dist = Math.abs(state.marker - state.windowCenter);
  const stage = currentStage(config, state.stageIndex);
  const half = stage.windowWidth / 2;
  const perfectR = half * config.tiers.perfect;
  const goodR = half * config.tiers.good;

  let tier: Exclude<Tier, null> = 'miss';
  if (dist <= perfectR) tier = 'perfect';
  else if (dist <= goodR) tier = 'good';
  else if (dist <= half) tier = 'normal';

  if (tier === 'miss') {
    state.exposure += config.missPenalty;
    state.combo = 0;
    state.lastTier = 'miss';
    state.messages.push('点空了，暴露度上升');
  } else {
    const base = config.successGain[tier];
    const gain = Math.round(base * (1 + state.combo * config.comboMultiplier));
    state.spirit += gain;
    state.combo += 1;
    state.lastTier = tier;
    const tierText = tier === 'perfect' ? '完美' : tier === 'good' ? '优秀' : '普通';
    state.messages.push(`${tierText}判定，${config.labels.spirit} +${gain}`);
    newWindow(state, config, ctx.rng);
    checkStage(state, config, ctx);
  }
  checkEndings(state, config, ctx);
}

function miss(state: TimingState, config: TimingConfig, ctx: ModuleContext): void {
  state.marker = 0;
  state.exposure += config.missPenalty;
  state.combo = 0;
  state.lastTier = 'miss';
  state.messages.push('错过时机，暴露度上升');
  newWindow(state, config, ctx.rng);
  checkEndings(state, config, ctx);
}

function activateSkill(state: TimingState, config: TimingConfig, ctx: ModuleContext, skillId: string): void {
  const skill = config.skills?.find((s) => s.id === skillId);
  if (!skill) return;
  if (!state.skillsUnlocked.includes(skillId) || state.skillsUsed.includes(skillId)) {
    state.messages.push('技能不可用');
    return;
  }
  state.skillsUsed.push(skillId);
  switch (skill.effect.type) {
    case 'clearExposure':
      state.exposure = Math.max(0, state.exposure - skill.effect.amount);
      break;
    case 'addSpirit':
      state.spirit += skill.effect.amount;
      break;
    case 'healBreath':
      state.breath = Math.min(config.breath.max, state.breath + skill.effect.amount);
      break;
  }
  state.messages.push(`使用技能：${skill.name}`);
  checkStage(state, config, ctx);
  checkEndings(state, config, ctx);
}

export function reduce(state: TimingState, input: NormalizedInput, ctx: ModuleContext): void {
  if (state.phase === 'result') return;
  const config = ctx.bundle.primaryModule.config as TimingConfig;
  if (input.kind === 'press') {
    state.holding = true;
    return;
  }
  if (input.kind === 'release') {
    state.holding = false;
    if (input.heldMs < TAP_THRESHOLD_MS) resolveTap(state, config, ctx);
    return;
  }
  if (input.kind === 'action' && input.actionId === 'useSkill') {
    activateSkill(state, config, ctx, input.params?.skillId ?? '');
  }
}

export function tick(state: TimingState, dt: number, ctx: ModuleContext): void {
  if (state.phase === 'result') return;
  const config = ctx.bundle.primaryModule.config as TimingConfig;

  if (state.holding) {
    state.breath -= config.hold.breathDrainPerMs * dt;
    state.spirit += (config.holdGainPerMs ?? 0) * dt;
    if (state.breath <= 0) {
      state.breath = 0;
      state.holding = false;
      state.exposure += config.missPenalty;
      state.combo = 0;
      state.messages.push(config.failHintBreath ?? '憋不住气了，暴露度上升');
    }
  } else {
    state.breath = Math.min(config.breath.max, state.breath + config.breathRecoveryPerMs * dt);
    if (config.exposureRecoverPerMs) {
      state.exposure = Math.max(0, state.exposure - config.exposureRecoverPerMs * dt);
    }
  }

  const stage = currentStage(config, state.stageIndex);
  const speedFactor = state.holding ? config.hold.slowFactor : 1;
  state.marker += (dt / stage.cycleMs) * speedFactor;

  if (state.marker >= 1) {
    miss(state, config, ctx);
  }
}
