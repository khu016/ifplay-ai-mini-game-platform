# IfPlay 项目专属约束

> 本文件在外层 `AGENTS.md`（核心规则卡）之上，补充本项目专属约定。冲突时以外层核心规则卡为准。

## 产品边界（来自 PRD v1.1）
- 形态：响应式网页，手机竖屏优先、兼容桌面浏览器；不做原生 App。
- 用户：不会编程的大众创作者、内容创作者、普通玩家、平台管理员；成年声明用于封闭测试筛选（18 岁以上）。
- 核心闭环：输入中文想法 → AI 澄清追问 → 结构化方案卡 → 用户确认门 → 后台分阶段生成 GameSpec → 引擎组装 → 自动试玩 → 视觉生成 → 私有试玩 → 自然语言修改/版本回退 → 主动发布 → 审核 → 游戏厅。
- 底层：固定模拟器引擎执行规则，**不执行 AI 生成的任意代码**（schema 不允许脚本字段，渲染器不用 eval）。
- 首版非目标：动作/射击/平台/实时战斗/复杂物理、上传参考图/文件、付费订阅广告、实时协作多人、开放插件市场。

## 强制底线补充（本项目特有）
- 引擎确定性优先：规则由固定引擎执行，模型不直接运行任意代码。
- 失败不覆盖成功：任何生成/修改失败不破坏当前可玩版本。
- 确认后再生成：只有用户点击"确认并生成"才创建付费生成任务。
- 默认私有：发布必须用户主动触发；发布前审核；审核服务异常时默认不公开。
- 内容安全：禁止色情/违法/仇恨/极端暴力/危险行为指导及明显侵权冒用；用户输入、生成文本、封面、关键图片、评论分别审核。
- 日志不得记录验证码、密码、完整手机号或 API Key；密码用慢哈希，验证码短时有效且一次性。
- 不制造虚假热度：禁止伪造用户、评论、播放量或在线人数。
- 派生（做同款）保留 source_game_id / source_version_id / 原作者，且重新审核，不继承源作品审核结果。

## 预算红线（来自 PRD 第 18–19 节）
- 封测月预算 100 元：文本 20 / 生图 25 / 审核 5 / 短信 5 / 存储部署 20 / 预留 25。
- 单任务预算：新建软上限 2 元、硬上限 3 元；修改软上限 0.8 元。
- 80 元预警、100 元停止新增生成；已有游戏游玩不随生成预算关停。
- 每次外部调用记录供应商、模型、用量、估算费用、任务与阶段；相同版本+相同 prompt 哈希命中缓存不重复调用。

## 状态约定
- 项目状态机：`guest_draft → private_project → generating → playable_private → review_pending → published`，辅助状态 `needs_revision / review_rejected / unpublished / taken_down / archived`。
- 版本状态机：`building → validating → playable → selected_for_publish → published`，失败版本 `failed` 不能替代当前 playable 版本。
- 生成任务阶段：`draft → clarifying → awaiting_confirmation → queued → generating_rules → validating_schema → generating_content → assembling → auto_testing → generating_visuals → final_check → completed`，异常 `needs_revision / failed / cancelled / budget_blocked`。
- 权限判断在后端，不能信任前端角色字段；管理员高影响操作二次确认并审计。

## 当前授权范围
- 阶段 1 技术适配已完成；《第一阶段技术开发文档》已出（M0 规则引擎验证）。待产品经理确认三件事后开发。
- M0 只做：固定 GameSpec v0.1、规则引擎、校验器、自动路径模拟、结局可达性、3 个手写示例、最简试玩页；不接模型、零费用。
- 确认前不写代码、不装依赖、不建数据库。

## M0 核心安全边界（强制）
- AI 只能生成结构化 GameSpec JSON；不允许 AI 生成的 JavaScript/HTML/SQL/脚本进入运行环境。
- 禁止 `eval`、`Function`、`new Function` 及任何动态执行用户内容。
- 游戏规则由固定引擎确定性执行；随机过程必须支持传入 seed（同 seed 同路径）。
- 模型不能以一句“测试通过”替代真实测试结果；完成判定只依据工具输出。
