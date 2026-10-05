#!/usr/bin/env bash
# 阶段二·冒烟前置（零费用）：离线彩排"补丁 CLI → 验证转发器 → 假服务"的真实链路。
# 覆盖：真实 Agent 写文件闭环、thinking/max_tokens 上线断言、不合规请求零转发、失败不重发。
# 边界：全程 --internal 网络 + 本地假服务 + 明显假 Key，不触达任何公网，费用 0 元。
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
BASE_IMAGE="${BASE_IMAGE:-node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df}"
SRC="${SRC:-$SPIKE/generated/smoke-src}"
TLS="$SPIKE/generated/smoke-tls"
ROOT="$SPIKE/generated/smoke-chain"
NET="poc-smoke-net"; RELAY_C="poc-smoke-relay"
FAKE_KEY="POC_LOCAL_FAKE_KEY_NOT_A_CREDENTIAL"
PROMPT="请创建一个名为 SMOKE.txt 的文本文件，内容严格等于 IFPLAY_DEEPSEEK_SMOKE_OK，然后停止。不要创建其他文件，不要生成图片，不要安装依赖，不要访问其他网络服务。MOCK:TOOL_WRITE=/work/SMOKE.txt MOCK:INPUT=7500 MOCK:OUTPUT=300 MOCK:CACHED=0"

