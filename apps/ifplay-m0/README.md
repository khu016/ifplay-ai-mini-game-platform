# IfPlay M0/M1 试玩

IfPlay AI 小游戏生成平台的技术验证项目：证明「统一运行时 + 白名单玩法模块 + `GameBundle` 配置」能承载四种明显不同的玩法，且题材内容只存在于配置中、引擎不感知题材。

## 技术栈

- TypeScript（strict）+ Vite + React 18（仅 UI 壳）
- 核心运行时与玩法模块为纯 TypeScript，零框架、零 DOM
- Zod 4（`z.config({ jitless: true })`）校验 `GameBundle`，**禁止 `eval` / `Function` / `new Function` / `z.compile()`**
- `@dnd-kit/core`（仅拖拽输入交互；合成规则/得分/结局在模块纯逻辑中）
- Vitest（单元 / 模块测试）+ Playwright（浏览器冒烟，含手机竖屏视口）+ ESLint

## 目录结构

```
src/
├── core/        # 统一运行时：RNG / 存读档 / 事件总线 / 白名单条件效果 / 场景 / 输入 / 运行时组装
├── modules/     # 玩法模块契约 + 注册表 + business / timing / drag-merge / story-quiz
├── bundles/     # 四款手写 GameBundle 样例（题材只在这里）
└── ui/          # React 壳（选择页 / 可玩页 / ViewModel → DOM / dnd-kit 拖拽区）
tests/
├── unit/        # rng / save / schema / effects / themescan / compat
├── modules/     # business / timing / drag-merge / story-quiz
└── smoke/       # Playwright 浏览器冒烟
```

## 四款样例（四种主玩法）

| 游戏 | 玩法模块 |
| --- | --- |
| 我在三线城市给外星人修手机 | 经营模拟 `business` |
| 在公司厕所偷偷修仙 | 点击时机 `timing` |
| 把老板画的饼拖进微波炉炼成年终奖 | 拖拽合成 `drag-merge` |
| 凌晨三点在业主群竞选小区龙王 | 剧情问答 `story-quiz` |

新增游戏只需在 `src/bundles/` 增加一个配置并登记，引擎零改动。

## 启动

```bash
npm install
npm run dev        # http://localhost:5173
```

## 验证

```bash
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # Vitest 单元 + 模块测试（47 个用例）
npm run build      # 生产构建
npm run test:e2e   # Playwright 浏览器冒烟（首次需 npx playwright install chromium chromium-headless-shell）
```

## 架构要点

- `GameBundle`（runtimeVersion `0.2`/`0.3`）：`manifest / experience / scenes / primaryModule / auxiliaryModules / entities / rules / progression / uiLayout / assets / saveSchema / testPlan`，用 Zod 校验结构、引用与范围。
- 核心运行时：seedable RNG（mulberry32）、`localStorage` 存读档 + 版本校验、事件总线、白名单条件 / 效果执行器、场景路由、输入归一化、素材降级、ViewModel。
- 玩法模块契约：`id + version / validateConfig / validateBundle? / createInitialState / reduce / tick? / serialize / deserialize / view`。
- 安全边界：不执行任意代码；引擎与模块源码无任何样例题材字样（由 `tests/unit/themescan.test.ts` 守护）。
