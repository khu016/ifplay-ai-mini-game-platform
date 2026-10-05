#!/usr/bin/env bash
# 零费用实测：真实 OpenGame CLI 最终发往 DeepSeek 兼容端点的 HTTP 请求体长什么样
# 目的：确认 max_tokens / maxRetries / reasoning 能否只靠配置注入，thinking 是否必须打补丁。
# 边界：--network none，域名 api.deepseek.com 经 /etc/hosts 指向 127.0.0.1 上的本地假服务；
#      不发任何真实网络请求，Key 是明显的假值，费用 0 元。
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
OG_SRC="${OG_SRC:-/Users/a123/Documents/Codex/2026-09-15/ifplay-opengame-poc/opengame@c9bea377}"
BASE_IMAGE="node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df"
WORK="$SPIKE/generated/request-probe"
SRC="${SRC:-$SPIKE/generated/verify-build}"
FAKE_KEY="POC_LOCAL_FAKE_KEY_NOT_A_CREDENTIAL"

fail() { echo "FAIL: $*" >&2; exit 1; }
log() { echo "[reqprobe] $*"; }

[ -d "$SRC/packages/cli/dist" ] || fail "缺少已构建的 OpenGame 副本：${SRC}（先跑 runner/verify-opengame-build.sh）"

rm -rf "$WORK"
mkdir -p "$WORK/.qwen"

# 只允许 loopback 解析；api.deepseek.com 指到本机假服务，任何真实外网都无路由
cat > "$WORK/hosts" <<'EOF'
127.0.0.1	localhost
::1	localhost
127.0.0.1	api.deepseek.com
EOF

# 待验证的配置注入方式：全部写在项目 settings 里（不改上游代码）
cat > "$WORK/.qwen/settings.json" <<'EOF'
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

log "容器内启动本地假服务并驱动真实 CLI（--network none，费用 0 元）"
docker run --rm --name poc-reqprobe --network none \
  --cpus 2 --memory 2g --pids-limit 256 \
  --read-only --tmpfs /tmp \
  -v "$WORK/hosts":/etc/hosts:ro \
  -v "$SPIKE/runner":/ops:ro \
  -v "$SRC":/src:ro \
  -v "$WORK":/work:rw \
  -e HOME=/tmp \
  -e OPENAI_API_KEY="$FAKE_KEY" \
  -e OPENAI_BASE_URL=http://api.deepseek.com/v1 \
  -e OPENAI_MODEL=deepseek-flash \
  -e POC_DEEPSEEK_DISABLE_THINKING="${POC_DEEPSEEK_DISABLE_THINKING:-0}" \
  -e CLI_EXTRA="${CLI_EXTRA:-}" \
  -e OTEL_SDK_DISABLED=true \
  -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" sh -c '
    node /ops/mock-deepseek.mjs --port 80 --capture /work/final-requests.jsonl --ready /work/mock.ready >/work/mock.log 2>&1 &
    MOCK=$!
    for i in $(seq 1 60); do [ -s /work/mock.ready ] && break; sleep 0.25; done
    [ -s /work/mock.ready ] || { echo "假服务未就绪"; cat /work/mock.log; exit 1; }
    cd /work
    timeout 420 node /src/packages/cli/dist/index.js \
      -p "Reply with exactly this single line and nothing else: OK" \
      --auth-type openai -o stream-json $CLI_EXTRA >/work/cli.jsonl 2>/work/cli.err
    echo "CLI_RC=$?"
    kill $MOCK 2>/dev/null || true
    echo "=== CLI stderr(前 20 行) ==="; head -20 /work/cli.err || true
    echo "=== 假服务日志 ==="; cat /work/mock.log
  '

[ -s "$WORK/final-requests.jsonl" ] || fail "没抓到任何请求体——CLI 可能未发出请求（见上面对 CLI 输出）"

echo
echo "=== 最终 HTTP 请求体字段（逐次）==="
python3 - "$WORK/final-requests.jsonl" <<'PY'
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
print(f"抓到 {len(rows)} 次请求")
total_bytes = 0
for r in rows:
    b = r['bodyWithoutMessages']
    print(f"#{r['n']} path={r['path']} messages={r['messageCount']} roles={r['messageRoles'][:4]}")
    print(f"   fields={r['bodyFields']}")
    print(f"   model={b.get('model')} max_tokens={b.get('max_tokens')} stream={b.get('stream')} "
          f"stream_options={b.get('stream_options')} reasoning_effort={b.get('reasoning_effort')} "
          f"thinking={b.get('thinking')} temperature={b.get('temperature')} top_p={b.get('top_p')}")
    print(f"   authorizationHeaderPresent={r['authorizationHeaderPresent']} bodyBytes={r.get('bodyBytes')}")
    total_bytes += r.get('bodyBytes') or 0
# 保守估算：每 3 字节按 1 token 计（中英混排下比 4 字节/token 更保守）
print(f"合计请求体 {total_bytes} 字节，保守估算输入 token ≈ {int(total_bytes/3)}（含工具定义与系统提示）")
PY
echo "REQUEST_SHAPE_DONE cost_cny=0"
