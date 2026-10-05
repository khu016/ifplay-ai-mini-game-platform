#!/usr/bin/env bash
# OpenGame 本体零费用可重复构建审核（第二轨阶段一固化脚本）
# 边界：不调用模型、不读取/配置 Key、不开放模型/图片域名、费用 0 元。
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
OG_SRC="${OG_SRC:-/Users/a123/Documents/Codex/2026-09-15/ifplay-opengame-poc/opengame@c9bea377}"
LOCKED_SHA="c9bea37786af524bf3bbe802f2b67d23816fa5c0"
BASE_IMAGE="node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df"
EXPECT_VERSION="0.6.0"
BUILD_TIMEOUT="${BUILD_TIMEOUT:-2400}"   # 秒；超时 docker kill 整容器
NET="poc-verify-net"; PROXY_C="poc-verify-proxy"; BUILD_C="poc-verify-build"
WORK="$SPIKE/generated/verify-build"; LOGS="$SPIKE/generated/build-logs"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

fail() { echo "FAIL: $*" >&2; exit 1; }
log() { echo "[verify] $*"; }

cleanup() {
  # 只清理本脚本自建的、名称唯一的资源；不触碰其他容器/镜像/目录
  docker rm -f "$BUILD_C-1" "$BUILD_C-2" "$BUILD_C-3" "$PROXY_C" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup_pre() { docker rm -f "$BUILD_C-1" "$BUILD_C-2" "$BUILD_C-3" "$PROXY_C" "$BUILD_C" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
cleanup_pre   # 可重复运行：第二次不因同名残留失败

[ -d "$OG_SRC" ] || fail "OpenGame 源码缓存不存在: $OG_SRC"
ACTUAL_SHA="$(git -C "$OG_SRC" rev-parse HEAD)"
[ "$ACTUAL_SHA" = "$LOCKED_SHA" ] || fail "源码 SHA $ACTUAL_SHA ≠ 锁定 $LOCKED_SHA"
[ -z "$(git -C "$OG_SRC" status --porcelain)" ] || fail "源码缓存工作区不干净"
log "源码 SHA 校验通过: $ACTUAL_SHA"

LOCAL_ID="$(docker image inspect "$BASE_IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
EXPECTED_ID="sha256:${BASE_IMAGE##*@sha256:}"
[ "$LOCAL_ID" = "sha256:${EXPECTED_ID#sha256:}" ] || fail "基础镜像 digest 校验失败: local=$LOCAL_ID want=$EXPECTED_ID"
log "基础镜像按 digest 固定校验通过: $BASE_IMAGE"

mkdir -p "$WORK" "$LOGS"
if [ ! -f "$WORK/package-lock.json" ]; then
  log "预拷源码到独立构建输出目录（71M，仅首次）"
  (cd "$OG_SRC" && tar -cf - .) | (cd "$WORK" && tar -xf -)
  [ -f "$WORK/package-lock.json" ] || fail "源码拷贝失败"
fi

log "创建 --internal 网络与 egress 代理边车（唯一出口，默认全拒绝）"
docker network create --internal "$NET" >/dev/null
docker run -d --name "$PROXY_C" --network "$NET" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" -v "$SPIKE/config:/cfg:ro" \
  "$BASE_IMAGE" node /ops/egress-proxy.mjs --config /cfg/egress-allowlist.json --port 3128 --bind 0.0.0.0 >/dev/null
sleep 1
docker network connect bridge "$PROXY_C"
docker inspect "$PROXY_C" --format '{{.State.Status}}' | grep -q '^running$' || fail "代理边车未启动"

log "egress 白名单容器内实测（放行 registry；拒绝 RUM/模型类域名/直连）"
docker run --rm --network "$NET" --cpus 1 --memory 512m --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$SPIKE/runner:/ops:ro" \
  -e PROXY_HOST="$PROXY_C" -e PROXY_PORT=3128 -e EGRESS_MODE=strict \
  "$BASE_IMAGE" node /ops/egress-live-test.mjs 2>&1 | tee "$LOGS/verify-egress-$TS.log"
grep -q "ALL PASS" "$LOGS/verify-egress-$TS.log" || fail "egress 实测未全过（详见 $LOGS/verify-egress-$TS.log）"

log "本体构建容器（源码只读挂载，仅 $WORK 可写；资源限额+超时；瞬时网络错误下最多 3 次完整重建）"
build_attempt() {  # $1=attempt number
  local A="$1" C="$BUILD_C-$1" L="$LOGS/verify-build-$TS-attempt$1.log"
  docker rm -f "$C" >/dev/null 2>&1 || true
  docker run -d --name "$C" --network "$NET" --cpus 2 --memory 2g --pids-limit 256 \
    --read-only --tmpfs /tmp -v "$OG_SRC:/src:ro" -v "$WORK:/work:rw" \
    -e HTTP_PROXY="http://$PROXY_C:3128" -e HTTPS_PROXY="http://$PROXY_C:3128" \
    -e npm_config_audit=false -e npm_config_fund=false -e npm_config_cache=/tmp/npm-cache \
    -e npm_config_fetch_retries=5 -e npm_config_fetch_retry_maxtimeout=120000 -e npm_config_maxsockets=4 \
    -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false -e NODE_OPTIONS=--max-old-space-size=1536 \
    "$BASE_IMAGE" sh -c 'set -e; cd /work; echo "=== npm ci ==="; npm ci --no-audit --no-fund --loglevel=error; echo "CI_OK"; echo "=== rebuild sharp ==="; npm rebuild sharp >/dev/null 2>&1; echo "SHARP_OK"; echo "=== build ==="; npm run build; echo "BUILD_OK"; echo "=== typecheck ==="; npm run typecheck; echo "TYPECHECK_OK"' >/dev/null
  local START DEADLINE EXITED ST RC
  START=$(date +%s); DEADLINE=$((START + BUILD_TIMEOUT)); EXITED=""
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    ST="$(docker inspect -f '{{.State.Status}}' "$C" 2>/dev/null || echo gone)"
    if [ "$ST" != "running" ]; then EXITED=1; break; fi
    sleep 15
  done
  [ -n "$EXITED" ] || { docker kill "$C" >/dev/null 2>&1 || true; fail "构建超过 ${BUILD_TIMEOUT}s，已 docker kill 整容器"; }
  RC="$(docker inspect -f '{{.State.ExitCode}}' "$C")"
  docker logs "$C" > "$L" 2>&1
  if [ "$RC" = "0" ] && grep -q '^CI_OK$' "$L" && grep -q '^SHARP_OK$' "$L" && grep -q '^BUILD_OK$' "$L" && grep -q '^TYPECHECK_OK$' "$L"; then
    cp "$L" "$LOGS/verify-build-$TS.log"; BUILD_LOG="$L"
    log "构建 attempt$A 通过 (rc=0，四标记齐)"; return 0
  fi
  if grep -qE "ECONNRESET|socket disconnected|ETIMEDOUT|EAI_AGAIN|ENETUNREACH" "$L"; then
    log "attempt${A} 因瞬时网络错误失败（rc=${RC}），重试"; return 1
  fi
  fail "构建 attempt${A} 失败且非网络原因（rc=${RC}，详见 ${L}）"
}
BUILD_LOG=""
build_attempt 1 || build_attempt 2 || build_attempt 3 || fail "3 次构建均失败（宿主网络不稳）"

log "离线冒烟：--network none + 只读挂载（CLI 版本/help/原生模块加载）"
VOUT="$(docker run --rm --network none --cpus 1 --memory 1g --pids-limit 128 \
  --read-only --tmpfs /tmp -v "$WORK:/work:ro" -e HOME=/tmp \
  -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \
  "$BASE_IMAGE" sh -c 'cd /work; node packages/cli/dist/index.js --version')"
[ "$VOUT" = "$EXPECT_VERSION" ] || fail "--version 输出 '$VOUT' ≠ $EXPECT_VERSION"
docker run --rm --network none --read-only --tmpfs /tmp -v "$WORK:/work:ro" -e HOME=/tmp \
  "$BASE_IMAGE" sh -c 'cd /work; node packages/cli/dist/index.js --help | head -1' | grep -q "Usage: opengame" || fail "--help 校验失败"
docker run --rm --network none --read-only --tmpfs /tmp -v "$WORK:/work:ro" -e HOME=/tmp \
  "$BASE_IMAGE" sh -c 'cd /work; node -e "require(\"onnxruntime-node\"); require(\"sharp\"); console.log(\"NATIVE_OK\")"' | grep -q NATIVE_OK || fail "onnxruntime/sharp 加载失败"
log "离线冒烟通过：--version=${VOUT}，--help 正常，onnxruntime/sharp 加载成功"

docker logs "$PROXY_C" > "$LOGS/verify-proxy-$TS.log" 2>&1
log "白名单审计（仅统计行，不含凭据）: $(grep -c '"status":"allow"' "$LOGS/verify-proxy-$TS.log") allow / $(grep -c '"status":"deny"' "$LOGS/verify-proxy-$TS.log") deny"
log "磁盘: $(du -sh "$WORK" | cut -f1) @ $WORK"
echo "VERIFY_OPENGAME_BUILD_PASS sha=$LOCKED_SHA image=${BASE_IMAGE} cost_cny=0"
