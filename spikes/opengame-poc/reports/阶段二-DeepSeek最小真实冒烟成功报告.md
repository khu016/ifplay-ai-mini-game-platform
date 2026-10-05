# 阶段三 · DeepSeek 最小真实冒烟**成功**报告（第 3 次尝试，2026-10-05）

- 时间：2026-10-05 14:14:46–14:14:58（本地 UTC+8）= `2026-10-05T06:14:46Z`–`06:14:58Z`
- 授权：**产品经理在 2026-10-05 重新明确授权**一次最小真实冒烟，硬上限人民币 **0.10 元**（预警 0.08 元）；不授权游戏生成、不授权图片、不授权自动修复、不授权第二次付费尝试。命令由产品经理**自己在终端执行**，Key 由终端隐藏输入，**全程未经我手、未进聊天/历史/参数/文件/日志/Git**。
- 结论：**成功**。真实 OpenGame Agent（打过 `thinking` 关闭补丁的隔离副本）经隔离容器 + TLS 验证转发器 + egress 白名单代理，向真实 DeepSeek 发出 **2 次** `POST /v1/chat/completions`，两次都 200，并写出**字节完全等于** `IFPLAY_DEEPSEEK_SMOKE_OK` 的 `SMOKE.txt`。
- 实际费用：**我方账本（真实 usage × 高峰价 × 显式汇率 7.5 的保守折算）0.012421 元**，脚本结束行输出 `SMOKE_RUN_DONE cost_cny=0.0124`。**DeepSeek 控制台账单尚未核对**（我没有拿到控制台数字，也不自行推断）；最终费用以产品经理在控制台核对的账单为准。未触预警线 0.08 元，未触硬停 0.10 元。
- 取证目录：`generated/smoke-run/`（13 个文件，全部在 gitignore 内）。本报告按授权指令第七节要求的 15 项逐条回答。
- 历史：前两次失败记录保留、不覆盖 —— `reports/阶段二-DeepSeek最小真实冒烟报告.md`（第 2 次）与接入准备报告第 14.5/14.8 节（第 1、2 次）。

---

## 一、15 项逐条回答

### 1. 是否真实经过 OpenGame 调用链

**是，完整经过。** 证据链三段都在：

- `cli.jsonl` 的 `system/init`：`qwen_code_version=0.6.0`、`model=deepseek-flash`、`tools=["write_file"]`、approval mode `auto-edit`（**未使用 `--yolo`**，shell 工具仍禁用）
- `cli.jsonl` 的 `result`：`subtype=success`、`is_error=false`、`num_turns=2`、`result="已创建 /work/SMOKE.txt，内容为 IFPLAY_DEEPSEEK_SMOKE_OK。"`
- `relay-evidence.jsonl`：转发器收到并由 OpenAI SDK 发出 **2 条**真实请求（`n=1`、`n=2`），上游 `api.deepseek.com:443(经 egress 代理 CONNECT)`，两条 `responseStatus=200`

即"补丁 CLI → `/etc/hosts` 固定 → TLS 验证转发器 → egress 白名单代理 → 真实 DeepSeek"整条链路首次真实跑通。

### 2. 是否成功生成内容完全正确的 `SMOKE.txt`

**是。** `generated/smoke-run/SMOKE.txt` **24 字节**，与 `IFPLAY_DEEPSEEK_SMOKE_OK` 逐字节相等（无换行、无 BOM、无尾随空格）。脚本校验行：`"smokeFileExact": true`。
`"unexpectedFiles": []` —— 没有多出任何文件；`proxy.log` 与 `cli.err` 是取证产物，不是 Agent 创建的项目文件。

### 3. 请求模型名与 API 实际返回的 `model` 字段

| 项 | 值 | 来源 |
| --- | --- | --- |
| 请求模型名 | `deepseek-flash` | 转发器取证 `requestedModel`（两次一致） |
| **实际返回 model** | **`deepseek-flash`** | **响应体 `model` 字段**，账本记为 `actualModels: ["deepseek-flash <== vendor-response"]` |

如实说明两点：① 这次**取到了接口响应的 model 字段**，不是用配置值冒充；② 但 DeepSeek 把**滚动名原样回显**，响应里**没有**更细的具体版本号，因此"实际版本"仍无法钉死（`DeepSeek-V3.x` 具体哪一版未知）。CLI 侧 `model` 字段仍属 `cli-config`，本报告不拿它当响应值。

### 4. 输入 / 缓存输入 / 输出 / 总 Token（真实 usage，两次分别记录）

