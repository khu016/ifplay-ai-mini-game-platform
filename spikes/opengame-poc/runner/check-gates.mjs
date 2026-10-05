// 真实生成前的四道闸门（供 generate-game.sh 调用）。任一不过 → 退出码 3，且不触网。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paidGateStatus, assertCredentials, loadProviders } from './credentials.mjs';
import { pricingReadiness } from './pricing.mjs';
import { matchTarget } from './egress-rules.mjs';

const pocRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) { console.error(`REFUSE: ${msg}`); process.exit(3); }

const steps = [];
// 1) 双重付费开关
const gate = paidGateStatus(process.env);
if (!gate.allowPaidCalls) fail(gate.reason);
steps.push(`1/4 付费闸门已开（ENABLE_PAID_API + COST_AUTHORIZED 均为 true）`);

// 2) 凭证：Key 只在环境、模型名与 baseUrl 显式钉死（防静默回退）
try { assertCredentials({ env: process.env, needImage: false }); } catch (e) { fail(e.message); }
steps.push(`2/4 凭证与模型名校验通过（不回显密钥）`);

// 3) 定价与汇率已确认
const ready = pricingReadiness();
if (!ready.text.ready) fail(`文本定价未确认：${ready.text.reason}`);
if (ready.fx.status && String(ready.fx.status).includes('待')) {
  fail(`汇率仍未确认（${ready.fx.status}）——首次真实调用前必须由产品经理回填当天牌价`);
}
steps.push(`3/4 定价已确认（USD peak 价 × 汇率 ${ready.fx.usdCny}）；图片定价${ready.image.ready ? '已确认' : '未确认（图片调用将被单独拒绝）'}`);

// 4) 白名单：模型域名放行、遥测域名拒绝
const allow = JSON.parse(readFileSync(join(pocRoot, 'config/egress-allowlist.json'), 'utf8'));
if (!matchTarget(allow, 'api.deepseek.com', 443)) fail('api.deepseek.com:443 未在 model 分组放行');
if (matchTarget(allow, 'gb4w8c3ygj-default-sea.rum.aliyuncs.com', 443)) fail('RUM 遥测域名被放行，违反上报关闭要求');
if (matchTarget(allow, 'aliyuncs.com', 443)) fail('aliyuncs.com 上级域被放行（会连带放开 RUM）');
steps.push('4/4 egress 白名单：模型域名放行、RUM 与其他模型域名保持拒绝');

console.log(steps.join('\n'));
console.log('GATES_PASS');
