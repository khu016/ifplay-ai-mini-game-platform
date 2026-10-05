#!/usr/bin/env bash
# 冒烟转发器的本地证书链（纯本地、零网络、零费用）：
# 自签 CA → 签发 CN=api.deepseek.com 的服务器证书，容器内用 NODE_EXTRA_CA_CERTS 只信任该 CA。
# 用途：让 CLI 在"以为自己在连 api.deepseek.com"的前提下，由转发器逐条校验最终 HTTP 请求体
#       并采集真实 usage。这是有意披露的本地中间人取证，私钥/证书只落在 gitignore 的 generated/ 下。
set -euo pipefail

SPIKE="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${1:-$SPIKE/generated/smoke-tls}"
DAYS="${DAYS:-3}"
HOST="api.deepseek.com"

fail() { echo "FAIL: $*" >&2; exit 1; }

command -v openssl >/dev/null || fail "缺少 openssl"
mkdir -p "$DIR"
cd "$DIR"

umask 077

not_expiring_soon() { # 剩余有效期需大于 6 小时（LibreSSL 无 -checkend，手工比较 notAfter）
  local na ts now
  na="$(openssl x509 -in "$1" -noout -enddate | cut -d= -f2)"
  ts="$(date -u -j -f '%b %e %T %Y %Z' "$na" +%s 2>/dev/null \
        || date -u -j -f '%b %e %T %Y' "${na% *}" +%s 2>/dev/null || echo 0)"
  now="$(date -u +%s)"
  [ "$ts" -gt $((now + 21600)) ]
}

if [ "${FORCE:-0}" != "1" ] && [ -f relay.pem ] && [ -f relay.key ] && [ -f ca.pem ] \
   && openssl verify -CAfile ca.pem relay.pem >/dev/null 2>&1 \
   && not_expiring_soon relay.pem; then
  echo "[tls] 复用仍未过期的本地证书：$DIR"
else
  rm -f ca.key ca.pem relay.key relay.csr relay.pem openssl-ca.cnf openssl-relay.cnf

  cat > openssl-ca.cnf <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no
[dn]
CN = IfPlay PoC Local CA
[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
EOF

  cat > openssl-relay.cnf <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $HOST
[v3_srv]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = DNS:$HOST
subjectKeyIdentifier = hash
EOF

  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days "$DAYS" \
    -config openssl-ca.cnf -extensions v3_ca >/dev/null 2>&1 || fail "生成本地 CA 失败"
  openssl req -newkey rsa:2048 -nodes -keyout relay.key -out relay.csr -days "$DAYS" \
    -config openssl-relay.cnf >/dev/null 2>&1 || fail "生成 CSR 失败"
  openssl x509 -req -in relay.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out relay.pem \
    -days "$DAYS" -extfile openssl-relay.cnf -extensions v3_srv >/dev/null 2>&1 || fail "签发服务器证书失败"
fi

openssl verify -CAfile ca.pem relay.pem | grep -q ': OK$' || fail "服务器证书未能通过本地 CA 校验"
openssl x509 -in relay.pem -noout -subject | sed 's/^/[tls] /'
openssl x509 -in relay.pem -noout -text 2>/dev/null | grep -A1 -i 'Alternative Name' | sed 's/^/[tls] /' || true
echo "[tls] 就绪：CA=$DIR/ca.pem 证书=$DIR/relay.pem 私钥=$DIR/relay.key（有效期 ${DAYS} 天，仅供本地取证）"
echo "SMOKE_TLS_READY cost_cny=0"
