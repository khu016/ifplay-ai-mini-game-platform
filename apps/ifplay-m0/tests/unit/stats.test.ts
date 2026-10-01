import { describe, it, expect } from 'vitest';
import { loadStats, recordStats } from '@/core/stats';
import type { StorageLike } from '@/core/save';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('最佳成绩与基础统计', () => {
  it('recordStats 累加游玩次数并更新最佳成绩', () => {
    const s = fakeStorage();
    expect(loadStats('g1', s)).toEqual({ bestScore: 0, plays: 0 });
    recordStats('g1', 100, s);
    recordStats('g1', 50, s);
    recordStats('g1', 200, s);
    expect(loadStats('g1', s)).toEqual({ bestScore: 200, plays: 3 });
  });

  it('不同游戏统计隔离', () => {
    const s = fakeStorage();
    recordStats('g1', 10, s);
    recordStats('g2', 99, s);
    expect(loadStats('g1', s).bestScore).toBe(10);
    expect(loadStats('g2', s).bestScore).toBe(99);
  });
});
