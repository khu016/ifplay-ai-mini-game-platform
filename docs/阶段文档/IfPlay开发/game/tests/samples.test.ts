import { describe, it, expect } from "vitest";
import { SAMPLES } from "../src/samples";
import { validate } from "../src/validate/validator";
import { analyze, simulate } from "../src/simulate/simulator";

describe("三个手写示例", () => {
  for (const spec of SAMPLES) {
    describe(spec.metadata.title, () => {
      it("通过校验", () => {
        const r = validate(spec);
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
      });

      it("至少 4 个结局", () => {
        expect(spec.endings.length).toBeGreaterThanOrEqual(4);
      });

      it("至少一个结局可达", () => {
        const report = analyze(spec, { seeds: 30 });
        expect(report.atLeastOneEndingReachable).toBe(true);
      });

      it("无死局（有常驻事件兜底）", () => {
        const report = analyze(spec, { seeds: 30 });
        expect(report.deadEnds).toBe(0);
      });

      it("确定性：同 seed 两次模拟结果一致", () => {
        const a = simulate(spec, 123, "random");
        const b = simulate(spec, 123, "random");
        expect(a.path).toEqual(b.path);
        expect(a.endingId).toBe(b.endingId);
        expect(a.turns).toBe(b.turns);
      });
    });
  }

  it("输出各示例可达结局（供验收参考）", () => {
    for (const spec of SAMPLES) {
      const report = analyze(spec, { seeds: 50 });
      console.log(`\n[${spec.metadata.title}]`);
      console.log(`  定义结局: ${spec.endings.map((e) => e.title).join(" / ")}`);
      console.log(`  可达结局: ${report.reachableEndings.map((id) => spec.endings.find((e) => e.id === id)?.title ?? id).join(" / ")}`);
      console.log(`  未达结局: ${report.unreachableEndings.map((id) => spec.endings.find((e) => e.id === id)?.title ?? id).join(" / ") || "无"}`);
      console.log(`  死局: ${report.deadEnds}  超时: ${report.timeouts}  越界: ${report.clampWarnings.length}`);
    }
  });
});
