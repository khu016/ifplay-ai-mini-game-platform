# OpenGame 第二轨 PoC · 阶段一（零费用验证）+ 阶段二（DeepSeek 接入准备）

> 分支：`spike/opengame-poc`（从远端 `dev/ifplay-m0@8d97218` 干净分叉，不含 NIVI 提交）
> 状态：阶段一**已完成收尾**（2026-10-03）；阶段二**只完成 DeepSeek 接入的代码骨架与零费用测试**（2026-10-03）。**未提交、未推送、未建 PR**。
> 阶段三（最小真实冒烟）：**2026-10-05 第 3 次尝试成功**——真实 OpenGame Agent 经隔离容器 + TLS 验证转发器 + egress 白名单调用真实 DeepSeek，2 次转发均 200，写出字节完全等于 `IFPLAY_DEEPSEEK_SMOKE_OK` 的 `SMOKE.txt`；我方账本 **0.012421 元**（保守汇率 7.5，`SMOKE_RUN_DONE cost_cny=0.0124`），**DeepSeek 控制台账单待产品经理核对**（未触 0.08 预警、未触 0.10 硬停，0 次重试，无图片无修复）。证据在 `generated/smoke-run/`，报告 `reports/阶段二-DeepSeek最小真实冒烟成功报告.md`。此前两次失败记录保留（`reports/阶段二-DeepSeek最小真实冒烟报告.md`：bash 3.2 UTF-8 变量扩展、Docker 容器名 DNS 拓扑，均为零条请求发出）。**仍待验证**：具体模型版本、长会话多轮工具链、真实游戏代码生成——"冒烟通过"不等于"第二轨可用"。
> 隔离：最小容器（Colima/Docker）已安装并验证通过；egress 白名单代理已容器内实测（构建面 7/7、模型/图片面 11/11）；**OpenGame 本体构建+离线动态冒烟全绿，`shaLocked=true`（SHA `c9bea377…`，基础镜像按 digest 固定）**。
> 未开始：五款真实生成（首款「深夜食堂经营」）。**DeepSeek 真实接口兼容性已在 2026-10-05 的最小冒烟上首次真实验证通过**（`thinking.type=disabled` + `max_tokens=512` + `stream_options.include_usage` 被接受并回传 usage/model），但这只覆盖 1 个任务、2 个轮次，长会话与真实游戏代码生成仍未验证。五款真实游戏需要**新的、单独的费用授权**（每款 3.0 元的预算块与冒烟的 0.10 元块不可混用）。M2 后端由另一独立工作树开发，不属本 PoC。

本目录验证 IfPlay「第二轨」：白名单玩法模块覆盖不了的新玩法，走**隔离的代码生成→构建→测试→审核**流程是否可行（以 OpenGame 的 agentic 代码生成为代表）。

## 目录

```
spikes/opengame-poc/
├── config/opengame.json        # OpenGame SHA(已锁定)/预算/分档单价/汇率/修复轮/遥测关闭/风险台账
├── config/providers.json       # 供应商决定(DeepSeek 官方 OpenAI 兼容 + 万相)/双重付费闸门/Key 环境变量名/预算规则
├── config/opengame.settings.template.json # OpenGame settings 模板(无 apiKey；关遥测；Key 名进 excludedEnvVars)
├── config/egress-allowlist.json # egress 白名单（按用途分组：model/image/packageRegistry/buildBinaries；默认 deny）
├── config/egress-allowlist.none.json # 空白名单样本（验证默认全拒绝的安全失败）
├── config/isolation.sb          # sandbox-exec profile（已暂停，仅证据留存）
├── .env.example                # 环境变量样例（只有占位，无任何真实 Key；本地 .env 已 gitignore）
├── prompts/                    # 五款游戏的固定生成 prompt
├── runner/                     # 见下方「第二阶段新增脚本」+ 阶段一的编排/计量/隔离/egress
├── evaluators/                 # 确定性验收器（构建关 + 浏览器渲染/玩法关）
├── fixtures/                   # 五款游戏验收断言 + 评估器自测静态页
├── reports/                    # 阶段一/阶段二结论与空跑演练 JSON
└── generated/                  # 生成产物与账本状态（gitignore，不入库）
```

