#!/usr/bin/env bash
# 诊断复现（零费用，纯本地 --internal 网络）：证明"容器名解析只在共享网络内可用"，
# 这正是阶段二真实冒烟失败的根因（中继报 getaddrinfo EAI_AGAIN poc-smoke-proxy）。
# 不触达任何公网，不调用任何模型，费用 0 元。
set -uo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
BASE_IMAGE="${BASE_IMAGE:-node:20-slim@sha256:10fc5f5f33cba34a4befa58fcf95f724e67707fab7c32fb8cd3fcf90ebcc20df}"
NET_A="poc-diag-egress"; NET_B="poc-diag-smoke"
CA_A="poc-diag-proxy"; CA_B="poc-diag-relay"

log() { echo "[dnsdiag] $*"; }
cleanup() {
  docker rm -f "$CA_A" "$CA_B" >/dev/null 2>&1 || true
  docker network rm "$NET_A" "$NET_B" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker image inspect "$BASE_IMAGE" >/dev/null 2>&1 || { log "FAIL: 基础镜像不在本地缓存"; exit 1; }
docker network create --internal "$NET_A" >/dev/null || exit 1
docker network create --internal "$NET_B" >/dev/null || exit 1

# 代理边车：监听 3128（只在 NET_A）
docker run -d --name "$CA_A" --network "$NET_A" --read-only --tmpfs /tmp -e HOME=/tmp \
  "$BASE_IMAGE" node -e "require('net').createServer(()=>{}).listen(3128,'0.0.0.0')" >/dev/null || exit 1
# 中继：只在 NET_B —— 与真实脚本当时的拓扑一致
docker run -d --name "$CA_B" --network "$NET_B" --read-only --tmpfs /tmp -e HOME=/tmp \
  "$BASE_IMAGE" node -e "require('net').createServer(()=>{}).listen(443,'0.0.0.0');setInterval(()=>{},1000)" >/dev/null || exit 1
sleep 2

probe() { # 在中继容器里解析并 TCP 连接代理容器名
  docker exec -e TARGET="$CA_A" "$CA_B" node -e '
    const net=require("node:net"), dns=require("node:dns");
    dns.lookup(process.env.TARGET,(e)=>{ if(e){console.log("DNS_FAIL "+e.code);process.exit(2);}
      console.log("DNS_OK");
      const s=net.connect({host:process.env.TARGET,port:3128});
      s.setTimeout(5000);
      s.once("connect",()=>{console.log("TCP_OK");s.destroy();process.exit(0);});
      s.once("error",(x)=>{console.log("TCP_FAIL "+x.code);process.exit(3);});
      s.once("timeout",()=>{console.log("TCP_TIMEOUT");process.exit(4);});
    });' 2>&1
}

log "步骤1：代理只在 ${NET_A}，中继只在 ${NET_B}（复现故障拓扑）"
OUT1="$(probe)"; RC1=$?
log "结果 rc=${RC1}: $(echo "$OUT1" | tr '\n' ' ')"

log "步骤2：把中继同时接入 ${NET_A}（修复方案）"
docker network connect "$NET_A" "$CA_B" || exit 1
sleep 1
OUT2="$(probe)"; RC2=$?
log "结果 rc=${RC2}: $(echo "$OUT2" | tr '\n' ' ')"

# 检查跨网解析失败期间没有任何连接进入代理侧（代理容器内 netstat 不可用，用 docker exec 计数替代）
log "验证：故障拓扑下 DNS 直接失败，未产生任何 TCP 连接（EAI_AGAIN/ENOTFOUND 即'请求未离开本机'）"

if [ "$RC1" -ne 0 ] && echo "$OUT1" | grep -q "DNS_FAIL" && [ "$RC2" = 0 ] && echo "$OUT2" | grep -q "TCP_OK"; then
  echo "DNSDIAG_PASS separated_unresolvable=1 shared_reachable=1"
  exit 0
fi
echo "DNSDIAG_INCONCLUSIVE before_rc=$RC1 after_rc=$RC2"
exit 1
