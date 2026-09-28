import type { Ending, EventOption, GameEvent, GameSpec } from "../schema/gameSpec";
import { evalCondition } from "./conditions";
import { applyEffects } from "./effects";
import { PRNG } from "./prng";
import { clamp } from "./util";

export interface GameState {
  spec: GameSpec;
  seed: number;
  prng: PRNG;
  turn: number;
  stats: Record<string, number>;
  flags: Record<string, boolean>;
  /** 已触发的一次性事件 */
  firedOnce: Set<string>;
  /** 事件上次触发回合（用于冷却） */
  lastFired: Map<string, number>;
  ended: boolean;
  endingId: string | null;
  stuck: boolean;
  stuckReason: string | null;
  /** 资源越界夹紧记录（自动路径模拟用） */
  clampLog: string[];
}

export type TurnOutcome =
  | { kind: "event"; event: GameEvent; options: EventOption[] }
  | { kind: "ending"; ending: Ending }
  | { kind: "timeout" }
  | { kind: "stuck"; reason: string }
  | { kind: "continue" };

export function createInitialState(spec: GameSpec, seed: number): GameState {
  const stats: Record<string, number> = {};
  for (const s of spec.stats) {
    stats[s.id] = clamp(s.initial, s.min, s.max);
  }
  const flags: Record<string, boolean> = {};
  for (const f of spec.flags) {
    flags[f.id] = false;
  }
  return {
    spec,
    seed,
    prng: new PRNG(seed),
    turn: 0,
    stats,
    flags,
    firedOnce: new Set(),
    lastFired: new Map(),
    ended: false,
    endingId: null,
    stuck: false,
    stuckReason: null,
    clampLog: [],
  };
}

function context(state: GameState) {
  return { turn: state.turn, stats: state.stats, flags: state.flags };
}

/** 按优先级从高到低，返回第一个条件成立的结局；无则 null */
export function checkEnding(state: GameState): Ending | null {
  const sorted = [...state.spec.endings].sort((a, b) => b.priority - a.priority);
  for (const e of sorted) {
    if (evalCondition(e.condition, context(state))) return e;
  }
  return null;
}

function availableOptions(event: GameEvent, state: GameState): EventOption[] {
  return event.options.filter((o) => evalCondition(o.condition, context(state)));
}

function markFired(event: GameEvent, state: GameState): void {
  if (event.once) state.firedOnce.add(event.id);
  if (event.cooldown !== undefined) state.lastFired.set(event.id, state.turn);
}

function presentEvent(event: GameEvent, state: GameState): TurnOutcome {
  markFired(event, state);
  const options = availableOptions(event, state);
  if (options.length === 0) {
    state.stuck = true;
    state.stuckReason = `事件「${event.title}」无可用选项`;
    return { kind: "stuck", reason: state.stuckReason };
  }
  return { kind: "event", event, options };
}

function sampleEvent(state: GameState): GameEvent | null {
  const ctx = context(state);
  const candidates = state.spec.events.filter((e) => {
    if (e.once && state.firedOnce.has(e.id)) return false;
    if (e.cooldown !== undefined) {
      const last = state.lastFired.get(e.id);
      if (last !== undefined && state.turn - last < e.cooldown) return false;
    }
    return evalCondition(e.condition, ctx);
  });
  if (candidates.length === 0) return null;
  const weights = candidates.map((e) => e.weight);
  const idx = state.prng.weighted(weights);
  return idx >= 0 ? candidates[idx] ?? null : null;
}

/** 结束当前回合：回合 +1 → 结局判定 → 超时判定 → 事件采样/死局 */
export function nextTurn(state: GameState): TurnOutcome {
  if (state.ended) return endedOutcome(state);
  if (state.stuck) return { kind: "stuck", reason: state.stuckReason ?? "" };

  state.turn += 1;

  const ending = checkEnding(state);
  if (ending) {
    state.ended = true;
    state.endingId = ending.id;
    return { kind: "ending", ending };
  }

  if (state.turn > state.spec.clock.total) {
    state.ended = true;
    return { kind: "timeout" };
  }

  const event = sampleEvent(state);
  if (!event) {
    state.stuck = true;
    state.stuckReason = `第 ${state.turn} 回合无可用事件`;
    return { kind: "stuck", reason: state.stuckReason };
  }
  return presentEvent(event, state);
}

/** 应用玩家选择的选项效果；返回 continue 表示应进入下一回合 */
export function chooseOption(state: GameState, option: EventOption): TurnOutcome {
  if (state.ended) return endedOutcome(state);
  if (state.stuck) return { kind: "stuck", reason: state.stuckReason ?? "" };

  const result = applyEffects(option.effects, state.spec, state.stats, state.flags, state.prng, state.clampLog);

  if (result.endingId !== undefined) {
    const ending = state.spec.endings.find((e) => e.id === result.endingId);
    state.ended = true;
    state.endingId = result.endingId;
    if (!ending) {
      state.stuck = true;
      state.stuckReason = `结局「${result.endingId}」不存在`;
      return { kind: "stuck", reason: state.stuckReason };
    }
    return { kind: "ending", ending };
  }

  if (result.gotoEventId !== undefined) {
    const event = state.spec.events.find((e) => e.id === result.gotoEventId);
    if (!event) {
      state.stuck = true;
      state.stuckReason = `事件「${result.gotoEventId}」不存在`;
      return { kind: "stuck", reason: state.stuckReason };
    }
    return presentEvent(event, state);
  }

  // 效果之后再次做结局判定（例如某数值刚达标）
  const ending = checkEnding(state);
  if (ending) {
    state.ended = true;
    state.endingId = ending.id;
    return { kind: "ending", ending };
  }

  return { kind: "continue" };
}

function endedOutcome(state: GameState): TurnOutcome {
  if (state.stuck) return { kind: "stuck", reason: state.stuckReason ?? "" };
  if (state.endingId !== null) {
    const ending = state.spec.endings.find((e) => e.id === state.endingId);
    if (ending) return { kind: "ending", ending };
  }
  return { kind: "timeout" };
}

/**
 * 从存档恢复后的当前局面：已结束/卡死则还原结局；否则按 currentEventId 还原
 * 当时展示的事件与可用选项（不重新采样、不重复 markFired）；无 currentEventId 则正常推进一回合。
 */
export function resumeOutcome(state: GameState, currentEventId: string | null): TurnOutcome {
  if (state.ended || state.stuck) return endedOutcome(state);
  if (currentEventId) {
    const event = state.spec.events.find((e) => e.id === currentEventId);
    if (event) {
      const options = availableOptions(event, state);
      if (options.length > 0) return { kind: "event", event, options };
      return { kind: "stuck", reason: `事件「${event.title}」无可用选项` };
    }
    return { kind: "stuck", reason: `事件「${currentEventId}」不存在` };
  }
  return nextTurn(state);
}