fail() { echo "FAIL: $*" >&2; exit 1; }
log() { echo "[chain] $*"; }
stop_relay() { docker rm -f "$RELAY_C" >/dev/null 2>&1 || true; }
# 用例 E 的容器/网络名（与付费脚本同一套命名纪律：一律 poc- 前缀，收尾全清）
NET_E="poc-chain-e-net"; NET_E2="poc-chain-e2-net"; MOCK_C="poc-e-mock"; PROXY_E="poc-e-proxy"
RELAY_E="poc-e-relay"; RELAY_E2="poc-e2-relay"
cleanup() {
  stop_relay
  docker rm -f "$MOCK_C" "$PROXY_E" "$RELAY_E" "$RELAY_E2" >/dev/null 2>&1 || true
  docker network rm "$NET" "$NET_E" "$NET_E2" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

RELAY_DIST="$SRC/packages/core/dist/src/core/openaiContentGenerator/provider/deepseek.js"
[ -f "$RELAY_DIST" ] || fail "缺少构建副本：$SRC"
grep -q POC_DEEPSEEK_DISABLE_THINKING "$RELAY_DIST" || fail "副本未应用 thinking 补丁（先跑 runner/apply-thinking-patch.sh）"
docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || fail "基础镜像不在本地缓存：$BASE_IMAGE"
bash "$SPIKE/runner/make-smoke-ca.sh" >/dev/null || fail "本地证书生成失败"

# ── 0. shell 变量扩展静态守卫（付费路径的地雷检查） ─────────────────────────
# 2026-10-04 真实冒烟在读取 Key 后立刻崩在这里：macOS 自带 bash 3.2 在 UTF-8 locale 下
# 会把紧跟变量名的中文标点首字节吞进变量名（`$KEY_LEN，` → 变量 KEY_LEN\xef…），
# 配合 set -u 就是"未定义变量"直接退出；C locale 下不触发，所以我此前的免费测试全绿却没发现它。
# 规矩：变量一律写成 ${NAME}，凡 `$NAME` 或 `$1` 紧跟非 ASCII 字符即判失败。
QUOTES_BAD="$(python3 - "$SPIKE/runner" <<'PY'
import os, re, sys
pat = re.compile(r'\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]{1,2})(?![{\dA-Za-z_])[^\x00-\x7F]')
d = sys.argv[1]
bad = []
for fn in sorted(os.listdir(d)):
    if not fn.endswith('.sh'):
        continue
    p = os.path.join(d, fn)
    with open(p, encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            if line.lstrip().startswith('#'):
                continue  # 注释不参与扩展（本守卫自己的说明行就带这个写法）
            if pat.search(line):
                bad.append(f'{fn}:{i}: {line.strip()[:70]}')
print('\n'.join(bad))
PY
)"
if [ -n "$QUOTES_BAD" ]; then
  echo "$QUOTES_BAD" | sed 's/^/  /'
  fail "runner/*.sh 存在 \$VAR 紧跟中文字符/中文标点 的写法（UTF-8 locale 下会错误扩展），请改成 \${VAR}"
fi
echo "PASS | 0 shell 变量扩展守卫（runner/*.sh 无 \$VAR 紧跟非 ASCII 的写法）"

start_relay() { # $1=workdir $2=failTimes $3=maxRequests
  local work="$1" ft="$2" mr="$3"
  stop_relay
  mkdir -p "$work"
  docker run -d --name "$RELAY_C" --network "$NET" --cpus 1 --memory 512m --pids-limit 128 \
    --read-only --tmpfs /tmp \
    -v "$SPIKE/runner:/ops:ro" -v "$TLS:/tls:ro" -v "$work:/work:rw" \
    -e HOME=/tmp -e RELAY_PORT=443 -e RELAY_CERT=/tls/relay.pem -e RELAY_KEY=/tls/relay.key \
    -e RELAY_EVIDENCE=/work/relay-evidence.jsonl -e RELAY_UPSTREAM_MODE=mock \
    -e RELAY_MOCK_HOST=127.0.0.1 -e RELAY_MOCK_PORT=80 \
    -e RELAY_EXPECT_MODEL=deepseek-flash -e RELAY_EXPECT_MAX_TOKENS=512 -e RELAY_REQUIRE_THINKING=1 \
    -e RELAY_MAX_REQUESTS="$mr" -e RELAY_MAX_BODY_BYTES=40000 -e RELAY_MAX_TOTAL_EST_TOKENS=30000 \
    -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
    "$BASE_IMAGE" sh -c "node /ops/mock-deepseek.mjs --port 80 --capture /work/final-requests.jsonl --ready /work/mock.ready --fail-times $ft >/work/mock.log 2>&1 &
      for i in \$(seq 1 80); do [ -s /work/mock.ready ] && break; sleep 0.25; done
      [ -s /work/mock.ready ] || exit 1
      exec node /ops/smoke-relay.mjs >>/work/relay.log 2>&1" >/dev/null
  for _ in $(seq 1 80); do grep -q '"at":"listen"' "$work/relay.log" 2>/dev/null && break; sleep 0.25; done
  grep -q '"at":"listen"' "$work/relay.log" 2>/dev/null || fail "转发器未就绪：$(cat "$work/relay.log" 2>/dev/null | head -5)"
  RELAY_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$RELAY_C")"
  [ -n "$RELAY_IP" ] || fail "拿不到转发器 IP"
}

run_cli() { # $1=workdir $2=thinkingGate(1|0)
  local work="$1" gate="$2"
  rm -f "$work/SMOKE.txt"
  mkdir -p "$work/.qwen"
  printf '127.0.0.1\tlocalhost\n::1\tlocalhost\n%s\tapi.deepseek.com\n' "$RELAY_IP" > "$work/hosts"
  cat > "$work/.qwen/settings.json" <<'EOF'
{
  "security": { "auth": { "selectedType": "openai" } },
  "model": {
    "name": "deepseek-flash",
    "generationConfig": {
      "samplingParams": { "max_tokens": 512 },
      "maxRetries": 0,
      "reasoning": false
    }
  },
  "privacy": { "usageStatisticsEnabled": false }
}
EOF
  docker run --rm --name poc-smoke-cli --network "$NET" \
    --cpus 2 --memory 2g --pids-limit 256 \
    --read-only --tmpfs /tmp \
    -v "$work/hosts":/etc/hosts:ro \
    -v "$SPIKE/runner":/ops:ro \
    -v "$SRC":/src:ro \
    -v "$TLS":/tls:ro \
    -v "$work":/work:rw \
    -e HOME=/tmp \
    -e OPENAI_API_KEY="$FAKE_KEY" \
    -e OPENAI_BASE_URL=https://api.deepseek.com/v1 \
    -e OPENAI_MODEL=deepseek-flash \
    -e NODE_EXTRA_CA_CERTS=/tls/ca.pem \
    -e POC_DEEPSEEK_DISABLE_THINKING="$gate" \
    -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
    "$BASE_IMAGE" sh -c "cd /work && timeout 300 node /src/packages/cli/dist/index.js -p '$PROMPT' --auth-type openai -o stream-json --core-tools write_file >/work/cli.jsonl 2>/work/cli.err; echo CLI_RC=\$?"
  return 0
}

check() { # $1=名称 $2=0/1
  if [ "$2" = "0" ]; then echo "PASS | $1"; else echo "FAIL | $1"; FAILED=$((FAILED + 1)); fi
}
FAILED=0
rm -f "$ROOT/PASS"
docker network create --internal "$NET" >/dev/null

# ── A. 合规链路应走通，并由真实 Agent 写出 SMOKE.txt ────────────────────────
log "A 合规链路彩排（补丁生效 + 转发器放行 + 真实写文件）"
A="$ROOT/a"; rm -rf "$A"; mkdir -p "$A"
start_relay "$A" 0 3
run_cli "$A" 1 | tail -2
set +e
python3 - "$A" <<'PY'
import json, os, sys
work = sys.argv[1]
ev = [json.loads(l) for l in open(os.path.join(work, 'relay-evidence.jsonl'), encoding='utf-8') if l.strip()]
fwd = [e for e in ev if e.get('at') == 'forward']
ref = [e for e in ev if e.get('at') != 'forward']
smoke = os.path.join(work, 'SMOKE.txt')
content = open(smoke, encoding='utf-8').read() if os.path.exists(smoke) else None
print(json.dumps({
    "forwarded": len(fwd),
    "refused": len(ref),
    "thinking": [e.get('thinking') for e in fwd],
    "maxTokens": [e.get('maxTokens') for e in fwd],
    "tools": [e.get('toolNames') for e in fwd],
    "includeUsage": [e.get('includeUsage') for e in fwd],
    "responseStatus": [e.get('responseStatus') for e in fwd],
    "usage": [e.get('usage') for e in fwd],
    "actualModel": [e.get('actualModel') for e in fwd],
    "bodyBytes": [e.get('bodyBytes') for e in fwd],
    "smokeContent": content,
}, ensure_ascii=False))
ok_fwd = len(fwd) >= 1
ok_think = all(e.get('thinking') == {'type': 'disabled'} for e in fwd) and bool(fwd)
ok_mt = all(e.get('maxTokens') == 512 for e in fwd) and bool(fwd)
ok_usage = all(isinstance(e.get('usage'), dict) and 'prompt_tokens' in e['usage'] for e in fwd) and bool(fwd)
ok_model = all(e.get('actualModel') for e in fwd) and bool(fwd)
ok_file = content == 'IFPLAY_DEEPSEEK_SMOKE_OK'
ok_status = all(e.get('responseStatus') == 200 for e in fwd) and bool(fwd)
for name, good in [('A1 转发器放合并转发合规请求', ok_fwd), ('A2 线上 thinking.type=disabled', ok_think),
                   ('A3 线上 max_tokens=512', ok_mt), ('A4 取到真实 usage 字段', ok_usage),
                   ('A5 取到响应 model 字段', ok_model), ('A6 上游返回 200', ok_status),
                   ('A7 真实 Agent 写出内容完全匹配的 SMOKE.txt', ok_file)]:
    print(f"{'PASS' if good else 'FAIL'} | {name}")
sys.exit(0 if all([ok_fwd, ok_think, ok_mt, ok_usage, ok_model, ok_status, ok_file]) else 1)
PY
rc=$?
set -e
check "A 合规链路 7 项" $rc

# ── B. 补丁未生效（无 thinking）时，转发器必须零转发 ────────────────────────
log "B 不合规请求（缺 thinking）必须被拒绝且不产生转发"
B="$ROOT/b"; rm -rf "$B"; mkdir -p "$B"
start_relay "$B" 0 3
run_cli "$B" 0 >/dev/null
set +e
python3 - "$B" <<'PY'
import json, os, sys
work = sys.argv[1]
ev = [json.loads(l) for l in open(os.path.join(work, 'relay-evidence.jsonl'), encoding='utf-8') if l.strip()]
fwd = [e for e in ev if e.get('at') == 'forward']
ref = [e for e in ev if e.get('at') == 'refuse']
codes = {e.get('code') for e in ref}
reasons = [e.get('reason') for e in ref][:1]
smoke = os.path.exists(os.path.join(work, 'SMOKE.txt'))
ok = len(fwd) == 0 and len(ref) >= 1 and 'SMOKE_REQUEST_NOT_CONFORMING' in codes and not smoke
print(json.dumps({"forwarded": len(fwd), "refused": len(ref), "codes": sorted(codes), "reason": reasons, "smokeWritten": smoke}, ensure_ascii=False))
print(f"{'PASS' if ok else 'FAIL'} | B1 缺 thinking 的请求零转发、记录拒绝原因、未产出文件")
sys.exit(0 if ok else 1)
PY
rc=$?
set -e
check "B 不合规零转发" $rc

# ── C. 上游 500：客户端不得重发付费请求（单任务锁 + maxRetries=0） ──────────
log "C 上游 500 后不得自动重发"
C="$ROOT/c"; rm -rf "$C"; mkdir -p "$C"
start_relay "$C" 1 1
run_cli "$C" 1 >/dev/null
set +e
python3 - "$C" <<'PY'
import json, os, sys
work = sys.argv[1]
ev = [json.loads(l) for l in open(os.path.join(work, 'relay-evidence.jsonl'), encoding='utf-8') if l.strip()]
fwd = [e for e in ev if e.get('at') == 'forward']
locks = [e for e in ev if e.get('code') == 'SMOKE_SINGLE_ATTEMPT_LOCK']
statuses = [e.get('responseStatus') for e in fwd]
ok = len(fwd) == 1 and statuses[0] == 500
print(json.dumps({"forwarded": len(fwd), "statuses": statuses, "attemptLockRefusals": len(locks)}, ensure_ascii=False))
print(f"{'PASS' if ok else 'FAIL'} | C1 只转发 1 次（maxRetries=0 未重发付费请求）")
if locks:
    print(f"NOTE | 客户端仍尝试了第 2 次，已被单任务锁拦下（未产生费用）：{len(locks)} 次")
sys.exit(0 if ok else 1)
PY
rc=$?
set -e
check "C 失败不重发" $rc

# ── D. 转发器取证 → 冒烟账本（7.5 汇率、0.10 硬停、>512 输出即停） ──────────
log "D 记账链路彩排（smoke 预算 + 单请求输出上限）"
# 每次彩排都是一个独立会话：D 系列必须从空账本开始。账本落盘恢复本身是必测项（用例 #11），
# 但彩排重跑不是"同一会话重启"，不清就会把历次重跑的费用累加到硬停线上，
# 让 D1 假失败（2026-10-04 实跑踩过：第三次重跑累计 0.1174 元 ≥ 0.10 硬停，闸门按设计中止）。
rm -f "$ROOT/d-ledger-state.json" "$ROOT/d-ledger.json" \
      "$ROOT/d2-ledger-state.json" "$ROOT/d3-ledger-state.json"
set +e
node "$SPIKE/runner/smoke-account.mjs" record --evidence "$A/relay-evidence.jsonl" \
  --state "$ROOT/d-ledger-state.json" --json "$ROOT/d-ledger.json" >"$ROOT/d.out" 2>&1
rc=$?
set -e
python3 - "$ROOT/d.out" "$ROOT/c-ledger-overflow.json" <<'PY'
import json, re, sys
txt = open(sys.argv[1], encoding='utf-8').read()
ok = False
try:
    d = json.loads(txt)
    s = d.get('summary', {})
    ok = (len(d.get('accounted', [])) == 2 and d.get('withinHardStop') is True
          and s.get('spentCny', 99) <= 0.10 and s.get('hardStopCny') == 0.10
          and s.get('warnCny') == 0.08 and s.get('maxOutputTokens') == 512
          and s.get('maxImages') == 0 and s.get('ratesCnyPer1k', {}).get('output') == 0.009
          and d.get('fxUsdCny') == 7.5 and len(s.get('actualModels', [])) == 1)
    print(json.dumps({"spentCny": s.get("spentCny"), "calls": s.get("calls"),
                      "tokens": s.get("tokens"), "hardStopCny": s.get("hardStopCny"),
                      "actualModels": s.get("actualModels")}, ensure_ascii=False))
except Exception as e:
    print("PARSE-FAIL", e, txt[:400])
print(f"{'PASS' if ok else 'FAIL'} | D1 两次转发全部入账，费用/汇率/上限与实际模型名符合冒烟预算")
sys.exit(0 if ok else 1)
PY
rc2=$?
set -e
check "D 记账链路" $rc2

# D2：把 usage 的输出改成 >512，账本必须立即中止（不按 0 元处理，也不继续计费）
python3 - "$A/relay-evidence.jsonl" "$ROOT/d2-evidence.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
for r in rows:
    if r.get('at') == 'forward' and isinstance(r.get('usage'), dict):
        r['usage']['completion_tokens'] = 900
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
PY
set +e
node "$SPIKE/runner/smoke-account.mjs" record --evidence "$ROOT/d2-evidence.jsonl" \
  --state "$ROOT/d2-ledger-state.json" >"$ROOT/d2.out" 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ] && grep -q "超过上限 512" "$ROOT/d2.out"; then
  echo "PASS | D2 单次输出 900 > 512 时账本立即中止（退出码 ${rc}）"
