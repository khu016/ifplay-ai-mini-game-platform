// 从运行时权威 Zod schema 导出共享 GameBundle 契约（JSON Schema），供 Python 后端校验。
// 运行：npm run export:contract （或 npx vite-node scripts/export-contract.ts）
// 产出：contract/gamebundle-contract.json
import { z } from '@/core/zod';
import { gameBundleSchema } from '@/core/schema';
import { businessConfigSchema } from '@/modules/business/config';
import { timingConfigSchema } from '@/modules/timing/config';
import { dragMergeConfigSchema } from '@/modules/drag-merge/config';
import { storyQuizConfigSchema } from '@/modules/story-quiz/config';
import { businessModule } from '@/modules/business';
import { timingModule } from '@/modules/timing';
import { dragMergeModule } from '@/modules/drag-merge';
import { storyQuizModule } from '@/modules/story-quiz';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const modules = [
  { mod: businessModule, schema: businessConfigSchema },
  { mod: timingModule, schema: timingConfigSchema },
  { mod: dragMergeModule, schema: dragMergeConfigSchema },
  { mod: storyQuizModule, schema: storyQuizConfigSchema },
];

const moduleContracts: Record<string, { version: string; configSchema: unknown }> = {};
for (const { mod, schema } of modules) {
  moduleContracts[mod.id] = { version: mod.version, configSchema: z.toJSONSchema(schema) };
}

const contract = {
  contractVersion: '1.0.0',
  generatedFrom: 'apps/ifplay-m0 运行时权威 Zod schema',
  runtimeVersions: ['0.2', '0.3'],
  moduleIds: modules.map((m) => m.mod.id),
  modules: moduleContracts,
  bundleSchema: z.toJSONSchema(gameBundleSchema),
};

const outDir = join(__dirname, '..', 'contract');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, 'gamebundle-contract.json');
writeFileSync(outFile, JSON.stringify(contract, null, 2));
console.log(`[export-contract] 契约已导出：${outFile}`);
