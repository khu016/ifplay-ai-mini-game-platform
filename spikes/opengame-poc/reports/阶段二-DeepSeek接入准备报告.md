# 阶段二 · DeepSeek 接入准备报告

- 日期：2026-10-03
- 分支：`spike/opengame-poc`　HEAD：`8d97218454c0c9f6074efaf110bfa21c36e71c15`（未提交、未推送、未建 PR）
- 本轮范围：**只做 DeepSeek 接入的代码骨架与零费用测试，不进行任何真实游戏生成。**
- 费用：**0 元**（未发出任何带凭据的模型/图片请求；模型域名只做过无凭据 TLS HEAD 连通探测，返回 401）
- 前置约束复核：`apps/ifplay-m0/` 零改动 ✅　OpenGame 继续锁定 SHA `c9bea37786af524bf3bbe802f2b67d23816fa5c0`（未升级、未重新 clone）✅　阶段一已通过 ✅

---

## 一、已确认的供应商安排（本轮按此实现，未再向外探索）

| 项 | 结论 |
| --- | --- |
| 主 Agent / 游戏方案 / 代码生成 / 自动修复 | DeepSeek 官方 OpenAI 兼容接口，base URL `https://api.deepseek.com`，模型名 `deepseek-flash` |
| 图片 | 阿里云万相（OpenGame 内置 DashScope 适配），优先兼容 `wan2.5-t2i-preview` |
| 视频 / 云端音频 | 关闭（保持未配置，调用即抛错） |
| 每款上限 | 自动修复 ≤2 轮、图片 1~3 张、总费用 ≤3 元 |
| 首款真实游戏 | 「深夜食堂经营」——**本轮未开始生成** |

---

## 二、接入审计结论（代码位点为证，均在只读缓存 `opengame@c9bea377/`）

### 2.1 主 Agent 调用路径：可以纯配置接上 DeepSeek

- `AuthType.USE_OPENAI = 'openai'`（`packages/core/src/core/contentGenerator.ts:40-46`）。
- 环境变量 `OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL` 在 `contentGenerator.ts:104-107` 读取；**缺 Key 直接抛错**（`:110-112`）；**缺模型名静默回退 `qwen3-coder-plus`**（`:116`）——这条是本轮闸门强制 `OPENAI_MODEL` 必须显式等于 `deepseek-flash` 的直接原因。
- 客户端构造 `new OpenAI({ apiKey, baseURL, timeout, maxRetries })`（`openaiContentGenerator/provider/default.ts:39-45`）。
- 本 fork **内置 DeepSeek 兼容 provider**：`DeepSeekOpenAICompatibleProvider` 在 baseUrl 含 `api.deepseek.com` 时自动命中（`provider/deepseek.ts:21-27`），默认常量 `DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'`（`openaiContentGenerator/constants.ts:9`）。
- 模型名原样透传（`pipeline.ts:232`），请求链路**没有模型白名单**，因此 `deepseek-flash` 这个滚动名不会被拦。

**结论**：DeepSeek 走 OpenAI 兼容层接入不需要改代码，只需要 `--auth-type openai` + 三个环境变量 + settings 里的 `model.name`。

### 2.2 推理 / 工具调用路径：`reasoning_content` 只在"同一轮工具链内"回传

- 响应侧：`reasoning_content` 被映射为 `{ text, thought: true }`（非流式 `converter.ts:687-692`，流式 `:790-793`），并写入历史（`geminiChat.ts:527-620`）。
- 请求侧：assistant 且带 `tool_calls` 的消息会把 thought 作为 `reasoning_content` 回传（`converter.ts:411-421`，类型 `ExtendedChatCompletionAssistantMessageParam` `:38-41`）。
- **关键限制**：`client.ts:395` 对每个**新的顶层用户消息**（`!options?.isContinuation`）调用 `stripThoughtsFromHistory()`（`geminiChat.ts:452-489`），把 thought 从历史里删掉。

⇒ 同一轮内的多步工具调用会带着 `reasoning_content` 回传；**跨顶层轮次不会**。DeepSeek 官方对后者的要求本轮无法用零费用手段确认，因此**登记为真实调用前的兼容性风险，不声称已接通**（见第三节 R1）。

### 2.3 其他审计出的限制（均为风险，非阻塞）

- DeepSeek provider 把数组内容压平为纯文本，**遇到非文本 part 直接抛错**（`deepseek.ts:57-67`）→ 生成过程中不能给模型喂截图/图片输入。同时它强制 `temperature: 0`（`:81-85`）。
- `max_tokens` 只能从请求侧 samplingParams 带入（`pipeline.ts:298` 的 `addParameterIfDefined('max_tokens', …, 'maxOutputTokens')`），而 settings schema 只暴露 timeout/maxRetries/schemaCompliance（`settingsSchema.ts:631-690`）→ **单次输出上限无法只靠配置文件控制**。
- 流式已带 `stream_options: { include_usage: true }`（`pipeline.ts:238-243`），usage 含 `prompt_tokens_details.cached_tokens`（`converter.ts:743-767`）→ 分档计价的数据源是存在的。
- CLI 非交互 JSON 的 usage 形如 `input_tokens / output_tokens / cache_read_input_tokens / total_tokens`（`cli/src/nonInteractive/io/BaseJsonOutputAdapter.ts:180-205`），但其中 `model` 字段取自 config 而非接口返回（`:248`）→ 滚动模型名的**真实版本无法从 CLI 取得**，必须另取 vendor-response。

### 2.4 图片路径（万相）：可用，但计费与重试有坑

- `GenerateAssets` 工具无条件注册（`core/src/tools/generate-assets.ts:961`、`config/config.ts:1431`）；模型路由 `services/assetModelRouter.ts:125-133 / 284-342`。
- 实际请求是 DashScope 原生异步接口：`POST {base}/api/v1/services/aigc/text2image/image-synthesis` + `X-DashScope-Async: enable`，再 `GET /api/v1/tasks/{id}` 轮询（`services/assetImageService.ts:39-97`）；模型名含 `wan` + `t2i` 时走异步，`wan2.5-t2i-preview` 是内置默认（`services/providerConfig.ts:101-104`）。
- 环境变量 `OPENGAME_IMAGE_PROVIDER|API_KEY|BASE_URL|MODEL`（`providerConfig.ts:138-142`），settings 侧 `openGame.providers.image.*`（`settingsSchema.ts:1197-1253`）。图片编辑模型硬编码 `wanx2.1-imageedit`（`assetModelRouter.ts:46-50`）。
- **整条图片路径没有任何 usage/成本字段**；`pollTaskStatus` 直接丢弃响应体（`assetBaseService.ts:75-107`）；`fetchWithRetry` 对 429/5xx **最多重发 3 次 POST**（`:26-58`）→ 存在重复计费风险，且这些 fetch 是裸全局 fetch，绕过 OTel。
- 视频/云端音频存在但为抛错桩（`assetModelRouter.ts:241-267`），不配置即不可用，符合"关闭"要求。

### 2.5 必须继续拒绝的外呼

RUM 用量上报 `gb4w8c3ygj-default-sea.rum.aliyuncs.com`（`core/src/telemetry/qwen-logger/qwen-logger.ts:61-64`）、`chat.qwen.ai`（`qwenOAuth2.ts:23-26`）、OTLP（env 驱动）、update-notifier→npm。**铁律：不得为放行万相 OSS 结果而放开 `aliyuncs.com` 上级域，RUM 与它同后缀。**

另需注意：OpenGame 会从 cwd 向上逐级加载项目 `.env`（`settings.ts:569-592`），默认只排除 `DEBUG/DEBUG_MODE`（`:55`）→ 已把 Key 变量名写进 `advanced.excludedEnvVars`（settings 模板中固化）。

---

