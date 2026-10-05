# 阶段二 · DeepSeek 最小真实冒烟报告（第 2 次尝试：未成功，费用 0 元的判定与依据）

> **后续指向（2026-10-05 追加，不改写下文任何历史结论）**：第 3 次尝试已在真实 DeepSeek 上成功，见 `reports/阶段二-DeepSeek最小真实冒烟成功报告.md`。下面记录的两次失败原因（bash 3.2 UTF-8 变量扩展、Docker 容器名 DNS 拓扑）与"零条模型请求发出"的判断保持不变，作为过程证据保留。

- 时间：2026-10-04 17:32:53–17:32:58（本地，UTC 09:32:53Z–09:32:58Z）
- 授权范围：仅一次最小冒烟任务；硬上限人民币 0.10 元（预警 0.08 元）；不授权游戏生成、图片、自动修复、第二次付费尝试
- 结论：**冒烟未成功**（`SMOKE.txt` 未生成）。失败点是我方隔离拓扑里的一个容器名解析缺陷，请求**从未离开本机**，因此本次没有产生模型调用；但"0 元"只能由 DeepSeek 控制台最终确认，我方账本按纪律**不入账**（缺 usage）
- 本报告按授权指令第七节要求的 15 项逐条回答。取证原文已归档：`generated/smoke-run-archive/attempt2-20261004T1732/`（7 个文件）与自动归档 `generated/smoke-run-archive/20261004T130533Z/`

---

## 一、15 项逐条回答

### 1. 是否真实经过 OpenGame 调用链

**是（到转发器为止）。** 真实补丁 CLI 在隔离容器里跑完了它的那一半：

- `cli.jsonl` 的 `system/init` 行显示 `qwen_code_version=0.6.0`、`model=deepseek-flash`、`tools=["write_file"]`、`permission_mode=auto-edit`（未用 `--yolo`）
- 转发器确实收到并由 OpenAI SDK 发出了 1 条 `POST /v1/chat/completions`，请求体 22020 字节、`messageCount=4`
- CLI 最终输出 `[API Error: 502 上游请求失败（不会自动重发）]`，`num_turns=1`、`duration_ms=64`、`duration_api_ms=53`

**没有**经过的部分：请求在转发器容器内部解析 egress 代理容器名时失败，未到代理、未到 DeepSeek。

> 附带发现（风险，见第 14 项）：OpenGame 在 API 报错时进程仍以 `CLI_RC=0` 退出。**退出码不能作为冒烟成功判据**，必须看 `SMOKE.txt` 内容 + 转发器取证。

### 2. 是否成功生成内容完全正确的 `SMOKE.txt`

**否。** 校验输出：`{"smokeExists": false, "exactMatch": false, "bytes": 0, "sha256": null, "content": null}`。未产出任何文件，也没有多余文件。

### 3. 请求模型名与 API 实际返回的 model 字段

- 请求模型名：`deepseek-flash`（转发器取证 `requestedModel`，与 CLI 配置一致）
- 实际返回 model：**未取得实际版本**（无任何上游响应）。按纪律不用配置值冒充响应值，也不引用 OpenGame 输出行里的 `"model":"deepseek-flash"`（那是 CLI 回显的配置，不是供应商响应）

### 4. 输入、缓存输入、输出和总 Token

| 项 | 值 | 来源 |
| --- | --- | --- |
| 输入 | 未取得（无响应） | 转发器 `usage=null` |
| 缓存输入 | 未取得 | 同上 |
| 输出 | 未取得 | 同上 |
| 总 | 未取得 | 同上 |

旁证（**不是**供应商 usage，只作对照）：CLI 自报 `input_tokens=0, output_tokens=0, cache_read_input_tokens=0`；转发器按字节保守估算 `estTokens=7340`。

### 5. 按 7.5 汇率计算的人民币费用

- 汇率是显式配置的保守熔断值（非实时）：`config/providers.json` 的 `smoke.fxUsdCny=7.5`
- **本次账本未入账，费用无法由我方确认**：记账规则是"缺 usage 立即停止，不按 0 元处理"
- 判定"很可能 0 元"的依据（不是计费凭证）：失败是转发器容器内的 `getaddrinfo EAI_AGAIN poc-smoke-proxy`，即 DNS 解析阶段失败、连 TCP 都没建到代理；egress 代理（本机唯一出口）日志里**只有一行 listening，零条 allow/deny/隧道记录**，说明没有任何一帧发往 `api.deepseek.com`
- 付费前预检（若 3 次全 cache-miss、全 512 输出）最坏 `0.065124` 元 ≤ 0.10 元硬上限，单请求最坏 `0.021708` 元