| 次 | `prompt_tokens` | 其中 cached | miss | `completion_tokens` | `total_tokens` | 响应耗时 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4838 | 0 | 4838 | 70 | 4908 | 1124 ms |
| 2 | 4936 | **4736** | 200 | 27 | 4963 | 506 ms |
| 合计 | **9774** | **4736** | 5038 | **97** | **9871** | — |

- usage 来自响应体 `usage` 字段（`stream_options.include_usage=true` 生效），非估算。
- CLI 自报 `input_tokens=9774 / output_tokens=97 / cache_read_input_tokens=4736 / total_tokens=9871`，与响应 usage 合计**逐项一致**（互为旁证）。
- 第 2 次 `cached_tokens=4736` 说明**前缀缓存在真实 DeepSeek 上生效**，因此实际费用远低于最坏预演。

### 5. 按 7.5 汇率计算的人民币费用

- 汇率是**显式配置的保守熔断值**，非实时牌价：`config/providers.json → smoke.fx.usdCny = 7.5`，状态写明"故意取高不取低"。
- 分档单价（CNY / 1k token，DeepSeek 官方高峰牌价折算）：缓存命中 `0.000045`、未命中 `0.00225`、输出 `0.009`。
- 逐笔：第 1 次 `4.838k×0.00225 + 0.070k×0.009 = 0.011515` 元；第 2 次 `0.200k×0.00225 + 4.736k×0.000045 + 0.027k×0.009 = 0.000906` 元。
- **合计 0.012421 元，账本汇总 `spentCny = 0.0124`**（约合 ¥0.0124 ≈ 1.24 分；按 7.5 反算约 `$0.001656`）。
- 对照：付费前最坏预演 `0.065124` 元（3 次 × 7600 in + 512 out，全按 miss 高峰价），实际只用了它的 **19%**。`warned=false`、`aborted=false`、`withinHardStop=true`。
- 四类费用同一账本：`reasoning / repair / image` 三项 **calls=0、spent=0、images=0**（本次授权不含自动修复与图片）。

### 6. DeepSeek 控制台账单是否暂未核对

**暂未核对。** 我手上只有我方自己的记账证据：真实 usage（`relay-evidence.jsonl` 两次响应）→ `ledger.json` 逐笔 `0.011515 + 0.000906 = 0.012421` 元 → 脚本输出 `SMOKE_RUN_DONE cost_cny=0.0124`。**控制台侧的数字我没有收到，也不去猜**（此前版本里写过的"账单 0.011955 元、已核对一致"是我把未经确认的数字当成了事实，已撤回）。

- 为什么必须单独核对：账本用的是**显式配置的保守汇率 7.5**（故意取高）和**高峰档单价**，两边口径不同，所以账本数字天然可能高于实际账单；反向差异（账单明显高于账本）则说明 usage 采集或分档计价有漏。
- 我方能自证的只有"没有多扣"：`forwardedAttempts=2`、`upstreamErrors=[]`、`refused=[]`、代理日志恰好 2 条 `api.deepseek.com:443` allow 且 0 条其他域名 —— 即**付费请求恰好 2 条，没有重试、没有越界**，这是"费用不超过账本口径"的必要条件。
- 我方**无法**自证的：供应商侧实际结算价、实际汇率、是否有其他计费项。**费用是否为零或为 0.0124 元量级，只能由产品经理在 DeepSeek 控制台核对。**
- 请核对的口径：2026-10-05 14:14（北京时间）前后 2 次 `deepseek-flash` chat completions，输入合计 9774 token（其中缓存命中 4736）、输出 97 token。

### 7. `thinking.type=disabled` 与 `max_tokens=512` 在最终请求中生效的证据

转发器是在**最终 HTTP 请求体**上逐条断言的（不合规就地 400 且零转发），两条请求都记录到：

```
n=1  thinking={"type":"disabled"}  maxTokens=512  stream=true  includeUsage=true  reasoningEffort=null  toolNames=["write_file"]  bodyBytes=22020  messageCount=4
n=2  thinking={"type":"disabled"}  maxTokens=512  stream=true  includeUsage=true  reasoningEffort=null  toolNames=["write_file"]  bodyBytes=22394  messageCount=6
```

- `thinking` 能进最终请求**靠补丁**（`patches/0001-deepseek-disable-thinking.patch` + `POC_DEEPSEEK_DISABLE_THINKING=1`）；`pipeline.ts` 的参数白名单不含 `thinking`，配置文件注不进去（R10 已证实）。
- `max_tokens=512` 由 `.qwen/settings.json` 的 `model.generationConfig.samplingParams` 透传，线上取证为实际值（R3 已证实可硬控）。
- **供应商侧也确认接受**：两次都返回 200 且回传 usage，没有出现"`thinking` 字段未知"或 400 报错（R7 的这一半已解决）。

