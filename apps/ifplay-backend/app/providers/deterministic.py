"""确定性测试 Provider（仅用于自动测试与本地演示，非真实模型）。

产出完全确定：根据关键词选主玩法，生成固定澄清问题、方案卡和最小合法 GameBundle。
界面与报告必须注明它不是真实模型；真实 Provider 未验证前不得宣称 AI 生成已完成。
"""
from __future__ import annotations

import json

from .base import Provider

# 运行时权威的模块版本（与 apps/ifplay-m0 的 moduleRegistry 一致）
MODULE_VERSIONS = {
    "business": "1.0.0",
    "timing": "1.1.0",
    "drag-merge": "1.1.0",
    "story-quiz": "1.0.0",
}

_CLARIFICATION_QUESTIONS = [
    "请描述玩家在游戏里主要做什么、想达成什么目标？",
    "你希望一局游戏大概玩多久？（例如 5 分钟以内）",
]

# 内容修复确定性测试夹具（仅测试/演示用，非真实模型）
FIXTURE_FAIL_ONCE = "首轮非法修复后合法"
FIXTURE_FAIL_ALWAYS = "修复两轮仍失败"

_MODULE_ORDER = ["business", "timing", "drag-merge", "story-quiz"]


def _pick_module(idea: str) -> str:
    text = idea or ""
    if any(k in text for k in ["打铁", "点击", "时机", "切菜", "节奏", "扇巴掌", "钓鱼"]):
        return "timing"
    if any(k in text for k in ["合成", "拖拽", "做饭", "调饮", "收纳", "化妆", "拼装"]):
        return "drag-merge"
    if any(k in text for k in ["剧情", "问答", "选择", "故事", "人格", "乙女", "悬疑", "聊天"]):
        return "story-quiz"
    return "business"  # 默认经营模拟


def _plan_content(idea: str, module_id: str, *, suffix: str = "", aux: list | None = None) -> dict:
    title = (idea or "未命名游戏").strip()[:40] or "未命名游戏"
    return {
        "title": (title + suffix)[:40],
        "one_liner": idea or "",
        "player_role": "玩家",
        "goal": idea or "完成一局游戏",
        "primary_module": module_id,
        "auxiliary_modules": aux if aux is not None else [],
        "theme": idea or "通用",
        "core_loop": f"以 {module_id} 为主玩法的演示循环",
        "risk_notes": ["本方案卡由 deterministic-test 生成，非真实模型。"],
        "track": "gamebundle",
        "estimated_minutes": 5,
        "resources": ["金钱", "口碑"],
        "fail_conditions": ["资源耗尽"],
        "progression": ["升级解锁"],
        "visual_direction": "简洁竖屏、暖色调、平台组件占位素材",
        "asset_plan": {"cover": "模板封面", "icons": "内置图标"},
        "limitations": ["不生成任意代码，仅白名单玩法模块"],
        "track_reason": f"{module_id} 可由受控运行时模块覆盖，稳定且成本低",
    }


def _modify_patch(text: str) -> list:
    """确定性补丁：根据关键词返回一条合法补丁（仅测试/演示用）。"""
    if "回合" in text:
        return [{"op": "set", "path": "primaryModule.config.totalTurns", "value": 20}]
    if "时长" in text or "分钟" in text:
        return [{"op": "set", "path": "experience.estimatedMinutes", "value": 8}]
    if "难度" in text:
        return [{"op": "set", "path": "experience.difficulty", "value": 2}]
    return [{"op": "set", "path": "experience.goal", "value": "完成一局游戏（已按修改调整）"}]


def _next_module(module_id: str) -> str:
    idx = _MODULE_ORDER.index(module_id) if module_id in _MODULE_ORDER else 0
    return _MODULE_ORDER[(idx + 1) % len(_MODULE_ORDER)]


def _business_config() -> dict:
    return {
        "labels": {"money": "金钱", "reputation": "口碑", "battery": "电池", "turn": "回合"},
        "startMoney": 100,
        "startReputation": 10,
        "totalTurns": 10,
        "customersPerTurn": 1,
        "patienceDecay": 5,
        "reputationLossPerLeave": 1,
        "reputationGainPerRepair": 2,
        "reputationLossPerBadRepair": 1,
        "batteryStart": 10,
        "batteryCost": 1,
        "batteryRefill": 10,
        "initialParts": {"screen": 2},
        "parts": [{"id": "screen", "name": "屏幕", "cost": 10}],
        "customers": [
            {"id": "c1", "name": "顾客", "fault": "屏幕坏了", "requiredPartId": "screen", "reward": 20, "patience": 50}
        ],
        "upgrades": [],
        "events": [],
    }


def _timing_config() -> dict:
    return {
        "labels": {"spirit": "灵气", "breath": "憋气", "exposure": "暴露", "combo": "连击", "stage": "阶段", "rating": "评价"},
        "cycleMs": 1000,
        "windowCenter": 0.5,
        "windowWidth": 0.2,
        "jitter": 0.05,
        "tiers": {"perfect": 0.9, "good": 0.6},
        "spirit": {"start": 0, "target": 100},
        "exposure": {"start": 0, "max": 100},
        "breath": {"start": 100, "max": 100},
        "successGain": {"perfect": 20, "good": 10, "normal": 5},
        "missPenalty": 10,
        "comboMultiplier": 1.0,
        "hold": {"slowFactor": 0.5, "breathDrainPerMs": 0.01},
        "breathRecoveryPerMs": 0.02,
        "tapHint": "在时机窗口内点击",
    }


