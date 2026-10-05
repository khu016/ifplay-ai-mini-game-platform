#!/bin/bash
# 最小容器隔离验证脚本（可复跑）
# 前置：Colima 已启动，docker CLI 可用，node:20-alpine 已拉取。
# 用法：bash runner/verify-container-isolation.sh <单款游戏目录>
set -u
GAMEDIR="${1:?用法: verify-container-isolation.sh <单款游戏目录>}"
IMG="node:20-alpine"
FAIL=0

echo "===== 1) 默认断网 + 直连 IP/TCP ====="
out=$(docker run --rm --network none "$IMG" sh -c '
  echo "DNS=$( (nslookup example.com 2>&1 || true) | head -1 )";
  echo "TCP80=$(node -e "require(\"net\").connect(80,\"1.1.1.1\",()=>console.log(\"CONNECTED\")).on(\"error\",e=>console.log(\"BLOCKED:\"+e.code))" 2>&1 | tail -1)";
')
echo "$out"
echo "$out" | grep -q "BLOCKED:" && echo "PASS" || { echo "FAIL"; FAIL=1; }

echo ""
echo "===== 2) 无法读取宿主敏感目录 ====="
out=$(docker run --rm --network none -v "$GAMEDIR:/work:rw" "$IMG" sh -c '
  echo "users=$(ls /Users 2>&1 | head -1)";
  echo "ssh=$(ls /root/.ssh 2>&1 | head -1)";
  echo "env=$(cat /Users/a123/.env 2>&1 | head -1)";
  echo "work=$(ls /work | tr -d \"\n\")";
')
echo "$out"
echo "$out" | grep -q "No such file" && echo "PASS" || { echo "FAIL"; FAIL=1; }

echo ""
echo "===== 3) 无法写入挂载目录之外 ====="
out=$(docker run --rm --network none --read-only --tmpfs /tmp -v "$GAMEDIR:/work:rw" "$IMG" sh -c '
  (echo ok > /work/w.txt) && echo "work=OK" || echo "work=FAIL";
  (echo x > /etc/foo.txt) 2>/dev/null && echo "etc=WRITABLE(问题)" || echo "etc=DENIED";
')
echo "$out"
echo "$out" | grep -q "etc=DENIED" && echo "PASS" || { echo "FAIL"; FAIL=1; }

echo ""
echo "===== 4) 超时后整个进程树终止 + 容器删除 ====="
docker run --rm --name poc-tree -d "$IMG" sh -c 'sh -c "sleep 300" & sh -c "sleep 300" & sleep 300' >/dev/null
sleep 2
tree=$(docker exec poc-tree sh -c 'ps -o pid,ppid,comm | grep -E "sleep|sh" | wc -l' 2>/dev/null)
docker kill poc-tree >/dev/null 2>&1
sleep 1
left=$(docker ps -a --filter name=poc-tree --format '{{.Names}}' | wc -l | tr -d ' ')
echo "进程树节点数=$tree, 残留容器=$left"
[ "$tree" -gt 2 ] && [ "$left" -eq 0 ] && echo "PASS" || { echo "FAIL"; FAIL=1; }

echo ""
echo "===== 5) 容器内真实构建（依赖安装 + 正式构建）====="
docker run --rm --network none --read-only --tmpfs /tmp --cpus 2 --memory 2g --pids-limit 256 \
  -v "$GAMEDIR:/work:rw" "$IMG" sh -c 'cd /work && npm install --no-audit --no-fund --loglevel=error >/dev/null 2>&1 && npm run build' \
  && echo "PASS（退出码 0）" || { echo "FAIL"; FAIL=1; }

echo ""
echo "===== 6) 资源限额生效 ====="
docker run --rm --name poc-limit -d --network none --cpus 2 --memory 2g --pids-limit 256 --read-only --tmpfs /tmp "$IMG" sleep 300 >/dev/null
docker inspect poc-limit --format 'CPU={{.HostConfig.NanoCpus}} MEM={{.HostConfig.Memory}} PIDS={{.HostConfig.PidsLimit}} RO={{.HostConfig.ReadonlyRootfs}} NET={{.HostConfig.NetworkMode}}'
docker kill poc-limit >/dev/null 2>&1

echo ""
[ "$FAIL" -eq 0 ] && echo "===== 全部通过 =====" || echo "===== 存在失败项 ====="
exit $FAIL