OpenGame 本体在**外部缓存**：`/Users/a123/Documents/Codex/2026-09-15/ifplay-opengame-poc/opengame@c9bea377/`（按 SHA 引用，不复制进 IfPlay 仓库）。

## 第一阶段范围（已完成）

1. 隔离能力探针（sandbox-exec 证据：仅证明其不足以隔离，结论改为容器）。
2. 管线骨架（config/prompts/runner/evaluators/fixtures/reports）。
3. 配置、预算（3 元/款，含安全余量）与修复轮次（最多 2 轮，确定性计数在 runner）。
4. 五款游戏的固定提示词与验收标准。
5. 确定性构建（真实依赖安装+正式构建+退出码+日志摘要）与浏览器验收器（本地静态服务器 + 外网请求直接阻断）。
6. 零费用管线演练（无 key、无真实生成，generation 为 stub）。

**不调用任何付费 API，不配置/读取其他项目 Key，不进行五款真实模型生成。**
**不使用 mock 结果冒充真实生成成功**——阶段一只验收管线与隔离能力，不代表"接入成功"。

## 五款游戏（真实生成尚未开始）

| 游戏 | 核心玩法验收 |
| --- | --- |
| 深夜食堂经营 | 完成 ≥3 个经营回合（接待/上菜/结算），有可读金钱/满意度变化 |
| 点击打铁 | 连点驱动锻造进度，完成 ≥1 次锻造并结算 |
| 酒店经营 | 完成 ≥3 个经营回合（入住/退房/收益），有资源数值变化 |
| 旋转闯关 | 通过 ≥1 关（到达过关/结算态），旋转交互生效 |
| 随机事件人生 | 触发 ≥3 个事件选择，达成 ≥1 个结局 |

通用要求：390×844 竖屏可渲染、核心交互可用、无致命报错、无未授权外网请求。

## 运行（阶段一：零费用验证）

```bash
cd spikes/opengame-poc
npm install                     # 仅安装 playwright（浏览器已缓存，无网络下载）
npm run dry-run                 # 零费用空跑：生成(stub)→构建→浏览器测试→报告→费用中止演示
```

容器隔离验证（需先 `colima start`；参数必须是**绝对路径**，否则 Docker 会把它当成非法卷名，2026-10-04 实测）：
```bash
bash runner/verify-container-isolation.sh "$PWD/fixtures/selftest"
```

OpenGame 本体重复审核（需先 `colima start`；digest 固定镜像、只读源码、egress 白名单唯一出口、离线冒烟，可重复运行）：
```bash
bash runner/verify-opengame-build.sh
```

## 第二阶段：DeepSeek 接入准备（代码骨架 + 零费用测试）

2026-10-03 确认的供应商安排：主 Agent、游戏方案、代码生成与自动修复走 **DeepSeek 官方 OpenAI 兼容接口**（base URL `https://api.deepseek.com`，模型名 `deepseek-flash`）；图片保留**阿里云万相**（优先兼容 `wan2.5-t2i-preview`）；视频与云端音频关闭；每款最多自动修复 2 轮、图片 1~3 张、总费用不超过 3 元。

接入结论（审计证据见 `reports/阶段二-DeepSeek接入准备报告.md`）：DeepSeek 可通过本 fork 的 `AuthType.USE_OPENAI` + `OPENAI_API_KEY/BASE_URL/MODEL` 纯配置接上（内置 `DeepSeekOpenAICompatibleProvider` 自动识别 `api.deepseek.com`，请求链路不校验模型白名单）。**但真实接口兼容性尚未验证**：跨顶层轮次的 `reasoning_content` 回传、DeepSeek 不接受非文本内容、settings 侧未暴露 `max_tokens`、CLI 只报请求模型名、万相路径无 usage 且 429/5xx 重发最多 3 次——全部登记在 `config/opengame.json` 的 `deepseekIntegrationRisks`，不得声称"已接通"。