## 三、配置骨架与安全闸门（本轮新增，全部零费用实测）

| 件 | 位置 | 行为 |
| --- | --- | --- |
| 供应商与预算决定 | `config/providers.json` | paidGates / model / image / video=off / audio=off / pricing / budget / isolation |
| OpenGame settings 模板 | `config/opengame.settings.template.json` | `security.auth.selectedType=openai`、`model.name=deepseek-flash`、`privacy.usageStatisticsEnabled=false`、Key 名进 `excludedEnvVars`；**模板里没有任何 apiKey 字段** |
| 环境变量样例 | `.env.example` | 只有占位与空值；`.env`/`.env.*` 已 gitignore，`!.env.example` 显式保留（`git check-ignore` 复核） |
| Key 注入 | 只经 `docker run -e OPENAI_API_KEY` | 不写文件、不进 argv、不进 JSON/Markdown/日志；`keyPresence()` 只返回"在不在/长度"，永不返回值 |
| 双重付费开关 | `ENABLE_PAID_API` + `COST_AUTHORIZED` | 必须**同时**显式为 `true` 才允许任何真实调用；任一未开即拒绝**且不触网**（实测 `networkTouched=0`） |
| 禁止静默回退 | `assertCredentials()` | `OPENAI_MODEL` 必须显式等于 `deepseek-flash`；baseUrl 必须以 `https://api.deepseek.com` 开头；占位值直接拒 |
| 禁止宿主机直连 | 生成容器一律 `--internal` 网络 + 代理边车唯一出口 | `generate-game.sh` 计划命令里无 bridge 直连路径；实测绕过代理 `ENETUNREACH`/`EAI_AGAIN` |
| 无 Key 安全失败 | `check-gates.mjs` | 现在运行输出 `REFUSE: ENABLE_PAID_API 未显式设为 true…`，退出码 3 |

## 四、费用闸门（四类费用同一账本）

`runner/budget.mjs` 的 `CostLedger`：主 Agent / reasoning / 图片 / 自动修复四类进**同一个 `perGameCny=3.0` 额度**，状态落盘 `generated/ledger/<game>.json`（进程重启可恢复，已实测）。

- 分档计价：输入(未命中缓存) / 缓存命中输入 / 输出 三档分别算，源数据 DeepSeek 官方牌价 USD/1M（`https://api-docs.deepseek.com/quick_start/pricing`，取数 2026-10-03，deepseek-flash：cache-hit `$0.006`、cache-miss `$0.30`、output `$1.20`）。
- 汇率**显式配置**：`fx.usdCny = 7.3`，标注「待产品经理确认（保守占位值，非实时牌价）」，未确认时 `check-gates.mjs` 直接拒绝，不暗中假定。
- 首轮按**高峰价**保守预估，不依赖 off-peak 优惠（off-peak 为高峰的一半，仅作事后核对）。
- 换算到 CNY/1k：缓存命中 `0.0000438`、未命中 `0.00219`、输出 `0.00876`。
- **缺 usage 立即停止**，绝不按 0 元处理（非流式、流式末块、CLI 回灌三条路径都实测过）。usage 自相矛盾（`cached > input`）同样停止。
- **2.55 元预警**（只告警不中止）、**3.00 元硬停**（中止并落盘原因）。
- 调用前预检查：用最坏输入 token 估算 + `maxOutputTokensPerCall=4096`，预估越过 3 元即**不发这次调用**（实测：预估 87.64 元 → 拒发）。
- 修复轮次确定性计数，**≤2 轮**，第 3 轮判 failed；修复费用与主 Agent 同账本（实测 `byCategory = {agent, repair}`）。
- 图片 ≤3 张，第 4 张拒绝；**万相单张价未确认 → 图片调用被闸门拒绝**（不按 0 元）。
- 每笔记录：模型请求名 + **接口返回的实际模型标识** + 模型来源（`vendor-response` / `cli-config`）、时间、token、缓存命中、修复轮、图片张数、CNY 成本。缺实际模型标识即停止——因为 `deepseek-flash` 是滚动模型名，不能当成固定版本描述。

## 五、网络白名单（本轮只做了连通与拒绝，无带 Key 请求）

`config/egress-allowlist.json` 按用途分组，默认全拒绝：

| 分组 | 域名:端口 | 用途 |
| --- | --- | --- |
| model | `api.deepseek.com:443` | DeepSeek 官方 OpenAI 兼容接口（本轮仅为模型调用准备） |
| image | `dashscope.aliyuncs.com:443` | 万相图片接口（为后续图片调用预登记） |
| packageRegistry | `registry.npmjs.org:443` | 构建依赖 |
| buildBinaries | `github.com` / `objects.githubusercontent.com` / `release-assets.githubusercontent.com` :443 | 阶段一构建实测缺口 |
| 图片结果下载（厂商 OSS） | **未登记** | 域名未确定 → 保持拒绝；**禁止放开 `aliyuncs.com` 整域（会连带放开 RUM）** |

匹配逻辑抽成单一事实来源 `runner/egress-rules.mjs`，被 `egress-proxy.mjs` 与所有测试共用（防两处配置漂移）；IP 字面量一律拒绝。`neverAllowlisted` 段明文列出禁止加入的域名（RUM、`chat.qwen.ai`、`ark.cn-beijing.volces.com`、`dashscope-intl.aliyuncs.com`、`api.openai.com`、update-check 等）。

---

## 六、已通过的零费用测试（本轮全部重跑，2026-10-03 18:2x~18:3x 本地时间）

### 6.1 `npm run test:deepseek` → **25/25 PASS，真实调用 0 次，费用 0 元**

覆盖任务要求的 12 类场景（编号为自测项，实测输出摘自日志）：

| # | 用例 | 实测关键输出 |
| --- | --- | --- |
| 01 | 缺 Key / 缺模型名 / 错 baseUrl 一律拒绝启动 | 三条拒绝消息各自命中，不回退默认模型 |
| 02 | 双重付费开关任一未开 → 拒绝且不触网 | `networkTouched=0` |
| 03a/b/c | 非流式 usage → CNY；流式 `include_usage` 末块采集；多笔累计同账本 | 单笔 `0.008348` 元，累计 `0.016696`，`actualModel=DeepSeek-V3.1-mock-20261003` |
| 04 | 三档分别计价 × 显式汇率 7.3 | 全命中缓存 < 混合 < 全未命中，符合预期 |
| 05a/b/c/d | 缺 usage（非流式/流式）、`cached>input` 自相矛盾、缺实际模型标识 | 四种都停止记账，`spent=0` |
| 06 | 达 2.55 元预警但不中止 | `spent=2.6630` + warning，未 aborted |
| 07 | 达 3.00 元强制中止 | `累计 3.1624 元 ≥ 硬停线 3 元，强制中止` |
| 08 | 预检查：预估越额直接拒发 | 「本次预估 87.6359 元 > 硬停 3 元」 |
| 09 | 修复 ≤2 轮且修复费用同账本 | `seq=[repair,repair,failed]`，`byCategory={agent:0.00657, repair:0.01314}` |
| 10a/b | 第 4 张图片拒绝；图片单价未确认 → 拒绝图片调用 | 「图片数量超上限：累计 4 > 3」；「图片单张价未确认…」 |
| 11 | 账本落盘、重启可恢复 | 恢复后 `spent=0.00657`、`calls=1` |
| 12 | 白名单规则矩阵（12 条） | 放行 `api.deepseek.com:443`(model)、`dashscope.aliyuncs.com:443`(image)；拒绝 `api.openai.com`、`ark.cn-beijing.volces.com`、`dashscope-intl.aliyuncs.com`、RUM 域、`rum.aliyuncs.com`、`:80`、`:8443`、伪造后缀域、IPv4/IPv6；空白名单安全失败 |
| 13 | 密钥不进日志 | 底层错误与 HTTP 400 回显都只出现 `***REDACTED***`，无 Key |
| 14 | 本地协议自测：`reasoning_content` 缺失被拒 / 带回通过 | 400「assistant tool_calls 消息缺少 reasoning_content」 vs 通过（**真实供应商行为仍待验证**） |
| 15 | 调用前输入 token 预估计为正 | `est=907` |
| 16 | `apps/ifplay-m0/` 零改动 | `git diff` / `git status` 均空 |
| 17 | 定价就绪度如实记录 | 文本=已配高峰价、图片=待确认、汇率=显式占位待确认 |
| 18 | CLI usage 事件回灌同一账本；缺 usage 的行触发停止 | `recorded=2`，中止原因「响应缺少 usage」 |
| 19 | 白名单未配置/空白名单 → 安全失败（默认拒绝） | 空白名单与配置文件缺失都拒绝；`categories` 缺失返回 null；已配置时只放行 `model` 分组 |

