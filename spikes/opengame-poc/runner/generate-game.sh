#!/usr/bin/env bash
# 阶段二 · 真实生成容器骨架。默认 dry-run：只打印隔离命令与闸门判定，不发起任何调用、不产生费用。
# 用法：
#   bash runner/generate-game.sh --game midnight-diner
#   ENABLE_PAID_API=true COST_AUTHORIZED=true OPENAI_API_KEY=... OPENAI_MODEL=deepseek-flash \
#     bash runner/generate-game.sh --game midnight-diner --execute    # 仅在用户明确费用授权后
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
GAME=""
EXECUTE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --game) GAME="${2:-}"; shift 2 ;;
    --execute) EXECUTE=1; shift ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done
[ -n "$GAME" ] || { echo "必须给 --game <slug>" >&2; exit 2; }

fail() { echo "REFUSE: $*" >&2; exit 3; }

BASE_IMAGE="${BASE_IMAGE:-node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df}"
OG_SRC="${OG_SRC:-/Users/a123/Documents/Codex/2026-09-15/ifplay-opengame-poc/opengame@c9bea377}"
NET=poc-gen-net
PROXY=poc-gen-proxy

echo "[gate] 闸门判定（四道，任一不过即拒绝）"
if GATE_OUT="$(cd "$SPIKE" && node runner/check-gates.mjs 2>&1)"; then
  echo "$GATE_OUT" | sed 's/^/  /'
else
  echo "$GATE_OUT" | sed 's/^/  /'
  if [ "$EXECUTE" = "1" ]; then exit 3; fi
  echo "[dry-run] 闸门未通过 → 真实执行会被拒绝（当前只演示，不触网、不产生费用）"
fi

if [ "$EXECUTE" != "1" ]; then
  echo "[dry-run] 未加 --execute，不发起任何网络调用。计划命令（变量已展开；命令替换保留原样）："
  echo "[dry-run] 注意：下面这套『代理 + 白名单』拓扑已被实测证伪（R9：本 CLI 不接代理），不能照着跑；"
  echo "[dry-run]       真实生成必须改用 runner/run-deepseek-smoke.sh 的验证转发器拓扑，见 --execute 的拒绝信息。"
  cat <<PLAN
  # 1) egress 白名单代理（--internal 网络的唯一出口；沿用阶段一已实测的启动方式）
  #    ⚠ 已实测：该代理拦不住本 CLI 的模型出口（provider/default.ts:31-46 不接代理，Node20 fetch 不读 HTTPS_PROXY）
  docker network create --internal $NET
  docker run -d --name $PROXY --network $NET --cpus 1 --memory 512m --pids-limit 128 \\
    --read-only --tmpfs /tmp -v $SPIKE/runner:/ops:ro -v $SPIKE/config:/cfg:ro \\
    $BASE_IMAGE node /ops/egress-proxy.mjs --config /cfg/egress-allowlist.json --port 3128 --bind 0.0.0.0
  docker network connect bridge $PROXY

  # 2) 生成容器：源码只读、单游戏目录可写、资源限额、超时、无 --yolo、Key 只经 -e 注入
  #    实测修正（阶段二）：HTTPS_PROXY/HTTP_PROXY 对本 CLI 无效——OpenGame 的 OpenAI 客户端不接代理
  #    （provider/default.ts:31-46），Node 20 fetch 也不读代理环境变量，因此不能靠代理约束生成容器出口；
  #    真实生成前必须复用 runner/smoke-relay.mjs 的"验证转发器 + --internal 唯一出口"拓扑。
  #    另：$OG_SRC 是【未打补丁】的上游只读缓存，跑不出 thinking.type=disabled；
  #    真实生成必须改用与 generated/smoke-src 同源的已打补丁副本（见 patches/README.md）。
  docker run --rm --name poc-gen-$GAME --network $NET \\
    --cpus 2 --memory 2g --pids-limit 256 --read-only --tmpfs /tmp \\
    -v $OG_SRC:/src:ro -v $SPIKE/generated/games/$GAME:/work:rw \\
    -e HOME=/tmp -e ENABLE_PAID_API -e COST_AUTHORIZED \\
    -e OPENAI_API_KEY -e OPENAI_BASE_URL=https://api.deepseek.com/v1 -e OPENAI_MODEL=deepseek-flash \\
    -e OTEL_SDK_DISABLED=true -e GEMINI_TELEMETRY_ENABLED=false \\
    -e POC_DEEPSEEK_DISABLE_THINKING=1 \\
    $BASE_IMAGE sh -c 'cd /work; node /src/packages/cli/dist/index.js -p "\$(cat /work/prompt.md)" --output-format stream-json -m deepseek-flash --max-session-turns 40'

  # 3) 退出后由 runner 逐行解析 stream-json 的 usage 事件入账本（同一 perGame 额度）：
  #    2.55 元预警 / 3.00 元硬停 / 缺 usage 或缺实际模型标识即停 / 修复≤2 轮 / 图片≤3 张
PLAN
  echo "[dry-run] 完成，费用 0 元"
  exit 0
fi

[ -n "${OPENAI_API_KEY:-}" ] || fail "真实执行需要 OPENAI_API_KEY 经环境变量注入"
# 生成阶段的出口约束尚未落地（代理对本 CLI 无效，见上面实测修正），
# 未接上验证转发器之前不允许发起长时间多轮生成，避免无法取证的付费调用。
fail "真实游戏生成已被拒绝：生成容器还没有接上 runner/smoke-relay.mjs 的验证转发器（代理无法约束该 CLI 出口，且生成需逐轮取证 usage）。请先按冒烟拓扑完成生成链路改造并取得费用授权。"
# 上面的拒绝是本脚本当前的设计终点，不是遗漏：真实生成必须先改造成
# runner/run-deepseek-smoke.sh 那套「--internal 唯一出口 + TLS 验证转发器 + 逐轮 usage 入账」的拓扑，
# 才可能同时满足「只放通 api.deepseek.com:443」「每一轮都有费用证据」两条底线。
# 在那之前，这里保留可执行代码只会产生无法取证的付费调用，因此整段删除。