> **2026-10-05 更新（上面这段是 2026-10-03 的阶段二结论，原样保留）**：最小冒烟已真实跑通，其中四项已关闭 —— `max_tokens=512` 由 settings 硬控并线上取证、响应**有** `model` 字段（回显滚动名 `deepseek-flash`，具体版本号仍拿不到）、`stream_options.include_usage` 生效并回传 usage、非思考模式下第 2 顶层轮次（含上一轮 `tool_calls`）**没有回传 `reasoning_content` 也被接受**（1 任务 / 2 轮的小样本，不能外推到长会话）。**仍未验证**：多轮真实代码生成、DeepSeek 不接受非文本内容、万相路径（本次授权不含图片，无 usage 与重发行为原样保留）。

runner 新增文件：

| 文件 | 作用 |
| --- | --- |
| `credentials.mjs` | 双重付费闸门（`ENABLE_PAID_API` + `COST_AUTHORIZED`）、Key 只判在不在不返回值、缺 Key/缺模型名/非 DeepSeek base URL 一律拒绝（不静默回退模型）、日志脱敏 |
| `pricing.mjs` | USD/1M × 显式汇率 → CNY/1k，输入/缓存输入/输出分档；定价或汇率未确认直接抛错（不按 0 元） |
| `budget.mjs` 的 `CostLedger` | 主 Agent / reasoning / 图片 / 自动修复四类进同一单款额度；`usage` 缺失即停、2.55 元预警、3.00 元硬停、调用前预估越线即拒发、状态落盘可恢复 |
| `egress-rules.mjs` | 白名单匹配器（代理与测试共用的唯一事实来源；IP 字面量一律拒绝） |
| `mock-deepseek.mjs` | 本地假 DeepSeek（127.0.0.1 随机端口）：产出真实形态 usage/SSE，并可制造"缺 usage / 缺模型名 / cached>input / 工具调用未回传 reasoning_content"等失败样本；`--tls-cert/--tls-key` 走 HTTPS（**必须 `https.createServer`，`tls.createServer` 交付裸 socket 会让 HTTP 客户端静默挂死**，2026-10-04 实测），`--host 0.0.0.0` 供容器内被别的名义访问 |
| `gated-call.mjs` | 真实调用的唯一入口骨架：闸门 → 凭据 → 白名单目标 → 账本预检查 → 调用 → 交账本记账（任何缺项都由账本中止） |
| `check-gates.mjs` | 四道闸门自检（付费闸门 / 凭据 / 定价与汇率 / 白名单一致性），不过就打印 `REFUSE` 并退出 3 |
| `ingest-usage.mjs` | 把 OpenGame CLI 的 `stream-json` usage 事件灌进同一账本；一条带 usage 的事件都没有 → 标为"费用无法确认"，不按 0 元 |
| `generate-game.sh` | 真实生成入口，**默认 dry-run 只打印计划命令**；`--execute` 当前直接拒绝（生成容器尚未接上验证转发器，见第三阶段说明） |
| `verify-model-egress.sh` | 零费用容器化验证模型/图片白名单（无凭据 HEAD，只证明连通与拒绝） |

零费用测试全部只用 mock / 本地假服务，不含任何带 Key 的模型请求：

```bash
cd spikes/opengame-poc
npm run test:deepseek    # DeepSeek 接入闸门自测（25 项，含 12 类必测场景）
node runner/budget.mjs  # 阶段一预算/修复轮自测（6 项）
npm run test:egress-proxy # egress 白名单代理本地自测（7 项，不访问公网）
npm run gates           # 四道闸门自检（默认应拒绝真实调用）
npm run dry-run         # 零费用空跑（含 DeepSeek 闸门步骤 + 付费闸门关闭断言）
npm run gen -- --game 深夜食堂经营   # dry-run 打印执行计划，不发任何调用
```

