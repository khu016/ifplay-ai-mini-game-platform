import { z } from '@/core/zod';

export const timingConfigSchema = z.object({
  labels: z.object({
    spirit: z.string().max(64),
    breath: z.string().max(64),
    exposure: z.string().max(64),
    combo: z.string().max(64),
  }),
  cycleMs: z.number().positive(),
  windowCenter: z.number().min(0).max(1),
  windowWidth: z.number().min(0.01).max(1),
  jitter: z.number().min(0).max(0.5),
  tiers: z.object({
    perfect: z.number().min(0).max(1),
    good: z.number().min(0).max(1),
  }),
  spirit: z.object({ start: z.number().min(0), target: z.number().positive() }),
  exposure: z.object({ start: z.number().min(0), max: z.number().positive() }),
  breath: z.object({ start: z.number().min(0), max: z.number().positive() }),
  successGain: z.object({
    perfect: z.number().min(0),
    good: z.number().min(0),
    normal: z.number().min(0),
  }),
  missPenalty: z.number().min(0),
  comboMultiplier: z.number().min(0),
  hold: z.object({
    slowFactor: z.number().min(0.1).max(1),
    breathDrainPerMs: z.number().min(0),
  }),
  breathRecoveryPerMs: z.number().min(0),
  tapHint: z.string().max(200),
});

export type TimingConfig = z.infer<typeof timingConfigSchema>;