### 8. 实际发生的网络域名和拒绝记录

| 层 | 记录 |
| --- | --- |
| egress 白名单代理（本机唯一出口） | `listening on 0.0.0.0:3128 (default deny)` → **2 条 `status:allow`，全部 `api.deepseek.com:443`（category=model，bytes 19351 / 15366）**；**0 条 deny、0 个其他域名** |
| 转发器 | `proxy-precheck ok=true (10ms)` → `forward n=1 200` → `forward n=2 200`；`refused=[]`、`upstreamErrors=[]` |
| CLI 侧 | `--internal` 网络 + `/etc/hosts` 把 `api.deepseek.com` 固定到中继 `172.18.0.2`；中继**未接 bridge**（脚本断言），CLI 无宿主机路由 |

本轮**没有**任何 npm、RUM、`chat.qwen.ai`、图片域或其他模型域的连接尝试。

### 9. Key 脱敏检查结果

- 注入方式：只经 `docker run -e OPENAI_API_KEY`（无值形式）从脚本环境继承；不进命令行参数、不进文件、不进日志、不进 Git。脚本只报"已设置（长度 …）"。
- 我对 `generated/smoke-run/` 全部 **13 个取证文件按值扫描**（`sk-…`、`Bearer <值>`、`"api_key":"<值>"`、`"authorization":"<值>"`）：**0 个文件命中**。上一轮那种按字段名误报的审计已改成按值。
- 转发器只记 `authorizationHeaderPresent: true`（布尔），从不落请求头原文。
- 我没有读取、查找、复用任何 Key；本报告不复述 Key 的任何片段（长度也只在脚本输出里出现，我不转录）。

### 10. 是否发生任何重试

**0 次重试。** 2 条请求是**同一个任务的两个 Agent 轮次**（第 1 轮请求写文件工具、第 2 轮回传工具结果并确认完成），不是重发：`num_turns=2`、`.qwen/settings.json` 的 `maxRetries=0`、`upstreamErrors=[]`、`refused=[]`、转发器单请求锁（`RELAY_MAX_REQUESTS=3`）未触发。任何 429/5xx/网络错误都会停止且不重发（授权明令），这次没有发生。

### 11. 付费开关、Key、容器和网络是否已清理

**已全部清理（我于 2026-10-05 15:15 本地时间复查）：**

- 脚本结尾自动 `SMOKE_ABORT/CLEANUP`：`[smoke] Colima 已停止`
- `poc-*` 容器 **0**、`poc-*` 网络 **0**（daemon 已随 Colima 关闭）
- 我的会话 shell 里 `ENABLE_PAID_API` / `COST_AUTHORIZED` / `OPENAI_API_KEY` 命中数 **0**；两个开关只在那一条命令的生命周期内存在，**未写进任何配置文件**
- 账本状态落盘保留（`ledger.json` / `ledger-state.json` / `precheck.json` / `wire-evidence.json`），费用证据不因清理而丢失

### 12. 本轮新增及修改文件

**新增（本报告与取证，均在 gitignore 或 spike 未跟踪范围内）**

| 文件 | 说明 |
| --- | --- |
| `reports/阶段二-DeepSeek最小真实冒烟成功报告.md` | 本报告 |
| `generated/smoke-run/`（13 个文件） | `SMOKE.txt`、`cli.jsonl`、`cli.err`、`hosts`、`relay-evidence.jsonl`、`relay.log`、`proxy.log`、`precheck.json`、`ledger.json`、`ledger-state.json`、`wire-evidence.json`、`smoke-result.json`、`.qwen/settings.json` |

**修改（文档，不覆盖历史）**

| 文件 | 改了什么 |
| --- | --- |
| `README.md` | 阶段三状态行改为"第 3 次成功、费用 0.0124 元、控制台待核对"，并保留两次失败的如实记录 |
| `reports/阶段二-DeepSeek接入准备报告.md` | 追加第 14.12 节（成功结论与指向本报告），14.8–14.11 的失败与复核记录原样保留 |
| `config/providers.json` | `smoke` 块新增 `authorizationHistory` 数组（2026-10-04 两次失败、2026-10-05 一次成功，各附对应报告路径），`comment` 改为"发起任何真实调用都需要产品经理在该次运行前重新明确授权"；预算数值、汇率、定价、规则文本**一字未改**（每款 3.0 元的游戏预算块保持不动），付费开关没有被持久化打开 |