else
  echo "FAIL | D2 输出超限未被中止：rc=$rc $(head -3 "$ROOT/d2.out")"; FAILED=$((FAILED + 1))
fi

# D3：缺 usage 的取证必须拒绝入账
python3 - "$A/relay-evidence.jsonl" "$ROOT/d3-evidence.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
n = 0
for r in rows:
    if r.get('at') == 'forward' and isinstance(r.get('usage'), dict) and n == 0:
        r['usage'] = None; n += 1
open(sys.argv[2], 'w', encoding='utf-8').write('\n'.join(json.dumps(r, ensure_ascii=False) for r in rows) + '\n')
PY
set +e
node "$SPIKE/runner/smoke-account.mjs" record --evidence "$ROOT/d3-evidence.jsonl" \
  --state "$ROOT/d3-ledger-state.json" >"$ROOT/d3.out" 2>&1
rc=$?
set -e
if [ "$rc" -ne 0 ] && grep -q "缺少 usage" "$ROOT/d3.out"; then
  echo "PASS | D3 usage 缺失时拒绝入账并按停止处理（退出码 ${rc}）"
else
  echo "FAIL | D3 缺 usage 未被拦下：rc=$rc $(head -3 "$ROOT/d3.out")"; FAILED=$((FAILED + 1))