### 6. DeepSeek 控制台账单是否暂未核对

**是，暂未核对，且必须由产品经理在控制台核对。** 我方没有任何能证明"0 元"的计费侧凭证；上面第 5 项只是拓扑层面的证据。

### 7. `thinking.type=disabled` 与 `max_tokens=512` 是否在最终请求中生效的证据

**在"最终由 OpenGame 发出的 HTTP 请求体"层面已证否/证实：证实。** 转发器逐条断言到的这条请求：

```
thinking={"type":"disabled"}  maxTokens=512  stream=true  includeUsage=true
reasoningEffort=null  toolNames=["write_file"]  bodyBytes=22020
```

这与补丁要求一致（`patches/0001-deepseek-disable-thinking.patch` + `POC_DEEPSEEK_DISABLE_THINKING=1`，`pipeline.ts` 的白名单不含 `thinking`，配置注不进去）。
**未验证的部分**：这些字段是否被真实 DeepSeek 接受（供应商侧行为仍属未知，见第 14 项）。

### 8. 实际发生的网络域名和拒绝记录

| 层 | 记录 |
| --- | --- |
| egress 白名单代理（唯一出口） | 仅 `[egress-proxy] listening on 0.0.0.0:3128 (default deny)`，**0 条 allow、0 条 deny、0 条隧道** |
| 转发器 | `listen`（upstream=api.deepseek.com:443）→ `upstream-error`（n=1, `EAI_AGAIN poc-smoke-proxy`, 10ms）→ `refuse`（502 `SMOKE_UPSTREAM_FAIL`, forwarded=false, 11ms） |
| 实际出去的域名 | **无**。请求没到代理，也就没有任何出站连接 |

### 9. Key 脱敏检查结果

- Key 只经 `docker run -e OPENAI_API_KEY`（无值形式）从脚本环境继承进容器：不进命令行参数、不进文件、不进日志、不进 Git；脚本只报"已设置/长度"，本次长度 35，未回显
- 归档 7 个取证文件按**值**扫描（`sk-[A-Za-z0-9]{8,}`、`Bearer` 后跟值、`"api_key":"值"`）：**0 命中**
- 失败当时那行 `SMOKE_ABORT: 日志中出现疑似凭据关键字` 是**我方审计的误报**：旧审计按关键字 `authorization` 匹配，命中的是我自己写进取证的字段名 `authorizationHeaderPresent`（布尔值，不含密钥）。已改为按值匹配 + 用本次 Key 的 8 字符片段逐一比对（只报命中与否），并把记账移到审计之前，保证费用证据不会因审计结论而丢失
- 未读取、未复用、未查找用户输入过的 Key

### 10. 是否发生任何重试

**0 次。** `.qwen/settings.json` 的 `maxRetries=0`；转发器收到 `n=1` 一条请求，失败即返回 502 且不重发；`num_turns=1`。故障后没有第二次付费尝试。

### 11. 付费开关、Key、容器和网络是否已清理

**已全部清理（2026-10-04 21:08 复查）：**

- `env | grep -E '^(ENABLE_PAID_API|COST_AUTHORIZED|OPENAI_API_KEY)='` → 空；闸门从未写入任何持久化配置
- `docker ps -a` / `docker network ls` 里 `poc-*` → 均为 0（含彩排用的 `poc-e-*`）
- Colima 已停止
- 取证目录归档后清空，避免下一轮混淆（本轮顺手修掉了"演练会 rm -rf 掉上一轮真实取证"的缺陷）

### 12. 本轮新增及修改文件

新增：

| 文件 | 作用 |
| --- | --- |
| `runner/diag-relay-proxy-dns.sh` | 零费用复现本故障：容器名只在**共享网络**内可解析；分离时 `EAI_AGAIN`，接入共享网络后 `DNS_OK TCP_OK`（`DNSDIAG_PASS`） |
| `runner/chain-e-client.mjs` | 彩排用例 E 的客户端：发一条形状合规的请求，验证"转发器→代理→上游"整跳并核对 SSE usage/[DONE] |
| `runner/probe-tunnel.mjs` | 分层探针（TCP→CONNECT→TLS→HTTP 分阶段计时），定位卡点用 |

修改：

