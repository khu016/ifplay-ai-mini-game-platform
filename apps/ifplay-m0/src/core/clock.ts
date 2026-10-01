export interface Clock {
  readonly turn: number;
  readonly paused: boolean;
  advanceTurn(): number;
  setPaused(paused: boolean): void;
}

export function createClock(): Clock {
  let turn = 0;
  let paused = false;
  return {
    get turn() {
      return turn;
    },
    get paused() {
      return paused;
    },
    advanceTurn() {
      turn += 1;
      return turn;
    },
    setPaused(p) {
      paused = p;
    },
  };
}