fi

# ── E. 付费拓扑彩排：real 模式中继 → egress 白名单代理 → 内网 TLS 假上游 ─────
# 为什么必须有这一条：阶段二真实冒烟（2026-10-04）失败在"中继解析不到代理容器名"
# （getaddrinfo EAI_AGAIN poc-smoke-proxy），而 A-D 用的都是 mock 上游、根本不经过代理，
# 所以这一跳从没被测过。E 用 --internal 内网 + 本地证书把整条真实链路彩排一遍，费用 0 元。
log "E real 模式中继 → 白名单代理 → 内网 TLS 假上游（付费拓扑彩排）"
E="$ROOT/e"; rm -rf "$E"; mkdir -p "$E"
docker network create --internal "$NET_E" >/dev/null || fail "E：网络创建失败"

docker run -d --name "$MOCK_C" --network "$NET_E" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" -v "$TLS:/tls:ro" -v "$E:/work:rw" \
  -e HOME=/tmp -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/mock-deepseek.mjs --port 443 --host 0.0.0.0 \
  --tls-cert /tls/relay.pem --tls-key /tls/relay.key --ready /work/mock.ready >/dev/null \
  || fail "E：假上游（TLS）启动失败"
for _ in $(seq 1 80); do [ -s "$E/mock.ready" ] && break; sleep 0.25; done
[ -s "$E/mock.ready" ] || fail "E：假上游未就绪"
MOCK_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$MOCK_C")"
[ -n "$MOCK_IP" ] || fail "E：拿不到假上游 IP"

