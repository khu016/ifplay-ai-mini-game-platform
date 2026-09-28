import type { Effect, GameSpec } from "../schema/gameSpec";
import type { PRNG } from "./prng";
import { clamp } from "./util";

export interface EffectResult {
  /** 遇到 goto 时指向目标事件（取第一个） */
  gotoEventId?: string;
  /** 遇到 trigger_ending 时指向目标结局（取第一个，优先级高于 goto） */
  endingId?: string;
}

/**
 * 按顺序应用一组效果。所有效果都会执行（数值变更不因 goto/ending 中断），
 * 最终若有 endingId 则优先返回 endingId，否则返回 gotoEventId。
 * clampLog 收集"数值越界被夹紧"的提示，用于自动路径模拟的资源越界检测。
 */
export function applyEffects(
  effects: Effect[],
  spec: GameSpec,
  stats: Record<string, number>,
  flags: Record<string, boolean>,
  prng: PRNG,
  clampLog: string[] = [],
): EffectResult {
  const result: EffectResult = {};

  for (const e of effects) {
    switch (e.op) {
      case "set_stat": {
        const def = spec.stats.find((s) => s.id === e.stat);
        const v = def ? clamp(e.value, def.min, def.max) : e.value;
        if (def && v !== e.value) {
          clampLog.push(`${e.stat} 设为 ${e.value} 越界，夹紧为 ${v}`);
        }
        stats[e.stat] = v;
        break;
      }
      case "add_stat": {
        const cur = stats[e.stat] ?? 0;
        const def = spec.stats.find((s) => s.id === e.stat);
        const next = cur + e.delta;
        const v = def ? clamp(next, def.min, def.max) : next;
        if (def && v !== next) {
          clampLog.push(`${e.stat} +${e.delta} 越界，夹紧为 ${v}`);
        }
        stats[e.stat] = v;
        break;
      }
      case "set_flag":
        flags[e.flag] = e.value;
        break;
      case "goto":
        if (result.gotoEventId === undefined) result.gotoEventId = e.event;
        break;
      case "trigger_ending":
        if (result.endingId === undefined) result.endingId = e.ending;
        break;
      case "roll": {
        const weights = e.rolls.map((r) => r.weight);
        const idx = prng.weighted(weights);
        const branch = idx >= 0 ? e.rolls[idx] : undefined;
        if (branch) {
          const sub = applyEffects(branch.effects, spec, stats, flags, prng, clampLog);
          if (sub.endingId !== undefined && result.endingId === undefined) {
            result.endingId = sub.endingId;
          }
          if (sub.gotoEventId !== undefined && result.gotoEventId === undefined) {
            result.gotoEventId = sub.gotoEventId;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  return result;
}
