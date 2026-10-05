"""费用计量与预算闸门。

规则：
- 调用前最坏成本预检（输入估算 + max_output_tokens + 图片）
- 响应缺少 usage → 失败（不能按 0 元）
- 文本/推理/图片/修复费用全部计入单任务预算
- 预留安全余量，避免单次调用结束后才发现超额
"""
from __future__ import annotations

from .config import Settings
from .providers.base import ProviderError


class CostTracker:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.effective_budget = settings.budget_per_task * (1 - settings.safety_margin)

    def estimate_worst(self, input_tokens: int, images: int = 0) -> float:
        input_cost = (input_tokens / 1000) * self.settings.input_price_per_1k
        output_cost = (self.settings.max_output_tokens / 1000) * self.settings.output_price_per_1k
        image_cost = images * self.settings.image_price
        return input_cost + output_cost + image_cost

    def precheck(self, spent: float, input_tokens: int, images: int = 0) -> None:
        if images > self.settings.max_images:
            raise ProviderError("image_limit", f"图片数量超上限：{images} > {self.settings.max_images}")
        worst = self.estimate_worst(input_tokens, images)
        if spent + worst > self.effective_budget:
            raise ProviderError(
                "cost_limit",
                f"费用预检中止：本次最坏 {worst:.4f} 元，累计将达 {spent + worst:.4f} 元 > 有效预算 {self.effective_budget:.4f} 元",
            )

    def account(
        self,
        spent: float,
        input_tokens: int | None,
        output_tokens: int | None,
        images: int = 0,
    ) -> float:
        if input_tokens is None or output_tokens is None:
            raise ProviderError("missing_usage", "模型响应缺少 usage，按失败处理（不能按 0 元）")
        if images > self.settings.max_images:
            raise ProviderError("image_limit", f"图片数量超上限：{images} > {self.settings.max_images}")
        cost = (
            (input_tokens / 1000) * self.settings.input_price_per_1k
            + (output_tokens / 1000) * self.settings.output_price_per_1k
            + images * self.settings.image_price
        )
        new_spent = spent + cost
        if new_spent >= self.effective_budget:
            raise ProviderError(
                "cost_limit",
                f"累计 {new_spent:.4f} 元 ≥ 有效预算 {self.effective_budget:.4f} 元",
            )
        return cost
