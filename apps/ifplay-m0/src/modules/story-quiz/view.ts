import type { StoryQuizConfig } from './config';
import { evaluateStoryCondition, type StoryQuizState } from './logic';
import type { ModuleView } from '@/core/viewModel';

export function view(state: StoryQuizState, config: StoryQuizConfig): ModuleView {
  const log = state.history.map((h) => (h.choiceText ? `${h.choiceText} → ${h.text}` : h.text)).slice(-20);

  if (state.phase === 'result') {
    return {
      scene: 'result',
      stats: [{ label: config.labels.score, value: state.score }],
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

  const node = config.nodes.find((n) => n.id === state.currentNodeId);
  if (!node) {
    return { scene: 'result', stats: [], meters: [], message: '', actions: [], queue: [], log, inputMode: 'actions' };
  }

  const visibleChoices = node.choices.filter(
    (c) => !(c.once && state.usedChoices.includes(c.id)) && (!c.condition || evaluateStoryCondition(c.condition, state)),
  );

  const attrStats = config.attributes.map((a) => ({ label: a.name, value: state.attributes[a.id] ?? 0 }));

  return {
    scene: 'play',
    stats: [{ label: config.labels.score, value: state.score }, ...attrStats],
    meters: [],
    message: state.messages.length > 0 ? state.messages[state.messages.length - 1] : '',
    actions: visibleChoices.map((c) => ({ id: 'choose', label: c.text, params: { choiceId: c.id } })),
    queue: [],
    panel: {
      title: node.speaker ?? '',
      body: node.text,
      actions: [],
    },
    log,
    inputMode: 'actions',
  };
}
