import type { StorageLike } from '@/core/save';

// 跨局最佳成绩与基础统计（与游戏存档分离，不做永久升级/成就）。
export interface GameStats {
  bestScore: number;
  plays: number;
}

const PREFIX = 'ifplay-m0:stats:';

function key(bundleId: string): string {
  return PREFIX + bundleId;
}

function storage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage;
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

export function loadStats(bundleId: string, storageArg?: StorageLike | null): GameStats {
  const s = storage(storageArg);
  if (!s) return { bestScore: 0, plays: 0 };
  try {
    const raw = s.getItem(key(bundleId));
    if (!raw) return { bestScore: 0, plays: 0 };
    const parsed = JSON.parse(raw) as Partial<GameStats>;
    return {
      bestScore: typeof parsed.bestScore === 'number' ? parsed.bestScore : 0,
      plays: typeof parsed.plays === 'number' ? parsed.plays : 0,
    };
  } catch {
    return { bestScore: 0, plays: 0 };
  }
}

export function recordStats(bundleId: string, score: number, storageArg?: StorageLike | null): GameStats {
  const s = storage(storageArg);
  const cur = loadStats(bundleId, s);
  const next: GameStats = { bestScore: Math.max(cur.bestScore, score), plays: cur.plays + 1 };
  try {
    s?.setItem(key(bundleId), JSON.stringify(next));
  } catch {
    // 忽略存储失败
  }
  return next;
}
