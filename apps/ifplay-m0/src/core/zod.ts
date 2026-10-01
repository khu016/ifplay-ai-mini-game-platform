import { z } from 'zod';

// 强制关闭 Zod 的 JIT 编译路径（JIT 内部依赖 new Function）。
// 本工程安全边界：禁止 eval / Function / new Function / z.compile()。
z.config({ jitless: true });

export { z };
