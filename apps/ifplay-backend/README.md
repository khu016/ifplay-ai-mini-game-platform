# IfPlay M2 后端（第二阶段）

IfPlay「AI 创作闭环」后端，实现受控 GameBundle 主轨的完整产品闭环：

`输入想法 → 创作会话 → 澄清问答（有上限）→ 方案卡（可修改/重推，保留历史）→ 确认 → 生成任务（含内容修复）→ 校验 → 保存版本（数量上限归档）→ 自然语言修改（结构化补丁）→ 版本恢复`。

> 本阶段只做受控 GameBundle 主轨，不接入 OpenGame 自由代码生成；`IsolatedCodeTrack` 仅预留并返回「尚未接入」，不执行任何代码。
> 当前无真实 Key，仅使用 `deterministic-test` Provider（明确非真实模型，不是 AI）。**真实模型冒烟待验**，不得宣称 AI 生成已完成。
> 任务为**单进程 SQLite 本地 MVP**的持久化长任务（后台工作器 + 重启恢复），不是多机生产任务系统。

## 技术栈

- Python 3.12 + FastAPI + SQLAlchemy 2（SQLite）+ jsonschema + pytest
- 依赖管理：uv（`pyproject.toml` + `uv.lock`）

## 目录

```
app/
├── main.py          # FastAPI 入口、/api/v1、统一错误处理
├── config.py        # 环境变量配置（无真实 Key）
├── db.py            # SQLAlchemy engine + init_db + 向后兼容列迁移
├── models.py        # 数据对象（ORM）
├── schemas.py       # Pydantic 请求/响应
├── state.py         # 任务状态机（generation + modification 双状态机）
├── cost.py          # 费用计量与预算闸门
├── billing.py       # 统一费用账本（记账/预检/失败留痕/会话聚合）
├── patch.py         # GameBundle 结构化补丁（允许路径白名单 + 约束）
├── worker.py        # 后台工作器（单进程线程，领取 queued 任务）
├── errors.py        # 统一错误码
├── contract/        # GameBundle 契约校验（消费共享契约 JSON）
├── providers/       # Provider 接口 + deterministic-test
├── tracks/          # GameBundleTrack / IsolatedCodeTrack
├── services/        # 会话/任务/版本业务逻辑
└── routers/         # API 路由
tests/               # pytest 测试套件
```

## 启动

```bash
cd apps/ifplay-backend
uv sync                                   # 安装依赖（创建 .venv）
cp .env.example .env                      # 复制配置（无真实 Key）
uv run uvicorn app.main:app --reload      # http://127.0.0.1:8000
```

## 测试

```bash
uv run pytest -q                          # 单元 + 集成 + 持久化 + 状态机 + 契约 + Provider + 费用 + 修复 + 修改 + 版本上限 + 迁移
```

## 接口（/api/v1，详见 http://127.0.0.1:8000/docs OpenAPI）

### 创作会话与方案卡

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/v1/sessions | 创建创作会话（含想法） |
| GET | /api/v1/sessions/{session_id} | 查询创作会话 |
| POST | /api/v1/sessions/{session_id}/clarifications | 提交澄清答案（达到上限自动停止追问并生成方案） |
| GET | /api/v1/sessions/{session_id}/plan | 获取当前方案卡 |
| POST | /api/v1/sessions/{session_id}/plan/modify | 修改当前方案（保存新记录，旧方案保留） |
| POST | /api/v1/sessions/{session_id}/plan/recommend | 重新推荐方案 |
| GET | /api/v1/sessions/{session_id}/plans | 方案历史列表 |
| POST | /api/v1/sessions/{session_id}/plan/confirm | 确认方案卡 |

### 生成任务（持久化长任务）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/v1/sessions/{session_id}/tasks | 创建生成任务（持久化入队，返回 202 + queued） |
| GET | /api/v1/tasks/{task_id} | 查询生成任务状态 |
| GET | /api/v1/tasks/{task_id}/result | 查询生成结果、校验摘要与用量台账 |
| POST | /api/v1/tasks/{task_id}/resume | 显式恢复 interrupted 任务（idempotency_key + confirm_retry=true） |

### 自然语言修改（异步任务）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/v1/sessions/{session_id}/versions/{version_id}/modifications | 提交修改（异步入队，返回 202 + queued，幂等） |
| GET | /api/v1/modifications/{task_id} | 查询修改任务 |
| GET | /api/v1/modifications/{task_id}/result | 查询修改结果（新版本/校验摘要/用量） |
| POST | /api/v1/modifications/{task_id}/resume | 恢复 interrupted 修改任务（幂等） |

### 版本

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/v1/sessions/{session_id}/versions?include_archived=true | 版本列表（默认仅最近 N 个可玩版本） |
| POST | /api/v1/versions/{version_id}/restore | 恢复历史版本（以创建新版本方式） |

错误统一返回：`{"error":{"code":"...","message":"..."}}`。

## 任务生命周期（持久化长任务）

- 生成任务：`confirmed → queued → generating → validating → playable`；任一步可 `failed`。
- 修改任务：`queued → applying → validating → succeeded`；任一步可 `failed`。
- `generating/applying/validating` 在服务重启时变为 `interrupted`（生成 `generation_interrupted` / 修改 `modification_interrupted`），仅可显式 resume 重新入队。
- 创建任务只写入 `queued` 状态即返回 202，不等待结束；后台工作器条件 UPDATE 原子领取，避免重复执行。
- `playable` / `succeeded` / `failed` 不自动重试；`interrupted` 不自动调用 Provider。

## 本阶段关键能力

- **统一费用账本**：澄清/方案/方案修改/重推/生成/内容修复/自然语言修改全部进入同一会话账本，记录 provider/model/version/token/耗时/费用/用途/状态；usage 缺失立即失败；每次调用前预算预检；失败调用留痕（不含提示词全文）；累计费用不清零。
- **澄清上限**：`IFPLAY_MAX_CLARIFICATIONS` 真正生效，达到上限停止追问并生成方案。
- **方案卡**：补充预计时长/主要资源/失败条件/成长方式/视觉方向/默认素材方案/当前无法实现内容/推荐轨道及原因；修改与重推保留历史。
- **内容修复**：生成后运行五类校验，失败时把机器可读错误交给 Provider 修复，最多两轮（第 3 次禁止），每轮单独记账，失败不产出可玩版本。
- **自然语言修改**：Provider 只返回结构化补丁 → 允许路径检查 → 应用到副本 → 完整校验 → 成功创建新版本（`parent_version_id` 指向原版本）；修改失败不覆盖当前可玩版本。
- **版本上限**：`IFPLAY_MAX_VERSIONS` 真正执行，超出部分标记归档（不物理删除）；归档版本不可作修改基线；恢复=创建新版本。

## 数据清理

SQLite 数据文件在 `data/ifplay.db`（已 gitignore）。删除该文件即可清空全部数据：

```bash
rm -f data/ifplay.db
```

数据库变更向后兼容：启动时自动为旧库补列并回填，不删除现有数据（见 `app/db.py::_migrate`）。

## GameBundle 共享契约

后端不手写契约，而是消费由运行时权威 Zod schema 生成的 JSON Schema（`apps/ifplay-m0/contract/gamebundle-contract.json`），
生成方式（在 `apps/ifplay-m0/` 下）：

```bash
npm run export:contract
```

后端校验包含：结构（JSON Schema）、模块 config、白名单玩法、引用完整性、安全字段（禁止 eval/Function/script/HTML 等）。
