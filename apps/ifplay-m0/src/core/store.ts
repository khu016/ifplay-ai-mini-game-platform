// 状态存储：持有当前状态 + 审计日志（变更追踪）。
export interface Store<S> {
  get(): S;
  replace(next: S): void;
  audit(text: string): void;
  audits(): readonly string[];
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const audits: string[] = [];
  return {
    get: () => state,
    replace(next) {
      state = next;
    },
    audit(text) {
      audits.push(text);
    },
    audits: () => audits,
  };
}