### 6.2 其他零费用测试

| 命令 | 结果 |
| --- | --- |
| `node runner/budget.mjs` | 6 项全过（`overBudgetAbort / preCheckAbort / noUsage / imageLimit / repairRounds / repairPersistence`） |
| `node runner/egress-proxy-test.mjs` | **7/7 全过**（本地，不出公网） |
| `npm run gates` | 如设计拒绝：`REFUSE: ENABLE_PAID_API 未显式设为 true…`，退出码 3 |
| `npm run gen -- --game 深夜食堂经营` | dry-run 正常：先打印闸门拒绝，再打印计划命令，无网络调用，「完成，费用 0 元」；`bash -n` 语法过 |
| `npm run dry-run` | 管线全绿（rc=0），新增两步都过：`deepseek-gate-selftest 25/25`、`paid-gate allowPaidCalls=false`；`noPaidApiCalled=true`、`generationSkipped=true`。报告 `reports/空跑演练-2026-10-03T10-35-27-289Z.json` |

### 6.3 容器内实测（需 Colima；只用无凭据探测，零费用）

`bash runner/verify-model-egress.sh` → `MODEL_EGRESS_PASS cost_cny=0`，`[egress-live-test] ALL PASS` **11/11**：

```
PASS | allow api.deepseek.com via tunnel (HTTPS/443)              | {"status":401}
PASS | allow dashscope.aliyuncs.com via tunnel (HTTPS/443)        | {"status":404}
PASS | deny openai (api.openai.com:443)                           | {"status":403}
PASS | deny doubao-ark (ark.cn-beijing.volces.com:443)            | {"status":403}
PASS | deny dashscope-intl (dashscope-intl.aliyuncs.com:443)      | {"status":403}
PASS | deny qwen-oauth (chat.qwen.ai:443)                         | {"status":403}
PASS | deny aliyun RUM telemetry domain                           | {"status":403}
PASS | deny allowlisted host on non-allowlisted port (:8443)      | {"status":403}
PASS | deny plain-HTTP forward to model host (:80)                | {"status":403}
PASS | no direct route to public IP (1.1.1.1:443)                 | {"err":"ENETUNREACH"}
PASS | no direct route bypassing proxy (api.deepseek.com:443)     | {"err":"EAI_AGAIN"}
```

代理日志按 `authorization|bearer|api[-_]?key|sk-` 关键词复核为**零命中**；日志落 `generated/build-logs/verify-model-egress-20261003T102255Z.log`、`verify-model-proxy-20261003T102255Z.log`。

### 6.4 阶段一回归（因白名单匹配器改为共用，重跑一次证明没坏）

`bash runner/verify-opengame-build.sh` → **`VERIFY_OPENGAME_BUILD_PASS sha=c9bea377… cost_cny=0`**，`strict` 模式 egress 7/7 PASS、构建 attempt1 通过、离线冒烟 `--version=0.6.0` 正常、白名单审计 7 allow / 4 deny、`shaLocked=true` 维持不变。

---

## 七、尚未验证的真实接口兼容性（不得当作已接通）

登记于 `config/opengame.json → deepseekIntegrationRisks`，全部需要一次带 Key 的真实调用才能确认：

| # | 风险 | 现状 |
| --- | --- | --- |
| R1 | **跨顶层轮次的 `reasoning_content`**：同轮工具链内会回传，但每个新顶层用户消息前被 `stripThoughtsFromHistory()` 剥离。DeepSeek 是否要求跨轮保留、拒绝后会报什么错，未经真实验证 | 只有本地 mock 协议自测（6.1 #14）。若真实调用报错，需要决定是否给 OpenGame 打补丁保留 thought |
| R2 | DeepSeek provider 对非文本内容 part 直接抛错（`deepseek.ts:57-67`）→ 生成过程中**不能向模型发送截图/图片输入**（浏览器验收环节必须只看错误文本，不能靠视觉反馈回路）；provider 还强制 `temperature: 0` | 行为由代码确认，实际报错形态待验 |
| R3 | settings schema 未暴露 `max_tokens`/samplingParams（`settingsSchema.ts:631-690`）→ 单次输出上限无法只靠配置文件控制。闸门侧用 `maxOutputTokensPerCall=4096` 做**预估**，但真实调用是否真被限制住，取决于走请求侧还是打补丁 | 需决定控制方式（见第九节第 7 项） |
| R4 | OpenGame CLI JSON 的 `model` 取自 config（`BaseJsonOutputAdapter.ts:248`），不是接口返回名 → 滚动模型名 `deepseek-flash` 的真实版本无法从 CLI 取得。账本已支持 `vendor-response` / `cli-config` 两种来源，但若只有 CLI 输出，来源只能标 `cli-config` 并如实写"未取到真实版本" | 待决定抓取方式 |
| R5 | 万相图片路径**没有任何 usage/成本字段**，且 `fetchWithRetry` 对 429/5xx 最多重发 3 次 POST（`assetBaseService.ts:26-58`）→ 可能重复计费。目前只能按"提交次数 × 单张价"保守记账并在完成时核对张数 | 需确认单张价与去重/核对口径 |
| R6 | 图片结果落在厂商 OSS 域名，域名尚未确定 → 未登记前图片下载会被白名单拒绝。**严禁为放行 OSS 而放开 `aliyuncs.com` 上级域**（RUM 同后缀） | 需真实调用一次后从响应取实际 host 再登记 |
| R7 | DeepSeek 是否接受/忽略 `stream_options.include_usage`、错误码形态（余额不足、限流、402）、以及 `deepseek-flash` 是否真按官方牌价计费 | 全部待真实调用确认 |
| R8 | 遥测关闭的实际形态：`privacy.usageStatisticsEnabled=false` + `OTEL_SDK_DISABLED=true` + `GEMINI_TELEMETRY_ENABLED=false` 已写进 settings 模板与环境变量计划，但**生成容器内是否还有其它外呼**（update-check 等）只在阶段一的 strict 审计里验证过构建环 | 首次真实生成时按代理 allow/deny 日志逐条复核 |
| R9 | **CONNECT 代理约束不住这个 CLI**：`provider/default.ts:31-46` 从不给 OpenAI 客户端接 dispatcher/agent，Node 20 的 fetch 也不读 `HTTPS_PROXY`。只靠"代理 + 白名单"生成的付费调用无法被证明只走了白名单域名 | 2026-10-04 实测确认（见第十四节）。对策：冒烟与后续生成必须用"补丁 CLI + `/etc/hosts` 固定 + TLS 终结验证转发器 + `--internal` 唯一出口"拓扑；`generate-game.sh --execute` 在改造完成前硬拒绝 |
| R10 | `thinking`（DeepSeek 思考开关）**无法靠配置注入最终请求**：`pipeline.ts:225-329` 的参数白名单只含 temperature/top_p/`max_tokens`/top_k/penalties，SDK 建流时只传 `signal` | 已由 `patches/0001-deepseek-disable-thinking.patch` 解决（env 门控，`POC_DEEPSEEK_DISABLE_THINKING=1` 才生效），线上形状已由本地假服务取证 |

