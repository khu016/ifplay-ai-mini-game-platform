export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'ifplay-m0:';

export interface SaveData {
  schemaVersion: number;
  seed: number;
  rngState: number;
  state: unknown;
  savedAt: number;
}

function key(bundleId: string): string {
  return PREFIX + bundleId;
}

// 浏览器环境使用 localStorage；Node（测试）环境可注入自定义 storage。
function defaultStorage(): StorageLike | null {
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

export function saveGame(bundleId: string, data: SaveData, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(key(bundleId), JSON.stringify(data));
  } catch {
    // localStorage 不可用或配额满：静默失败，不影响游戏运行
  }
}

export function loadGame(bundleId: string, storage: StorageLike | null = defaultStorage()): SaveData | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(bundleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSave(bundleId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(key(bundleId));
  } catch {
    // ignore
  }
}