# 代理容器内的 /etc/hosts 把 api.deepseek.com 固定到内网假上游：白名单照用冒烟那份，
# 但没有任何一帧离开本机。
printf '127.0.0.1\tlocalhost\n::1\tlocalhost\n%s\tapi.deepseek.com\n' "$MOCK_IP" > "$E/hosts"
docker run -d --name "$PROXY_E" --network "$NET_E" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" -v "$SPIKE/config:/cfg:ro" \
  -v "$E/hosts":/etc/hosts:ro \
  -e HOME=/tmp -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/egress-proxy.mjs --config /cfg/egress-allowlist.smoke.json \
  --port 3128 --bind 0.0.0.0 >/dev/null || fail "E：白名单代理启动失败"
sleep 1
[ "$(docker inspect "$PROXY_E" --format '{{.State.Status}}')" = running ] || fail "E：白名单代理未运行"

docker run -d --name "$RELAY_E" --network "$NET_E" --cpus 1 --memory 768m --pids-limit 192 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" -v "$TLS:/tls:ro" -v "$E:/work:rw" \
  -e HOME=/tmp -e RELAY_PORT=443 -e RELAY_CERT=/tls/relay.pem -e RELAY_KEY=/tls/relay.key \
  -e RELAY_EVIDENCE=/work/relay-evidence.jsonl \
  -e RELAY_UPSTREAM_MODE=real -e RELAY_UPSTREAM_HOST=api.deepseek.com -e RELAY_UPSTREAM_PORT=443 \
  -e PROXY_HOST="$PROXY_E" -e PROXY_PORT=3128 \
  -e NODE_EXTRA_CA_CERTS=/tls/ca.pem \
  -e RELAY_EXPECT_MODEL=deepseek-flash -e RELAY_EXPECT_MAX_TOKENS=512 -e RELAY_REQUIRE_THINKING=1 \
  -e RELAY_MAX_REQUESTS=1 -e RELAY_MAX_BODY_BYTES=40000 -e RELAY_MAX_TOTAL_EST_TOKENS=30000 \
  -e RELAY_UPSTREAM_TIMEOUT_MS=20000 \
  -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/smoke-relay.mjs >/dev/null || fail "E：中继启动失败"
