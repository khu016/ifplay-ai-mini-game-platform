import { z } from '@/core/zod';

export const timingStageSchema = z.object({
  cycleMs: z.number().positive(),
  windowWidth: z.number().min(0.01).max(1),
  jitter: z.number().min(0).max(0.5),
  targetSpirit: z.number().positive(),
});

export const timingSkillSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(500).optional(),
  stageIndex: z.number().int().min(0).max(20),
  effect: z.object({
    type: z.enum(['clearExposure', 'addSpirit', 'healBreath']),
    amount: z.number(),
  }),
});

export const timingConfigSchema = z.object({
  labels: z.object({
    spirit: z.string().max(64),
    breath: z.string().max(64),
    exposure: z.string().max(64),
    combo: z.string().max(64),
    stage: z.string().max(64).optional(),
    rating: z.string().max(64).optional(),
  }),
  cycleMs: z.number().positive(),
  windowCenter: z.number().min(0).max(1),
  windowWidth: z.number().min(0.01).max(1),
  jitter: z.number().min(0).max(0.5),
  tiers: z.object({ perfect: z.number().min(0).max(1), good: z.number().min(0).max(1) }),
  spirit: z.object({ start: z.number().min(0), target: z.number().positive() }),
  exposure: z.object({ start: z.number().min(0), max: z.number().positive() }),
  breath: z.object({ start: z.number().min(0), max: z.number().positive() }),
  successGain: z.object({ perfect: z.number().min(0), good: z.number().min(0), normal: z.number().min(0) }),
  missPenalty: z.number().min(0),
  comboMultiplier: z.number().min(0),
  hold: z.object({ slowFactor: z.number().min(0.1).max(1), breathDrainPerMs: z.number().min(0) }),
  breathRecoveryPerMs: z.number().min(0),
  tapHint: z.string().max(200),
  // —— 新增（可选，缺省回退单阶段旧行为）——
  stages: z.array(timingStageSchema).min(1).max(10).optional(),
  holdGainPerMs: z.number().min(0).optional(),
  exposureRecoverPerMs: z.number().min(0).optional(),
  skills: z.array(timingSkillSchema).max(20).optional(),
  rating: z.object({ s: z.number(), a: z.number(), b: z.number(), c: z.number() }).optional(),
  failHintExposure: z.string().max(500).optional(),
  failHintBreath: z.string().max(500).optional(),
});

export type TimingConfig = z.infer<typeof timingConfigSchema>;
