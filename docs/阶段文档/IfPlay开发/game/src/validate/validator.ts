import type {
  Condition,
  Effect,
  EventOption,
  GameEvent,
  GameSpec,
  StatDef,
} from "../schema/gameSpec";
import { GAMESPEC_SCHEMA_VERSION } from "../schema/gameSpec";

export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const CLOCK_UNITS = ["day", "week", "month", "turn"];
const CMP_OPS = [">=", "<=", ">", "<", "==", "!="];

function err(code: string, message: string, path?: string): ValidationIssue {
  return { code, message, path };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 对未知输入做结构 + 引用完整性 + 数值边界校验 */
export function validate(input: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [err("INVALID_SPEC", "GameSpec 必须是对象")], warnings };
  }

  if (input.schemaVersion !== GAMESPEC_SCHEMA_VERSION) {
    errors.push(err("INVALID_SCHEMA_VERSION", `schemaVersion 必须为 "${GAMESPEC_SCHEMA_VERSION}"`, "schemaVersion"));
  }

  const spec = input as unknown as GameSpec;
  const statIds = new Set<string>();
  const flagIds = new Set<string>();
  const eventIds = new Set<string>();
  const endingIds = new Set<string>();

  // metadata
  const meta = spec.metadata;
  if (!isRecord(meta)) {
    errors.push(err("MISSING_FIELD", "缺少 metadata", "metadata"));
  } else {
    for (const key of ["id", "title", "description", "genre"] as const) {
      if (typeof meta[key] !== "string" || (meta[key] as string).trim() === "") {
        errors.push(err("MISSING_FIELD", `metadata.${key} 必须为非空字符串`, `metadata.${key}`));
      }
    }
  }

  // clock
  const clock = spec.clock;
  if (!isRecord(clock)) {
    errors.push(err("MISSING_FIELD", "缺少 clock", "clock"));
  } else {
    if (!CLOCK_UNITS.includes(clock.unit as string)) {
      errors.push(err("INVALID_ENUM", `clock.unit 必须为 ${CLOCK_UNITS.join("/")}`, "clock.unit"));
    }
    if (typeof clock.total !== "number" || !Number.isFinite(clock.total) || clock.total < 1) {
      errors.push(err("INVALID_NUMBER", "clock.total 必须为 ≥1 的整数", "clock.total"));
    }
  }

  // stats
  if (!Array.isArray(spec.stats) || spec.stats.length === 0) {
    errors.push(err("MISSING_FIELD", "stats 必须为非空数组", "stats"));
  } else {
    spec.stats.forEach((s: StatDef, i) => {
      const p = `stats[${i}]`;
      if (typeof s.id !== "string" || s.id.trim() === "") errors.push(err("INVALID_ID", "stat.id 必须为非空字符串", `${p}.id`));
      if (typeof s.name !== "string" || s.name.trim() === "") errors.push(err("MISSING_FIELD", "stat.name 必须为非空字符串", `${p}.name`));
      for (const k of ["initial", "min", "max"] as const) {
        if (typeof s[k] !== "number" || !Number.isFinite(s[k])) {
          errors.push(err("INVALID_NUMBER", `stat.${k} 必须为数字`, `${p}.${k}`));
        }
      }
      if (typeof s.visible !== "boolean") errors.push(err("INVALID_TYPE", "stat.visible 必须为布尔值", `${p}.visible`));
      if (s.min > s.max) errors.push(err("INVALID_NUMBER", "stat.min 不能大于 max", `${p}.min`));
      if (s.initial < s.min || s.initial > s.max) {
        warnings.push(err("STAT_INITIAL_OUT_OF_RANGE", `stat「${s.id}」初值 ${s.initial} 超出 [${s.min}, ${s.max}]，将被夹紧`, `${p}.initial`));
      }
      if (statIds.has(s.id)) errors.push(err("DUPLICATE_ID", `stat id「${s.id}」重复`, `${p}.id`));
      statIds.add(s.id);
    });
  }

  // flags
  if (!Array.isArray(spec.flags)) {
    errors.push(err("MISSING_FIELD", "flags 必须为数组", "flags"));
  } else {
    spec.flags.forEach((f, i) => {
      const p = `flags[${i}]`;
      if (typeof f.id !== "string" || f.id.trim() === "") errors.push(err("INVALID_ID", "flag.id 必须为非空字符串", `${p}.id`));
      if (typeof f.name !== "string" || f.name.trim() === "") errors.push(err("MISSING_FIELD", "flag.name 必须为非空字符串", `${p}.name`));
      if (flagIds.has(f.id)) errors.push(err("DUPLICATE_ID", `flag id「${f.id}」重复`, `${p}.id`));
      flagIds.add(f.id);
    });
  }

  // endings (先收集 id，供引用检查)
  if (!Array.isArray(spec.endings) || spec.endings.length === 0) {
    errors.push(err("MISSING_FIELD", "endings 必须为非空数组", "endings"));
  } else {
    spec.endings.forEach((e, i) => {
      const p = `endings[${i}]`;
      if (typeof e.id !== "string" || e.id.trim() === "") errors.push(err("INVALID_ID", "ending.id 必须为非空字符串", `${p}.id`));
      if (typeof e.title !== "string" || e.title.trim() === "") errors.push(err("MISSING_FIELD", "ending.title 必须为非空字符串", `${p}.title`));
      if (typeof e.priority !== "number" || !Number.isFinite(e.priority)) errors.push(err("INVALID_NUMBER", "ending.priority 必须为数字", `${p}.priority`));
      if (e.condition === undefined) {
        warnings.push(err("ENDING_NO_CONDITION", `结局「${e.title}」无条件，将立即触发`, `${p}.condition`));
      }
      if (endingIds.has(e.id)) errors.push(err("DUPLICATE_ID", `ending id「${e.id}」重复`, `${p}.id`));
      endingIds.add(e.id);
    });
  }

  // events
  if (!Array.isArray(spec.events) || spec.events.length === 0) {
    errors.push(err("MISSING_FIELD", "events 必须为非空数组", "events"));
  } else {
    spec.events.forEach((e: GameEvent, i) => {
      const p = `events[${i}]`;
      if (typeof e.id !== "string" || e.id.trim() === "") errors.push(err("INVALID_ID", "event.id 必须为非空字符串", `${p}.id`));
      if (typeof e.title !== "string" || e.title.trim() === "") errors.push(err("MISSING_FIELD", "event.title 必须为非空字符串", `${p}.title`));
      if (typeof e.body !== "string") errors.push(err("MISSING_FIELD", "event.body 必须为字符串", `${p}.body`));
      if (typeof e.weight !== "number" || !Number.isFinite(e.weight) || e.weight < 0) {
        errors.push(err("INVALID_NUMBER", "event.weight 必须为 ≥0 的数字", `${p}.weight`));
      }
      if (e.cooldown !== undefined && (typeof e.cooldown !== "number" || e.cooldown < 1)) {
        errors.push(err("INVALID_NUMBER", "event.cooldown 必须为 ≥1 的整数", `${p}.cooldown`));
      }
      if (!Array.isArray(e.options) || e.options.length === 0) {
        errors.push(err("MISSING_FIELD", "event.options 必须为非空数组", `${p}.options`));
      } else {
        e.options.forEach((o: EventOption, j) => {
          const op = `${p}.options[${j}]`;
          if (typeof o.text !== "string" || o.text.trim() === "") errors.push(err("MISSING_FIELD", "option.text 必须为非空字符串", `${op}.text`));
          if (!Array.isArray(o.effects)) errors.push(err("MISSING_FIELD", "option.effects 必须为数组", `${op}.effects`));
        });
      }
      if (eventIds.has(e.id)) errors.push(err("DUPLICATE_ID", `event id「${e.id}」重复`, `${p}.id`));
      eventIds.add(e.id);
    });
  }

  // 引用完整性：遍历所有条件与效果
  spec.events?.forEach((e, i) => {
    const p = `events[${i}]`;
    checkCondition(e.condition, p, statIds, flagIds, errors);
    e.options?.forEach((o, j) => {
      checkCondition(o.condition, `${p}.options[${j}]`, statIds, flagIds, errors);
      o.effects?.forEach((ef, k) => checkEffect(ef, `${p}.options[${j}].effects[${k}]`, statIds, flagIds, eventIds, endingIds, errors));
    });
  });
  spec.endings?.forEach((e, i) => {
    checkCondition(e.condition, `endings[${i}]`, statIds, flagIds, errors);
  });

  // 语义警告：weight 为 0 且无 goto 指向的事件可能不可达
  const gotoRefs = new Set<string>();
  spec.events?.forEach((e) => {
    e.options?.forEach((o) => collectGoto(o.effects, gotoRefs));
  });
  spec.events?.forEach((e) => {
    if (e.weight === 0 && !gotoRefs.has(e.id)) {
      warnings.push(err("EVENT_UNREACHABLE", `事件「${e.title}」权重为 0 且无 goto 指向，可能不可达`, `events`));
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

function checkCondition(
  c: Condition | undefined,
  path: string,
  statIds: Set<string>,
  flagIds: Set<string>,
  errors: ValidationIssue[],
): void {
  if (c === undefined) return;
  switch (c.op) {
    case "flag":
      if (!flagIds.has(c.flag)) errors.push(err("UNKNOWN_FLAG", `引用不存在的 flag「${c.flag}」`, path));
      break;
    case "compare":
      if (!statIds.has(c.stat)) errors.push(err("UNKNOWN_STAT", `引用不存在的 stat「${c.stat}」`, path));
      if (!CMP_OPS.includes(c.cmp)) errors.push(err("INVALID_ENUM", `cmp 必须为 ${CMP_OPS.join("/")}`, path));
      break;
    case "turn":
      if (!CMP_OPS.includes(c.cmp)) errors.push(err("INVALID_ENUM", `cmp 必须为 ${CMP_OPS.join("/")}`, path));
      break;
    case "all":
    case "any":
      if (!Array.isArray(c.conditions) || c.conditions.length === 0) {
        errors.push(err("INVALID_TYPE", "conditions 必须为非空数组", path));
      } else {
        c.conditions.forEach((x, i) => checkCondition(x, `${path}.conditions[${i}]`, statIds, flagIds, errors));
      }
      break;
    default:
      errors.push(err("INVALID_OP", `未知条件 op「${(c as { op: string }).op}」`, path));
  }
}

function checkEffect(
  ef: Effect,
  path: string,
  statIds: Set<string>,
  flagIds: Set<string>,
  eventIds: Set<string>,
  endingIds: Set<string>,
  errors: ValidationIssue[],
): void {
  switch (ef.op) {
    case "set_stat":
    case "add_stat":
      if (!statIds.has(ef.stat)) errors.push(err("UNKNOWN_STAT", `引用不存在的 stat「${ef.stat}」`, path));
      break;
    case "set_flag":
      if (!flagIds.has(ef.flag)) errors.push(err("UNKNOWN_FLAG", `引用不存在的 flag「${ef.flag}」`, path));
      break;
    case "goto":
      if (!eventIds.has(ef.event)) errors.push(err("UNKNOWN_EVENT", `引用不存在的事件「${ef.event}」`, path));
      break;
    case "trigger_ending":
      if (!endingIds.has(ef.ending)) errors.push(err("UNKNOWN_ENDING", `引用不存在的结局「${ef.ending}」`, path));
      break;
    case "roll":
      if (!Array.isArray(ef.rolls) || ef.rolls.length === 0) {
        errors.push(err("INVALID_TYPE", "roll.rolls 必须为非空数组", path));
      } else {
        ef.rolls.forEach((r, i) => {
          if (typeof r.weight !== "number" || !Number.isFinite(r.weight) || r.weight < 0) {
            errors.push(err("INVALID_NUMBER", "roll 分支 weight 必须为 ≥0 的数字", `${path}.rolls[${i}]`));
          }
          if (!Array.isArray(r.effects)) errors.push(err("INVALID_TYPE", "roll 分支 effects 必须为数组", `${path}.rolls[${i}]`));
          r.effects?.forEach((x, j) => checkEffect(x, `${path}.rolls[${i}].effects[${j}]`, statIds, flagIds, eventIds, endingIds, errors));
        });
      }
      break;
    default:
      errors.push(err("INVALID_OP", `未知效果 op「${(ef as { op: string }).op}」`, path));
  }
}

function collectGoto(effects: Effect[] | undefined, out: Set<string>): void {
  effects?.forEach((e) => {
    if (e.op === "goto") out.add(e.event);
    else if (e.op === "roll") e.rolls?.forEach((r) => collectGoto(r.effects, out));
  });
}
