// 输入归一化：把 DOM 事件统一成模块可消费的归一化输入。
export type NormalizedInput =
  | { kind: 'action'; actionId: string; params?: Record<string, string> }
  | { kind: 'press' }
  | { kind: 'release'; heldMs: number };

export function action(actionId: string, params?: Record<string, string>): NormalizedInput {
  return { kind: 'action', actionId, params };
}
export function press(): NormalizedInput {
  return { kind: 'press' };
}
export function release(heldMs: number): NormalizedInput {
  return { kind: 'release', heldMs };
}
