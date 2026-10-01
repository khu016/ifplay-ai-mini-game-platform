import type { BusinessConfig } from './config';
import type { BusinessState } from './logic';
import type { ActionButton, ModuleView } from '@/core/viewModel';

function lastMessage(state: BusinessState): string {
  return state.messages.length > 0 ? state.messages[state.messages.length - 1] : '';
}

export function view(state: BusinessState, config: BusinessConfig): ModuleView {
  const log = state.messages.slice(-20);
  if (state.phase === 'result') {
    return {
      scene: 'result',
      stats: [
        { label: config.labels.money, value: state.money },
        { label: config.labels.reputation, value: state.reputation },
        { label: config.labels.turn, value: state.turn },
      ],
      meters: [],
      message: '',
      actions: [],
      queue: [],
      log,
      inputMode: 'actions',
      result: {
        title: state.endingName ?? '结局',
        summary: state.endingDesc ?? '',
        endingId: state.endingId ?? '',
      },
    };
  }

  const currentCustomer = state.currentCustomerId
    ? config.customers.find((c) => c.id === state.currentCustomerId)
    : null;

  const queue = state.queue.map((q) => {
    const c = config.customers.find((cc) => cc.id === q.customerId);
    return {
      id: q.customerId,
      name: c?.name ?? q.customerId,
      detail: `耐心 ${q.patience} · ${c?.fault ?? ''}`,
      action: { id: 'serve', label: '接待', params: { customerId: q.customerId } },
    };
  });

  let panel;
  if (currentCustomer) {
    const partActions = config.parts.map((p) => ({
      id: 'choosePart',
      label: `${p.name}（库存 ${state.inventory[p.id] ?? 0}）`,
      disabled: (state.inventory[p.id] ?? 0) < 1,
      params: { partId: p.id },
    }));
    panel = {
      title: currentCustomer.name,
      body: `${currentCustomer.fault}${currentCustomer.desc ? `\n${currentCustomer.desc}` : ''}`,
      actions: partActions,
    };
  }

  const actions: ActionButton[] = [
    { id: 'nextTurn', label: '结束本回合' },
    {
      id: 'buyBattery',
      label: `补电池（-${config.batteryCost}）`,
      disabled: state.money < config.batteryCost,
    },
  ];
  for (const p of config.parts) {
    actions.push({
      id: 'buyPart',
      label: `进货 ${p.name}（-${p.cost}）`,
      disabled: state.money < p.cost,
      params: { partId: p.id },
    });
  }
  for (const u of config.upgrades) {
    if (!state.upgradesOwned.includes(u.id)) {
      actions.push({
        id: 'buyUpgrade',
        label: `升级 ${u.name}（-${u.cost}）`,
        disabled: state.money < u.cost,
        params: { upgradeId: u.id },
      });
    }
  }

  return {
    scene: 'play',
    stats: [
      { label: config.labels.money, value: state.money },
      { label: config.labels.reputation, value: state.reputation },
      { label: config.labels.battery, value: state.battery },
      { label: config.labels.turn, value: `${state.turn}/${config.totalTurns}` },
    ],
    meters: [],
    message: lastMessage(state),
    actions,
    queue,
    panel,
    log,
    inputMode: 'actions',
  };
}
