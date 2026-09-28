import type { GameSpec } from "../schema/gameSpec";
import { createInitialState, type GameState } from "./engine";
import { PRNG } from "./prng";

export interface SerializedState {
  schemaVersion: string;
  gameId: string;
  seed: number;
  prngState: number;
  turn: number;
  stats: Record<string, number>;
  flags: Record<string, boolean>;
  firedOnce: string[];
  lastFired: [string, number][];
  ended: boolean;
  endingId: string | null;
  stuck: boolean;
  stuckReason: string | null;
}

export function serializeState(state: GameState): SerializedState {
  return {
    schemaVersion: state.spec.schemaVersion,
    gameId: state.spec.metadata.id,
    seed: state.seed,
    prngState: state.prng.getState(),
    turn: state.turn,
    stats: { ...state.stats },
    flags: { ...state.flags },
    firedOnce: [...state.firedOnce],
    lastFired: [...state.lastFired.entries()],
    ended: state.ended,
    endingId: state.endingId,
    stuck: state.stuck,
    stuckReason: state.stuckReason,
  };
}

export function deserializeState(data: SerializedState, spec: GameSpec): GameState {
  if (data.gameId !== spec.metadata.id) {
    throw new Error(`存档 gameId「${data.gameId}」与当前游戏「${spec.metadata.id}」不一致`);
  }
  if (data.schemaVersion !== spec.schemaVersion) {
    throw new Error(`存档 schemaVersion「${data.schemaVersion}」与当前「${spec.schemaVersion}」不一致`);
  }

  const state = createInitialState(spec, data.seed);
  state.prng = new PRNG(data.seed);
  state.prng.setState(data.prngState);
  state.turn = data.turn;
  state.stats = { ...data.stats };
  state.flags = { ...data.flags };
  state.firedOnce = new Set(data.firedOnce);
  state.lastFired = new Map(data.lastFired);
  state.ended = data.ended;
  state.endingId = data.endingId;
  state.stuck = data.stuck;
  state.stuckReason = data.stuckReason;
  return state;
}
