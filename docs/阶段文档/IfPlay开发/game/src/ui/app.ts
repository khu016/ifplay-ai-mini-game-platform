import type { GameSpec } from "../schema/gameSpec";
import { GameSession, type SaveData } from "./controller";
import { SAMPLES } from "../samples";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) ?? null) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

export interface AppOptions {
  storage?: StorageLike;
}

export interface App {
  render(): void;
  save(): boolean;
  restore(): boolean;
  getSession(): GameSession | null;
}

export function createApp(root: HTMLElement, opts: AppOptions = {}): App {
  const storage = opts.storage ?? memoryStorage();
  let session: GameSession | null = null;

  function saveKey(id: string): string {
    return `ifplay:save:${id}`;
  }

  function el(tag: string, className?: string, text?: string): HTMLElement {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text; // 一律 textContent，杜绝 HTML 注入
    return n;
  }

  function button(text: string, onClick: () => void, testId?: string): HTMLButtonElement {
    const b = el("button", undefined, text) as HTMLButtonElement;
    if (testId) b.dataset.testid = testId;
    b.addEventListener("click", onClick);
    return b;
  }

  function randomSeed(): number {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  function startGame(game: GameSpec, seed: number): void {
    session = new GameSession(game, seed);
    session.begin();
    render();
  }

  function save(): boolean {
    if (!session) return false;
    storage.setItem(saveKey(session.spec.metadata.id), JSON.stringify(session.serialize()));
    return true;
  }

  function restore(): boolean {
    if (!session) return false;
    const raw = storage.getItem(saveKey(session.spec.metadata.id));
    if (!raw) return false;
    try {
      const data = JSON.parse(raw) as SaveData;
      session = GameSession.restore(data, session.spec);
      render();
      return true;
    } catch {
      return false;
    }
  }

  function render(): void {
    root.replaceChildren();
    if (!session) renderMenu();
    else renderPlay();
  }

  function renderMenu(): void {
    root.appendChild(el("h1", undefined, "IfPlay · M0 试玩"));
    root.appendChild(el("p", "sub", "三个手写示例（确定性规则引擎，无模型、无后端）"));
    const list = el("div", "game-list");
    list.dataset.testid = "menu";
    for (const g of SAMPLES) {
      const card = el("div", "card");
      card.appendChild(el("h2", undefined, g.metadata.title));
      card.appendChild(el("p", undefined, g.metadata.description));
      card.appendChild(el("p", "meta", `题材：${g.metadata.genre} · ${g.clock.total} ${g.clock.unit}`));
      card.appendChild(button("开始游戏", () => startGame(g, randomSeed()), `start-${g.metadata.id}`));
      list.appendChild(card);
    }
    root.appendChild(list);
  }

  function renderPlay(): void {
    const s = session as GameSession;
    const spec = s.spec;

    root.appendChild(el("h1", undefined, spec.metadata.title));
    const top = el("div", "bar");
    top.appendChild(el("span", undefined, `第 ${s.state.turn} / ${spec.clock.total} ${spec.clock.unit}`));
    top.appendChild(el("span", undefined, `种子 ${s.seed}`));
    root.appendChild(top);

    const statsBox = el("div", "stats");
    for (const st of spec.stats) {
      if (!st.visible) continue;
      const row = el("div", "stat");
      row.appendChild(el("span", "stat-name", st.name));
      row.appendChild(el("span", "stat-value", String(s.state.stats[st.id] ?? 0)));
      statsBox.appendChild(row);
    }
    root.appendChild(statsBox);

    const actions = el("div", "actions");
    actions.appendChild(button("存档", () => setStatus(save() ? "已存档" : "存档失败"), "save"));
    actions.appendChild(button("读档", () => setStatus(restore() ? "已读档" : "无存档"), "restore"));
    actions.appendChild(button("重新开始", () => startGame(spec, randomSeed()), "restart"));
    actions.appendChild(button("返回菜单", () => { session = null; render(); }, "back"));
    root.appendChild(actions);

    const status = el("div", "status");
    status.dataset.testid = "status";
    root.appendChild(status);

    const current = s.current;
    if (current) {
      if (current.kind === "event") {
        const card = el("div", "card");
        card.appendChild(el("h2", undefined, current.event.title));
        card.appendChild(el("p", "body", current.event.body));
        const opts = el("div", "options");
        current.options.forEach((o, i) => {
          opts.appendChild(button(o.text, () => { s.choose(i); render(); }, `option-${i}`));
        });
        card.appendChild(opts);
        root.appendChild(card);
      } else if (current.kind === "ending") {
        root.appendChild(endingBox(current.ending.title, current.ending.body));
      } else if (current.kind === "timeout") {
        root.appendChild(endingBox("时间到", "本局结束（未命中任何结局）"));
      } else if (current.kind === "stuck") {
        root.appendChild(endingBox("卡死", current.reason));
      }
    }

    function setStatus(msg: string): void {
      status.textContent = msg;
    }
  }

  function endingBox(title: string, body: string): HTMLElement {
    const box = el("div", "ending");
    box.dataset.testid = "ending";
    box.appendChild(el("h2", undefined, `结局：${title}`));
    box.appendChild(el("p", undefined, body));
    return box;
  }

  render();

  return {
    render,
    save,
    restore,
    getSession: () => session,
  };
}
