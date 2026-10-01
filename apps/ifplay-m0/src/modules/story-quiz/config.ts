import { z } from '@/core/zod';
import type { ValidationResult } from '@/core/schema';

export const storyEffectSchema = z.object({
  type: z.enum(['addAttribute', 'addScore', 'setFlag', 'addFlag']),
  attribute: z.string().max(64).optional(),
  amount: z.number().optional(),
  flag: z.string().max(64).optional(),
  value: z.unknown().optional(),
});

export const storyConditionSchema = z.object({
  type: z.enum(['always', 'attributeReached', 'attributeBelow', 'flagIs']),
  attribute: z.string().max(64).optional(),
  value: z.unknown().optional(),
  flag: z.string().max(64).optional(),
});

export const storyChoiceSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(500),
  effects: z.array(storyEffectSchema).max(20).optional(),
  next: z.string().min(1).max(64).optional(),
  ending: z.string().min(1).max(64).optional(),
  condition: storyConditionSchema.optional(),
  once: z.boolean().optional(),
});

export const storyNodeSchema = z.object({
  id: z.string().min(1).max(64),
  text: z.string().min(1).max(2000),
  speaker: z.string().max(200).optional(),
  choices: z.array(storyChoiceSchema).max(20),
  ending: z.string().min(1).max(64).optional(),
});

export const storyQuizConfigSchema = z.object({
  labels: z.object({ score: z.string().max(64) }),
  attributes: z
    .array(z.object({ id: z.string().min(1).max(64), name: z.string().max(200) }))
    .max(50),
  startNodeId: z.string().min(1).max(64),
  nodes: z.array(storyNodeSchema).min(1).max(500),
});

export type StoryQuizConfig = z.infer<typeof storyQuizConfigSchema>;
export type StoryCondition = z.infer<typeof storyConditionSchema>;

// 图校验：悬空 next 引用、无出口节点、不可达节点、无法到达结局的节点（防无限循环）。
export function validateStoryGraph(config: StoryQuizConfig): ValidationResult {
  const nodeIds = new Set(config.nodes.map((n) => n.id));
  const nodeById = new Map(config.nodes.map((n) => [n.id, n]));
  const errors: Array<{ path: string; message: string }> = [];

  if (!nodeIds.has(config.startNodeId)) {
    return { ok: false, errors: [{ path: 'startNodeId', message: `起始节点不存在: ${config.startNodeId}` }] };
  }

  for (const n of config.nodes) {
    if (n.ending) {
      if (n.choices.length > 0) {
        errors.push({ path: `nodes.${n.id}`, message: '带结局的节点不应再有选项' });
      }
    } else if (n.choices.length === 0) {
      errors.push({ path: `nodes.${n.id}`, message: '无出口节点：没有选项也没有结局' });
    }
    for (const c of n.choices) {
      if (c.next && !nodeIds.has(c.next)) {
        errors.push({ path: `nodes.${n.id}.choices.${c.id}.next`, message: `悬空引用: ${c.next}` });
      }
      if (!c.next && !c.ending) {
        errors.push({ path: `nodes.${n.id}.choices.${c.id}`, message: '选项既无 next 也无 ending' });
      }
    }
  }

  const reachable = new Set<string>();
  const stack = [config.startNodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = nodeById.get(id);
    if (!node) continue;
    for (const c of node.choices) {
      if (c.next) stack.push(c.next);
    }
  }
  for (const id of nodeIds) {
    if (!reachable.has(id)) errors.push({ path: `nodes.${id}`, message: '不可达节点' });
  }

  const canReachEnding = (startId: string): boolean => {
    const seen = new Set<string>();
    const s = [startId];
    while (s.length > 0) {
      const id = s.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = nodeById.get(id);
      if (!node) continue;
      if (node.ending) return true;
      for (const c of node.choices) {
        if (c.ending) return true;
        if (c.next) s.push(c.next);
      }
    }
    return false;
  };
  for (const id of nodeIds) {
    if (!canReachEnding(id)) {
      errors.push({ path: `nodes.${id}`, message: '无法到达任何结局（可能形成无出口循环）' });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}
