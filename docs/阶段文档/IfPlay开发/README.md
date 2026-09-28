# IfPlay AI 模拟器游戏平台

这是 IfPlay Agent 的独立项目目录。所有本项目代码、PRD、阶段文档、证据、依赖与本地配置都以本目录为基准，不以外层工具包根目录为基准。

**当前阶段：阶段 2 后端 MVP · 第一子阶段 = M0 规则引擎验证，已实现并自测通过，待产品经理验收。**

## 启动与验证方法（M0）

```bash
cd docs/阶段文档/IfPlay开发/game/
npm install          # 已装（typescript / vite / vitest / happy-dom）
npm run dev          # 开发服务器 → 打开 http://localhost:5173/
npm test             # 运行全部测试（52 项）
npm run typecheck    # 类型检查
npm run build        # 生产构建（产物在 game/dist/）
npm run preview      # 预览构建产物 → http://localhost:4173/
```

试玩步骤：打开首页 → 点任意游戏卡的「开始游戏」→ 选选项推进 → 可用「存档/读档」（localStorage，按游戏隔离）。

## 阅读入口
- [PRD 原文](docs/PRD/PRD-IfPlay-AI模拟器游戏平台-MVP.md)：产品需求 v1.1（2026-09-28）。
- [项目状态](docs/项目状态.md)：已定需求、决策台账与进度。
- [PRD 体检记录](docs/阶段文档/PRD补全清单.md)：阶段 0 的补全清单。
- [技术适配声明](docs/阶段文档/第一阶段技术适配声明.md)：阶段 1 的技术选型与取舍。
- [第一阶段技术开发文档](docs/阶段文档/第一阶段技术开发文档.md)：M0 规则引擎验证（当前开发依据）。

## 产品一句话
面向不会编程的大众和内容创作者，让用户用中文描述任意题材，经 AI 追问和方案确认后，生成一款可在手机及电脑浏览器中直接游玩的轻量 2D 模拟器，并支持修改、发布、分享和"做同款"。

## 目录约定
```text
IfPlay开发/
├── README.md
├── AGENTS.md                 # IfPlay 项目专属约束
├── .gitignore
├── .env.example              # 不含真实密钥的配置模板（阶段 1 后细化）
├── docs/
│   ├── PRD/                  # 产品需求原文
│   ├── 阶段文档/             # 体检清单、技术适配声明、阶段开发文档
│   ├── evidence/             # 各阶段证据包
│   └── 项目状态.md
└── game/                    # M0 纯 TypeScript 单包（引擎 + 校验 + 模拟 + 试玩页 + 测试）
    ├── src/schema/          # GameSpec v0.1 类型 + JSON Schema
    ├── src/validate/        # 校验器（结构/引用完整性/数值边界）
    ├── src/engine/          # 规则引擎 + seedable PRNG + 存档
    ├── src/simulate/        # 自动路径模拟 + 结局可达性
    ├── src/ui/              # 最简试玩页
    ├── src/samples/         # 3 个手写 GameSpec JSON
    └── tests/               # Vitest 单测 + UI 冒烟
```

## 配置边界
- 本项目 `.env` 只属于 IfPlay Agent，不与其他 Agent 共享，不从外层工具包 `.env` 隐式读取。
- 当前没有实际 `.env`，只有 `.env.example` 模板；不能声称已保存任何 API Key。
- 本项目沿用外层 Git 仓库，未初始化嵌套 Git 仓库。
