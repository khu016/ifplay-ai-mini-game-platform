import type { GameSpec } from "../schema/gameSpec";
import { createInitialState, nextTurn, chooseOption, type GameState, type TurnOutcome } from "../engine/engine";

export type Strategy = "random" | "first" | "last";

export interface SimulationResult {
  seed: number;
  strategy: Strategy;
  endingId: string | null;
  timedOut: boolean;
  stuck: boolean;
  stuckReason: string | null;
  turns: number;
  /** 访问过的事件 ID 序列 */
  path: string[];
  /** 资源越界夹紧记录 */
  clampWarnings: string[];
}

export interface AnalysisReport {
  specId: string;
  totalRuns: number;
  reachableEndings: string[];
  unreachableEndings: string[];
  deadEnds: number;
  timeouts: number;
  clampWarnings: string[];
  atLeastOneEndingReachable: boolean;
  runs: SimulationResult[];
}

/** 单次自动路径模拟（确定性地由 seed + 策略驱动） */
export function simulate(
  spec: GameSpec,
  seed: number,
  strategy: Strategy,
  maxTurns = Math.max(spec.clock.total * 3 + 10, 50),
): SimulationResult {
  const state: GameState = createInitialState(spec, seed);
  const path: string[] = [];
  let outcome: TurnOutcome = nextTurn(state);

  let guard = 0;
  while (guard++ < maxTurns) {
    if (outcome.kind === "event") {
      path.push(outcome.event.id);
      const options = outcome.options;
      let choice = options[0];
      if (strategy === "last") choice = options[options.length - 1];
      else if (strategy === "random") choice = options[state.prng.int(0, options.length)] ?? options[0];
      if (!choice) break;
      outcome = chooseOption(state, choice);
      if (outcome.kind === "continue") {
        outcome = nextTurn(state);
      }
    } else {
      break; // ending / timeout / stuck
    }
  }

  return {
    seed,
    strategy,
    endingId: state.endingId,
    timedOut: state.ended && state.endingId === null && !state.stuck,
    stuck: state.stuck,
    stuckReason: state.stuckReason,
    turns: state.turn,
    path,
    clampWarnings: [...state.clampLog],
  };
}

/** 多 seed × 多策略聚合分析：结局可达性、死局、资源越界 */
export function analyze(
  spec: GameSpec,
  options: { seeds?: number; strategies?: Strategy[]; maxTurns?: number } = {},
): AnalysisReport {
  const strategies = options.strategies ?? ["random", "first", "last"];
  const seedCount = options.seeds ?? 50;
  const runs: SimulationResult[] = [];

  for (const strategy of strategies) {
    for (let seed = 0; seed < seedCount; seed++) {
      runs.push(simulate(spec, seed, strategy, options.maxTurns));
    }
  }

  const reachable = new Set<string>();
  const clampWarnings = new Set<string>();
  let deadEnds = 0;
  let timeouts = 0;
  for (const r of runs) {
    if (r.endingId !== null) reachable.add(r.endingId);
    if (r.stuck) deadEnds += 1;
    if (r.timedOut) timeouts += 1;
    for (const w of r.clampWarnings) clampWarnings.add(w);
  }

  const defined = spec.endings.map((e) => e.id);
  const unreachable = defined.filter((id) => !reachable.has(id));

  return {
    specId: spec.metadata.id,
    totalRuns: runs.length,
    reachableEndings: [...reachable],
    unreachableEndings: unreachable,
    deadEnds,
    timeouts,
    clampWarnings: [...clampWarnings],
    atLeastOneEndingReachable: reachable.size > 0,
    runs,
  };
}
