import type { GameSpec } from "../schema/gameSpec";
import { createInitialState, chooseOption, nextTurn, resumeOutcome, type GameState, type TurnOutcome } from "../engine/engine";
import { deserializeState, serializeState, type SerializedState } from "../engine/save";

export interface SaveData extends SerializedState {
  /** 存档时正在展示的事件 ID（用于恢复局面） */
  currentEventId: string | null;
}

/** 纯逻辑的游玩会话（与 DOM 解耦，可被 Vitest 直接测试） */
export class GameSession {
  readonly spec: GameSpec;
  readonly seed: number;
  state: GameState;
  current: TurnOutcome | null = null;

  constructor(spec: GameSpec, seed: number) {
    this.spec = spec;
    this.seed = seed;
    this.state = createInitialState(spec, seed);
  }

  /** 开始游戏，推进到第一回合（或立即结局） */
  begin(): TurnOutcome {
    this.current = nextTurn(this.state);
    return this.current;
  }

  /** 选择当前事件的第 index 个选项 */
  choose(index: number): TurnOutcome {
    if (!this.current || this.current.kind !== "event") {
      throw new Error("当前局面不可选择");
    }
    const option = this.current.options[index];
    if (!option) throw new Error(`选项下标 ${index} 越界`);
    const outcome = chooseOption(this.state, option);
    this.current = outcome.kind === "continue" ? nextTurn(this.state) : outcome;
    return this.current;
  }

  serialize(): SaveData {
    const base = serializeState(this.state);
    return {
      ...base,
      currentEventId: this.current?.kind === "event" ? this.current.event.id : null,
    };
  }

  static restore(data: SaveData, spec: GameSpec): GameSession {
    const session = new GameSession(spec, data.seed);
    session.state = deserializeState(data, spec);
    session.current = resumeOutcome(session.state, data.currentEventId);
    return session;
  }
}
