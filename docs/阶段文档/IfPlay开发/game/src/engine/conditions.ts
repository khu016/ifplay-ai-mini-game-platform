import type { Condition, CmpOp } from "../schema/gameSpec";

export interface EvalContext {
  turn: number;
  stats: Record<string, number>;
  flags: Record<string, boolean>;
}

function cmp(a: number, op: CmpOp, b: number): boolean {
  switch (op) {
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    default:
      return false;
  }
}

/** 求值条件；undefined 视为恒真 */
export function evalCondition(c: Condition | undefined, ctx: EvalContext): boolean {
  if (!c) return true;
  switch (c.op) {
    case "flag": {
      const v = ctx.flags[c.flag] ?? false;
      return c.not ? !v : v;
    }
    case "compare": {
      const v = ctx.stats[c.stat] ?? 0;
      return cmp(v, c.cmp, c.value);
    }
    case "turn":
      return cmp(ctx.turn, c.cmp, c.value);
    case "all":
      return c.conditions.every((x) => evalCondition(x, ctx));
    case "any":
      return c.conditions.some((x) => evalCondition(x, ctx));
    default:
      return false;
  }
}