## 八、尚未产生的真实费用

- **本轮费用 = 0 元**。账本里出现的所有金额都来自 mock（`runner/mock-deepseek.mjs`，127.0.0.1 随机端口）。
- 与模型域名的唯一接触：容器内**无凭据** TLS `HEAD /`，`api.deepseek.com` 返回 401、`dashscope.aliyuncs.com` 返回 404。**没有 Authorization 头、没有 token 消耗、没有图片额度消耗。**
- 未充值、未查询余额、未登录任何厂商控制台、未创建/读取任何 Key。
- 双重付费开关当前均关闭（默认 `false`）：`check-gates.mjs` 实测拒绝放行（退出码 3）；`generate-game.sh` 未加 `--execute` 时不发起任何网络调用。
- 五款真实游戏生成：**未开始**（首款「深夜食堂经营」只在 dry-run 里打印了计划命令）。
- 本轮没有提交、推送、建 PR；Colima 验证后已停止，无残留 `poc-*` 容器/网络。

## 九、第一次真实调用前仍需产品经理提供或确认的事项

> 以下任一项缺失，本轮代码都会**拒绝调用**而不是替对方猜。这些是我停下来的点，需要明确指示才能推进。

1. **DeepSeek API Key**：只提供/注入，不复述。注入方式需确认为 `docker run -e OPENAI_API_KEY`（不写文件、不进 argv 明文、不进日志）。
2. **汇率确认**：当前 `usdCny=7.3` 是保守占位值并标注"待确认"；未确认前 `check-gates.mjs` 持续拒绝。
3. **DeepSeek 高峰单价确认**：本轮按 2026-10-03 官方文档的高峰价（cache-hit $0.006 / cache-miss $0.30 / output $1.20 每 1M tokens）；需确认是否仍为该价，以及是否坚持"首轮不依赖 off-peak 优惠"。
4. **万相图片单张价与计费口径**：`pricePerImage` 目前为 `null` → 图片调用被闸门拒绝。需给出单张价（CNY，或 USD + 汇率）以及按"提交次数"还是"成功张数"计。
5. **费用授权**：需显式同时打开 `ENABLE_PAID_API=true` 与 `COST_AUTHORIZED=true`，这等价于"允许产生真实费用"。
6. **实际模型标识的抓取方式**：接受"真实版本从代理/SDK 层取，CLI 输出记为 `cli-config`"这一口径，还是同意为此给 OpenGame 打小补丁。
7. **`max_tokens` 控制方式**：请求侧注入（需改调用代码）还是接受"仅预检查估算、无硬上限"的风险。
8. **跨轮 `reasoning_content` 的处置**：若真实调用报错，是否同意修改 `client.ts:395` 的剥离逻辑（属于对上游 fork 的行为改动，需明确授权）。
9. **图片结果 OSS 域名**：需在一次真实图片调用后登记具体 host；放开白名单属于扩大网络面，逐项确认，不放开 `aliyuncs.com` 整域。
10. **首次真实调用的规模**：建议先做一次最小 call（几条消息、几百 input token、输出上限几千 token、不出图），预期几分钱以内，用来一次性验证 R1/R4/R7；确认后再进入首款「深夜食堂经营」的完整生成。

## 十、本轮新增与修改的文件

全部位于 `spikes/opengame-poc/`（该目录整体未被 Git 跟踪，`?? spikes/`）。

**新增 — 配置**
- `config/providers.json` — 供应商决定、双重付费闸门、Key/baseUrl/模型环境变量名、分档定价与汇率、预算与规则、隔离与 Key 处理
- `config/opengame.settings.template.json` — OpenGame settings 模板（无 apiKey；关遥测；Key 变量名进 `excludedEnvVars`；图片 provider 段）
- `.env.example` — 只有占位与空值，无真实 Key

**新增 — runner**
- `runner/credentials.mjs` — 付费双闸门、凭据断言（防静默回退模型）、Key 只判在不在、日志脱敏
- `runner/pricing.mjs` — USD/1M × 显式汇率 → CNY/1k 分档换算；定价/汇率缺失即抛错
- `runner/egress-rules.mjs` — 白名单匹配器（代理与测试共用的唯一事实来源；IP 字面量一律拒绝）
- `runner/mock-deepseek.mjs` — 本地假 DeepSeek（真实形态 usage/SSE + 各类失败样本 + `reasoning_content` 协议校验）
- `runner/gated-call.mjs` — 真实调用唯一入口骨架（闸门→凭据→白名单→预检查→调用→交账本）
- `runner/deepseek-selftest.mjs` — 25 项零费用自测
- `runner/check-gates.mjs` — 四道闸门自检，不过即 `REFUSE` + 退出 3
- `runner/ingest-usage.mjs` — CLI `stream-json` usage 事件灌入同一账本；一条带 usage 都没有 → 标"费用无法确认"
- `runner/generate-game.sh` — 真实执行入口，默认 dry-run 只打印计划
- `runner/verify-model-egress.sh` — 零费用容器化模型/图片白名单实测

**修改**
- `runner/budget.mjs` — 新增 `CostLedger`（四类费用同一额度、预警/硬停、缺 usage/缺模型名即停、落盘恢复、CLI usage 映射）；阶段一 `CostTracker`/`RepairRoundTracker`/`selfTest` 保留不动
- `runner/egress-proxy.mjs` — 内联匹配逻辑改为 `import { matchTarget } from './egress-rules.mjs'`（3 处调用点）
- `runner/egress-live-test.mjs` — 新增 `none|strict|model` 三模式与 model 套件 11 项
- `runner/pipeline.mjs` — 新增步骤 5 `deepseek-gate-selftest`、5b `paid-gate`，summary 带 DeepSeek 字段
- `config/egress-allowlist.json` — 新增 `model`/`image` 分组与逐组 `purpose`、`neverAllowlisted` 段、"禁止放开 `aliyuncs.com` 整域"注释
- `config/opengame.json` — `budget`（2.55 预警 / 3.00 硬停）、`metering`（账本/分档单价/汇率/实际模型规则）、`providers`（改为已确认决定）、新增 `paidGates`、新增 `deepseekIntegrationRisks`（R1~R6）、`egress.note`（补记 model 面 11/11 与共用匹配器）、`generation`（`realGenerationStarted:false` + 阶段二说明）
- `package.json` — 新增 scripts：`test:deepseek`、`test:budget`、`test:egress-proxy`、`gates`、`gen`
- `.gitignore` — `.env`、`.env.*`、`!.env.example`、`*.pem`、`*.key`、`*_key`、`*_token`、`secrets/`、`.ledger/`
- `README.md` — 标题与状态改为阶段一+阶段二、目录结构补新文件、新增"第二阶段：DeepSeek 接入准备"整节（供应商安排、接入结论、runner 文件表、零费用测试命令）
- `reports/阶段二-DeepSeek接入准备报告.md` — 本报告

**未修改（约束复核）**：`apps/ifplay-m0/` 全部零改动（`git diff` / `git status` 均为空，自测项 16 也在断言这件事）；OpenGame 缓存目录只读引用，SHA 与阶段一一致。

## 十一、当前 Git 分支、HEAD 与工作区状态