模型/图片白名单的容器实测（需 Colima，脚本会自启自停；仅无凭据连通与拒绝，零费用）：
```bash
bash runner/verify-model-egress.sh                                    # 阶段一/阶段二全量模型+图片白名单
EGRESS_MODE=smoke ALLOWLIST=egress-allowlist.smoke.json \
  bash runner/verify-model-egress.sh                                  # 冒烟白名单：只放行 api.deepseek.com:443
```

## 第三阶段：DeepSeek 最小真实冒烟（2026-10-05 第 3 次尝试已成功；后续付费调用需新的授权）

冒烟任务：让真实 CLI 驱动真实 DeepSeek 写出内容严格等于 `IFPLAY_DEEPSEEK_SMOKE_OK` 的 `SMOKE.txt`，仅此一个任务。硬上限 **0.10 元**（预警 0.08 元），不授权游戏生成、图片、自动修复，也不授权第二次付费尝试。预算与授权范围只写在 `config/providers.json` 的 `smoke` 块里（每款 3 元的游戏预算块保持不变，两者不可混用）。

**结果（2026-10-05 14:14，第 3 次尝试）**：成功。`SMOKE.txt` 24 字节逐字节匹配，2 次真实转发均 200，`thinking={"type":"disabled"}` + `max_tokens=512` 在最终请求体上取证成立，响应回传真实 usage 与 `model` 字段，前缀缓存生效；我方账本 **0.012421 元**（`SMOKE_RUN_DONE cost_cny=0.0124`），0 重试、无图片、无修复、未触预警与硬停；DeepSeek **控制台账单待产品经理核对**。15 项取证见 `reports/阶段二-DeepSeek最小真实冒烟成功报告.md`，前两次失败记录保留在 `reports/阶段二-DeepSeek最小真实冒烟报告.md`。

关键实测结论（决定了下面的架构）：
- `max_tokens=512`、`maxRetries=0`、`reasoning:false` 可由 `.qwen/settings.json` 注入最终请求；**`thinking` 无法靠配置注入**（`pipeline.ts` 白名单不含它，SDK 建流时只传 `signal`），必须由 `patches/0001-deepseek-disable-thinking.patch` 关闭，环境变量 `POC_DEEPSEEK_DISABLE_THINKING=1` 才生效。
- 该 fork 的 OpenAI 客户端从不接代理、Node 20 fetch 也不读 `HTTPS_PROXY`，所以 **CONNECT 代理约束不住 CLI 出口**；冒烟改用"补丁 CLI + `/etc/hosts` 固定 + TLS 终结验证转发器 + 白名单代理唯一出口"的拓扑，转发器逐条校验请求形状并采集真实 usage。这是有意披露的本地取证中间人，证书只在 gitignore 的 `generated/smoke-tls/`。
- **容器名只在共享同一 Docker 网络的容器之间可解析**（内嵌 DNS 规则，2026-10-04 真实冒烟第二轮因此失败：转发器对代理容器名 `getaddrinfo EAI_AGAIN`，10ms 内退出，代理侧 CONNECT 计数 0，一条请求都没发出）。现在转发器**双网卡**（内部网收 CLI 流量 + 共享 egress 网解析代理名），启动即做 `proxy-precheck`（只 DNS+TCP，不发 CONNECT），预检不通过就在**启动 CLI 之前**停止；并断言转发器不得接入 `bridge`，否则等于绕过白名单。
- OpenGame CLI **对 API 错误也返回 `CLI_RC=0`**，所以成功判据只能是 `SMOKE.txt` 内容严格匹配 + 转发器证据，不能只看退出码。

新增文件：

