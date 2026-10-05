#!/usr/bin/env bash
# 阶段二·DeepSeek 最小真实冒烟（会产生真实费用；本次授权总额硬上限 0.10 元，仅限一次最小任务）
#
# 授权范围：一次写 SMOKE.txt 的真实 Agent 调用。
# 不授权：任何游戏生成、任何图片调用、任何自动修复、任何第二次付费尝试。
#
# 隔离拓扑（宿主机绝不直连模型）：
#   poc-smoke-cli   --internal 网络，补丁 CLI，/etc/hosts 把 api.deepseek.com 固定到转发器；Key 只经容器环境变量继承
#   poc-smoke-relay 验证转发器：断言 thinking/max_tokens/stream+include_usage，取证 usage 与实际 model，然后经隧道转发
#   poc-smoke-proxy egress 白名单代理（smoke 白名单：只放行 api.deepseek.com:443），是全网唯一出口
#
# 付费开关 ENABLE_PAID_API / COST_AUTHORIZED 只能由调用方在【这一条命令】的环境里临时给出，
# 本脚本不写任何持久化配置；结束时清容器、清网络、停 Colima。
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$SPIKE/../.." && pwd)"
BASE_IMAGE="${BASE_IMAGE:-node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df}"
SRC="$SPIKE/generated/smoke-src"
TLS="$SPIKE/generated/smoke-tls"
WORK="$SPIKE/generated/smoke-run"
CHAIN_ROOT="$SPIKE/generated/smoke-chain"
OG_CACHE="${OG_CACHE:-/Users/a123/Documents/Codex/2026-09-15/ifplay-opengame-poc/opengame@c9bea377}"
NET_SMOKE="poc-smoke-net"; NET_EGRESS="poc-egress-net"
PROXY_C="poc-smoke-proxy"; RELAY_C="poc-smoke-relay"; CLI_C="poc-smoke-cli"
EXPECT_BRANCH="spike/opengame-poc"
EXPECT_HEAD="8d97218454c0c9f6074efaf110bfa21c36e71c15"
UPSTREAM_SHA="c9bea37786af524bf3bbe802f2b67d23816fa5c0"
MODEL="deepseek-flash"
PLANNED_REQUESTS="${PLANNED_REQUESTS:-3}"
# 7600 = 彩排实测最大请求体 22465 字节 / 3 向上取整（22465/3=7488）再留余量，宁可高估不低估。
EST_INPUT_TOKENS="${EST_INPUT_TOKENS:-7600}"
PROMPT="请创建一个名为 SMOKE.txt 的文本文件，文件内容必须严格等于 IFPLAY_DEEPSEEK_SMOKE_OK，然后停止。不要创建其他项目文件，不要生成图片，不要安装依赖，不要访问其他网络服务。"
EXPECTED_CONTENT="IFPLAY_DEEPSEEK_SMOKE_OK"

fail() { echo "SMOKE_ABORT: $*" >&2; exit 1; }
log() { echo "[smoke] $*"; }

STOPPED_CONTAINERS=""
COLIMA_STARTED_BY_US=0
PAID_RUN_STARTED=0
cleanup() {
  docker rm -f "$CLI_C" "$RELAY_C" "$PROXY_C" >/dev/null 2>&1 || true
  docker network rm "$NET_SMOKE" "$NET_EGRESS" >/dev/null 2>&1 || true
  unset OPENAI_API_KEY ENABLE_PAID_API COST_AUTHORIZED 2>/dev/null || true
  # 只在"本次自己起了 Colima"或"本次真的发起过付费容器"时停机；
  # 闸门/前置核对阶段的纯停止不应把用户已启动的 Colima 关掉（曾实测：免费核对途中因闸门拒绝而停机）。
  if [ "${KEEP_COLIMA:-0}" != "1" ] && { [ "$COLIMA_STARTED_BY_US" = "1" ] || [ "$PAID_RUN_STARTED" = "1" ]; }; then
    if command -v colima >/dev/null 2>&1 && colima status >/dev/null 2>&1; then
      colima stop >/dev/null 2>&1 || true
      log "Colima 已停止"
    fi
  fi
}
trap cleanup EXIT INT TERM

