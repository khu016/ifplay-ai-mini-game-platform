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
  score: z.number(),
  resultName: z.string().max(200),
  flag: z.string().max(64).optional(),
});

export const dragMergeConfigSchema = z.object({
  labels: z.object({
    score: z.string().max(64),
    steps: z.string().max(64),
    combo: z.string().max(64),
  }),
  maxSteps: z.number().int().min(1),
  targetScore: z.number().positive(),
  wrongPenalty: z.number().min(0),
  comboMultiplier: z.number().min(0),
  items: z.array(dragItemSchema).min(1).max(100),
  slots: z.array(dragSlotSchema).min(1).max(20),
  initialItems: z.record(z.string(), z.number().int().min(0)),
  recipes: z.array(dragRecipeSchema).min(1).max(200),
});

export type DragMergeConfig = z.infer<typeof dragMergeConfigSchema>;
