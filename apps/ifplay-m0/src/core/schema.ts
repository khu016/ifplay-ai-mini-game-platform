import { z } from '@/core/zod';

export const moduleIdSchema = z.enum(['business', 'timing', 'drag-merge', 'story-quiz']);
export type ModuleId = z.infer<typeof moduleIdSchema>;

export const manifestSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
  author: z.string().max(64),
  language: z.literal('zh-CN'),
  runtimeVersion: z.enum(['0.2', '0.3']),
});

export const experienceSchema = z.object({
  playerRole: z.string().min(1).max(200),
  goal: z.string().min(1).max(500),
  estimatedMinutes: z.number().int().min(1).max(120),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  intro: z.array(z.string().max(500)).max(20),
});

export const sceneSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(['menu', 'play', 'result']),
  layoutId: z.string().min(1).max(64),
});

export const primaryModuleSchema = z.object({
  id: moduleIdSchema,
  version: z.string().min(1).max(32),
  // 各模块配置结构不同，由对应模块的 validateConfig 校验
  config: z.unknown(),
});

export const auxiliaryModuleSchema = z.object({
  id: z.string().min(1).max(64),
  version: z.string().min(1).max(32),
  config: z.record(z.string(), z.unknown()),
});

export const entitySchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.string().min(1).max(32),
    name: z.string().max(200),
    desc: z.string().max(1000).optional(),
  })
  .passthrough();

export const conditionSchema = z.object({
  type: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const effectSchema = z.object({
  type: z.string().min(1).max(64),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const ruleSchema = z.object({
  id: z.string().min(1).max(64),
  when: conditionSchema,
  then: z.array(effectSchema).min(1).max(50),
});

export const taskSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(1000).optional(),
});

export const upgradeSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(1000).optional(),
  cost: z.number().min(0),
});

export const endingSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  desc: z.string().max(1000),
  // story-quiz 由叙事触发结局，无需条件；business/timing/drag-merge 提供通用条件
  condition: conditionSchema.optional(),
});

export const progressionSchema = z.object({
  tasks: z.array(taskSchema).max(50),
  upgrades: z.array(upgradeSchema).max(50),
  endings: z.array(endingSchema).min(2).max(50),
});

export const uiLayoutSchema = z.object({
  theme: z.record(z.string(), z.string()),
  playLayout: z.string().min(1).max(64),
});

export const assetsSchema = z.object({
  placeholder: z.string().max(200),
  icons: z.record(z.string(), z.string()).optional(),
});

export const saveSchemaSchema = z.object({
  version: z.number().int().positive(),
  keys: z.array(z.string().min(1).max(64)).min(1).max(100),
});

export const testPlanSchema = z.object({
  cases: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        type: z.enum(['business', 'timing', 'general']),
        steps: z.array(z.string().max(1000)).max(50),
        expect: z.string().max(1000),
      }),
    )
    .max(100),
});

export const gameBundleSchema = z.object({
  manifest: manifestSchema,
  experience: experienceSchema,
  scenes: z.array(sceneSchema).min(1).max(50),
  primaryModule: primaryModuleSchema,
  auxiliaryModules: z.array(auxiliaryModuleSchema).max(2),
  entities: z.array(entitySchema).max(1000),
  rules: z.array(ruleSchema).max(500),
  progression: progressionSchema,
  uiLayout: uiLayoutSchema,
  assets: assetsSchema,
  saveSchema: saveSchemaSchema,
  testPlan: testPlanSchema,
});

export type GameBundle = z.infer<typeof gameBundleSchema>;

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: Array<{ path: string; message: string }> };

export function validateBundle(input: unknown): ValidationResult {
  const r = gameBundleSchema.safeParse(input);
  if (r.success) return { ok: true };
  return {
    ok: false,
    errors: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  };
}
