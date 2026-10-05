// egress 白名单匹配规则（代理与自测共用同一份判定，避免实现漂移）
export function isIpLiteral(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.includes(':')) return true;
  return false;
}

export function parseDomainPort(entry) {
  let host = entry, port = null;
  const i = entry.lastIndexOf(':');
  if (i > 0) { host = entry.slice(0, i); port = Number(entry.slice(i + 1)); }
  return { host, port };
}

export function hostMatches(host, domain) {
  if (host === domain) return true;
  return host.endsWith('.' + domain);
}

// 返回 { category, domain } 表示放行；null 表示拒绝。IP 字面量一律拒绝。
export function matchTarget(allowlist, hostname, port) {
  if (isIpLiteral(hostname)) return null;
  for (const [category, entry] of Object.entries(allowlist.categories || {})) {
    for (const item of entry.domains || []) {
      const { host: d, port: dp } = parseDomainPort(item);
      if (hostMatches(hostname, d) && (dp === null || dp === port)) {
        return { category, domain: d };
      }
    }
  }
  return null;
}
