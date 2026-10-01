import { describe, it, expect } from 'vitest';
import { createGame, type GameRuntime } from '@/core/runtime';
import { makeBundle } from '../helpers';
import { storyQuizModule } from '@/modules/story-quiz';
import type { StoryQuizConfig } from '@/modules/story-quiz/config';
import type { StoryQuizState } from '@/modules/story-quiz/logic';
import type { GameBundle } from '@/core/schema';
import { dragonKingBundle } from '@/bundles/dragon-king';

const config: StoryQuizConfig = {
  labels: { score: '人气' },
  attributes: [{ id: 'prestige', name: '威望' }],
  startNodeId: 'start',
  nodes: [
    {
      id: 'start',
      text: '开始',
      choices: [
        { id: 'boost', text: '积累威望', effects: [{ type: 'addAttribute', attribute: 'prestige', amount: 2 }], next: 'mid' },
        { id: 'flag', text: '拿隐藏道具', effects: [{ type: 'addFlag', flag: 'secret' }], next: 'mid', once: true },
      ],
    },
    {
      id: 'mid',
      text: '中段',
      choices: [
        { id: 'vote_success', text: '高票当选', condition: { type: 'attributeReached', attribute: 'prestige', value: 2 }, ending: 'success' },
        { id: 'vote_hidden', text: '亮出隐藏道具', condition: { type: 'flagIs', flag: 'secret', value: true }, ending: 'hidden' },
        { id: 'vote_fail', text: '退选', ending: 'fail' },
        { id: 'back', text: '回去', next: 'start' },
      ],
    },
  ],
};

const endings: GameBundle['progression']['endings'] = [
  { id: 'success', name: '当选', desc: '' },
  { id: 'fail', name: '失败', desc: '' },
  { id: 'hidden', name: '隐藏', desc: '' },
];

function stateOf(rt: GameRuntime): StoryQuizState {
  return rt.state as unknown as StoryQuizState;
}
function choose(rt: GameRuntime, choiceId: string): void {
  rt.step({ kind: 'action', actionId: 'choose', params: { choiceId } });
}
function visibleChoiceIds(rt: GameRuntime): string[] {
  return rt.view().actions.map((a) => a.params?.choiceId ?? '').filter(Boolean);
}

describe('剧情问答模块', () => {
  it('选择推进到下一个节点', () => {
    const rt = createGame(makeBundle('story-quiz', config, endings), { seed: 1 });
    choose(rt, 'boost');
    expect(stateOf(rt).currentNodeId).toBe('mid');
  });

  it('效果累积属性与 flag', () => {
    const rt = createGame(makeBundle('story-quiz', config, endings), { seed: 1 });
    choose(rt, 'flag');
    expect(stateOf(rt).attributes.prestige).toBe(0);
    expect(stateOf(rt).flags.secret).toBe(true);
  });

  it('条件选项按属性/flag 显示', () => {
    const rt = createGame(makeBundle('story-quiz', config, endings), { seed: 1 });
    choose(rt, 'boost'); // prestige=2
    const ids = visibleChoiceIds(rt);
    expect(ids).toContain('vote_success');
    expect(ids).not.toContain('vote_hidden'); // 无 flag secret
  });

  it('一次性选项用过即隐藏', () => {
    const rt = createGame(makeBundle('story-quiz', config, endings), { seed: 1 });
    choose(rt, 'flag'); // 用掉 once
    choose(rt, 'back'); // 回到 start
    expect(visibleChoiceIds(rt)).not.toContain('flag');
  });

  it('普通成功结局', () => {
    const rt = createGame(makeBundle('story-quiz', config, endings), { seed: 1 });
    choose(rt, 'boost');
    choose(rt, 'vote_success');
    expect(rt.ended).toBe(true);
    expect(stateOf(rt).endingId).toBe('success');
  });

  it('隐藏结局', () => {
    const rt = createGame(makeBundle('story-quiz', config, endings), { seed: 1 });
    choose(rt, 'flag');
    choose(rt, 'vote_hidden');
    expect(stateOf(rt).endingId).toBe('hidden');
  });

  it('拒绝悬空 next 引用', () => {
    const bad: StoryQuizConfig = {
      labels: { score: '人气' },
      attributes: [],
      startNodeId: 'start',
      nodes: [{ id: 'start', text: 'x', choices: [{ id: 'c', text: 'x', next: 'nope' }] }],
    };
    expect(storyQuizModule.validateConfig(bad).ok).toBe(false);
  });

  it('拒绝无出口节点', () => {
    const bad: StoryQuizConfig = {
      labels: { score: '人气' },
      attributes: [],
      startNodeId: 'start',
      nodes: [{ id: 'start', text: 'x', choices: [] }],
    };
    expect(storyQuizModule.validateConfig(bad).ok).toBe(false);
  });

  it('真实样例：相同操作 → 相同结果', () => {
    const run = () => {
      const rt = createGame(dragonKingBundle, { seed: 9 });
      choose(rt, 'c_soup');
      choose(rt, 'c_joke');
      choose(rt, 'c_dance');
      choose(rt, 'c_hotline');
      choose(rt, 'c_success');
      return JSON.stringify(rt.state);
    };
    expect(run()).toBe(run());
  });
});
