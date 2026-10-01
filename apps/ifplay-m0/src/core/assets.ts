import type { GameBundle } from '@/core/schema';

// 素材降级：图标缺失时回退到占位符，保证游戏不因素材阻塞。
export function resolveIcon(bundle: GameBundle, key: string): string {
  return bundle.assets.icons?.[key] ?? bundle.assets.placeholder;
}
