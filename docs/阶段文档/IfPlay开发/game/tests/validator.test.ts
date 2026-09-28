import { describe, it, expect } from "vitest";
import { validate } from "../src/validate/validator";
import { SAMPLES } from "../src/samples";
import type { GameSpec } from "../src/schema/gameSpec";

function cloneSample(id: string): GameSpec {
  return JSON.parse(JSON.stringify(SAMPLES.find((s) => s.metadata.id === id))) as GameSpec;
}

describe("validator", () => {
  it("三个手写示例全部通过校验（无 error）", () => {
    for (const s of SAMPLES) {
      const r = validate(s);
      expect(r.ok, s.metadata.title).toBe(true);
      expect(r.errors, s.metadata.title).toHaveLength(0);
    }
  });

  it("schemaVersion 错误", () => {
    const spec = cloneSample("alien-phone-film");
    (spec as { schemaVersion: string }).schemaVersion = "0.9";
    const r = validate(spec);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "INVALID_SCHEMA_VERSION")).toBe(true);
  });

  it("引用不存在的 stat", () => {
    const spec = cloneSample("alien-phone-film");
    spec.events[0]!.options[0]!.effects.push({ op: "add_stat", stat: "nope", delta: 1 });
    const r = validate(spec);
    expect(r.errors.some((e) => e.code === "UNKNOWN_STAT")).toBe(true);
  });

  it("引用不存在的 flag", () => {
    const spec = cloneSample("toilet-cultivation");
    spec.endings[0]!.condition = { op: "flag", flag: "ghost" };
    const r = validate(spec);
    expect(r.errors.some((e) => e.code === "UNKNOWN_FLAG")).toBe(true);
  });

  it("goto 引用不存在的事件", () => {
    const spec = cloneSample("pigeon-career");
    spec.events[0]!.options[0]!.effects.push({ op: "goto", event: "missing" });
    const r = validate(spec);
    expect(r.errors.some((e) => e.code === "UNKNOWN_EVENT")).toBe(true);
  });

  it("trigger_ending 引用不存在的结局", () => {
    const spec = cloneSample("alien-phone-film");
    spec.events[0]!.options[0]!.effects.push({ op: "trigger_ending", ending: "nope" });
    const r = validate(spec);
    expect(r.errors.some((e) => e.code === "UNKNOWN_ENDING")).toBe(true);
  });

  it("重复 id", () => {
    const spec = cloneSample("alien-phone-film");
    spec.stats.push({ id: "balance", name: "重复", initial: 0, min: 0, max: 1, visible: true });
    const r = validate(spec);
    expect(r.errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("weight 为负", () => {
    const spec = cloneSample("alien-phone-film");
    spec.events[0]!.weight = -1;
    const r = validate(spec);
    expect(r.errors.some((e) => e.code === "INVALID_NUMBER")).toBe(true);
  });

  it("min > max 报错", () => {
    const spec = cloneSample("alien-phone-film");
    spec.stats[0]!.min = 10;
    spec.stats[0]!.max = 1;
    const r = validate(spec);
    expect(r.errors.some((e) => e.code === "INVALID_NUMBER")).toBe(true);
  });

  it("结局无条件给出警告", () => {
    const spec = cloneSample("alien-phone-film");
    spec.endings[0]!.condition = undefined;
    const r = validate(spec);
    expect(r.warnings.some((e) => e.code === "ENDING_NO_CONDITION")).toBe(true);
  });
});