| 文件 | 作用 |
| --- | --- |
| `patches/0001-deepseek-disable-thinking.patch` + `patches/README.md` | 唯一上游文件改动（`deepseek.ts`），带基线/补丁后哈希与"补丁副本不等于上游 SHA"的纪律说明 |
| `runner/apply-thinking-patch.sh` | 在隔离克隆副本 `generated/smoke-src` 上校验基线→应用补丁→`--network none` 离线重建 core→记录哈希（幂等，可重放） |
| `runner/make-smoke-ca.sh` | 本地自签 CA + `api.deepseek.com` 服务器证书（3 天有效，纯本地零费用） |
| `runner/smoke-relay.mjs` | 验证转发器：断言 `thinking.type=disabled` / `max_tokens=512` / `stream+include_usage` / 无图片工具，不合规直接 400 且**零转发**；单次尝试锁（429）、请求体字节与累计估算 token 上限、逐条落证据（不含 Authorization）；`real` 模式启动即做 `proxy-precheck`（DNS+TCP，零请求体）失败即退出，并有 `RELAY_UPSTREAM_TIMEOUT_MS`（默认 120s）空闲看门狗，上游静默不会挂住付费运行 |
| `runner/verify-smoke-chain.sh` | 零费用全链路彩排（用例 0 shell 变量扩展守卫 / A 合规 7 项 / B 缺 thinking 零转发 / C 上游 500 不重发 / D·D2·D3 记账中止 / **E1–E5 真实转发器经真实白名单代理到本地假上游**，即失败的那一跳 / **F 反向用例：拓扑错误时预检失败即退出、零请求发出**），通过后写 `generated/smoke-chain/PASS` |
| `runner/diag-relay-proxy-dns.sh` | 零费用复现并证明 Docker DNS 规则：不共享网络时容器名不可解析、共享后可达（`DNSDIAG_PASS`） |
| `runner/chain-e-client.mjs` | 彩排 E 组的客户端：经转发器发一条合规请求，断言 SSE 收到 usage 且以 `[DONE]` 收尾 |
| `runner/probe-tunnel.mjs` | 分段计时探针（TCP/CONNECT/TLS/HTTP 各跳耗时），用于定位链路在哪一环静默 |
| `runner/smoke-account.mjs` | 冒烟专用预算：`precheck` 按 cache-miss 高峰价 × 汇率 7.5 算最坏费用，`record` 逐条校验 usage/实际模型名后入账本 |
| `runner/run-deepseek-smoke.sh` | 真实冒烟唯一入口：Git/HEAD/apps/上游缓存核对 → 残留 `poc-*` 容器/网络即拒绝启动 → 双重付费闸门 → 隐藏方式索取 Key（只判长度，绝不回显） → 免费前置新鲜度（补丁、彩排 PASS < 24h、证书、镜像 digest） → 费用预检 → 隔离拓扑发起（中继双网卡 + `proxy-precheck` 通过后才启动 CLI） → **先记账再做凭据审计**（按值检测 `sk-…`/`Bearer <值>` 等真实凭据形态，不因字段名误报而销毁费用证据） → 结果与证据落盘 → 清空前自动归档 `generated/smoke-run-archive/<时间戳>/` → 清理容器/网络/Key 并停 Colima。`SMOKE_DRY_RUN=1` 可在无真实 Key、无付费、不启动容器的情况下跑完全部免费前置，并用明显非凭据的占位值走**与真实运行相同的 Key 解析与长度校验**（2026-10-04 的崩溃就发生在这段代码之后一行） |
| `config/egress-allowlist.smoke.json` | 冒烟白名单：只有 `api.deepseek.com:443`；图片域/RUM/npm/其他模型域留空即拒 |

免费验证一次跑法（全部 `cost_cny=0`）：

