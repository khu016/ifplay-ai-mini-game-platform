# OpenGame 上游补丁（可审计、仅在隔离副本生效）

上游锁定基线：`c9bea37786af524bf3bbe802f2b67d23816fa5c0`（只读缓存 `opengame@c9bea377`，本目录的补丁**从不**应用到该缓存）。

## 0001-deepseek-disable-thinking.patch

- 文件：`packages/core/src/core/openaiContentGenerator/provider/deepseek.ts`（唯一改动文件）
- 基线 sha256：`4491fad8986f0fb2cd0e8b9a26899395006b4e692d49c2a28590636b9486aa51`
- 补丁文件 sha256：`6f2e17ce42cb372eccd77249f4614c143a238ce6e77bc87194d8598917a081f0`
- 为什么必须打：实测（`runner/verify-deepseek-request-shape.sh`，零费用）确认 OpenGame 的请求组装链路
  （`pipeline.ts:225-329` → `provider/default.ts:buildRequest` → SDK `create(..., {signal})`）只透传
  `max_tokens / temperature / top_p / reasoning_effort` 等白名单字段，SDK 调用不带 `extra_body`，
  因此**没有任何配置路径**能注入 DeepSeek 的 `thinking: { "type": "disabled" }`。
- 行为：仅当环境变量 `POC_DEEPSEEK_DISABLE_THINKING=1` 时，在 `DeepSeekOpenAICompatibleProvider.buildRequest`
  的最终返回处写入 `thinking: { "type": "disabled" }` 并删除与之互斥的 `reasoning_effort`；
  两条返回路径（无 messages 早退、正常消息路径）都被覆盖。
  环境变量未设置为 `1` 时，请求体与上游完全一致（已在零费用探针中验证：`thinking=None`）。
- 应用方式（`runner/apply-thinking-patch.sh`，可重复执行、幂等）：
  1. `cp -c -R generated/verify-build generated/smoke-src` 生成 APFS 克隆的隔离临时副本（副本 git HEAD 仍是上游 SHA）；
  2. 校验副本干净且目标文件哈希等于上面记录的基线哈希；
  3. `git apply patches/0001-deepseek-disable-thinking.patch`；
  4. 在 `--network none` 的锁定镜像容器内 `node ../../scripts/build_package.js` 离线重建 `packages/core`（不下载依赖）；
  5. 断言编译产物包含补丁逻辑，并记录哈希到 `generated/smoke-src/PATCH_APPLIED.txt`。
- 补丁后文件哈希（本次记录，重建后如变动以 `PATCH_APPLIED.txt` 为准）：
  - 源码 `deepseek.ts`：`9770ece9c3396fcf1b27ed8be3f012488e7acf8267ec505fd989da490800a3ac`
  - 产物 `packages/core/dist/src/core/openaiContentGenerator/provider/deepseek.js`：`c308d01cc643c776e66f2bb63fead3e50f585c26d361c356b6a05a62361b2998`
- 表述纪律：应用补丁后的副本**不再等于**上游 SHA `c9bea377…`，只能称"同基线的临时可执行副本"；
  上游锁定 SHA 的记录保持不变，只读缓存不被修改。
