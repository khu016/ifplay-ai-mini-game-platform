# 人格会议网页端

人格会议 Agent 的独立项目目录。项目文件路径均以本目录为基准，不以外层工具包根目录为基准。

**当前阶段**：阶段 2 后端 MVP（第一阶段·纵向切片）已开发完成，mock 测试与 mock 冒烟通过；真实模型冒烟待提供 API Key 后验证。

## 产品一句话
用户在手机或电脑浏览器里提出一个困扰自己的问题，系统推荐或由用户选择 3–5 个四字母人格角色，围绕问题持续讨论；用户可随时插话、补充、追问，结束时由主持人整理一份决策纪要。首版为响应式网页，微信小程序留待后续版本。

## 阅读入口
- [PRD 原文 v1.1（网页端）](docs/PRD/人格会议网页端_PRD_v1.1.md)：需求确认稿，产品负责人 Keiry。
- [PRD v1.0（微信小程序，历史）](docs/PRD/人格会议微信小程序_PRD_v1.0.md)：已被 v1.1 取代。
- [项目状态](docs/项目状态.md)：已定需求、待确认问题与阶段历史。
- [技术适配声明](docs/阶段文档/第一阶段技术适配声明.md)、[第一阶段技术开发文档](docs/阶段文档/第一阶段技术开发文档.md)。
- [阶段 2 证据包](docs/evidence/阶段2/)。

## 本地运行

### 环境要求
- Python 3.12（项目已用 uv 管理，见下）
- uv（已装到 `~/.local/bin/uv`；缺失时参考 `curl -LsSf https://astral.sh/uv/install.sh | sh`）

### 安装依赖
```bash
cd 人格会议开发
uv sync            # 依据 pyproject.toml + uv.lock 建 .venv 并装依赖
```

### 启动
```bash
cd 人格会议开发
PYTHONPATH=backend uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```
浏览器打开 http://127.0.0.1:8000/ （验收页）。

开发模式默认不接真实邮件，登录验证码会直接显示在页面上；数据存在 `data/app.db`（已 gitignore）。

### 运行测试
```bash
cd 人格会议开发
uv run pytest      # 25 项 mock 测试
```

### 接入真实模型（真实验收前）
在项目根目录建 `.env`（已 gitignore），填：
```
MODEL_PROVIDER=deepseek
MODEL_NAME=deepseek-chat
MODEL_API_KEY=<你的 Key>
MODEL_BASE_URL=https://api.deepseek.com/v1
```
填好后重启服务，即可跑真实模型冒烟。

## 配置边界
- 本项目只用自己目录内的 `.env` 和 API Key；不从外层工具包或其他 Agent 项目隐式读取。
- `.env`、`.venv`、`data/`、`__pycache__` 均已 gitignore，不提交密钥与用户数据。
- 沿用外层 Git 仓库，本目录未初始化嵌套 Git 仓库。

## 目录约定
```text
人格会议开发/
├── README.md / AGENTS.md / .gitignore / .env.example / pyproject.toml / uv.lock / .python-version
├── backend/
│   ├── app/           # FastAPI：api/ core/ models/ schemas/ services/ static/
│   └── tests/         # pytest mock 测试
├── data/              # SQLite 数据库（gitignore）
└── docs/              # PRD、阶段文档、证据、项目状态
```