```
分支：spike/opengame-poc
HEAD：8d97218454c0c9f6074efaf110bfa21c36e71c15（= 阶段一起点，未新增提交）
提交/推送/PR：均无（origin/dev/ifplay-m0..HEAD 为空）
工作区：?? spikes/（整个 PoC 目录未跟踪，符合"不提交"要求）
apps/ifplay-m0/：零改动
OpenGame 缓存：opengame@c9bea377（clean，SHA 校验通过，未重新 clone、未升级）
容器：Colima 验证后停止；无残留 poc-* 容器与网络
费用：0 元
```

## 十二、闸门是否表（阶段二）

| # | 检查项 | 是 / 否 |
| --- | --- | --- |
| 1 | 本阶段范围内完成，未提前做后续阶段（未开始真实生成） | 是 |
| 2 | 零费用自动化测试已运行并通过 | 是（DeepSeek 25/25、budget 6/6、egress-proxy 7/7、pipeline 空跑全绿） |
| 3 | 真实模型冒烟 | N/A（本轮禁止；如实记"未验"，见第七节 R1~R8） |
| 4 | 类型检查 / Lint / 生产构建 | N/A（本阶段无前端代码改动；容器侧构建由阶段一脚本复现通过） |
| 5 | 密钥未进入代码、仓库、前端产物 | 是（Key 形态全库扫描仅 4 处命中，均为上游文档占位 `sk-xxxx…` 且位于 gitignore 的 `generated/` 内；本地无 `.env`，只有占位 `.env.example`；脱敏用例 #13 与白名单安全失败用例 #19 通过） |
| 6 | 数据在服务重启后可恢复 | 是（账本落盘用例 #11；阶段一 `repairPersistence` 亦通过） |
| 7 | 桌面与移动端宽度检查 | N/A（本阶段无界面） |
| 8 | README 已更新启动与验证方法 | 是（新增第二阶段整节与全部命令） |
| 9 | `docs/项目状态.md` 已更新 | 否（本 PoC 在 `spikes/` 分支上，状态由本报告与 README 承载；是否要写回主仓状态文件需产品经理指示） |
| 10 | 证据包已交付 | 是（`reports/` + `generated/build-logs/`，含 11/11 与 25/25 原始输出） |

## 十三、下一步（需要指示才动）

本轮到此停止。第一次真实调用前，第九节 10 项里至少 1、2、3、5 四项必须先有明确答复；其余（6、7、8、9）可以先按推荐默认走，但都涉及改上游 fork 或扩大网络面，我不会自行决定。

## 十四、追加：最小真实冒烟的免费准备（2026-10-04，费用 0 元）

产品经理给了一次性冒烟授权（硬上限 0.10 元，只允许写 `SMOKE.txt` 这一个任务，不授权游戏/图片/自动修复/第二次尝试）。本节是**发起付费调用之前**能全部免费做完的部分；真实冒烟报告另见 `reports/阶段二-DeepSeek最小真实冒烟报告.md`（尚未产生，等真实那一次跑完再写）。

### 14.1 三条实测结论（把第九节的悬案定死）

| 悬案 | 实测结论 | 证据 |
| --- | --- | --- |
| 第 7 项：`max_tokens` 怎么硬控 | `samplingParams.max_tokens=512` 经 settings 透传后**确实出现在最终 HTTP 请求体**，线上取证为 `max_tokens=512` | `runner/verify-deepseek-request-shape.sh`（`generated/request-probe/`，1 次请求，bodyBytes 21830） |
| 第 6 项：真实模型标识怎么取 | CLI 只报请求名，但**响应体 `model` 字段**可在转发器层取证 → 冒烟拓扑逐条记录 `requestedModel` / `actualModel`，缺失即中止 | `runner/smoke-relay.mjs` 证据行 + 彩排 D1（`actualModels: ["DeepSeek-V3.1-mock-20261003 <== vendor-response"]`） |
| 第九节没列出的新问题：出口约束 | **代理对这个 CLI 无效**（R9）。因此"白名单代理"不能单独当作冒烟的出口保证 → 改为 `/etc/hosts` 把 `api.deepseek.com` 固定到 TLS 终结验证转发器，转发器再经白名单代理出网；这条本地拦截是**有意披露**的取证设计，不是隐藏行为 | R9 + `runner/verify-smoke-chain.sh` |

另外确认 R10：`thinking.type=disabled` 无法靠配置注入，必须打补丁。补丁只动 `packages/core/src/core/openaiContentGenerator/provider/deepseek.ts` 一个文件，用 `POC_DEEPSEEK_DISABLE_THINKING=1` 门控，只作用在隔离克隆副本 `generated/smoke-src`，只读上游缓存 `opengame@c9bea377` 与 `generated/verify-build` 零改动。

- 补丁文件 sha256 `6f2e17ce…a081f0`；补丁后 `.ts` `9770ece9…00a3ac`；补丁后 `dist/*.js` `c308d01c…61b2998`；基线 `.ts` `4491fad8…86aa51`（记录在 `generated/smoke-src/PATCH_APPLIED.txt`）。
- **补丁副本不等于上游 SHA `c9bea377…`**，只是同基线的临时可执行副本；上游基线仍按 `c9bea377…` 登记。

### 14.2 冒烟预算（与每款 3 元的游戏预算完全分开）

`config/providers.json → smoke`：单次输出上限 512 token、自动修复 0 轮、图片 0 张、模型尝试至多 3 次转发（一次任务）、预警 0.08 元、硬停 0.10 元、汇率 7.5 只作**保守熔断值**（故意取高，非实时汇率）。

最坏预演（`runner/smoke-account.mjs precheck`，全按 cache-miss 高峰价、输出按满 512）：
- 单次最坏 `0.021708` 元；三次合计 `0.065124` 元 ≤ 0.10 元，且未触及 0.08 元预警线。
- 输入估算 7600 token 来自彩排实测最大请求体 22465 字节 ÷ 3 向上取整，宁可高估。
- 转发器侧另有硬闸：单请求体 ≤ 40000 字节、累计估算 ≤ 25000 token、`RELAY_MAX_REQUESTS=3` 之后一律 429 拒绝且不转发（**没有第二次付费尝试**）。

### 14.3 付费前全量零费用回归（2026-10-04 13:0x 本地时间，全部 `cost_cny=0`）

| 测试 | 结果 |
| --- | --- |
| `npm run test:deepseek` | 25/25 PASS |
| `npm run test:egress-proxy` | 7/7 PASS |
| `node runner/budget.mjs` | 6 项场景全部按设计触发（`overBudgetAbort / preCheckAbort / noUsage / imageLimit / repairRounds / repairPersistence`），退出码 0 |
| `npm run gates`（闸门全关） | 按预期 `REFUSE: ENABLE_PAID_API 未显式设为 true` + 退出 3 |
| `bash runner/verify-model-egress.sh`（阶段二模型+图片白名单） | 11/11 PASS，2 allow / 7 deny，代理日志无凭据关键字 |
| `EGRESS_MODE=smoke ALLOWLIST=egress-allowlist.smoke.json bash runner/verify-model-egress.sh` | 12/12 PASS，**1 allow（只有 api.deepseek.com）/ 9 deny**，含 dashscope 图片域、RUM、npm、其他模型域、非 443、明文 HTTP、直连 IP |
| `bash runner/verify-opengame-build.sh`（阶段一回归） | `VERIFY_OPENGAME_BUILD_PASS sha=c9bea37786af…`，离线冒烟 `--version=0.6.0`、onnxruntime/sharp 加载成功，1.2G 构建产物未删除 |
| `bash runner/apply-thinking-patch.sh` | 幂等重放（先回退再应用），离线 `--network none` 重建 core 通过，哈希与首次记录一致 |
| `SRC=…/smoke-src POC_DEEPSEEK_DISABLE_THINKING=1 … verify-deepseek-request-shape.sh` | 线上字段含 `thinking={'type':'disabled'}`、`max_tokens=512`、`reasoning_effort=None`、`stream_options={'include_usage':True}` |
| `bash runner/verify-smoke-chain.sh` | `SMOKE_CHAIN_PASS`：A 7 项（含真实 Agent 写出字节完全匹配的 `SMOKE.txt`）、B 缺 thinking ⇒ 零转发、C 上游 500 ⇒ 只转发 1 次不重发、D 记账（实际模型名与预算一致）、D2 输出 900>512 立即中止、D3 缺 usage 拒绝入账 |
| `SMOKE_DRY_RUN=1 bash runner/run-deepseek-smoke.sh` | `SMOKE_DRYRUN_PASS`：Git/HEAD/apps/上游缓存核对 → 补丁与彩排新鲜度 → 证书 → 镜像 digest → 费用预检全过；不检查闸门、不索取 Key、不启动容器、不发请求 |
| `npm run gen -- --game 深夜食堂经营`（generate-game.sh 改过，必须重跑） | dry-run rc=0，计划命令现在如实打印 `-p "$(cat /work/prompt.md)"`（旧版被 heredoc 展开成空串的错误已修），并显式标注"这套代理拓扑已被 R9 证伪，不能照着跑" |
| `npm run dry-run` | rc=0；`deepseek-gate-selftest pass=true`、`paid-gate pass=true`、`generationSkipped=true`、`noPaidApiCalled=true` |
| `generate-game.sh --execute` | **未执行**（即便用假 Key 也算发起生成链路的尝试，超出本次一次性冒烟授权）。改为静态取证：脚本列 0 位置的可执行 `docker` 命令 **0 条**，4 条 docker 文本全部在 dry-run 的 `cat <<PLAN` 里，拒绝行在它们之后 → `--execute` 不可能触网 |

