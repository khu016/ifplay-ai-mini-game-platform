import { z } from '@/core/zod';

export const dragItemSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
});

export const dragSlotSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  accepts: z.array(z.string().min(1).max(64)).max(100).optional(),
});

export const dragRecipeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  inputs: z.record(z.string().min(1).max(64), z.string().min(1).max(64)),
  // 合成产物（可回流库存，形成多级合成链）；旧版配方可省略（仅计分，不回流）
  output: z
    .object({ itemId: z.string().min(1).max(64), count: z.number().int().min(1).max(100) })
    .optional(),
  score: z.number(),
  resultName: z.string().max(200).optional(),
  flag: z.string().max(64).optional(),
  hint: z.string().max(500).optional(),
});

export const supplyPoolItemSchema = z.object({
  itemId: z.string().min(1).max(64),
  weight: z.number().min(0),
});

export const supplySchema = z.object({
  pool: z.array(supplyPoolItemSchema).min(1).max(200),
  initialDraw: z.number().int().min(0).max(1000),
  restockEvery: z.number().int().min(1).max(1000),
  restockCount: z.number().int().min(1).max(100),
});

export const dragOrderSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  targetItemId: z.string().min(1).max(64),
  deadlineStep: z.number().int().min(1),
  reward: z.number().min(0),
});

export const dragGoalSchema = z.object({
  type: z.enum(['ordersFulfilled', 'score']),
  value: z.number().positive(),
});

export const dragMergeConfigSchema = z.object({
  labels: z.object({
    score: z.string().max(64),
    steps: z.string().max(64),
    combo: z.string().max(64),
    orders: z.string().max(64).optional(),
    discovered: z.string().max(64).optional(),
  }),
  maxSteps: z.number().int().min(1),
  targetScore: z.number().positive().optional(), // 旧版兼容：分数目标
  wrongPenalty: z.number().min(0),
  comboMultiplier: z.number().min(0),
  items: z.array(dragItemSchema).min(1).max(100),
  slots: z.array(dragSlotSchema).min(1).max(20),
  initialItems: z.record(z.string(), z.number().int().min(0)).optional(),
  recipes: z.array(dragRecipeSchema).min(1).max(200),
  supply: supplySchema.optional(),
  orders: z.array(dragOrderSchema).max(50).optional(),
  goal: dragGoalSchema.optional(),
});

export type DragMergeConfig = z.infer<typeof dragMergeConfigSchema>;
