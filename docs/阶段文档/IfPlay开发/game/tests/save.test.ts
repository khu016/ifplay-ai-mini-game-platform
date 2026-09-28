import { describe, it, expect } from "vitest";
import { SAMPLES } from "../src/samples";
import { createInitialState, nextTurn } from "../src/engine/engine";
import { serializeState, deserializeState } from "../src/engine/save";

describe("存档与恢复", () => {
  it("serialize/deserialize 往返后状态一致", () => {
    const spec = SAMPLES[0]!;
    const state = createInitialState(spec, 7);
    nextTurn(state); // 推进一回合，消耗一次随机采样

    const data = serializeState(state);
    const restored = deserializeState(data, spec);

    expect(restored.turn).toBe(state.turn);
    expect(restored.stats).toEqual(state.stats);
    expect(restored.flags).toEqual(state.flags);
    expect([...restored.firedOnce]).toEqual([...state.firedOnce]);
    expect(restored.prng.getState()).toBe(state.prng.getState());
    expect(restored.endingId).toBe(state.endingId);
  });

  it("gameId 不一致时拒绝恢复", () => {
    const spec = SAMPLES[0]!;
    const other = SAMPLES[1]!;
    const state = createInitialState(spec, 1);
    const data = serializeState(state);
    expect(() => deserializeState(data, other)).toThrow();
  });

  it("恢复后与未中断的序列产生相同后续", () => {
    const spec = SAMPLES[0]!;
    const a = createInitialState(spec, 11);
    nextTurn(a);
    const data = serializeState(a);
    const b = deserializeState(data, spec);

    // 两者 PRNG 状态一致 → 后续采样一致
    const oa = nextTurn(a);
    const ob = nextTurn(b);
    if (oa.kind === "event" && ob.kind === "event") {
      expect(oa.event.id).toBe(ob.event.id);
    }
  });
});
