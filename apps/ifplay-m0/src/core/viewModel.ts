export interface Stat {
  label: string;
  value: number | string;
  max?: number;
}
export interface Meter {
  label: string;
  value: number;
  max: number;
}
export interface ActionButton {
  id: string;
  label: string;
  disabled?: boolean;
  params?: Record<string, string>;
}
export interface QueueItem {
  id: string;
  name: string;
  detail: string;
  action?: ActionButton;
}
export interface Panel {
  title: string;
  body: string;
  actions: ActionButton[];
}
export interface TapZone {
  label: string;
  hint: string;
  window?: { start: number; end: number };
  marker?: number;
}
export interface ResultInfo {
  title: string;
  summary: string;
  endingId: string;
}
export interface DragItem {
  id: string;
  name: string;
  count: number;
  disabled?: boolean;
}
export interface DropSlot {
  id: string;
  name: string;
  contains?: string;
}
export interface DragZone {
  items: DragItem[];
  slots: DropSlot[];
  hint?: string;
}

/** 模块产出的视图模型（不含游戏标题等 bundle 级信息）。 */
export interface ModuleView {
  scene: 'play' | 'result';
  stats: Stat[];
  meters: Meter[];
  message: string;
  actions: ActionButton[];
  queue: QueueItem[];
  panel?: Panel;
  log: string[];
  inputMode: 'actions' | 'tap' | 'drag';
  tapZone?: TapZone;
  dragZone?: DragZone;
  result?: ResultInfo;
}

/** 运行时包装后的完整视图模型。 */
export interface ViewModel extends ModuleView {
  title: string;
  subtitle?: string;
}
