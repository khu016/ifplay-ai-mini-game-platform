"""宽容的结构化输出解析：兼容 JSON、markdown 围栏、多种常见格式，再走 Pydantic 校验。"""

import json
import re

from .schemas import RoleSpeech, SummaryModel


def _strip_fences(text: str) -> str:
    t = text.strip()
    # 去掉 ```json ... ``` 或 ``` ... ```
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.DOTALL)
    if m:
        return m.group(1).strip()
    return t


def _find_json_object(text: str) -> str | None:
    # 找第一个平衡的 {...} 块
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_json(text: str) -> dict | None:
    """尽力把模型输出解析成 dict；失败返回 None。"""
    if not text:
        return None
    candidates = [_strip_fences(text), _find_json_object(text), text]
    for c in candidates:
        if not c:
            continue
        try:
            obj = json.loads(c)
            if isinstance(obj, dict):
                return obj
        except (json.JSONDecodeError, ValueError):
            continue
    return None


def parse_role_speech(text: str, fallback_role: str) -> RoleSpeech:
    obj = parse_json(text)
    if obj is None:
        return RoleSpeech(role_type=fallback_role, viewpoint=text.strip() or "（无内容）")
    # 兼容常见字段别名
    viewpoint = (
        obj.get("viewpoint")
        or obj.get("观点")
        or obj.get("content")
        or obj.get("text")
        or text.strip()
    )
    return RoleSpeech(
        role_type=obj.get("role_type") or obj.get("role") or fallback_role,
        claim_id=str(obj.get("claim_id") or obj.get("id") or ""),
        viewpoint=str(viewpoint),
        fact_refs=obj.get("fact_refs") or obj.get("依据") or [],
        assumptions=str(obj.get("assumptions") or obj.get("假设") or ""),
        responds_to=str(obj.get("responds_to") or obj.get("回应") or ""),
        change_condition=str(
            obj.get("change_condition") or obj.get("改变条件") or ""
        ),
    )


def parse_summary(text: str) -> SummaryModel | None:
    obj = parse_json(text)
    if obj is None:
        return None
    try:
        return SummaryModel(
            problem_and_conditions=str(
                obj.get("problem_and_conditions") or obj.get("问题与条件") or ""
            ),
            consensus=str(obj.get("consensus") or obj.get("共识") or ""),
            disagreements=str(obj.get("disagreements") or obj.get("分歧") or ""),
            unknowns=str(obj.get("unknowns") or obj.get("未知") or ""),
            next_step=str(obj.get("next_step") or obj.get("下一步") or ""),
            change_conditions=str(
                obj.get("change_conditions") or obj.get("改变结论的条件") or ""
            ),
        )
    except Exception:
        return None
