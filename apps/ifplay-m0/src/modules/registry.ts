import type { GameplayModule } from '@/modules/contract';
import type { ModuleId } from '@/core/schema';
import { businessModule } from '@/modules/business';
import { timingModule } from '@/modules/timing';
import { dragMergeModule } from '@/modules/drag-merge';
import { storyQuizModule } from '@/modules/story-quiz';

// 白名单玩法模块注册表。新增玩法模块只需在此登记，无需改动核心运行时。
export const moduleRegistry: Record<ModuleId, GameplayModule<any, any>> = {
  business: businessModule,
  timing: timingModule,
  'drag-merge': dragMergeModule,
  'story-quiz': storyQuizModule,
};
