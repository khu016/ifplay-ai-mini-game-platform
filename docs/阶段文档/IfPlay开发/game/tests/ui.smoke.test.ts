// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createApp, type StorageLike } from "../src/ui/app";
import { SAMPLES } from "../src/samples";

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) ?? null) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function q<T extends Element>(root: HTMLElement, sel: string): T | null {
  return root.querySelector(sel) as T | null;
}

describe("UI 冒烟（首屏→开始→选择→存档→读档）", () => {
  it("完整走通核心交互", () => {
    const root = document.createElement("div");
    const storage = memoryStorage();
    const app = createApp(root, { storage });

    // 首屏：菜单渲染 3 张卡
    expect(q(root, '[data-testid="menu"]')).toBeTruthy();
    expect(root.querySelectorAll(".card").length).toBe(SAMPLES.length);

    // 开始第一个游戏
    const startBtn = q<HTMLButtonElement>(root, `[data-testid="start-${SAMPLES[0]!.metadata.id}"]`);
    expect(startBtn).toBeTruthy();
    startBtn!.click();

    const session = app.getSession();
    expect(session).toBeTruthy();
    expect(q(root, '[data-testid="status"]')).toBeTruthy();

    // 若当前是事件，选择第一个选项
    const optBtn = q<HTMLButtonElement>(root, '[data-testid="option-0"]');
    if (optBtn) {
      optBtn.click();
    }

    // 存档 + 读档
    const saveBtn = q<HTMLButtonElement>(root, '[data-testid="save"]');
    const restoreBtn = q<HTMLButtonElement>(root, '[data-testid="restore"]');
    expect(saveBtn).toBeTruthy();
    expect(restoreBtn).toBeTruthy();
    saveBtn!.click();
    restoreBtn!.click();

    // 读档后仍有会话
    expect(app.getSession()).toBeTruthy();
  });
});
