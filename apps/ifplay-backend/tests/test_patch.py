"""GameBundle 结构化补丁：允许路径检查 + 数值/字符串约束 + 应用（单元测试）。"""
import pytest

from app.errors import PatchError
from app.patch import apply_patch
from app.providers.deterministic import build_bundle


def _business():
    return build_bundle("测试游戏", "business")


def test_legal_numeric_change():
    bundle = _business()
    out = apply_patch(bundle, [{"op": "set", "path": "primaryModule.config.totalTurns", "value": 20}])
    assert out["primaryModule"]["config"]["totalTurns"] == 20
    assert bundle["primaryModule"]["config"]["totalTurns"] == 10  # 原 bundle 未被修改


def test_legal_estimated_minutes():
    bundle = _business()
    out = apply_patch(bundle, [{"op": "set", "path": "experience.estimatedMinutes", "value": 8}])
    assert out["experience"]["estimatedMinutes"] == 8


def test_illegal_field_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, [{"op": "set", "path": "manifest.author", "value": "恶意作者"}])
    assert e.value.code == "patch_invalid_path"


def test_module_id_field_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, [{"op": "set", "path": "primaryModule.id", "value": "timing"}])
    assert e.value.code == "patch_invalid_path"


def test_code_injection_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, [{"op": "set", "path": "experience.goal", "value": "eval('alert(1)')"}])
    assert e.value.code == "patch_code_injection"


def test_nonexistent_path_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, [{"op": "set", "path": "primaryModule.config.nonexistentField", "value": 1}])
    assert e.value.code == "patch_invalid_path"


def test_typo_path_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, [{"op": "set", "path": "experience.estimatedMinutess", "value": 8}])
    assert e.value.code == "patch_invalid_path"


def test_value_out_of_range_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, [{"op": "set", "path": "primaryModule.config.totalTurns", "value": 9999}])
    assert e.value.code == "patch_invalid_value"


def test_malformed_patch_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, {"not": "a list"})
    assert e.value.code == "patch_malformed"


def test_unsupported_op_rejected():
    bundle = _business()
    with pytest.raises(PatchError) as e:
        apply_patch(bundle, [{"op": "delete", "path": "experience.goal"}])
    assert e.value.code == "patch_unsupported_op"