冒烟白名单实测日志：`generated/build-logs/verify-model-egress-20261004T050454Z.log`；阶段一回归与代理日志同目录。

### 14.4 本轮免费改动还修掉的两个真问题

1. `generate-game.sh` 之前打印的"生成容器 + `HTTPS_PROXY`"计划是**无效保证**（见 R9），且调用参数写的是不存在的 `--prompt-file`。现在：dry-run 计划改用真实存在的 `-p` 形式并写明该缺陷；`--execute` 在生成链路接上验证转发器之前**直接拒绝**， unreachable 的旧 docker 启动代码已删除，不留可能产生无法取证付费调用的入口。
2. `run-deepseek-smoke.sh` 之前会在闸门拒绝（纯停止、还没用容器）时把用户已经启动的 Colima 关掉，且镜像检查排在 Colima 启动之前，真实运行会误判"镜像不在本地缓存"。现在：先 `ensure_colima`（只在本次自启或本次真跑过容器时才停机），并加了 `SMOKE_DRY_RUN` 演练出口；证书过期会自动本地重签。

### 14.5 第一次真实冒烟在读取 Key 后崩溃：根因与修复（2026-10-04，费用仍为 0 元）

产品经理按第十四节的命令真实执行了一次，脚本在 Key 输入完成后的下一行立即中止：

```
runner/run-deepseek-smoke.sh: line 93: KEY_LEN…: unbound variable
```

- **没有产生任何付费调用**：崩溃点在第 2 步（Key 校验）结束之前，容器与网络在第 5 步才创建，转发器一次请求都没发出；崩溃后清理逻辑照常执行。
- **根因**：macOS 自带 `/bin/bash` 3.2.57 在 **UTF-8 locale** 下会把紧跟变量名的多字节字符的首字节并入变量名。`log "…（长度 $KEY_LEN，值不显示…）"` 因此查的是变量 `KEY_LEN\xef…`，配合 `set -u` 直接"未定义变量"退出。同一个 `$KEY_LEN` 在 C locale 下正常展开——**我此前的免费测试全都在 C locale 跑，所以一路绿灯，却没覆盖到产品经理的真实终端环境**。这是测试环境的错，不是脚本逻辑的错，也不是 Key 或授权的问题。
- **修复**：`runner/` 下 9 处 `$VAR` / `$1` 紧跟中文或中文标点的写法全部改成 `${VAR}`（涉及 `run-deepseek-smoke.sh`、`verify-opengame-build.sh`、`verify-smoke-chain.sh`、`apply-thinking-patch.sh`、`verify-deepseek-request-shape.sh`）。
- **防复发守卫**：`verify-smoke-chain.sh` 新增"用例 0 shell 变量扩展守卫"，逐行扫描 `runner/*.sh`（跳过注释行），再出现该写法就让彩排直接失败——付费路径不许带着这种地雷上线。守卫自身立刻生效过一次（它抓到了我写在注释里的示例），说明不是空转。
- **顺带修掉一个彩排自身的缺陷**：重跑彩排时 D 组失败，原因是 `d-ledger-state.json` 在多次彩排之间累积，第三次重跑累计 0.1174 元 ≥ 0.10 元硬停线，账本按设计强制中止（**闸门行为正确，是彩排没重置自己的账本**）。现在 D 系列每次从空账本开始；真实冒烟不受影响，因为它用 `generated/smoke-run/` 下每次运行前都会重建的状态文件。
- **Key 处理**：不使用、不查找、也不复用第一次输入的那个 Key；第一次运行没有把 Key 写进任何文件（写文件发生在崩溃之后，且脚本从不落盘 Key），该进程已退出，内存中的值随之消失。

### 14.6 修复后的免费回归（关键：全部在 `LC_ALL=en_US.UTF-8` 下重跑，复现产品经理的终端环境）

| 检查 | 结果 |
| --- | --- |
| `bash -n runner/*.sh`（9 个脚本） | 全部通过 |
| 崩溃行本身 | `SMOKE_DRY_RUN=1` 演练打印 `Key 状态：已设置（长度 35，…）`（占位值，不是凭据），不再 unbound |
| 短 Key / 无 Key / 闸门关 三条中止路径 | 各自打印正确中文信息后停止；`/dev/tty` 重定向报错也不再泄漏到屏幕 |
| `verify-smoke-chain.sh` | `SMOKE_CHAIN_PASS`，17 项 PASS / 0 FAIL（含新增守卫、D 组从空账本起算 0.0391 元） |
| 阶段一回归 `verify-opengame-build.sh` | `VERIFY_OPENGAME_BUILD_PASS sha=c9bea37786af…`，1.2G 产物完好 |
| `apply-thinking-patch.sh` | 幂等重放通过，补丁哈希与记录一致，中文提示行完整打印 |
| `verify-deepseek-request-shape.sh` | `thinking={'type':'disabled'}`、`max_tokens=512`、`reasoning_effort=None`、bodyBytes 21830 |
| `EGRESS_MODE=smoke` 白名单实测 | `MODEL_EGRESS_PASS`，12/12（只有 api.deepseek.com 放行） |
| node 侧 | selftest 25/25、egress-proxy 7/7、budget 6 项、gates 按设计退出 3、`npm run gen` dry-run rc=0、`npm run dry-run` rc=0 |
| 残留 | `poc-*` 容器 0、`poc-*` 网络 0；彩排证据里转发器上游只有 `127.0.0.1`（本地假服务），**零付费请求** |

为了让演练能覆盖这段崩溃代码：`SMOKE_DRY_RUN=1` 现在也会走与真实运行完全相同的 Key 解析与长度校验，只是用明显非凭据的占位值，且在启动任何容器之前就有退出出口。

### 14.7 当前状态（2026-10-04 第二次真实运行后已失效，见 14.8 / 14.9）

- 费用 **0 元**；第一次运行没有发出任何模型请求；没有 Key 进入文件、命令历史、日志或 Git。
- 分支 `spike/opengame-poc`，HEAD 仍是 `8d972184…`，`apps/ifplay-m0/` 零改动，上游缓存 `c9bea377…` 且 clean；未提交、未推送、未建 PR。
- 无残留 `poc-*` 容器与网络；Colima 验证后停止。
- 彩排 PASS 标记已刷新（付费运行要求 24 小时内新鲜）。
- 停在"等产品经理在终端里重新隐藏输入一次 Key"这一步，命令见 README 第三阶段。

