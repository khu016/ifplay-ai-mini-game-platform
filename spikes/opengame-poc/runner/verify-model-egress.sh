#!/usr/bin/env bash
# 阶段二 · 模型白名单容器内连通/拒绝实测（零费用：不带 Key、不发模型请求，只做 TLS 连接与无凭据 HEAD）
# 边界：不调用付费 API、不配置 Key、不登录 Docker Hub、只清理本脚本自建资源、可重复运行。
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
BASE_IMAGE="${BASE_IMAGE:-node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df}"
NET="poc-mege-net"; PROXY_C="poc-mege-proxy"; TEST_C="poc-mege-test"
ALLOWLIST="${ALLOWLIST:-egress-allowlist.json}"
EGRESS_MODE="${EGRESS_MODE:-model}"
LOGS="$SPIKE/generated/build-logs"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

fail() { echo "FAIL: $*" >&2; exit 1; }
log() { echo "[model-egress] $*"; }

cleanup() {
  docker rm -f "$TEST_C" "$PROXY_C" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup

docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || fail "基础镜像不在本地缓存（不重复下载）：$BASE_IMAGE"
mkdir -p "$LOGS"

log "创建 --internal 网络 + 白名单代理（唯一出口，默认全拒绝）｜白名单=$ALLOWLIST 模式=$EGRESS_MODE"
docker network create --internal "$NET" >/dev/null
docker run -d --name "$PROXY_C" --network "$NET" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" -v "$SPIKE/config:/cfg:ro" \
  -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/egress-proxy.mjs --config "/cfg/$ALLOWLIST" --port 3128 --bind 0.0.0.0 >/dev/null
sleep 1
docker network connect bridge "$PROXY_C"
docker inspect "$PROXY_C" --format '{{.State.Status}}' | grep -q '^running$' || fail "代理边车未启动"

if [ "$EGRESS_MODE" = "smoke" ]; then
  log "容器内实测（冒烟白名单：只放行 api.deepseek.com:443；图片域/RUM/npm/其他模型域/非 443/明文 HTTP/直连 IP 全拒绝）"
else
  log "容器内实测（放行 api.deepseek.com / dashscope.aliyuncs.com 的 443；拒绝其他模型域、RUM、非 443、明文 HTTP、直连 IP、绕过代理）"
fi
docker run --rm --network "$NET" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" \
  -e PROXY_HOST="$PROXY_C" -e PROXY_PORT=3128 -e EGRESS_MODE="$EGRESS_MODE" \
  -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" node /ops/egress-live-test.mjs 2>&1 | tee "$LOGS/verify-model-egress-$TS.log"

grep -q "ALL PASS" "$LOGS/verify-model-egress-$TS.log" || fail "模型白名单实测未全过（详见 $LOGS/verify-model-egress-$TS.log）"

docker logs "$PROXY_C" > "$LOGS/verify-model-proxy-$TS.log" 2>&1
if grep -qiE "authorization|bearer|api[-_]?key|sk-" "$LOGS/verify-model-proxy-$TS.log"; then
  fail "代理日志出现疑似凭据关键字，需人工核查"
fi
log "代理日志无凭据关键字"
log "放行/拒绝统计: $(grep -oE '"status":"[a-z-]+"' "$LOGS/verify-model-proxy-$TS.log" | sort | uniq -c | tr '\n' ' ')"
log "目标域名分类: $(grep -oE '"host":"[^"]+"' "$LOGS/verify-model-proxy-$TS.log" | sort | uniq -c | tr '\n' ' ')"
log "MODEL_EGRESS_PASS cost_cny=0 log=$LOGS/verify-model-egress-$TS.log"
