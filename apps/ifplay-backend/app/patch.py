"""GameBundle 结构化补丁：允许路径白名单 + 数值/字符串约束 + 应用。

自然语言修改时 Provider 只能返回结构化补丁（不允许返回代码/任意 bundle），
补丁必须先通过允许路径检查，再应用到副本；应用后仍执行完整契约/引用/白名单/安全校验。
"""
from __future__ import annotations

import copy
from dataclasses import dataclass

from .errors import PatchError

# 与契约/安全扫描一致的疑似代码/脚本片段
DANGEROUS_FRAGMENTS = ("eval(", "new function", "<script", "javascript:", "require(", "import(", "function(", "<iframe", "onerror")


@dataclass(frozen=True)
class PathSpec:
    kind: str  # "str" | "int" | "number"
    min_len: int = 1
    max_len: int | None = None
    min_val: float | None = None
    max_val: float | None = None


# 允许修改的路径白名单（点号分隔）。仅限安全的展示/数值字段，不允许改结构、模块 ID、结局图等。
ALLOWED_PATHS: dict[str, PathSpec] = {
    "manifest.name": PathSpec("str", 1, 60),
    "experience.goal": PathSpec("str", 1, 200),
    "experience.playerRole": PathSpec("str", 1, 100),
    "experience.estimatedMinutes": PathSpec("int", None, None, 1, 60),
    "experience.difficulty": PathSpec("int", None, None, 1, 5),
    # 经营模拟
    "primaryModule.config.totalTurns": PathSpec("int", None, None, 1, 100),
    "primaryModule.config.customersPerTurn": PathSpec("int", None, None, 1, 10),
    "primaryModule.config.patienceDecay": PathSpec("int", None, None, 0, 50),
    "primaryModule.config.batteryRefill": PathSpec("int", None, None, 1, None),
    "primaryModule.config.startMoney": PathSpec("number", None, None, 0, None),
    "primaryModule.config.startReputation": PathSpec("number", None, None, 0, None),
    "primaryModule.config.reputationLossPerLeave": PathSpec("number", None, None, 0, None),
    "primaryModule.config.reputationGainPerRepair": PathSpec("number", None, None, 0, None),
    "primaryModule.config.reputationLossPerBadRepair": PathSpec("number", None, None, 0, None),
    "primaryModule.config.batteryStart": PathSpec("number", None, None, 0, None),
    "primaryModule.config.batteryCost": PathSpec("number", None, None, 0, None),
    # 点击时机
    "primaryModule.config.cycleMs": PathSpec("number", None, None, 1, None),
    "primaryModule.config.windowCenter": PathSpec("number", None, None, 0, 1),
    "primaryModule.config.windowWidth": PathSpec("number", None, None, 0.01, 0.9),
    "primaryModule.config.missPenalty": PathSpec("number", None, None, 0, None),
    "primaryModule.config.comboMultiplier": PathSpec("number", None, None, 0, None),
    "primaryModule.config.breathRecoveryPerMs": PathSpec("number", None, None, 0, None),
    # 拖拽合成
    "primaryModule.config.maxSteps": PathSpec("int", None, None, 1, None),
    "primaryModule.config.wrongPenalty": PathSpec("number", None, None, 0, None),
}


def _check_string_value(path: str, value: object, spec: PathSpec) -> None:
    if not isinstance(value, str):
        raise PatchError("patch_invalid_value", f"路径 {path} 需要字符串，实际为 {type(value).__name__}")
    if len(value) < spec.min_len:
        raise PatchError("patch_invalid_value", f"路径 {path} 字符串长度需 ≥ {spec.min_len}")
    if spec.max_len is not None and len(value) > spec.max_len:
        raise PatchError("patch_invalid_value", f"路径 {path} 字符串长度需 ≤ {spec.max_len}")
    low = value.lower()
    for frag in DANGEROUS_FRAGMENTS:
        if frag in low:
            raise PatchError("patch_code_injection", f"路径 {path} 的值疑似包含代码/脚本片段，已拒绝")


def _check_numeric_value(path: str, value: object, spec: PathSpec) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PatchError("patch_invalid_value", f"路径 {path} 需要数值，实际为 {type(value).__name__}")
    if spec.kind == "int" and not isinstance(value, int):
        raise PatchError("patch_invalid_value", f"路径 {path} 需要整数，实际为 {type(value).__name__}")
    if spec.min_val is not None and value < spec.min_val:
        raise PatchError("patch_invalid_value", f"路径 {path} 值 {value} 需 ≥ {spec.min_val}")
    if spec.max_val is not None and value > spec.max_val:
        raise PatchError("patch_invalid_value", f"路径 {path} 值 {value} 需 ≤ {spec.max_val}")


def _set_at_path(bundle: dict, path: str, value: object) -> None:
    """按点号路径设置值；路径必须存在（父链均为 dict 且最终键存在）。"""
    parts = path.split(".")
    node: object = bundle
    for part in parts[:-1]:
        if not isinstance(node, dict) or part not in node:
            raise PatchError("patch_path_not_found", f"路径 {path} 不存在")
        node = node[part]
    final = parts[-1]
    if not isinstance(node, dict) or final not in node:
        raise PatchError("patch_path_not_found", f"路径 {path} 不存在")
    node[final] = value


def apply_patch(bundle: dict, patch: list) -> dict:
    """对副本应用结构化补丁。返回新的 bundle（浅不可变，深拷贝）。非法即抛 PatchError。"""
    if not isinstance(patch, list):
        raise PatchError("patch_malformed", "补丁必须是操作数组")
    new_bundle = copy.deepcopy(bundle)
    for op in patch:
        if not isinstance(op, dict):
            raise PatchError("patch_malformed", "补丁操作必须是对象")
        if op.get("op") != "set":
            raise PatchError("patch_unsupported_op", f"不支持的补丁操作：{op.get('op')!r}（本阶段仅支持 set）")
        path = op.get("path")
        if not isinstance(path, str):
            raise PatchError("patch_malformed", "补丁操作缺少字符串 path")
        if path not in ALLOWED_PATHS:
            raise PatchError("patch_invalid_path", f"路径 {path} 不在允许修改白名单内")
        if "value" not in op:
            raise PatchError("patch_malformed", f"补丁操作 {path} 缺少 value")
        spec = ALLOWED_PATHS[path]
        value = op["value"]
        if spec.kind == "str":
            _check_string_value(path, value, spec)
        else:
            _check_numeric_value(path, value, spec)
        _set_at_path(new_bundle, path, value)
    return new_bundle
