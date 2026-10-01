import type { TimingConfig } from './config';
import type { TimingState, Tier } from './logic';
import type { ModuleView } from '@/core/viewModel';

function tierLabel(t: Tier): string {
  switch (t) {
    case 'perfect':
      return '完美';
    case 'good':
      return '优秀';
    case 'normal':
      return '普通';
    case 'miss':
      return '失误';
    default:
      return '—';
  }
}

function totalTarget(config: TimingConfig): number {
  if (config.stages && config.stages.length > 0) {
    return config.stages.reduce((s, st) => s + st.targetSpirit, 0);
  }
  return config.spirit.target;
}

export function view(state: TimingState, config: TimingConfig): ModuleView {
  const log = state.messages.slice(-20);
  const target = totalTarget(config);

  if (state.phase === 'result') {
    return {
      scene: 'result',
      stats: [
        { label: config.labels.spirit, value: state.spirit },
        { label: config.labels.rating ?? '评价', value: state.rating ?? '—' },
      ],
      meters: [],
      message: '',
      actions: [],
      queue: [],
      log,
      inputMode: 'tap',
      result: {
        title: state.endingName ?? '结局',
        summary: `${state.endingDesc ?? ''}${state.failReason ? `\n${state.failReason}` : ''}`,
        endingId: state.endingId ?? '',
      },
    };
  }

  const stageCount = config.stages?.length ?? 1;
  const skills = (config.skills ?? [])
    .filter((s) => state.skillsUnlocked.includes(s.id))
    .map((s) => ({
      id: 'useSkill',
      label: s.name,
      disabled: state.skillsUsed.includes(s.id),
      params: { skillId: s.id },
    }));

  return {
    scene: 'play',
    stats: [
      { label: config.labels.combo, value: state.combo },
      { label: config.labels.stage ?? '阶段', value: `${state.stageIndex + 1}/${stageCount}` },
      { label: '最近判定', value: tierLabel(state.lastTier) },
    ],
    meters: [
      { label: config.labels.spirit, value: Math.min(state.spirit, target), max: target },
      { label: config.labels.breath, value: Math.round(state.breath), max: config.breath.max },
      { label: config.labels.exposure, value: Math.min(state.exposure, config.exposure.max), max: config.exposure.max },
    ],
    message: state.messages.length > 0 ? state.messages[state.messages.length - 1] : '',
    actions: skills,
    queue: [],
    log,
    inputMode: 'tap',
    tapZone: {
      label: config.labels.spirit,
      hint: config.tapHint,
      window: { start: state.windowStart, end: state.windowEnd },
      marker: state.marker,
    },
  };
}
