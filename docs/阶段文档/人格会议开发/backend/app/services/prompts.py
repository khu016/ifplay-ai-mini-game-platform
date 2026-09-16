"""Prompt 加载与渲染。Prompt 正文独立存放在 prompts/*.md，可版本追踪。"""

from pathlib import Path

from ..personas import PERSONAS

_HERE = Path(__file__).parent / "prompts"


def _load(name: str) -> str:
    return (_HERE / name).read_text(encoding="utf-8")


def _personas_text() -> str:
    lines = []
    for p in PERSONAS:
        lines.append(
            f"- {p['type_code']} {p['name']}：关注{p['focus']}；擅长问「{p['good_questions']}」；"
            f"容易忽略{p['blind_spot']}；风格{p['style']}"
        )
    return "\n".join(lines)


def _fact_text(fv) -> str:
    parts = [f"问题：{fv.question}"]
    if fv.known_choices:
        parts.append(f"已有选择：{fv.known_choices}")
    if fv.concerns:
        parts.append(f"最担心：{fv.concerns}")
    if fv.extra_conditions:
        parts.append(f"补充条件：{fv.extra_conditions}")
    return "；".join(parts)


def _history_text(messages, limit: int = 20) -> str:
    recent = messages[-limit:]
    return "\n".join(
        f"[{m.speaker}]{m.viewpoint}" for m in recent if m.speaker != "user"
    ) or "（暂无）"


def recommend(question: str) -> tuple[str, str]:
    return _load("system_recommend.md"), (
        f"用户问题：{question}\n\n候选角色：\n{_personas_text()}"
    )


def host_opening(fv) -> tuple[str, str]:
    return _load("system_host.md"), _fact_text(fv)


def role_speech(role: dict, fv, history: list) -> tuple[str, str]:
    return _load("system_role_speech.md"), (
        f"你的角色：{role['type_code']} {role['name']}（关注{role['focus']}；"
        f"擅长问「{role['good_questions']}」；容易忽略{role['blind_spot']}；风格{role['style']}）\n\n"
        f"当前事实：{_fact_text(fv)}\n\n近几轮讨论：\n{_history_text(history)}"
    )


def summarize(fv, history: list) -> tuple[str, str]:
    return _load("system_summarize.md"), (
        f"当前问题与最新条件：{_fact_text(fv)}\n\n讨论记录：\n{_history_text(history)}"
    )