for _ in $(seq 1 80); do grep -q '"at":"proxy-precheck"' "$E/relay-evidence.jsonl" 2>/dev/null && break; sleep 0.25; done
RELAY_E_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$RELAY_E")"
set +e
CLIENT_OUT="$(docker exec -e CLIENT_URL="https://${RELAY_E_IP}:443/v1/chat/completions" \
  -e CLIENT_CA=/tls/ca.pem -e CLIENT_KEY="$FAKE_KEY" \
  "$MOCK_C" node /ops/chain-e-client.mjs 2>&1)"
CLIENT_RC=$?
set -e
printf '%s\n' "$CLIENT_OUT" > "$E/client.out"
docker logs "$PROXY_E" > "$E/proxy.log" 2>&1 || true
set +e
python3 - "$E" "$CLIENT_RC" <<'PY'
import json, os, sys
work, client_rc = sys.argv[1], int(sys.argv[2])
ev = [json.loads(l) for l in open(os.path.join(work, 'relay-evidence.jsonl'), encoding='utf-8') if l.strip()]
pre = [e for e in ev if e.get('at') == 'proxy-precheck']
fwd = [e for e in ev if e.get('at') == 'forward']
ref = [e for e in ev if e.get('at') in ('refuse', 'upstream-error', 'upstream-timeout')]
allow = []
for l in open(os.path.join(work, 'proxy.log'), encoding='utf-8'):
    if l.startswith('{'):
        try: allow.append(json.loads(l))
        except Exception: pass
client = {}
try:
    client = json.loads(open(os.path.join(work, 'client.out'), encoding='utf-8').read().strip().splitlines()[-1])
except Exception:
    pass
tunnels = [a for a in allow if a.get('status') == 'allow'
           and a.get('host') == 'api.deepseek.com' and a.get('port') == 443]
checks = [
    ('E1 中继启动即完成代理预检（ok=true）',
     len(pre) == 1 and pre[0].get('ok') is True),
    ('E2 egress 代理对 api.deepseek.com:443 只建了一条隧道',
     len(tunnels) == 1),
    ('E3 转发器经隧道拿到 200 + usage + 实际 model',
     len(fwd) == 1 and fwd[0].get('responseStatus') == 200 and isinstance(fwd[0].get('usage'), dict)
     and bool(fwd[0].get('actualModel')) and 'egress' in str(fwd[0].get('upstream'))),
    ('E4 零拒绝、零上游错误（链路一次通过）', len(ref) == 0),
    ('E5 客户端侧 SSE 收到 usage 且以 [DONE] 收尾', client_rc == 0 and client.get('clientOk') is True),
]
print(json.dumps({'precheck': [{k: v for k, v in p.items() if k in ('ok', 'proxy', 'ms')} for p in pre],
                  'tunnelCount': len(tunnels), 'forwarded': len(fwd), 'refused': len(ref),
                  'usage': [f.get('usage') for f in fwd], 'client': client}, ensure_ascii=False))