### 14.8 第二次真实运行：拓扑缺陷（R10）导致失败，费用仍无法确认

产品经理重新隐藏输入 Key 后，脚本走完了 Key 校验、容器与网络创建、启动 OpenGame CLI，`CLI_RC=0`，但结果是 `{"smokeExists": false, "exactMatch": false}`，随后被凭据审计中止。这一轮**没有修好就能付费重跑的资格**——先把根因查实。

- **根因（真实缺陷，不是误报）**：Docker 内嵌 DNS **只对"共享同一网络"的容器解析容器名**。付费拓扑里中继（relay）挂在 `poc-smoke-net`（内部网），egress 代理挂在 `poc-egress-net`（内部网），两者**没有共享网络**，所以中继把代理名 `poc-smoke-proxy` 解析成 `getaddrinfo EAI_AGAIN`，在 10 毫秒内失败。代理侧日志显示 **CONNECT 计数 0**：一个字节都没出过容器边界，也没有任何请求打到 DeepSeek。
- **为什么彩排没抓到**：阶段二彩排的 A/B/C/D 组走的是"客户端 → 中继 → 本地假服务"，中继的上游始终是 `127.0.0.1`，从来不需要解析代理容器名。**付费路径独有的"中继 → 代理"这一跳在彩排里是空白**。这与此前 bash-3.2 的教训同类：不是逻辑错，是我构造的免费测试没覆盖到真实拓扑。
- **CLI 为何仍退出 0**：OpenGame 对 API 错误不返回非零码（阶段一已记录），所以成功判据只能是 `SMOKE.txt` 内容严格匹配 + 中继证据，不能只看 `CLI_RC`。
- **`SMOKE_ABORT: 日志中出现疑似凭据关键字` 是我自己审计的误报**：审计脚本用关键字 grep（`authorization|bearer|api[-_]?key|sk-`），命中了中继证据里我自己写的字段名 `authorizationHeaderPresent`（一个布尔键名，不含任何凭据值）。**这一轮的排序也有缺陷**：审计跑在记账之前，一旦误报就丢掉费用证据。
- **修复（全部零费用验证）**：
  1. `docker network connect "$NET_EGRESS" "$RELAY_C"` 让中继双网卡（内部网收 CLI 流量 + 共享 egress 网以解析代理名），并加断言：中继**不得**接入 `bridge`，否则等于绕过白名单。
  2. 中继启动即做 `proxy-precheck`（只做 DNS + TCP 建连，不发 CONNECT、不带请求体），失败就 `exit(1)`；付费脚本在**启动 CLI 之前**校验 `"at":"proxy-precheck","ok":true`，未通过就停止 → 拓扑错误再也吃不掉唯一一次付费机会。反向用例 F 实测：不共享网络时预检 `ok:false`、`EAI_AGAIN`、容器退出、**零条请求发出**。
  3. 凭据审计改为**按值检测**（`sk-…`、`Bearer <值>`、`"api_key":"<值>"` 等真实凭据形态，并把 Key 的 8 字节滑窗片段作为独立判据），不再因字段名误报；同时把**记账挪到审计之前**，保证任何审计结论都不会再销毁已落盘的费用证据。
  4. 中继新增 `upstream-timeout`（默认 120s）看门狗：上游静默时记录并断开，付费运行不可能无限挂住。
  5. 取证目录在清空前先归档（`generated/smoke-run-archive/<时间戳>/`）。这条是紧急修复：重跑步骤 14 的演练原本会 `rm -rf` 掉这轮失败证据。
  6. 假服务 `mock-deepseek.mjs` 的 TLS 模式原先用 `tls.createServer`（交付的是裸 socket，不是 HTTP req/res），HTTP 客户端会**静默挂死**；改为 `https.createServer`。彩排 E 组当初就是因此卡住 12 分钟以上。
- **新增彩排覆盖（正是失败的那一跳）**：E 组用真实中继 + 真实 egress 白名单代理 + `/etc/hosts` 把 `api.deepseek.com` 固定到本地假服务（**零公网、零费用**），E1–E5 全绿；F 组验证拓扑错误时零请求止损。另加 `runner/diag-relay-proxy-dns.sh`：`DNSDIAG_PASS separated_unresolvable=1 shared_reachable=1`，把"容器名只在共享网络内可解析"这条结论固化成可重跑的证据。

### 14.9 修复后的零费用全量回归（`LC_ALL=en_US.UTF-8`）

| 检查 | 结果 |
| --- | --- |
| `verify-smoke-chain.sh` | `SMOKE_CHAIN_PASS`，**19 项 PASS / 0 FAIL**（含新增守卫、E1–E5 真实链路跳、F 反向用例） |
| `SMOKE_DRY_RUN=1` 付费脚本演练 | `SMOKE_DRYRUN_PASS cost_cny=0`（走到与真实运行相同的 Key 解析与预检逻辑，占位值，不启动容器） |
| `diag-relay-proxy-dns.sh` | `DNSDIAG_PASS separated_unresolvable=1 shared_reachable=1` |
| 阶段一回归 `verify-opengame-build.sh` | `VERIFY_OPENGAME_BUILD_PASS sha=c9bea37786af…`，1.2G 产物完好 |
| `EGRESS_MODE=smoke` 白名单实测 | `MODEL_EGRESS_PASS` ×2，`cost_cny=0`（只有 `api.deepseek.com` 放行） |
| node 侧 selftest / egress-proxy / budget / gates | 全部通过；`gates` 按设计退出 3（拒绝真实调用） |
| 全量 PASS 行 | 80 条 `PASS`，0 条 `FAIL`（日志 `generated/build-logs/free-suite-20261004T130315Z.log`） |
| 残留 | `poc-*` 容器 0、`poc-*` 网络 0；Key 未进入任何文件、日志、命令历史或 Git；Colima 已停止 |

### 14.10 当前状态（截至本轮）

- **两次真实运行均未产生可确认费用**：第一轮在 Key 校验处因 bash 缺陷崩溃；第二轮因容器名解析失败，**一条模型请求都没发出**（代理 CONNECT 计数 0，无 usage 可记账）。费用按"无法确认"处理，DeepSeek 控制台仍需产品经理自行核对。
- **本轮一次性付费授权已用满**（授权原文为"仅限一次最小冒烟"）。再做真实调用需要产品经理**重新明确授权**，我不自行重跑。
- 分支 `spike/opengame-poc`，HEAD `8d972184…`，`apps/ifplay-m0/` 零改动，上游缓存 `c9bea377…` clean；未提交、未推送、未建 PR。
- 失败运行证据已归档在 `generated/smoke-run-archive/attempt2-20261004T1732/`，如实记录在 `reports/阶段二-DeepSeek最小真实冒烟报告.md`（15 项逐条）。
- 五款真实游戏（含"深夜食堂"）**仍未开始**，图片调用、依赖安装、自动修复均未获授权。

### 14.11 第三次零费用复核（2026-10-05，未付费、未索取 Key、未发起真实调用）

产品经理要求：在决定是否重新授权之前，先把上述修复**逐项重验一遍**。本轮结果全部通过，费用 **0 元**（日志 `generated/build-logs/free-review-docker-20261005T055800Z.log`、`free-review-node-20261005T055445Z.log`）。

**修复是否真实存在于代码里（静态核查，给行号）**

