# 阶段一 · OpenGame 结构与安全核查报告

- 时间：2026-10-02
- 核查对象：`https://github.com/leigest519/OpenGame`（"OpenGame: Open Agentic Coding for Games"）
- 候选 SHA：`c9bea37786af524bf3bbe802f2b67d23816fa5c0`（已确认 = 远端 `main` HEAD，2026-09-03）
- 本地缓存（外部，不入 IfPlay 仓库）：`/Users/a123/Documents/Codex/2026-09-15/ifplay-opengame-poc/opengame@c9bea377/`

## 核查结果

| 项 | 结果 |
| --- | --- |
| 许可证 | ✅ Apache-2.0（LICENSE 文件确认） |
| 版本 / 上游 | 0.6.0；基于 qwen-code 的 fork（`.env.example` 自述 "upstream qwen-code"） |
| 结构 | ✅ `packages/cli` `core` `sdk-typescript` `test-utils`；另有 `docs/` `Dockerfile` `Makefile` `integration-tests/` `agent-test/` |
| 执行入口 | ✅ `packages/cli` bin `opengame` → `dist/index.js`（React/Ink TUI，esbuild 构建） |
| `.env.example` | ✅ 存在，**明确声明"不内置任何默认凭据，不配置 Key 不产生任何第三方调用"** |
| Key 文档 | ✅ `docs/users/configuration/api-keys.md` 存在，四种模态 + 三种 provider 家族 |

## Key 分辨率顺序（摘自 .env.example）

1. `OPENGAME_<MODALITY>_*` 环境变量（最高优先）
2. `~/.qwen/settings.json` → `openGame.providers.<modality>.*`
3. 遗留上游变量（`DASHSCOPE_API_KEY` 等，向后兼容）

四种模态：`reasoning`（非平凡游戏必需）、`image`（资产生成必需）、`video`（可选）、`audio`（可选）；主 agent LLM 走 qwen-code 的 `OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL` 或交互 `/auth`。
Provider 家族：`tongyi`（DashScope）、`doubao`（Volcengine ARK）、`openai-compat`。

## 依赖核查

- lockfile 共 **1307** 个 package 节点。
- 核心依赖（`packages/core`）：`@anthropic-ai/sdk`、`@google/genai`、`openai`、`@modelcontextprotocol/sdk`、`simple-git`、`undici`、`ws`、`tiktoken`、`@imgly/background-removal-node`、`@xterm/headless` 等——符合 agentic coding 工具的网络/文件操作预期。
- **注意**：依赖 OpenTelemetry 全家桶（含 OTLP gRPC/HTTP 导出器）。若启用遥测会外发网络；运行时应禁用遥测，或依赖沙箱断网兜底。
- CLI 含 `--yolo`（qwen-code 自动批准模式，`ApprovalModeDialog.tsx`），**运行必须禁用 yolo**。

## 安全

- `SECURITY.md` 存在（标准漏洞披露流程）。
- 无内置默认密钥、无明显的恶意代码迹象（本轮为静态核查，未做动态/供应链扫描）。

## 遥测与数据上报（关闭方式已核实）

代码级核查结论（`packages/core/src/config/config.ts`、`telemetry/*`）：

| 机制 | 默认 | 关闭方式 |
| --- | --- | --- |
| 遥测（OpenTelemetry SDK，OTLP） | **关闭**（`telemetrySettings.enabled ?? false`） | 勿传 `--telemetry`；设 `OTEL_SDK_DISABLED=true`、`GEMINI_TELEMETRY_ENABLED=false` |
| 用量统计（QwenLogger → 阿里云 RUM `gb4w8c3ygj-default-sea.rum.aliyuncs.com`） | **开启**（`privacy.usageStatisticsEnabled ?? true`） | settings 设 `privacy.usageStatisticsEnabled=false` |
| 自动批准 YOLO 模式 | 非默认 | **禁止 `--yolo` / `GEMINI_CLI_APPROVAL_MODE=yolo`** 及任何跳过安全检查参数 |

硬兜底：构建/试玩阶段容器 `--network none`；生成阶段 egress 白名单只放行模型端点，不放行 RUM 上报域名。

## 锁定结论

〔**已更新 2026-10-03 下午：`shaLocked=true` 已生效**。下述"不锁定"为当日上午静态核查快照；当日内本体 `npm ci → npm rebuild sharp → build → typecheck` 与 glibc 离线 CLI 冒烟已在容器+最小 egress 白名单下全部实测通过，证据见 `阶段一-本体构建验证报告.md`、`阶段一-基础镜像核验记录.md`。〕

**（当时结论）不锁定（`shaLocked=false`）。** 结构、许可证、无默认 Key、依赖四项静态核查通过，但**完整 `npm install + build`（1307 依赖）与动态运行检查未做**，证据不充分，保持候选值。

尚未验证（列为你确认项）：
- ~~OpenGame 本体完整 `npm install + build`~~ 〔已完成：lockfile 1296 个外部 resolved 全部指向 registry.npmjs.org，登记该域后容器内执行通过；sharp 预编译另需 GitHub Releases 资源域，亦登记后通过〕
- ~~OpenGame 动态运行冒烟~~ 〔已完成：`--version`=0.6.0、`--help` 在 `--network none` 只读容器内 rc=0〕
