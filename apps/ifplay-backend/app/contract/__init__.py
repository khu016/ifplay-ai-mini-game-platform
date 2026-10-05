"""GameBundle 契约校验：结构、模块 config、白名单、引用完整性、安全字段。

契约 JSON 由 apps/ifplay-m0 运行时权威 Zod schema 生成（见其 scripts/export-contract.ts），
后端不手写契约，只消费共享契约并做额外检查。
"""
from __future__ import annotations

import json
from pathlib import Path

import jsonschema


class ContractValidator:
    def __init__(self, contract_path: str) -> None:
        self.path = Path(contract_path)
        self.contract = json.loads(self.path.read_text(encoding="utf-8"))
        self.bundle_schema = self.contract["bundleSchema"]
        self.modules = self.contract["modules"]
        self.module_ids = self.contract["moduleIds"]
        self.contract_version = self.contract["contractVersion"]

    # ---- 各检查项 ----

    def _check_contract(self, bundle: dict) -> dict:
        errors = [e.message for e in jsonschema.Draft202012Validator(self.bundle_schema).iter_errors(bundle)]
        return {"check_type": "contract", "passed": not errors, "details": {"errors": errors}}

    def _check_module_config(self, bundle: dict) -> dict:
        primary = bundle.get("primaryModule") or {}
        module_id = primary.get("id")
        config = primary.get("config")
        if module_id not in self.modules:
            return {"check_type": "module_config", "passed": False, "details": {"errors": [f"未知主玩法模块 {module_id}"]}}
        schema = self.modules[module_id]["configSchema"]
        errors = [e.message for e in jsonschema.Draft202012Validator(schema).iter_errors(config)]
        return {"check_type": "module_config", "passed": not errors, "details": {"errors": errors, "module": module_id}}

    def _check_whitelist(self, bundle: dict) -> dict:
        errors: list[str] = []
        primary = bundle.get("primaryModule") or {}
        module_id = primary.get("id")
        if module_id not in self.module_ids:
            errors.append(f"主玩法 {module_id} 不在白名单 {self.module_ids}")
        else:
            expected_version = self.modules[module_id]["version"]
            if primary.get("version") != expected_version:
                errors.append(f"主玩法 {module_id} 版本 {primary.get('version')} 与注册表 {expected_version} 不一致")
        for aux in bundle.get("auxiliaryModules") or []:
            if aux.get("id") not in self.module_ids:
                errors.append(f"辅助模块 {aux.get('id')} 不在白名单")
        return {"check_type": "whitelist", "passed": not errors, "details": {"errors": errors}}

    def _check_references(self, bundle: dict) -> dict:
        errors: list[str] = []
        primary = bundle.get("primaryModule") or {}
        module_id = primary.get("id")
        config = primary.get("config") or {}
        endings = [e.get("id") for e in (bundle.get("progression") or {}).get("endings") or []]

        if module_id == "business":
            part_ids = {p.get("id") for p in config.get("parts") or []}
            for c in config.get("customers") or []:
                if c.get("requiredPartId") not in part_ids:
                    errors.append(f"business 顾客 {c.get('id')} 引用了不存在的零件 {c.get('requiredPartId')}")
        elif module_id == "drag-merge":
            item_ids = {i.get("id") for i in config.get("items") or []}
            for r in config.get("recipes") or []:
                for inp_id in (r.get("inputs") or {}).values():
                    if inp_id not in item_ids:
                        errors.append(f"drag-merge 配方 {r.get('id')} 引用了不存在的原料 {inp_id}")
                out_item = (r.get("output") or {}).get("itemId")
                if out_item and out_item not in item_ids:
                    errors.append(f"drag-merge 配方 {r.get('id')} 引用了不存在的产物 {out_item}")
            for o in config.get("orders") or []:
                if o.get("targetItemId") not in item_ids:
                    errors.append(f"drag-merge 订单 {o.get('id')} 引用了不存在的物品 {o.get('targetItemId')}")
        elif module_id == "story-quiz":
            node_ids = {n.get("id") for n in config.get("nodes") or []}
            if config.get("startNodeId") not in node_ids:
                errors.append(f"story-quiz startNodeId {config.get('startNodeId')} 不存在")
            for n in config.get("nodes") or []:
                if n.get("ending") and n.get("ending") not in endings:
                    errors.append(f"story-quiz 节点 {n.get('id')} 引用了不存在的结局 {n.get('ending')}")
                for ch in n.get("choices") or []:
                    if ch.get("next") and ch.get("next") not in node_ids:
                        errors.append(f"story-quiz 选项 {ch.get('id')} 引用了不存在的节点 {ch.get('next')}")
                    if ch.get("ending") and ch.get("ending") not in endings:
                        errors.append(f"story-quiz 选项 {ch.get('id')} 引用了不存在的结局 {ch.get('ending')}")
        return {"check_type": "references", "passed": not errors, "details": {"errors": errors}}

    def _check_security(self, bundle: dict) -> dict:
        dangerous = ("eval(", "new function", "<script", "javascript:", "require(", "import(", "function(")
        hits: list[str] = []

        def scan(node, path=""):
            if isinstance(node, dict):
                for k, v in node.items():
                    scan(v, f"{path}.{k}")
            elif isinstance(node, list):
                for i, v in enumerate(node):
                    scan(v, f"{path}[{i}]")
            elif isinstance(node, str):
                low = node.lower()
                for d in dangerous:
                    if d in low:
                        hits.append(f"{path} 含疑似代码/脚本片段：{d}")

        scan(bundle)
        return {"check_type": "security", "passed": not hits, "details": {"hits": hits}}

    # ---- 总入口 ----

    def validate(self, bundle: dict) -> list[dict]:
        return [
            self._check_contract(bundle),
            self._check_module_config(bundle),
            self._check_whitelist(bundle),
            self._check_references(bundle),
            self._check_security(bundle),
        ]