| 文件 | 改了什么 |
| --- | --- |
| `runner/run-deepseek-smoke.sh` | ① 中继同时接入 `poc-smoke-net` + `poc-egress-net`（根因修复）；② CLI 启动前必须看到转发器 `proxy-precheck ok=true`，否则停止且零请求；③ 断言两个网络仍是 `internal`、中继没接 `bridge`；④ 中继 IP 改为按网络名取（接两网后旧写法会拿到两个 IP）；⑤ 记账移到凭据审计之前；⑥ 审计改按值匹配 + Key 片段比对；⑦ 上游空闲超时 120s 显式化；⑧ 取证增加 `forwardedAttempts/upstreamErrors/proxyPrecheck`；⑨ 残留检查扩到所有 `poc-*` 容器与网络；⑩ 旧取证先归档再清空 |
| `runner/smoke-relay.mjs` | 新增 real 模式启动自检 `proxy-precheck`（只解析+TCP，不发 CONNECT/请求体，失败即 `exit 1`）；新增上游空闲超时 `upstream-timeout` 取证并断流（否则对端不回 HTTP 时转发器会永久挂起，CLI 只能靠 420s 兜底） |
| `runner/verify-smoke-chain.sh` | 新增用例 E（real 中继→白名单代理→内网 TLS 假上游，5 项断言）与用例 F（反向：不共享网络必须预检失败即退出、零请求）；清理扩到 `poc-e-*` |
| `runner/mock-deepseek.mjs` | 支持 `--host/--tls-cert/--tls-key`，并修掉一个真实缺陷：TLS 版必须是 `https.createServer`（写成 `tls.createServer` 时监听器收到裸 socket，HTTP 请求永不响应 → 用例 E 就是这么挂住的） |
| `README.md` | 容器隔离示例参数改绝对路径；新增 E/F 与 `diag/probe` 说明（见下） |

### 13. 当前分支、HEAD、Git 状态与 `apps/ifplay-m0/` 零改动证明

```
分支：spike/opengame-poc
HEAD：8d97218454c0c9f6074efaf110bfa21c36e71c15（未提交、未推送、未建 PR）
git status --porcelain（worktree 根）：?? spikes/        ← spike 整体未入库，符合"不提交"
git status --porcelain -- apps/ifplay-m0：（空）          ← 零改动
上游只读缓存 opengame@c9bea377：HEAD=c9bea37786af524bf3bbe802f2b67d23816fa5c0，status 空
```

补丁只落在隔离克隆副本 `generated/smoke-src`（`generated/` 已被 spike 的 `.gitignore` 排除）。**上游基线 SHA 仍记为 `c9bea377…`；打了补丁的副本不等于该 SHA，也不宣称等于。**

### 14. 尚未解决的风险

1. **真实供应商链路一次都没验证成功。** 用例 E 证明的是"内网等价拓扑"（同一套转发器/代理/隧道代码，上游换成本地 TLS 假服务）；真实 DeepSeek 是否接受 `thinking.type=disabled`、回什么 `model` 字段、usage 形态如何，仍未知。
2. **费用只有控制台能确认。** 我方账本对这次"无 usage"的情况按纪律不入账、不按 0 元处理。
3. **OpenGame 出错也返回 `CLI_RC=0`**，成功判据只能是 `SMOKE.txt` 严格匹配 + 转发器取证；后续所有真实运行都要按这条写判据。
4. **real 模式上游证书校验**在彩排里靠 `NODE_EXTRA_CA_CERTS=本地CA` 走通；真实运行时走系统 CA 与真证书，这条分支只有真跑一次才算覆盖。
5. 转发器一旦向上游发出请求就把该次计入额度（即便上游报错也不重发）。预检已把"必然失败的拓扑错误"挡在发送之前，但**真实网络抖动仍可能消耗额度并拿不到 usage**，此时只能停止 + 控制台核对，不能自动重试（授权明令）。
6. Key 长度校验只判 `>=20`，不能识别"粘贴了错误字符串"；本次长度 35 属正常形态，但形态不等于有效性。

### 15. 五款真实游戏是否已开始

**没有。** 未生成任何游戏（含"深夜食堂"），未调用任何图片路径，`runner/generate-game.sh --execute` 仍在生成链路接上验证转发器之前直接拒绝。

---

## 二、根因（一句话）+ 修复前后对照

