// GameSpec v0.1 —— IfPlay 模拟器规则数据结构（唯一权威类型定义）
// 安全边界：GameSpec 只允许白名单结构化表达，禁止任意脚本/HTML/SQL。

export const GAMESPEC_SCHEMA_VERSION = "0.1" as const;

export type ClockUnit = "day" | "week" | "month" | "turn";
export type CmpOp = ">=" | "<=" | ">" | "<" | "==" | "!=";

export interface GameSpecMetadata {
  /** 稳定唯一 ID，用于存档关联 */
  id: string;
  title: string;
  description: string;
  genre: string;
  targetTurns?: number;
  lang?: string;
}

export interface StatDef {
  id: string;
  name: string;
  initial: number;
  min: number;
  max: number;
  /** false 表示隐藏状态，试玩界面不展示 */
  visible: boolean;
}

export interface FlagDef {
  id: string;
  name: string;
}

/** 条件：递归白名单，禁止任意字符串求值 */
export type Condition =
  | { op: "flag"; flag: string; not?: boolean }
  | { op: "compare"; stat: string; cmp: CmpOp; value: number }
  | { op: "turn"; cmp: CmpOp; value: number }
  | { op: "all"; conditions: Condition[] }
  | { op: "any"; conditions: Condition[] };

export interface RollBranch {
  weight: number;
  effects: Effect[];
}

/** 效果：白名单操作，禁止代码注入 */
export type Effect =
  | { op: "set_stat"; stat: string; value: number }
  | { op: "add_stat"; stat: string; delta: number }
  | { op: "set_flag"; flag: string; value: boolean }
  | { op: "goto"; event: string }
  | { op: "trigger_ending"; ending: string }
  | { op: "roll"; rolls: RollBranch[] };

export interface EventOption {
  text: string;
  condition?: Condition;
  effects: Effect[];
}

export interface GameEvent {
  id: string;
  title: string;
  body: string;
  condition?: Condition;
  /** ≥0；加权采样。0 表示仅能由 goto 或权重被其他事件挤掉时触发 */
  weight: number;
  /** 回合冷却，≥1 */
  cooldown?: number;
  once?: boolean;
  options: EventOption[];
}

export interface Ending {
  id: string;
  title: string;
  body: string;
  condition?: Condition;
  /** 数字越大越先判定 */
  priority: number;
}

export interface GameSpec {
  schemaVersion: typeof GAMESPEC_SCHEMA_VERSION;
  metadata: GameSpecMetadata;
  clock: { unit: ClockUnit; total: number };
  stats: StatDef[];
  flags: FlagDef[];
  events: GameEvent[];
  endings: Ending[];
}
