import { describe, it, expect } from "vitest";
import type { GameSpec } from "../src/schema/gameSpec";
import { evalCondition } from "../src/engine/conditions";
import { applyEffects } from "../src/engine/effects";
import { PRNG } from "../src/engine/prng";
import { createInitialState, nextTurn, chooseOption } from "../src/engine/engine";

function mkSpec(over: Partial<GameSpec> = {}): GameSpec {
  return {
    schemaVersion: "0.1",
    metadata: { id: "t", title: "测试", description: "d", genre: "g" },
    clock: { unit: "day", total: 3 },
    stats: [
      { id: "hp", name: "生命", initial: 10, min: 0, max: 20, visible: true },
      { id: "gold", name: "金币", initial: 0, min: 0, max: 100, visible: true },
    ],
    flags: [{ id: "f1", name: "标记" }],
    events: [
      { id: "e1", title: "事件1", body: "b", weight: 1, options: [{ text: "选择A", effects: [{ op: "add_stat", stat: "gold", delta: 10 }] }] },
    ],
    endings: [{ id: "win", title: "胜利", body: "b", condition: { op: "compare", stat: "gold", cmp: ">=", value: 20 }, priority: 10 }],
    ...over,
  };
}

describe("evalCondition", () => {
  const ctx = { turn: 3, stats: { hp: 5, gold: 10 }, flags: { f1: true } };

  it("flag / not", () => {
    expect(evalCondition({ op: "flag", flag: "f1" }, ctx)).toBe(true);
    expect(evalCondition({ op: "flag", flag: "f1", not: true }, ctx)).toBe(false);
  });
  it("compare", () => {
    expect(evalCondition({ op: "compare", stat: "gold", cmp: ">=", value: 10 }, ctx)).toBe(true);
    expect(evalCondition({ op: "compare", stat: "gold", cmp: ">", value: 10 }, ctx)).toBe(false);
    expect(evalCondition({ op: "compare", stat: "hp", cmp: "==", value: 5 }, ctx)).toBe(true);
    expect(evalCondition({ op: "compare", stat: "hp", cmp: "!=", value: 5 }, ctx)).toBe(false);
  });
  it("turn", () => {
    expect(evalCondition({ op: "turn", cmp: ">=", value: 3 }, ctx)).toBe(true);
    expect(evalCondition({ op: "turn", cmp: "<", value: 3 }, ctx)).toBe(false);
  });
  it("all / any", () => {
    expect(evalCondition({ op: "all", conditions: [{ op: "flag", flag: "f1" }, { op: "compare", stat: "gold", cmp: ">=", value: 5 }] }, ctx)).toBe(true);
    expect(evalCondition({ op: "any", conditions: [{ op: "flag", flag: "f1" }, { op: "compare", stat: "gold", cmp: ">=", value: 999 }] }, ctx)).toBe(true);
  });
  it("undefined 恒真", () => {
    expect(evalCondition(undefined, ctx)).toBe(true);
  });
});

describe("applyEffects", () => {
  it("set/add 并夹紧到上下限", () => {
    const spec = mkSpec();
    const stats = { hp: 10, gold: 0 };
    const flags: Record<string, boolean> = { f1: false };
    const log: string[] = [];
    applyEffects(
      [
        { op: "add_stat", stat: "gold", delta: 200 },
        { op: "set_stat", stat: "hp", value: -5 },
      ],
      spec,
      stats,
      flags,
      new PRNG(1),
      log,
    );
    expect(stats.gold).toBe(100);
    expect(stats.hp).toBe(0);
    expect(log.length).toBeGreaterThan(0);
  });

  it("set_flag", () => {
    const stats = { hp: 10, gold: 0 };
    const flags: Record<string, boolean> = { f1: false };
    applyEffects([{ op: "set_flag", flag: "f1", value: true }], mkSpec(), stats, flags, new PRNG(1));
    expect(flags.f1).toBe(true);
  });

  it("goto / trigger_ending 返回目标", () => {
    const spec = mkSpec();
    const stats = { hp: 10, gold: 0 };
    const flags: Record<string, boolean> = { f1: false };
    const r1 = applyEffects([{ op: "goto", event: "e1" }], spec, stats, flags, new PRNG(1));
    expect(r1.gotoEventId).toBe("e1");

    const r2 = applyEffects([{ op: "trigger_ending", ending: "win" }], spec, stats, flags, new PRNG(1));
    expect(r2.endingId).toBe("win");
  });

  it("roll 确定性按 seed 命中分支", () => {
    const spec = mkSpec();
    const stats = { hp: 10, gold: 0 };
    const flags: Record<string, boolean> = { f1: false };
    const effects = [{ op: "roll" as const, rolls: [{ weight: 1, effects: [{ op: "add_stat" as const, stat: "gold" as const, delta: 1 }] }, { weight: 1, effects: [{ op: "add_stat" as const, stat: "gold" as const, delta: 2 }] }] }];
    const s1 = { ...stats };
    const s2 = { ...stats };
    applyEffects(effects, spec, s1, flags, new PRNG(5));
    applyEffects(effects, spec, s2, flags, new PRNG(5));
    expect(s1.gold).toBe(s2.gold);
  });
});

describe("engine 回合循环", () => {
  it("推进→选择→结局", () => {
    const spec = mkSpec();
    const state = createInitialState(spec, 1);

    const o1 = nextTurn(state);
    expect(o1.kind).toBe("event");
    if (o1.kind === "event") {
      expect(o1.event.id).toBe("e1");
      const c1 = chooseOption(state, o1.options[0]!);
      expect(c1.kind).toBe("continue");
    }

    const o2 = nextTurn(state);
    expect(o2.kind).toBe("event");
    if (o2.kind === "event") {
      const c2 = chooseOption(state, o2.options[0]!);
      // 金币达到 20 → 命中胜利结局
      expect(c2.kind).toBe("ending");
      if (c2.kind === "ending") expect(c2.ending.id).toBe("win");
    }
  });

  it("同 seed 同路径（确定性）", () => {
    const spec = mkSpec({
      events: [
        { id: "e1", title: "E", body: "b", weight: 1, options: [
          { text: "A", effects: [{ op: "add_stat", stat: "gold", delta: 1 }] },
          { text: "B", effects: [{ op: "add_stat", stat: "gold", delta: 2 }] },
        ] },
        { id: "e2", title: "E2", body: "b", weight: 1, options: [{ text: "X", effects: [{ op: "add_stat", stat: "hp", delta: 1 }] }] },
      ],
    });

    function play() {
      const st = createInitialState(spec, 42);
      const ids: string[] = [];
      let o = nextTurn(st);
      let guard = 0;
      while (o.kind === "event" && guard++ < 10) {
        ids.push(o.event.id);
        const c = chooseOption(st, o.options[0]!);
        o = c.kind === "continue" ? nextTurn(st) : c;
      }
      return ids.join(",");
    }

    expect(play()).toBe(play());
  });
});
