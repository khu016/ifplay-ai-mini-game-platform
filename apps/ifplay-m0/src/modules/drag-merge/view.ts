import type { DragMergeConfig } from './config';
import type { DragMergeState } from './logic';
import type { ModuleView } from '@/core/viewModel';

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

  return {
    scene: 'play',
    stats: [
      { label: config.labels.score, value: state.score },
      { label: config.labels.steps, value: `${state.step}/${config.maxSteps}` },
      { label: config.labels.combo, value: state.combo },
    ],
    meters: [],
    message: state.messages.length > 0 ? state.messages[state.messages.length - 1] : '',
    actions: [],
    queue: [],
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
        const itemName = itemId ? config.items.find((i) => i.id === itemId)?.name ?? itemId : undefined;
        return { id: s.id, name: s.name, contains: itemName };
      }),
      hint: '把物品拖进容器',
    },
  };
}