| 检查 | 证据 | 结论 |
| --- | --- | --- |
| 中继双网卡 | `run-deepseek-smoke.sh:177` `docker network connect "$NET_EGRESS" "$RELAY_C"`（`:175-176` 写明根因），中继 IP 按网络名取（`:190`） | 存在 |
| 预检在 CLI 之前 | 中继侧 `smoke-relay.mjs:291`（仅 `real` 模式）→ `:298-317` 只做 `net.connect` 解析+TCP、8s 超时、失败 `process.exit(1)`，**不发 CONNECT、不带请求体**；编排侧 `run-deepseek-smoke.sh:181-186` 等到 `"at":"proxy-precheck","ok":true` 才继续，`:187` 还要求容器仍在 running，而 CLI 直到 `:212` 才启动 | 存在，顺序正确 |
| 绝不接 bridge | `:152-153` 断言两个网络 `Internal=true`；`:160` 只有 egress 代理接 bridge；`:188-189` 枚举中继全部网卡，命中 `bridge` 立即 `fail` | 存在 |
| 记账先于凭据审计 | `:254-261`（注释记录上一轮误报原因）；审计 `:263-285` 按**值**匹配（`sk-…`、`Bearer <值>`、`"api_key":"<值>"`）+ 本次 Key 的 8 字符滑窗片段逐文件比对 | 存在 |
| 上游空闲看门狗 | `smoke-relay.mjs:47`（`RELAY_UPSTREAM_TIMEOUT_MS`，默认 120s）、`:261-266` 超时记 `upstream-timeout` 并断流；`run-deepseek-smoke.sh:172` 显式传 120000 | 存在 |
| 取证先归档再清空 | `run-deepseek-smoke.sh:122-127`；上一轮真实证据仍在 `generated/smoke-run-archive/attempt2-20261004T1732/`（7 个文件齐全） | 存在，证据未丢 |

**重跑结果（本轮实跑）**

| 步骤 | 结果 |
| --- | --- |
| `bash -n`（10 个 runner 脚本） | 全过 |
| `npm run test:deepseek` | `25/25 PASS，真实调用 0 次，费用 0 元` |
| `node runner/budget.mjs` | 全过（含 `aborted/triggered` 中止场景、`repairPersistence` 重启恢复） |
| `npm run test:egress-proxy` | `全部通过: 7/7` |
| `npm run gates`（无管道，取真实退出码） | **rc=3**，`REFUSE: ENABLE_PAID_API 未显式设为 true` = 按设计拒绝 |
| `diag-relay-proxy-dns.sh` | `DNSDIAG_PASS separated_unresolvable=1 shared_reachable=1` |
| `verify-smoke-chain.sh` | `SMOKE_CHAIN_PASS cost_cny=0`：**19 条断言 PASS + 6 条分组汇总，0 FAIL**（含 E1–E5 真实中继→代理→上游、F 拓扑错误零请求） |
| `EGRESS_MODE=smoke` 白名单 | `MODEL_EGRESS_PASS cost_cny=0`，12 项 PASS（只放行 `api.deepseek.com:443`） |
| 全量白名单 | `MODEL_EGRESS_PASS cost_cny=0`，11 项 PASS |
| `verify-container-isolation.sh "$PWD/fixtures/selftest"` | 5 项 PASS + `===== 全部通过 =====`（TCP `ENETUNREACH`、只读根文件系统、`/etc` DENIED、进程树 6 节点且残留容器 0、selftest 构建 rc=0） |
| `apply-thinking-patch.sh` | `PATCH_APPLY_DONE cost_cny=0`；`PATCH_APPLIED.txt` 四个哈希与报告记录逐一一致（补丁 `6f2e17ce…`、补丁后 `.ts` `9770ece9…`、`dist/*.js` `c308d01c…`、基线 `.ts` `4491fad8…`） |
| `verify-deepseek-request-shape.sh` | `REQUEST_SHAPE_DONE cost_cny=0`；线上字段 `thinking={'type': 'disabled'}`、`max_tokens=512`、`stream_options={'include_usage': True}`、`reasoning_effort=None`、`temperature=0`、`bodyBytes=21830` |
| `verify-opengame-build.sh`（阶段一回归） | `VERIFY_OPENGAME_BUILD_PASS sha=c9bea37786af524bf3bbe802f2b67d23816fa5c0 image=node:20-slim@sha256:10fc5f5f…`，1.2G 产物完好 |
| `SMOKE_DRY_RUN=1 bash runner/run-deepseek-smoke.sh` | `SMOKE_DRYRUN_PASS cost_cny=0`：Git/上游核对 → 补丁存在 → 彩排 PASS `<86400s` → 证书自校验 → 镜像 digest 在本地缓存 → **残留 `poc-*` 为 0** → 旧取证归档 → 预检 `3×(7600 in + 512 out) = 0.065124 元 ≤ 0.10`（单请求 `0.021708` 元），Key 只做长度校验（占位值） |

**PASS 标记新鲜度**：`generated/smoke-chain/PASS` = `2026-10-05T05:56:03Z`，本轮新写，复核时 age≈217s，远小于付费脚本要求的 24 小时（`run-deepseek-smoke.sh:105-107`）。冒烟证书 `notAfter=2026-10-07`，仍在有效期，且过期会自动本地重签（`:109`）。

**残留与密钥面**：`poc-*` 容器 0、`poc-*` 网络 0；Colima 复核后已停止（`colima status` → not running）；本会话 shell 里 `ENABLE_PAID_API` / `COST_AUTHORIZED` / `OPENAI_API_KEY` 命中数 0；无 `.env`；全库 `sk-` 长串命中仅 3 处且全部在 gitignore 的 `generated/` 上游文档里，实测为**同一字符重复的占位串**（distinct/len=0.04）；两个付费开关在仓库里只以"命令示例文本"出现，未写入任何配置。

**Git 面（复核后仍成立）**：分支 `spike/opengame-poc`，HEAD `8d97218`，`git status --porcelain` = `?? spikes/`（整体未提交），`apps/ifplay-m0/` porcelain 与 `git diff HEAD` 均为 0 行，上游只读缓存 `opengame@c9bea377` HEAD 仍是 `c9bea37786af…`；未提交、未推送、未建 PR；M2 主后端工作树未触碰。

**仍未解决（不因复核通过而改变）**：真实 DeepSeek 兼容性**依然未验证**——E 组证明的是"内网等价拓扑"，上游是本地假服务。"脚本已修"不等于"DeepSeek 已接通"。一次性授权已用满，是否再给一次由产品经理决定。

### 14.12 复核之后：第 3 次真实冒烟已成功（2026-10-05，指向成功报告）

本节只做**追加指向**，不改动 14.5 / 14.8 / 14.10 / 14.11 的历史结论（前两次失败、零条请求发出、费用无法确认，都如实保留）。

- 上面那句"依然未验证"已被 2026-10-05 14:14 的第 3 次真实运行**部分关闭**：真实 DeepSeek 接受了 `thinking={"type":"disabled"}` + `max_tokens=512` + `stream_options.include_usage`，两次转发均 200 并回传真实 usage 与响应 `model` 字段，`SMOKE.txt` 字节完全匹配。完整 15 项取证见 `reports/阶段二-DeepSeek最小真实冒烟成功报告.md`。
- **仍未关闭的**：具体模型版本（响应只回显滚动名 `deepseek-flash`）、长会话多轮工具链、真实游戏代码生成。冒烟通过 ≠ 第二轨可用。
- **费用口径**：我方账本 `0.012421` 元（保守汇率 7.5 × 高峰档单价，只当上限）；**DeepSeek 控制台账单待产品经理核对**，我没有收到控制台数字，也不做推断。
- 授权状态：2026-10-05 这次授权再次**用满**。五款真实游戏（含「深夜食堂经营」）需要**新的、单独的费用授权**；`generate-game.sh --execute` 仍硬拒绝，图片与自动修复仍未获授权。

