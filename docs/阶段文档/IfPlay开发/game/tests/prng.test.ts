import { describe, it, expect } from "vitest";
import { PRNG } from "../src/engine/prng";

describe("PRNG（mulberry32）", () => {
  it("同 seed 同序列", () => {
    const a = new PRNG(42);
    const b = new PRNG(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("不同 seed 序列不同", () => {
    const a = new PRNG(1);
    const b = new PRNG(2);
    let diff = 0;
    for (let i = 0; i < 10; i++) {
      if (a.next() !== b.next()) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it("输出落在 [0,1)", () => {
    const p = new PRNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = p.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("weighted 按权重命中", () => {
    const p = new PRNG(123);
    const counts = [0, 0, 0];
    for (let i = 0; i < 10000; i++) {
      const idx = p.weighted([1, 2, 3]);
      counts[idx] = (counts[idx] ?? 0) + 1;
    }
    // 权重比约 1:2:3
    expect(counts[0]!).toBeGreaterThan(1000);
    expect(counts[2]!).toBeGreaterThan(counts[0]!);
  });

  it("weighted 权重全 0 返回 -1", () => {
    expect(new PRNG(1).weighted([0, 0])).toBe(-1);
  });

  it("int 在 [min,max) 内", () => {
    const p = new PRNG(99);
    for (let i = 0; i < 1000; i++) {
      const v = p.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(9);
    }
  });

  it("state 序列化后继续产生相同序列", () => {
    const a = new PRNG(5);
    for (let i = 0; i < 10; i++) a.next();
    const snapshot = a.getState();

    const b = new PRNG(0);
    b.setState(snapshot);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });
});