ok = all(g for _, g in checks)
for name, good in checks:
    print(f"{'PASS' if good else 'FAIL'} | {name}")
sys.exit(0 if ok else 1)
PY
rc=$?
set -e
check "E 付费拓扑彩排" $rc

# ── F. 反向用例：中继与代理不共享网络时，必须"零请求"就停下 ──────────────────
# 这就是阶段二真实冒烟失败的拓扑。修复后的行为要求：预检失败 → 中继进程退出 → 一条转发都没有。
log "F 反向用例：不共享网络时预检必须失败且零转发"
F="$ROOT/f"; rm -rf "$F"; mkdir -p "$F"
docker network create --internal "$NET_E2" >/dev/null || fail "F：网络创建失败"
docker run -d --name "$RELAY_E2" --network "$NET_E2" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" -v "$TLS:/tls:ro" -v "$F:/work:rw" \
  -e HOME=/tmp -e RELAY_PORT=443 -e RELAY_CERT=/tls/relay.pem -e RELAY_KEY=/tls/relay.key \
  -e RELAY_EVIDENCE=/work/relay-evidence.jsonl \
  -e RELAY_UPSTREAM_MODE=real -e RELAY_UPSTREAM_HOST=api.deepseek.com -e RELAY_UPSTREAM_PORT=443 \
  -e PROXY_HOST="$PROXY_E" -e PROXY_PORT=3128 \
  -e RELAY_EXPECT_MODEL=deepseek-flash -e RELAY_EXPECT_MAX_TOKENS=512 \
  -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/smoke-relay.mjs >/dev/null || fail "F：中继启动失败"
# 15 秒窗口：共享网络内名字解析是毫秒级的；真失败时 getaddrinfo 会一直重试到超时才报错，
# 所以"窗口内没出预检结论"同样算拦住（没有任何请求发出），但会如实标成 TIMEOUT 供人工核查。
for _ in $(seq 1 60); do grep -q '"at":"proxy-precheck"' "$F/relay-evidence.jsonl" 2>/dev/null && break; sleep 0.25; done
F_STATUS="$(docker inspect "$RELAY_E2" --format '{{.State.Status}}' 2>/dev/null || echo unknown)"
set +e
python3 - "$F" "$F_STATUS" <<'PY'
import json, os, sys
work, status = sys.argv[1], sys.argv[2]
path = os.path.join(work, 'relay-evidence.jsonl')
ev = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()] if os.path.exists(path) else []
pre = [e for e in ev if e.get('at') == 'proxy-precheck']
fwd = [e for e in ev if e.get('at') in ('forward', 'upstream-error', 'upstream-timeout')]
verdict = ('FAIL' if len(fwd) else
           'PASS' if (len(pre) == 1 and pre[0].get('ok') is False
                      and str(pre[0].get('errorName', '')).startswith(('EAI', 'ENOT', 'ECONN', 'ETIMED', 'ENET'))
                      and status == 'exited')
           else 'FAIL')
print(json.dumps({'precheck': pre, 'attempts': len(fwd), 'containerStatus': status}, ensure_ascii=False))
print(f"{verdict} | F1 未共享网络 → 预检失败即退出，零条请求发出（付费脚本据此在 CLI 启动前停止）")
sys.exit(0 if verdict == 'PASS' else 1)
PY
rc=$?
set -e
check "F 拓扑错误零请求止损" $rc

cleanup
echo
if [ "$FAILED" -eq 0 ]; then
  date -u +%Y-%m-%dT%H:%M:%SZ > "$ROOT/PASS"
  echo "SMOKE_CHAIN_PASS cost_cny=0 pass_marker=$ROOT/PASS"
else
  echo "SMOKE_CHAIN_FAIL 失败项=$FAILED"
  exit 1
fi