ensure_colima() {
  command -v colima >/dev/null 2>&1 || fail "没有 colima 命令，无法在隔离容器内调用模型（不允许宿主机直连）"
  if ! colima status >/dev/null 2>&1; then
    log "启动 Colima（本次自启，结束后停止）"
    COLIMA_STARTED_BY_US=1
    colima start >/dev/null 2>&1 || fail "Colima 启动失败"
  fi
  docker info >/dev/null 2>&1 || fail "docker 守护进程不可用（隔离前提不成立），停止"
}

# ── 1. 前置核对：分支/HEAD/apps 零改动/上游锁定 SHA 与只读缓存未被改动 ──────
log "前置核对 Git 与上游基线"
[ "$(git -C "$REPO" rev-parse --abbrev-ref HEAD)" = "$EXPECT_BRANCH" ] || fail "分支不是 $EXPECT_BRANCH"
[ "$(git -C "$REPO" rev-parse HEAD)" = "$EXPECT_HEAD" ] || fail "HEAD 不是 ${EXPECT_HEAD}（不提交、不推送、不建 PR）"
[ -z "$(git -C "$REPO" status --porcelain -- apps/ifplay-m0)" ] || fail "apps/ifplay-m0 有改动，冒烟不得在该状态下进行"
[ "$(git -C "$OG_CACHE" rev-parse HEAD)" = "$UPSTREAM_SHA" ] || fail "上游缓存 SHA 与锁定值不一致"
[ -z "$(git -C "$OG_CACHE" status --porcelain)" ] || fail "上游只读缓存被改动，立即停止"
grep -q "generated/" "$SPIKE/.gitignore" || fail "generated/ 未被 gitignore，产物可能进仓库"

# ── 2. 付费闸门 + Key 隐藏输入 ────────────────────────────────────────────
# 演练模式用占位值走与真实运行【完全相同】的 Key 解析与长度校验（第 3 步之前就有 dry-run 出口，
# 占位值不是凭据、不会进任何容器或请求），否则崩溃过的这一段在免费测试里根本跑不到。
if [ "${SMOKE_DRY_RUN:-0}" = "1" ]; then
  log "演练模式（SMOKE_DRY_RUN=1）：不检查付费闸门、不索取 Key、不启动任何容器、不发送任何请求"
  OPENAI_API_KEY="${OPENAI_API_KEY:-SMOKE_DRY_RUN_PLACEHOLDER_NOT_A_KEY}"
  export OPENAI_API_KEY
else
  log "检查双重付费闸门"
  [ "${ENABLE_PAID_API:-}" = "true" ] || fail "ENABLE_PAID_API 不为 true：本次不授权付费调用（只能在单条命令里临时开启）"
  [ "${COST_AUTHORIZED:-}" = "true" ] || fail "COST_AUTHORIZED 不为 true：本次不授权费用"
  if [ -z "${OPENAI_API_KEY:-}" ]; then
    printf '请输入 DeepSeek API Key（隐藏输入，不回显、不进命令历史、不写文件）：' >&2
    # 2>/dev/null 必须写在 < /dev/tty 之前：否则非交互终端的重定向报错会先泄漏到屏幕
    read -rs OPENAI_API_KEY 2>/dev/null < /dev/tty || read -rs OPENAI_API_KEY || true
    printf '\n' >&2
    export OPENAI_API_KEY
  fi
