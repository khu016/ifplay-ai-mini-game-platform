import type { GameBundle, ModuleId } from '@/core/schema';
import { alienRepairBundle } from './alien-repair';
import { toiletImmortalBundle } from './toilet-immortal';
import { bossPieBundle } from './boss-pie';
import { dragonKingBundle } from './dragon-king';

export interface BundleEntry {
  bundle: GameBundle;
}

export const MODULE_LABELS: Record<ModuleId, string> = {
  business: '经营模拟',
  timing: '点击时机',
  'drag-merge': '拖拽合成',
  'story-quiz': '剧情问答',
};

// 样例注册表：新增游戏只需在此登记一个 bundle，引擎零改动。
export const bundles: BundleEntry[] = [
  { bundle: alienRepairBundle },
  { bundle: toiletImmortalBundle },
  { bundle: bossPieBundle },
  { bundle: dragonKingBundle },
];
