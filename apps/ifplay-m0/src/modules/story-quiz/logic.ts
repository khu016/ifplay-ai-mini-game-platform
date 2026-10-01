import type { StoryQuizConfig, StoryCondition } from './config';
import type { Rng } from '@/core/rng';
import type { NormalizedInput } from '@/core/input';
import type { ModuleContext } from '@/core/context';

export interface StoryHistoryEntry {
  nodeId: string;
  text: string;
  choiceText?: string;
}

export interface StoryQuizState {
  phase: 'play' | 'result';
  currentNodeId: string;
  attributes: Record<string, number>;
  score: number;
  flags: Record<string, unknown>;
  usedChoices: string[];
  history: StoryHistoryEntry[];
  messages: string[];
  endingId: string | null;
  endingName: string | null;
  endingDesc: string | null;
}

export function evaluateStoryCondition(cond: StoryCondition, state: StoryQuizState): boolean {
  switch (cond.type) {
    case 'always':
      return true;
    case 'attributeReached':
      return (state.attributes[cond.attribute ?? ''] ?? 0) >= Number(cond.value ?? 0);
    case 'attributeBelow':
      return (state.attributes[cond.attribute ?? ''] ?? 0) < Number(cond.value ?? 0);
    case 'flagIs':
      return state.flags[cond.flag ?? ''] === cond.value;
    default:
      return false;
  }
}

export function createInitialState(config: StoryQuizConfig, _seed: number, _rng: Rng): StoryQuizState {
  const attributes: Record<string, number> = {};
  for (const a of config.attributes) attributes[a.id] = 0;
  const startNode = config.nodes.find((n) => n.id === config.startNodeId)!;
  return {
    phase: 'play',
    currentNodeId: config.startNodeId,
    attributes,
    score: 0,
    flags: {},
    usedChoices: [],
    history: [{ nodeId: startNode.id, text: startNode.text }],
    messages: [],
    endingId: null,
    endingName: null,
    endingDesc: null,
  };
}

function endGame(state: StoryQuizState, ctx: ModuleContext, endingId: string): void {
  const e = ctx.bundle.progression.endings.find((x) => x.id === endingId);
  state.phase = 'result';
  state.endingId = endingId;
  state.endingName = e?.name ?? endingId;
  state.endingDesc = e?.desc ?? '';
  ctx.bus.emit({ type: 'game:ended', endingId });
}

function choose(state: StoryQuizState, config: StoryQuizConfig, ctx: ModuleContext, choiceId: string): void {
  const node = config.nodes.find((n) => n.id === state.currentNodeId);
  if (!node) return;
  const choice = node.choices.find((c) => c.id === choiceId);
  if (!choice) return;
  if (choice.once && state.usedChoices.includes(choice.id)) {
    state.messages.push('这个选择已经用过了');
    return;
  }
  if (choice.condition && !evaluateStoryCondition(choice.condition, state)) {
    state.messages.push('条件不满足');
    return;
  }

  for (const eff of choice.effects ?? []) {
    switch (eff.type) {
      case 'addAttribute':
        state.attributes[eff.attribute ?? ''] = (state.attributes[eff.attribute ?? ''] ?? 0) + (eff.amount ?? 0);
        break;
      case 'addScore':
        state.score += eff.amount ?? 0;
        break;
      case 'setFlag':
        state.flags[eff.flag ?? ''] = eff.value;
        break;
      case 'addFlag':
        state.flags[eff.flag ?? ''] = true;
        break;
    }
  }
  if (choice.once) state.usedChoices.push(choice.id);
  state.history.push({ nodeId: node.id, text: node.text, choiceText: choice.text });

  if (choice.ending) {
    endGame(state, ctx, choice.ending);
    return;
  }
  if (choice.next) {
    const nextNode = config.nodes.find((n) => n.id === choice.next);
    if (!nextNode) return;
    state.currentNodeId = nextNode.id;
    state.history.push({ nodeId: nextNode.id, text: nextNode.text });
    if (nextNode.ending) {
      endGame(state, ctx, nextNode.ending);
    }
  }
}

export function reduce(state: StoryQuizState, input: NormalizedInput, ctx: ModuleContext): void {
  if (state.phase === 'result') return;
  if (input.kind !== 'action') return;
  const config = ctx.bundle.primaryModule.config as StoryQuizConfig;
  if (input.actionId === 'choose') {
    choose(state, config, ctx, input.params?.choiceId ?? '');
  }
}
