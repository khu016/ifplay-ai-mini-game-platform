#!/usr/bin/env bash
# 阶段二·冒烟前置：在隔离副本上应用 thinking 关闭补丁，并在离线容器内重建 core。
# 边界：补丁只作用于 spikes/opengame-poc/generated/smoke-src（APFS 克隆副本）；
#      只读上游缓存 opengame@c9bea377 与 generated/verify-build 永不被修改。
#      --network none 构建，不下载任何依赖，不产生费用。
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$SPIKE/generated/smoke-src}"
PATCH="${PATCH:-$SPIKE/patches/0001-deepseek-disable-thinking.patch}"
TARGET="packages/core/src/core/openaiContentGenerator/provider/deepseek.ts"
BASE_SHA="c9bea37786af524bf3bbe802f2b67d23816fa5c0"
BASE_TS_SHA256="4491fad8986f0fb2cd0e8b9a26899395006b4e692d49c2a28590636b9486aa51"
BASE_IMAGE="node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df"
C="poc-patch-build"

fail() { echo "FAIL: $*" >&2; exit 1; }
log() { echo "[patch] $*"; }
cleanup() { docker rm -f "$C" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
cleanup

[ -d "$SRC/.git" ] || fail "副本缺少 .git：$SRC"
[ -f "$PATCH" ] || fail "补丁不存在：$PATCH"
git -C "$SRC" rev-parse HEAD | grep -q "^$BASE_SHA\$" || fail "副本基线不是 $BASE_SHA"
# 幂等：上次已打补丁就先回退，保证每次都从干净基线重放
if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  if git -C "$SRC" apply --reverse --check "$PATCH" >/dev/null 2>&1; then
    log "副本已有本补丁，先回退到基线"
    git -C "$SRC" apply -R "$PATCH"
    rm -f "$SRC/PATCH_APPLIED.txt"
  else
    fail "副本存在本补丁之外的改动，拒绝继续：$(git -C "$SRC" status --porcelain | head -3)"
  fi
fi
[ -z "$(git -C "$SRC" status --porcelain)" ] || fail "回退后副本仍不干净"
git -C "$SRC" cat-file -p "HEAD:$TARGET" | shasum -a 256 | grep -q "^$BASE_TS_SHA256" || fail "补丁目标文件与记录的基线哈希不一致"
docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || fail "基础镜像不在本地缓存（不重复下载）：$BASE_IMAGE"

log "校验补丁可干净应用"
git -C "$SRC" apply --check "$PATCH" || fail "补丁无法干净应用"
git -C "$SRC" apply "$PATCH"
log "已应用：$(basename "$PATCH")"

log "离线容器内重建 packages/core（--network none，不装依赖）"
docker run --rm --name "$C" --network none --read-only --tmpfs /tmp \
  --cpus 2 --memory 3g --pids-limit 512 \
  -e HOME=/tmp -e npm_config_cache=/tmp/npm-cache \
  -v "$SRC:/src" \
  -w /src/packages/core \
  "$BASE_IMAGE" sh -c 'PATH=/src/node_modules/.bin:$PATH node ../../scripts/build_package.js' 2>&1 | tail -8

grep -q "POC_DEEPSEEK_DISABLE_THINKING" "$SRC/packages/core/dist/src/core/openaiContentGenerator/provider/deepseek.js" \
  || fail "编译产物中看不到补丁逻辑"

log "哈希记录（补丁前后）"
{
  echo "upstream_baseline_sha=$BASE_SHA"
  echo "patch_file_sha256=$(shasum -a 256 "$PATCH" | awk '{print $1}')"
  echo "patched_ts_sha256=$(shasum -a 256 "$SRC/$TARGET" | awk '{print $1}')"
  echo "patched_dist_js_sha256=$(shasum -a 256 "$SRC/packages/core/dist/src/core/openaiContentGenerator/provider/deepseek.js" | awk '{print $1}')"
  echo "baseline_ts_sha256=$BASE_TS_SHA256"
} | tee "$SRC/PATCH_APPLIED.txt"
log "注意：应用补丁后的副本不再等于上游 SHA ${BASE_SHA}，只是同基线的临时可执行副本。"
log "PATCH_APPLY_DONE cost_cny=0"
