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
  marker: number;
  windowStart: number;
  windowEnd: number;
  windowCenter: number;
  holding: boolean;
  lastTier: Tier;
  messages: string[];
  endingId: string | null;
  endingName: string | null;
  endingDesc: string | null;
}

// 长按判定阈值（毫秒）。小于该值视为点击，否则视为长按松开。
export const TAP_THRESHOLD_MS = 180;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function newWindow(state: TimingState, config: TimingConfig, rng: Rng): void {
  const jitter = (rng.next() * 2 - 1) * config.jitter;
  const center = clamp(config.windowCenter + jitter, 0, 1);
  state.windowCenter = center;
  state.windowStart = clamp(center - config.windowWidth / 2, 0, 1);
  state.windowEnd = clamp(center + config.windowWidth / 2, 0, 1);
  state.marker = 0;
}

export function createInitialState(config: TimingConfig, _seed: number, rng: Rng): TimingState {
  const state: TimingState = {
    phase: 'play',
    spirit: config.spirit.start,
    exposure: config.exposure.start,
    breath: config.breath.start,
    combo: 0,
    marker: 0,
    windowStart: 0,
    windowEnd: 0,
    windowCenter: config.windowCenter,
    holding: false,
    lastTier: null,
    messages: [],
    endingId: null,
    endingName: null,
    endingDesc: null,
  };
  newWindow(state, config, rng);
  return state;
}

function checkEndings(state: TimingState, ctx: ModuleContext): boolean {
  for (const e of ctx.bundle.progression.endings) {
    if (!e.condition) continue; // 叙事类结局不在此处理
    const ectx: EffectContext = {
      resources: { spirit: state.spirit, exposure: state.exposure, breath: state.breath },
      flags: {},
      turn: 0,
      messages: [],
    };
    if (evaluateCondition(e.condition, ectx)) {
      state.phase = 'result';
      state.endingId = e.id;
      state.endingName = e.name;
      state.endingDesc = e.desc;
      ctx.bus.emit({ type: 'game:ended', endingId: e.id });
      return true;
    }
  }
  return false;
}

function resolveTap(state: TimingState, config: TimingConfig, ctx: ModuleContext): void {
  const dist = Math.abs(state.marker - state.windowCenter);
  const half = config.windowWidth / 2;
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
  }
  checkEndings(state, ctx);
}

function miss(state: TimingState, config: TimingConfig, ctx: ModuleContext): void {
  state.marker = 0;
  state.exposure += config.missPenalty;
  state.combo = 0;
  state.lastTier = 'miss';
  state.messages.push('错过时机，暴露度上升');
  newWindow(state, config, ctx.rng);
  checkEndings(state, ctx);
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
    if (input.heldMs < TAP_THRESHOLD_MS) {
      resolveTap(state, config, ctx);
    }
    return;
  }
  // 'action' 输入在点击时机模块中忽略
}

export function tick(state: TimingState, dt: number, ctx: ModuleContext): void {
  if (state.phase === 'result') return;
  const config = ctx.bundle.primaryModule.config as TimingConfig;

  if (state.holding) {
    state.breath -= config.hold.breathDrainPerMs * dt;
    if (state.breath <= 0) {
      state.breath = 0;
      state.holding = false;
      state.exposure += config.missPenalty;
      state.combo = 0;
      state.messages.push('憋不住气了，暴露度上升');
    }
  } else {
    state.breath = Math.min(config.breath.max, state.breath + config.breathRecoveryPerMs * dt);
  }

  const speedFactor = state.holding ? config.hold.slowFactor : 1;
  state.marker += (dt / config.cycleMs) * speedFactor;

  if (state.marker >= 1) {
    miss(state, config, ctx);
  }
}