fi
[ -n "${OPENAI_API_KEY:-}" ] || fail "未检测到 API Key，安全停止（不改用其他 Key、其他模型或默认模型）"
KEY_LEN=${#OPENAI_API_KEY}
[ "$KEY_LEN" -ge 20 ] || fail "Key 长度异常（${KEY_LEN} 字符），疑似粘贴不完整，安全停止（不回显内容）"
log "Key 状态：已设置（长度 ${KEY_LEN}，值不显示、不写盘、不进命令行参数）"

# ── 3. 免费前置必须新鲜通过 ───────────────────────────────────────────────
ensure_colima
RELAY_DIST="$SRC/packages/core/dist/src/core/openaiContentGenerator/provider/deepseek.js"
[ -f "$RELAY_DIST" ] || fail "缺少已打补丁的构建副本（先跑 runner/apply-thinking-patch.sh）"
grep -q POC_DEEPSEEK_DISABLE_THINKING "$RELAY_DIST" || fail "构建副本里没有补丁逻辑"
[ -s "$CHAIN_ROOT/PASS" ] || fail "离线彩排未通过（先跑 runner/verify-smoke-chain.sh）"
AGE=$(( $(date +%s) - $(stat -f %m "$CHAIN_ROOT/PASS") ))
[ "$AGE" -lt 86400 ] || fail "离线彩排结果已超过 24 小时（age=${AGE}s），请重跑免费测试"
# 转发器证书是自签、短有效期（3 天）；过期会自动重签，纯本地零费用。
bash "$SPIKE/runner/make-smoke-ca.sh" >/dev/null 2>&1 || fail "本地冒烟证书生成/校验失败（不涉及网络与费用）"
[ -s "$TLS/relay.pem" ] && [ -s "$TLS/relay.key" ] && [ -s "$TLS/ca.pem" ] || fail "缺少冒烟证书：$TLS"
docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || fail "基础镜像不在本地缓存（不下载）：$BASE_IMAGE"
if docker ps -a --format '{{.Names}}' | grep -qE '^poc-'; then
  fail "存在残留 poc-* 容器（含彩排用例），先人工确认后再清理，付费冒烟不在脏环境下进行"
fi
if docker network ls --format '{{.Name}}' | grep -qE '^poc-'; then
  fail "存在残留 poc-* 网络，先人工确认后再清理"
fi

# ── 4. 费用最坏预检（按 cache-miss 高峰价 + 7.5 保守汇率，全 512 输出） ─────
# 上一轮取证目录非空时先归档再清空：真实运行的 relay-evidence/cli 日志是唯一现场证据，
# 不能被随后的免费演练（含 SMOKE_DRY_RUN）rm -rf 掉（2026-10-04 实测险被覆盖，已抢救归档）。
if [ -d "$WORK" ] && [ -n "$(ls -A "$WORK" 2>/dev/null)" ]; then
  ARC="$SPIKE/generated/smoke-run-archive/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$ARC" && (cd "$WORK" && tar cf - .) | (cd "$ARC" && tar xf -) \
    && log "旧取证目录已归档：$ARC" || log "旧取证目录归档失败（继续，但本轮证据请手工核对）"
fi
rm -rf "$WORK"; mkdir -p "$WORK/.qwen"
log "费用最坏预检：$PLANNED_REQUESTS 次请求 × (输入估算 $EST_INPUT_TOKENS token + 输出 512 token)"
node "$SPIKE/runner/smoke-account.mjs" precheck \
  --planned-requests "$PLANNED_REQUESTS" --est-input-tokens-per-call "$EST_INPUT_TOKENS" \
  --json "$WORK/precheck.json" || fail "预检不过（可能超过 0.10 元硬上限），未发送任何付费请求"
python3 -c "
import json;d=json.load(open('$WORK/precheck.json'))
assert d['allowed'] is True and d['hardStopCny'] == 0.1 and d['warnCny'] == 0.08 and d['fxUsdCny'] == 7.5
print(f\"[smoke] 预检通过：最坏 {d['worstTotalCny']} 元 ≤ 0.10 元硬上限（预警线 0.08 元）\")
"

if [ "${SMOKE_DRY_RUN:-0}" = "1" ]; then
  log "演练完成：付费闸门/Key/容器/网络均未触碰，费用 0 元"
  log "真实冒烟只需一次：ENABLE_PAID_API=true COST_AUTHORIZED=true bash runner/run-deepseek-smoke.sh（脚本会隐藏索取 Key）"
  echo "SMOKE_DRYRUN_PASS cost_cny=0"
  exit 0
fi

# ── 5. 隔离拓扑：白名单代理（唯一出口） → 验证转发器 → CLI ─────────────────
PAID_RUN_STARTED=1
log "创建网络与容器（--internal，宿主机不直连模型）"
docker network create --internal "$NET_SMOKE" >/dev/null
docker network create --internal "$NET_EGRESS" >/dev/null
# 唯一出口的性质必须由检查保证，不是靠注释：egress 网络必须仍是 internal，
# 只有代理容器接 bridge（宿主侧唯一有路由的容器）。
[ "$(docker network inspect "$NET_EGRESS" --format '{{.Internal}}')" = "true" ] || fail "$NET_EGRESS 不是 internal 网络，隔离前提不成立"
[ "$(docker network inspect "$NET_SMOKE" --format '{{.Internal}}')" = "true" ] || fail "$NET_SMOKE 不是 internal 网络，隔离前提不成立"

docker run -d --name "$PROXY_C" --network "$NET_EGRESS" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" -v "$SPIKE/config:/cfg:ro" \
  -e HOME=/tmp -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/egress-proxy.mjs --config /cfg/egress-allowlist.smoke.json --port 3128 --bind 0.0.0.0 >/dev/null
sleep 1
docker network connect bridge "$PROXY_C"
[ "$(docker inspect "$PROXY_C" --format '{{.State.Status}}')" = running ] || fail "egress 代理边车未启动"

docker run -d --name "$RELAY_C" --network "$NET_SMOKE" --cpus 1 --memory 768m --pids-limit 192 \
  --read-only --tmpfs /tmp \
  -v "$SPIKE/runner:/ops:ro" -v "$TLS:/tls:ro" -v "$WORK:/work:rw" \
  -e HOME=/tmp -e RELAY_PORT=443 -e RELAY_CERT=/tls/relay.pem -e RELAY_KEY=/tls/relay.key \
  -e RELAY_EVIDENCE=/work/relay-evidence.jsonl \
  -e RELAY_UPSTREAM_MODE=real -e RELAY_UPSTREAM_HOST=api.deepseek.com -e RELAY_UPSTREAM_PORT=443 \
  -e PROXY_HOST="$PROXY_C" -e PROXY_PORT=3128 \
  -e RELAY_EXPECT_MODEL="$MODEL" -e RELAY_EXPECT_MAX_TOKENS=512 -e RELAY_REQUIRE_THINKING=1 \
  -e RELAY_MAX_REQUESTS="$PLANNED_REQUESTS" -e RELAY_MAX_BODY_BYTES=40000 -e RELAY_MAX_TOTAL_EST_TOKENS=25000 \
  -e RELAY_UPSTREAM_TIMEOUT_MS=120000 \
  -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/smoke-relay.mjs >/dev/null
# 关键修正：容器名只在【共享网络】内可解析。上一轮真实冒烟就是因为中继只接了 NET_SMOKE、
# 代理只接了 NET_EGRESS，转发时报 getaddrinfo EAI_AGAIN poc-smoke-proxy（详见报告第十四节）。
docker network connect "$NET_EGRESS" "$RELAY_C"
for _ in $(seq 1 80); do grep -q '"at":"listen"' "$WORK/relay-evidence.jsonl" 2>/dev/null && break; sleep 0.25; done
grep -q '"at":"listen"' "$WORK/relay-evidence.jsonl" 2>/dev/null || fail "转发器未就绪（未发送任何付费请求）"
# 转发器→代理这一跳的预检（纯 DNS+TCP，不发 CONNECT、不发请求体）：不过就停，CLI 根本不启动
for _ in $(seq 1 80); do grep -q '"at":"proxy-precheck"' "$WORK/relay-evidence.jsonl" 2>/dev/null && break; sleep 0.25; done
if ! grep -q '"at":"proxy-precheck","ok":true' "$WORK/relay-evidence.jsonl" 2>/dev/null; then
  PRE="$(grep '"at":"proxy-precheck"' "$WORK/relay-evidence.jsonl" | tail -1)"
  fail "中继到 egress 代理这一跳预检未通过，已停止且未启动 CLI、未发送任何付费请求：$PRE"
fi
log "中继→代理链路预检通过（零费用，未发送任何请求）"
[ "$(docker inspect "$RELAY_C" --format '{{.State.Status}}')" = running ] || fail "转发器容器已退出（预检或启动失败），停止且未发送任何付费请求"
NETS_RELAY="$(docker inspect "$RELAY_C" --format '{{range $n, $c := .NetworkSettings.Networks}}{{$n}} {{end}}')"
case " $NETS_RELAY " in *" bridge "*) fail "中继意外接入了 bridge 网络（会绕过白名单代理），停止";; esac
RELAY_IP="$(docker inspect -f "{{(index .NetworkSettings.Networks \"${NET_SMOKE}\").IPAddress}}" "$RELAY_C")"
[ -n "$RELAY_IP" ] || fail "拿不到中继在 ${NET_SMOKE} 上的 IP"

printf '127.0.0.1\tlocalhost\n::1\tlocalhost\n%s\tapi.deepseek.com\n' "$RELAY_IP" > "$WORK/hosts"
cat > "$WORK/.qwen/settings.json" <<EOF
{
  "security": { "auth": { "selectedType": "openai" } },
  "model": {
    "name": "$MODEL",
    "generationConfig": {
      "samplingParams": { "max_tokens": 512 },
      "maxRetries": 0,
      "reasoning": false
    }
  },
  "privacy": { "usageStatisticsEnabled": false }
}
EOF
chmod 600 "$WORK/.qwen/settings.json"

log "启动一次真实冒烟任务（最多 $PLANNED_REQUESTS 次转发，自动重试 0 次）"
# Key 只通过 -e 从本脚本环境继承进容器：不出现在命令行参数、文件、日志或 Git
docker run --rm --name "$CLI_C" --network "$NET_SMOKE" \
  --cpus 2 --memory 2g --pids-limit 256 \
  --read-only --tmpfs /tmp \
  -v "$WORK/hosts":/etc/hosts:ro \
  -v "$SPIKE/runner":/ops:ro \
  -v "$SRC":/src:ro \
  -v "$TLS/ca.pem":/tls/ca.pem:ro \
  -v "$WORK":/work:rw \
  -e HOME=/tmp \
  -e OPENAI_API_KEY \
  -e OPENAI_BASE_URL=https://api.deepseek.com/v1 \
  -e OPENAI_MODEL="$MODEL" \
  -e NODE_EXTRA_CA_CERTS=/tls/ca.pem \
  -e POC_DEEPSEEK_DISABLE_THINKING=1 \
  -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  -w /work \
  "$BASE_IMAGE" sh -c "timeout 420 node /src/packages/cli/dist/index.js -p '$PROMPT' --auth-type openai -o stream-json --core-tools write_file --max-session-turns 4 >/work/cli.jsonl 2>/work/cli.err; echo CLI_RC=\$?" | tail -3

# ── 6. 取证：产物、请求形状、usage/费用、域名与拒绝记录、凭据泄漏检查 ──────
log "校验 SMOKE.txt 与请求取证"
set +e
python3 - "$WORK" "$EXPECTED_CONTENT" <<'PY'
import hashlib, json, os, sys
work, expect = sys.argv[1], sys.argv[2]
p = os.path.join(work, 'SMOKE.txt')
exists = os.path.exists(p)
raw = open(p, 'rb').read() if exists else b''
print(json.dumps({
    "smokeExists": exists,
    "exactMatch": raw.decode('utf-8', 'replace') == expect,
    "bytes": len(raw),
    "sha256": hashlib.sha256(raw).hexdigest() if exists else None,
    "content": raw.decode('utf-8', 'replace') if exists else None,
}, ensure_ascii=False))
sys.exit(0 if exists and raw.decode('utf-8', 'replace') == expect else 1)
PY
SMOKE_RC=$?
set -e

docker logs "$PROXY_C" > "$WORK/proxy.log" 2>&1 || true
docker logs "$RELAY_C" > "$WORK/relay.log" 2>&1 || true

# 记账必须在凭据审计【之前】：上一轮真实运行里，审计因我自己的字段名 authorizationHeaderPresent
# 命中关键字而先于记账失败退出，导致费用证据差点丢失。顺序修正后，无论审计结论如何都有账本。
set +e
node "$SPIKE/runner/smoke-account.mjs" record --evidence "$WORK/relay-evidence.jsonl" \
  --state "$WORK/ledger-state.json" --json "$WORK/ledger.json"
REC_RC=$?
set -e
log "记账完成 rc=${REC_RC}（费用/usage 证据已落盘，再做凭据审计）"

# 凭据审计按【值】匹配，不按字段名匹配：只抓真实密钥形态（sk-xxxx、Bearer 后跟值、
# "api_key":"值"），另外把本次环境变量里的 Key 切成 8 字符片段逐一比对（只报命中与否，绝不回显值）。
if python3 - "$WORK" <<'PY'
import os, re, sys
work = sys.argv[1]
files = ['proxy.log', 'relay.log', 'relay-evidence.jsonl', 'cli.jsonl', 'cli.err', 'SMOKE.txt']
texts = {}
for f in files:
    p = os.path.join(work, f)
    if os.path.exists(p):
        texts[f] = open(p, 'rb').read().decode('utf-8', 'replace')
blob = '\n'.join(texts.values())
value_pats = [
    r'sk-[A-Za-z0-9_\-]{8,}',
    r'[Bb]earer[ \t]+[^\s"\'\\]{8,}',
    r'"api[_-]?key"\s*:\s*"[^\s"]{8,}"',
    r'"authorization"\s*:\s*"[^\s"]{8,}\s[^"]+"',
]
hits = [p for p in value_pats if re.search(p, blob)]
key = os.environ.get('OPENAI_API_KEY', '')
segs = {key[i:i + 8] for i in range(max(0, len(key) - 7))} if len(key) >= 8 else set()
leak_files = sorted({f for f, t in texts.items() if any(s in t for s in segs)})
print(f"[smoke] 凭据审计：值型模式命中 {len(hits)} 类；本次 Key 片段命中文件 {len(leak_files)} 个（命中只报文件名，不报内容）")
if leak_files:
    print('[smoke] 泄漏文件：' + ','.join(leak_files), file=sys.stderr)
sys.exit(1 if (hits or leak_files) else 0)
PY
then
  log "代理/转发器/CLI 日志无凭据值"
else
  fail "日志中检测到疑似凭据【值】，需人工核查（冒烟结果不予采信；账本已保存在 $WORK/ledger.json）"
fi

set +e
python3 - "$WORK" <<'PY'
import json, os, sys
work = sys.argv[1]
ev = [json.loads(l) for l in open(os.path.join(work, 'relay-evidence.jsonl'), encoding='utf-8') if l.strip()]
fwd = [e for e in ev if e.get('at') == 'forward']
uerr = [e for e in ev if e.get('at') in ('upstream-error', 'upstream-timeout')]
ref = [e for e in ev if e.get('at') == 'refuse']
pre = [e for e in ev if e.get('at') == 'proxy-precheck']
known = {'.qwen', 'hosts', 'SMOKE.txt', 'proxy.log', 'relay.log', 'relay-evidence.jsonl', 'cli.jsonl', 'cli.err',
         'precheck.json', 'ledger.json', 'ledger-state.json', 'wire-evidence.json', 'smoke-result.json'}
extra = sorted(set(os.listdir(work)) - known)
print(json.dumps({
    "proxyPrecheck": [{"ok": e.get('ok'), "proxy": e.get('proxy'), "errorName": e.get('errorName')} for e in pre],
    # forwardedAttempts = 真正发往上游的次数（含上游报错的那些；报错同样占用额度，不重发）
    "forwardedOk": len(fwd),
    "forwardedAttempts": len(fwd) + len(uerr),
    "upstreamErrors": [{"n": e.get('n'), "errorName": e.get('errorName'), "errorMessage": e.get('errorMessage'),
                        "bodyBytes": e.get('bodyBytes'), "ms": e.get('ms')} for e in uerr],
    "refused": [{"code": e.get('code'), "reason": e.get('reason'), "path": e.get('path')} for e in ref],
    "requestedModel": sorted({e.get('requestedModel') for e in fwd + uerr}),
    "actualModel": sorted({e.get('actualModel') for e in fwd if e.get('actualModel')}),
    "wire": [{"n": e.get('n'), "thinking": e.get('thinking'), "maxTokens": e.get('maxTokens'),
              "stream": e.get('stream'), "includeUsage": e.get('includeUsage'),
              "reasoningEffort": e.get('reasoningEffort'), "responseStatus": e.get('responseStatus'),
              "usage": e.get('usage'), "bodyBytes": e.get('bodyBytes'), "upstream": e.get('upstream')} for e in fwd],
    "unexpectedFiles": extra,
}, ensure_ascii=False, indent=1))
open(os.path.join(work, 'wire-evidence.json'), 'w', encoding='utf-8').write(json.dumps({
    "proxyPrecheck": pre, "forwardedOk": len(fwd), "forwardedAttempts": len(fwd) + len(uerr),
    "upstreamErrors": uerr, "refused": ref, "requests": fwd, "unexpectedFiles": extra
}, ensure_ascii=False, indent=1))
PY
set -e
log "egress 代理放行/拒绝统计：$(grep -oE '\"status\":\"[a-z-]+\"' "$WORK/proxy.log" | sort | uniq -c | tr '\n' ' ')"
log "egress 代理目标域名：$(grep -oE '\"host\":\"[^\"]+\"' "$WORK/proxy.log" | sort | uniq -c | tr '\n' ' ')"

RESULT_JSON="$WORK/smoke-result.json"
python3 - "$WORK" "$SMOKE_RC" "$REC_RC" > "$RESULT_JSON" <<'PY'
import json, os, sys
work, smoke_rc, rec_rc = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ledger = json.load(open(os.path.join(work, 'ledger.json'), encoding='utf-8')) if os.path.exists(os.path.join(work, 'ledger.json')) else {}
wire = json.load(open(os.path.join(work, 'wire-evidence.json'), encoding='utf-8')) if os.path.exists(os.path.join(work, 'wire-evidence.json')) else {}
pre = json.load(open(os.path.join(work, 'precheck.json'), encoding='utf-8'))
s = ledger.get('summary', {})
print(json.dumps({
    "smokeFileExact": smoke_rc == 0,
    "ledgerRcOk": rec_rc == 0,
    "proxyPrecheckOk": [p.get('ok') for p in wire.get('proxyPrecheck', [])],
    "forwardedOk": wire.get('forwardedOk'),
    "forwardedAttempts": wire.get('forwardedAttempts'),
    "upstreamErrors": [{"errorName": e.get('errorName'), "errorMessage": e.get('errorMessage'), "ms": e.get('ms')}
                        for e in wire.get('upstreamErrors', [])],
    "refused": [r.get('code') for r in wire.get('refused', [])],
    "requestedModel": sorted({q.get('requestedModel') for q in wire.get('requests', [])}),
    "actualModel": sorted({q.get('actualModel') for q in wire.get('requests', []) if q.get('actualModel')}),
    "spentCny": s.get('spentCny'),
    "hardStopCny": s.get('hardStopCny'),
    "warnCny": s.get('warnCny'),
    "warned": s.get('warned'),
    "tokens": s.get('tokens'),
    "ratesCnyPer1k": s.get('ratesCnyPer1k'),
    "fxUsdCny": ledger.get('fxUsdCny'),
    "worstCaseCnyPrecheck": pre.get('worstTotalCny'),
    "withinHardStop": ledger.get('withinHardStop'),
    "unexpectedFiles": wire.get('unexpectedFiles'),
}, ensure_ascii=False, indent=1))
PY
log "结果摘要已写入 $RESULT_JSON"
cat "$RESULT_JSON"

if [ "$SMOKE_RC" -ne 0 ]; then echo "SMOKE_FAIL: SMOKE.txt 内容未严格匹配（不做第二次付费尝试）"; exit 1; fi
if [ "$REC_RC" -ne 0 ]; then echo "SMOKE_FAIL: 记账未通过（usage 缺失/模型不符/超上限），详见上面输出"; exit 1; fi
echo "SMOKE_RUN_DONE cost_cny=$(python3 -c "import json;print(json.load(open('$RESULT_JSON'))['spentCny'])")"