def _drag_merge_config() -> dict:
    return {
        "labels": {"score": "得分", "steps": "步骤", "combo": "连击"},
        "maxSteps": 20,
        "wrongPenalty": 1,
        "comboMultiplier": 1.0,
        "items": [{"id": "a", "name": "原料A"}, {"id": "b", "name": "原料B"}, {"id": "c", "name": "成品C"}],
        "slots": [{"id": "s1", "name": "格1"}, {"id": "s2", "name": "格2"}],
        "recipes": [
            {"id": "r1", "name": "合成成品C", "inputs": {"s1": "a", "s2": "b"}, "output": {"itemId": "c", "count": 1}, "score": 10}
        ],
    }


def _story_quiz_config() -> dict:
    return {
        "labels": {"score": "好感"},
        "attributes": [{"id": "like", "name": "好感"}],
        "startNodeId": "n1",
        "nodes": [
            {
                "id": "n1",
                "text": "故事开始，你做出第一个选择",
                "choices": [
                    {"id": "c1", "text": "选择 A", "next": "n2"},
                    {"id": "c2", "text": "选择 B（直接走向结局）", "ending": "win"},
                ],
            },
            {"id": "n2", "text": "第二个节点", "choices": [], "ending": "lose"},
        ],
    }


def _module_config(module_id: str) -> dict:
    return {
        "business": _business_config,
        "timing": _timing_config,
        "drag-merge": _drag_merge_config,
        "story-quiz": _story_quiz_config,
    }[module_id]()


def build_bundle(idea: str, module_id: str) -> dict:
    """构造一个最小但合法的 GameBundle（确定性）。"""
    name = (idea or "未命名游戏").strip()[:60] or "未命名游戏"
    return {
        "manifest": {
            "id": "det-" + "".join(c for c in name if c.isalnum() or c in "-_")[:20].lower() or "game",
            "name": name,
            "version": "1",
            "author": "deterministic-test",
            "language": "zh-CN",
            "runtimeVersion": "0.2",
        },
        "experience": {
            "playerRole": "玩家",
            "goal": idea or "完成一局游戏",
            "estimatedMinutes": 5,
            "difficulty": 1,
            "intro": ["这是由 deterministic-test 生成的演示游戏，非真实模型产物。"],
        },
        "scenes": [{"id": "play", "type": "play", "layoutId": "default"}],
        "primaryModule": {"id": module_id, "version": MODULE_VERSIONS[module_id], "config": _module_config(module_id)},
        "auxiliaryModules": [],
        "entities": [],
        "rules": [],
        "progression": {
            "tasks": [],
            "upgrades": [],
            "endings": [
                {"id": "win", "name": "成功", "desc": "达成目标"},
                {"id": "lose", "name": "失败", "desc": "未达成目标"},
            ],
        },
        "uiLayout": {"theme": {}, "playLayout": "default"},
        "assets": {"placeholder": ""},
        "saveSchema": {"version": 1, "keys": ["seed"]},
        "testPlan": {"cases": []},
    }


class DeterministicTestProvider(Provider):
    name = "deterministic-test"
    model = "deterministic-test-model"
    version = "0.0.0"
    is_real = False  # 明确非真实模型

    def _raw(self, prompt: str, *, max_output_tokens: int, timeout_seconds: float) -> dict:
        del timeout_seconds
        req = json.loads(prompt)
        kind = req["kind"]
        if kind == "clarification":
            answered = len(req.get("answers", []))
            if answered >= len(_CLARIFICATION_QUESTIONS):
                content = {"question": None, "done": True}
            else:
                content = {"question": _CLARIFICATION_QUESTIONS[answered], "done": False}
        elif kind == "plan_card":
            idea = req["idea"]
            content = _plan_content(idea, _pick_module(idea))
        elif kind == "plan_modify":
            idea = req["idea"]
            content = _plan_content(idea, req.get("primary_module", _pick_module(idea)), suffix="（已调整）")
        elif kind == "plan_recommend":
            idea = req["idea"]
            content = _plan_content(idea, _next_module(req.get("primary_module", _pick_module(idea))))
        elif kind == "gamebundle":
            idea = req["idea"]
            content = build_bundle(idea, req["primary_module"])
            # 内容修复测试夹具：首轮故意非法（缺失 manifest）
            if FIXTURE_FAIL_ONCE in idea or FIXTURE_FAIL_ALWAYS in idea:
                content.pop("manifest", None)
        elif kind == "repair":
            idea = req.get("idea", "")
            module_id = req.get("primary_module") or _pick_module(idea)
            content = build_bundle(idea, module_id)
            # 修复仍失败的测试夹具：修复后依然非法
            if FIXTURE_FAIL_ALWAYS in idea:
                content.pop("manifest", None)
        elif kind == "modify":
            content = _modify_patch(req.get("request_text", ""))
        else:
            raise ValueError(f"unknown kind {kind}")
        # 固定 token 用量（演示值，非真实计费）
        return {
            "content": json.dumps(content, ensure_ascii=False),
            "input_tokens": 100,
            "output_tokens": 500,
            "duration_ms": 1,
        }