**未修改**：`apps/ifplay-m0/` 零改动；上游只读缓存 `opengame@c9bea377` 未动；未提交、未推送、未建 PR；M2 主后端工作树未触碰。

### 13. 当前分支、HEAD、Git 状态与 `apps/ifplay-m0/` 零改动证明

```
分支：spike/opengame-poc
HEAD：8d97218454c0c9f6074efaf110bfa21c36e71c15（短 8d97218）——本轮未新增任何提交
git status --porcelain（worktree 根）：?? spikes/        ← 整个 spike 仍未跟踪，符合"不提交"
apps/ifplay-m0/：git status --porcelain 命中 0 行；git diff HEAD 输出 0 行
上游只读缓存 opengame@c9bea377：HEAD=c9bea37786af524bf3bbe802f2b67d23816fa5c0（未升级、未重新 clone）
```

补丁只作用在隔离克隆副本 `generated/smoke-src`；**上游基线 SHA 仍登记为 `c9bea377…`，补丁副本不等于该 SHA，也不宣称等于**。

### 14. 尚未解决的风险

1. **R1（跨顶层轮次 `reasoning_content`）在"非思考模式 + 2 轮工具链"这一条路径上有了正面结果**：第 2 次请求（`messageCount=6`，含上一轮 assistant 的 `tool_calls`）在**没有 `reasoning_content` 字段**的情况下被 DeepSeek 接受并返回 200。但样本只有 1 个任务、2 个轮次，**不能外推到多轮代码生成**（真实生成可能有几十轮工具调用、更长历史）。所以 R1 记为"非思考模式冒烟路径未见要求，长会话仍待观察"，不写"已彻底解决"。
2. **具体模型版本仍未钉死**：响应 `model` 回显滚动名 `deepseek-flash`，拿不到 `DeepSeek-V3.x` 具体版本号（R4 的这一半未解决）。
3. **汇率仍是显式保守值，且账单未核对**：`7.5` 不是实时牌价，是故意取高的熔断折算值，所以**账本 `0.012421` 元只能当上限口径，不能当实际账单金额引用**。真实账单必须由产品经理在 DeepSeek 控制台核对（见第 6 节，截至本报告写成时**尚未核对**）。若要精确对账，需接入实时汇率并单独确认，属于新的决策，不自行改。
4. **本次冒烟是"写一个 24 字节文本文件"**，不证明 Agent 能产出可构建、可运行、可验收的游戏代码。第二轨的真实价值（代码生成→构建→测试→审核）仍未验证。
5. **`--core-tools write_file` 只开了一个工具**，真实生成需要读写、构建、测试等更广工具面，那会带来新的费用与网络面问题；`generate-game.sh --execute` **仍硬拒绝**，改造完成前不要尝试。
6. **输出上限 512 与 `RELAY_MAX_BODY_BYTES=40000` 是冒烟专用紧约束**，游戏生成必然要放宽；放宽后的预算、预估与闸门需要重新设计和单独授权。
7. 本地自签 CA（`generated/smoke-tls/`）是**有意披露的取证中间人**；若未来把这条链路搬到别的机器，证书与信任链要重新设计，不能让上游证书校验降级为不校验。

### 15. 五款真实游戏是否已开始

**没有。** 未生成任何游戏（含首款「深夜食堂经营」），未调用图片路径，未做自动修复。五款真实游戏需要**新的、单独的费用授权**（每款 3.0 元/款的预算块与冒烟的 0.10 元块完全分开，本次授权不可延伸解释）。

---

## 二、这次跑通了什么（一句话）

**R9（代理约束不住 CLI）与 R10（`thinking` 无法注入）这两个上游缺陷，被"补丁 CLI + `/etc/hosts` 固定 + TLS 验证转发器 + `--internal` 唯一出口 + 双网卡中继 + 启动预检"的拓扑解决；DeepSeek 官方 OpenAI 兼容接口在 `thinking.type=disabled` + `max_tokens=512` + `stream_options.include_usage` 的组合下真实可用，并能返回 usage 与响应 model 字段。**

## 三、下一步（等你指示，我不自行继续）

1. 你先在 DeepSeek 控制台核对本次账单（预期与 0.0124 元同量级）。
2. 若要把这条链路推进到五款真实游戏，需要单独授权费用与范围；在此之前我会先做三件零费用的事：把工具面与预算规则重新设计成可取证的生成拓扑、把 `generate-game.sh --execute` 接上验证转发器、把长会话 `reasoning_content` 与多轮费用用本地假服务压测覆盖。
3. 期间分支、HEAD、`apps/ifplay-m0/`、上游 SHA 与"不提交不推送不建 PR"的约束继续保持。
