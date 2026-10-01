// 白名单条件 / 效果执行器。未知类型一律拒绝（不执行任意逻辑）。

export interface Condition {
  type: string;
  params?: Record<string, unknown>;
}
export interface Effect {
  type: string;
  params?: Record<string, unknown>;
}

export interface EffectContext {
  resources: Record<string, number>;
  flags: Record<string, unknown>;
  turn: number;
  messages: string[];
  ended?: string;
}

const CONDITION_WHITELIST = [
  'always',
  'turnReached',
  'resourceBelow',
  'resourceAbove',
  'resourceReached',
  'resourceDepleted',
  'flagIs',
] as const;

const EFFECT_WHITELIST = ['addResource', 'setFlag', 'message', 'endGame'] as const;

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0);
}
function str(v: unknown): string {
  return String(v ?? '');
}

export function evaluateCondition(cond: Condition, ctx: EffectContext): boolean {
  const p = cond.params ?? {};
  switch (cond.type) {
    case 'always':
      return true;
    case 'turnReached':
      return ctx.turn >= num(p.value);
    case 'resourceBelow':
      return (ctx.resources[str(p.resource)] ?? 0) < num(p.value);
    case 'resourceAbove':
      return (ctx.resources[str(p.resource)] ?? 0) > num(p.value);
    case 'resourceReached':
      return (ctx.resources[str(p.resource)] ?? 0) >= num(p.value);
    case 'resourceDepleted':
      return (ctx.resources[str(p.resource)] ?? 0) <= num(p.value);
    case 'flagIs':
      return ctx.flags[str(p.flag)] === p.value;
    default:
      throw new Error(`unknown condition type: ${cond.type}`);
  }
}

export function applyEffect(eff: Effect, ctx: EffectContext): void {
  const p = eff.params ?? {};
  switch (eff.type) {
    case 'addResource':
      ctx.resources[str(p.resource)] = (ctx.resources[str(p.resource)] ?? 0) + num(p.amount);
      break;
    case 'setFlag':
      ctx.flags[str(p.flag)] = p.value;
      break;
    case 'message':
      ctx.messages.push(str(p.text));
      break;
    case 'endGame':
      ctx.ended = str(p.endingId);
      break;
    default:
      throw new Error(`unknown effect type: ${eff.type}`);
  }
}

export function applyEffects(effects: Effect[], ctx: EffectContext): void {
  for (const eff of effects) applyEffect(eff, ctx);
}

export function isKnownConditionType(type: string): boolean {
  return (CONDITION_WHITELIST as readonly string[]).includes(type);
}
export function isKnownEffectType(type: string): boolean {
  return (EFFECT_WHITELIST as readonly string[]).includes(type);
}
