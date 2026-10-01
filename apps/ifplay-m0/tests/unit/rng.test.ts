import { describe, it, expect } from 'vitest';
import { createRng } from '@/core/rng';

describe('createRng（固定 seed 可复现）', () => {
  it('相同 seed 产生相同序列', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('不同 seed 产生不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('int / pick / shuffle 结果确定且范围正确', () => {
    const r = createRng(7);
    const ints = Array.from({ length: 50 }, () => r.int(0, 10));
    expect(ints.every((n) => n >= 0 && n < 10)).toBe(true);

    const r2 = createRng(7);
    expect(Array.from({ length: 50 }, () => r2.int(0, 10))).toEqual(ints);

    const items = ['a', 'b', 'c', 'd'];
    const r3 = createRng(9);
    const shuffled = r3.shuffle(items);
    expect(shuffled.sort()).toEqual(items.sort());
  });

  it('state/setState 可恢复序列', () => {
    const a = createRng(42);
    a.next();
    a.next();
    const snapshot = a.state();
    const b = createRng(999);
    b.setState(snapshot);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });
});