```bash
cd spikes/opengame-poc
npm run test:deepseek && node runner/budget.mjs && npm run test:egress-proxy && npm run gates
bash runner/verify-opengame-build.sh            # 阶段一回归：构建 + 离线冒烟 + SHA/digest 锁定
bash runner/apply-thinking-patch.sh             # 补丁重放 + 离线重建
SRC=$PWD/generated/smoke-src POC_DEEPSEEK_DISABLE_THINKING=1 \
  CLI_EXTRA="--core-tools write_file" bash runner/verify-deepseek-request-shape.sh   # 线上请求体形状
bash runner/verify-smoke-chain.sh               # 全链路彩排（含 E 真实中继→代理→上游、F 拓扑错误零请求），写 PASS 标记
bash runner/diag-relay-proxy-dns.sh             # 证明容器名只在共享网络内可解析（修复结论的可重跑证据）
SMOKE_DRY_RUN=1 bash runner/run-deepseek-smoke.sh   # 真实冒烟前的最后一道免费演练
```

真实冒烟只由产品经理在终端里执行这一条命令（脚本会隐藏索取 Key，Key 不进历史/参数/文件/日志/Git）：

```bash
ENABLE_PAID_API=true COST_AUTHORIZED=true bash runner/run-deepseek-smoke.sh
```

**授权状态（2026-10-05，冒烟已成功）**：2026-10-04 的两次真实运行均未跑通（bash 3.2 UTF-8 变量扩展、Docker 容器名 DNS 拓扑，都是**零条模型请求发出**，见 `reports/阶段二-DeepSeek最小真实冒烟报告.md`）。2026-10-05 先做了一次**全量零费用复核**（中继双网卡 / 预检先于 CLI / 绝不接 bridge 逐条对到行号，`verify-smoke-chain.sh` 19 条断言全 PASS，阶段一回归、白名单、隔离、补丁重放、请求形状、`SMOKE_DRY_RUN` 全绿，见接入准备报告第 14.11 节），产品经理随后**重新授权一次**并亲自在终端执行，**第 3 次成功**：`SMOKE.txt` 字节完全匹配，2 次真实转发均 200，账本 **0.012421 元**（`SMOKE_RUN_DONE cost_cny=0.0124`；DeepSeek 控制台账单**待产品经理核对**，账本数字按保守汇率 7.5 取高，不当实际账单引用），0 重试、无图片、无修复、未触 0.08 预警与 0.10 硬停，Key 未进任何文件或日志，容器网络已清、Colima 已停。完整 15 项取证见 `reports/阶段二-DeepSeek最小真实冒烟成功报告.md`。
**这次授权已再次用满**：五款真实游戏与任何后续付费调用都需要**新的单独授权**；执行前要重跑上面「免费验证一次跑法」并确认彩排 PASS 标记在 24 小时内。**"冒烟通过"不等于"第二轨可用"**——长会话多轮工具链、具体模型版本、真实游戏代码生成仍未验证。

写这些脚本必须守一条规矩：**变量一律写成 `${NAME}`，不能让 `$NAME` 或 `$1` 紧跟中文字符或中文标点**。macOS 自带 bash 3.2 在 UTF-8 locale 下会把多字节字符的首字节吞进变量名，配合 `set -u` 就是"未定义变量"直接退出；C locale 下不触发，所以用 C locale 跑测试发现不了（2026-10-04 第一次真实冒烟就是这样崩在 Key 校验之后的那一行，未产生任何付费调用）。`runner/verify-smoke-chain.sh` 的用例 0 会静态扫描 `runner/*.sh` 兜底。

`generate-game.sh --execute` 目前**硬拒绝**：生成容器还没接上验证转发器，代理又约束不住该 CLI 的出口，此时发起长时多轮生成等于发无法取证的付费调用。改造完成前不要尝试。

## 明确不修改

- `apps/ifplay-m0/`（第一轨运行时、四模块、四款样例、测试）全部不动。
- 不 merge / reset / rebase；不 push；不创建 PR。
