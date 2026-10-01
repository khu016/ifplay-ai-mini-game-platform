import { describe, it, expect } from 'vitest';
import { saveGame, loadGame, clearSave, type StorageLike } from '@/core/save';

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('save / load（localStorage 抽象，可注入）', () => {
  it('存读档 round-trip', () => {
    const s = fakeStorage();
    const data = { schemaVersion: 1, seed: 123, rngState: 456, state: { turn: 3 }, savedAt: Date.now() };
    saveGame('g1', data, s);
    const loaded = loadGame('g1', s);
    expect(loaded).toEqual(data);
  });

  it('无存档返回 null', () => {
    expect(loadGame('missing', fakeStorage())).toBeNull();
  });

  it('损坏数据返回 null（不抛异常）', () => {
    const s = fakeStorage();
    s.setItem('ifplay-m0:g1', '{not-json');
    expect(loadGame('g1', s)).toBeNull();
  });

  it('clearSave 后返回 null', () => {
    const s = fakeStorage();
    saveGame('g1', { schemaVersion: 1, seed: 1, rngState: 1, state: {}, savedAt: 1 }, s);
    clearSave('g1', s);
    expect(loadGame('g1', s)).toBeNull();
  });
});
