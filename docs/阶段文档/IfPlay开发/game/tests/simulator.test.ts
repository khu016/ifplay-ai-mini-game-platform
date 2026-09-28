import { describe, it, expect } from "vitest";
import type { GameSpec } from "../src/schema/gameSpec";
import { simulate, analyze } from "../src/simulate/simulator";
import { SAMPLES } from "../src/samples";

describe("simulate / analyze", () => {
  it("三个示例都能完成一次模拟（不卡死循环）", () => {
    for (const spec of SAMPLES) {
      const r = simulate(spec, 0, "random");
      expect(r.turns).toBeGreaterThan(0);
      expect(r.path.length).toBeGreaterThan(0);
    }
  });

  it("三个示例至少一个结局可达", () => {
    for (const spec of SAMPLES) {
      const report = analyze(spec, { seeds: 30 });
      expect(report.atLeastOneEndingReachable, spec.metadata.title).toBe(true);
    }
  });

  it("死局检测：once 事件耗尽后无事件可触发", () => {
    const spec: GameSpec = {
      schemaVersion: "0.1",
      metadata: { id: "dead", title: "死局", description: "d", genre: "g" },
      clock: { unit: "day", total: 5 },
      stats: [{ id: "s", name: "S", initial: 0, min: 0, max: 10, visible: true }],
      flags: [],
      events: [
        { id: "e1", title: "只有一次", body: "b", weight: 1, once: true, options: [{ text: "A", effects: [{ op: "add_stat", stat: "s", delta: 1 }] }] },
      ],
      endings: [],
    };
    const r = simulate(spec, 0, "first");
    expect(r.stuck).toBe(true);
    expect(r.stuckReason).toBeTruthy();
  });

  it("资源越界产生夹紧警告", () => {
    const spec: GameSpec = {
      schemaVersion: "0.1",
      metadata: { id: "clamp", title: "越界", description: "d", genre: "g" },
      clock: { unit: "day", total: 2 },
      stats: [{ id: "s", name: "S", initial: 0, min: 0, max: 5, visible: true }],
      flags: [],
      events: [
        { id: "e1", title: "E", body: "b", weight: 1, options: [{ text: "加满", effects: [{ op: "add_stat", stat: "s", delta: 100 }] }] },
      ],
      endings: [{ id: "end", title: "结束", body: "b", condition: { op: "turn", cmp: ">", value: 2 }, priority: 1 }],
    };
    const r = simulate(spec, 0, "first");
    expect(r.clampWarnings.length).toBeGreaterThan(0);
  });
});
