"""GameBundle 契约校验：合法/非法样例、白名单、任意代码拦截、引用完整性。"""
import copy
import os

import pytest

from app.contract import ContractValidator
from app.providers.deterministic import build_bundle


@pytest.fixture()
def validator():
    path = os.path.abspath(
        os.path.join(os.path.dirname(__file__), "..", "..", "ifplay-m0", "contract", "gamebundle-contract.json")
    )
    return ContractValidator(path)


def _validate_pass(validator, bundle):
    results = validator.validate(bundle)
    return all(v["passed"] for v in results)


def test_valid_bundle_passes(validator):
    for module in ["business", "timing", "drag-merge", "story-quiz"]:
        bundle = build_bundle("测试游戏", module)
        assert _validate_pass(validator, bundle), f"{module} 校验应通过"


def test_missing_required_field_fails(validator):
    bundle = build_bundle("测试", "business")
    del bundle["manifest"]
    results = validator.validate(bundle)
    contract = next(v for v in results if v["check_type"] == "contract")
    assert contract["passed"] is False


def test_unknown_module_fails_whitelist(validator):
    bundle = build_bundle("测试", "business")
    bundle["primaryModule"]["id"] = "platformer"  # 不在白名单
    results = validator.validate(bundle)
    wl = next(v for v in results if v["check_type"] == "whitelist")
    assert wl["passed"] is False


def test_module_version_mismatch_fails(validator):
    bundle = build_bundle("测试", "business")
    bundle["primaryModule"]["version"] = "9.9.9"
    results = validator.validate(bundle)
    wl = next(v for v in results if v["check_type"] == "whitelist")
    assert wl["passed"] is False


def test_eval_string_blocked(validator):
    bundle = build_bundle("测试", "business")
    bundle["experience"]["goal"] = "eval('alert(1)')"
    results = validator.validate(bundle)
    sec = next(v for v in results if v["check_type"] == "security")
    assert sec["passed"] is False


def test_script_tag_blocked(validator):
    bundle = build_bundle("测试", "business")
    bundle["manifest"]["name"] = "<script>alert(1)</script>"
    results = validator.validate(bundle)
    sec = next(v for v in results if v["check_type"] == "security")
    assert sec["passed"] is False


def test_reference_integrity_business(validator):
    bundle = build_bundle("测试", "business")
    # 顾客引用了不存在的零件
    bundle["primaryModule"]["config"]["customers"][0]["requiredPartId"] = "nonexistent"
    results = validator.validate(bundle)
    ref = next(v for v in results if v["check_type"] == "references")
    assert ref["passed"] is False


def test_reference_integrity_story(validator):
    bundle = build_bundle("测试", "story-quiz")
    # startNodeId 指向不存在的节点
    bundle["primaryModule"]["config"]["startNodeId"] = "ghost"
    results = validator.validate(bundle)
    ref = next(v for v in results if v["check_type"] == "references")
    assert ref["passed"] is False


def test_runtime_version_whitelist(validator):
    bundle = build_bundle("测试", "business")
    bundle["manifest"]["runtimeVersion"] = "9.9"
    results = validator.validate(bundle)
    contract = next(v for v in results if v["check_type"] == "contract")
    assert contract["passed"] is False
