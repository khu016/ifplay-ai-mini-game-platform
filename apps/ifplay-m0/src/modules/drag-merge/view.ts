import type { DragMergeConfig } from './config';
import type { DragMergeState } from './logic';
import type { ModuleView } from '@/core/viewModel';

function itemName(config: DragMergeConfig, itemId: string): string {
  return config.items.find((i) => i.id === itemId)?.name ?? itemId;
}

export function view(state: DragMergeState, config: DragMergeConfig): ModuleView {
  const log = state.messages.slice(-20);

  if (state.phase === 'result') {
    return {
      scene: 'result',
      stats: [
        { label: config.labels.score, value: state.score },
        { label: config.labels.steps, value: state.step },
        { label: config.labels.combo, value: state.combo },
      ],
      meters: [],
      message: '',
      actions: [],
      queue: [],
      log,
      inputMode: 'drag',
      result: { title: state.endingName ?? '结局', summary: state.endingDesc ?? '', endingId: state.endingId ?? '' },
    };
  }

  const stats = [
    { label: config.labels.score, value: state.score },
    { label: config.labels.steps, value: `${state.step}/${config.maxSteps}` },
    { label: config.labels.combo, value: state.combo },
  ];

  const queue = (config.orders ?? []).map((o, i) => {
    const inst = state.orders[i];
    const targetName = itemName(config, o.targetItemId);
    const status = inst.fulfilled ? '已完成' : inst.expired ? '已过期' : `期限 ${o.deadlineStep} 步`;
    const canDeliver = inst && !inst.fulfilled && !inst.expired && (state.inventory[o.targetItemId] ?? 0) > 0;
    return {
      id: o.id,
      name: o.name,
      detail: `${status} · 需要 ${targetName}`,
      action: canDeliver ? { id: 'deliver', label: '交付', params: { orderId: o.id } } : undefined,
    };
  });

  const discoveryLines = config.recipes.map((r) => {
    const discovered = state.discovered.includes(r.id);
    const name = r.resultName ?? (r.output ? itemName(config, r.output.itemId) : r.name);
    return discovered ? `✓ ${name}` : `？ ${r.hint ?? '尚未发现'}`;
  });
  const panel =
    discoveryLines.length > 0
      ? { title: config.labels.discovered ?? '图鉴', body: discoveryLines.join('\n'), actions: [] }
      : undefined;

  return {
    scene: 'play',
    stats,
    meters: [],
    message: state.messages.length > 0 ? state.messages[state.messages.length - 1] : '',
    actions: [],
    queue,
    panel,
    log,
    inputMode: 'drag',
    dragZone: {
      items: config.items.map((i) => ({
        id: i.id,
        name: i.name,
        count: state.inventory[i.id] ?? 0,
        disabled: (state.inventory[i.id] ?? 0) <= 0,
      })),
      slots: config.slots.map((s) => {
        const itemId = state.slots[s.id];
        const name = itemId ? itemName(config, itemId) : undefined;
        return { id: s.id, name: s.name, contains: name };
      }),
      hint: '把物品拖进容器',
    },
  };
}