**根因：Docker 的容器名解析只在"共享同一网络"的容器之间生效。** 中继只接了 `poc-smoke-net`，egress 代理只接了 `poc-egress-net`，所以中继向上游转发时 `getaddrinfo EAI_AGAIN poc-smoke-proxy`；10ms 内失败，代理侧零记录。彩排 A–D 用的是 mock 上游（`127.0.0.1`，不经代理），所以这一跳从没被测过。

零费用复现（`runner/diag-relay-proxy-dns.sh` 实测）：

```
步骤1：代理只在 poc-diag-egress，中继只在 poc-diag-smoke → rc=2 DNS_FAIL EAI_AGAIN
步骤2：把中继同时接入 poc-diag-egress                → rc=0 DNS_OK TCP_OK
DNSDIAG_PASS separated_unresolvable=1 shared_reachable=1
```

修复后：中继同时接入两网 + 启动自检 + CLI 前置闸门，同类错误**不可能再消耗一次付费请求**。

## 三、修复后的零费用回归（2026-10-04，`LC_ALL=en_US.UTF-8`，全部 `cost_cny=0`）

| # | 步骤 | 结果 |
| --- | --- | --- |
| 1 | `npm run test:deepseek` | PASS（25 项，含 12 类必测场景） |
| 2 | `node runner/budget.mjs` | PASS（6 项） |
| 3 | `npm run test:egress-proxy` | PASS（7/7） |
| 4 | `npm run gates` | 退出码 3 = **按设计拒绝**（`REFUSE: ENABLE_PAID_API 未显式设为 true`）；这是闸门关闭的证明，不是缺陷 |
| 5 | `npm run dry-run` | PASS |
| 6 | `bash runner/verify-opengame-build.sh` | PASS（`VERIFY_OPENGAME_BUILD_PASS`，SHA/digest 锁定、离线冒烟） |
| 7 | `bash runner/apply-thinking-patch.sh` | PASS（补丁重放 + 离线重建） |
| 8 | `bash runner/verify-deepseek-request-shape.sh` | PASS（线上请求体形状） |
| 9 | `bash runner/verify-container-isolation.sh "$PWD/fixtures/selftest"` | PASS（6/6，全部通过；参数需绝对路径，README 已改） |
| 10 | `bash runner/verify-model-egress.sh` | PASS（全量白名单） |
| 11 | `EGRESS_MODE=smoke ALLOWLIST=egress-allowlist.smoke.json bash runner/verify-model-egress.sh` | PASS（冒烟档只放行 `api.deepseek.com:443`） |
| 12 | `bash runner/diag-relay-proxy-dns.sh` | PASS（`DNSDIAG_PASS`，本故障的零费用复现） |
| 13 | `bash runner/verify-smoke-chain.sh` | PASS（A 合规 7 项 / B 不合规零转发 / C 失败不重发 / D·D2·D3 记账中止 / **E 付费拓扑 5 项 / F 反向 1 项**；写 `PASS` 标记） |
| 14 | `SMOKE_DRY_RUN=1 bash runner/run-deepseek-smoke.sh` | PASS（`SMOKE_DRYRUN_PASS cost_cny=0`，含 Key 解析与长度校验同段代码） |

日志：`generated/build-logs/free-suite-20261004T130315Z.log`（容器/网络残留：0）。

用例 E 的关键输出（彩排版真实链路一跳）：

```
E1 中继启动即完成代理预检（ok=true）      PASS   precheck ms=6
E2 egress 代理只建了一条隧道              PASS   tunnelCount=1
E3 经隧道拿到 200 + usage + 实际 model    PASS   usage={100,50,150,cached 0}
E4 零拒绝、零上游错误                     PASS   refused=0
E5 客户端 SSE 收到 usage 且 [DONE] 收尾   PASS   clientOk=true
F1 未共享网络 → 预检失败即退出，零请求     PASS   EAI_AGAIN, attempts=0, containerStatus=exited
```

## 四、授权状态与下一步（需要产品经理决定）

- **这次的一次性授权已用尽**（授权原文只允许"一次最小冒烟"）。我不会自行重跑，也不复用/查找之前输入过的 Key。
- 若同意再来一次，请重新给一次明确授权（同样的 0.10 元硬上限、一次任务、无图片、无自动修复、无第二次尝试），然后在终端执行唯一那条命令并按提示隐藏输入 Key：

```bash
ENABLE_PAID_API=true COST_AUTHORIZED=true bash runner/run-deepseek-smoke.sh
```

- 也可以先去 DeepSeek 控制台核对账单（本次应无消费记录），确认无费用后再决定是否重跑。
