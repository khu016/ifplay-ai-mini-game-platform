from datetime import datetime
from decimal import Decimal

from .config import Settings
from .errors import AppError
from .schemas import BudgetView, Charge
from .store import Store


class Budget:
    def __init__(self, store: Store, settings: Settings):
        self.store, self.settings = store, settings

    def month(self):
        return datetime.now().strftime("%Y-%m")

    def cost(self, input_tokens, output_tokens):
        return (Decimal(input_tokens) * self.settings.input_price +
                Decimal(output_tokens) * self.settings.output_price) / Decimal(1_000_000)

    def reserve(self, task_id, stage, input_bound, max_output):
        self.settings.check_call()
        amount = self.cost(input_bound, max_output)
        month = self.month()
        with self.store.ledger() as ledger:
            if any(charge.status == "uncertain" for charge in ledger.charges):
                raise AppError("PRICING_UNCONFIRMED", "存在超出预估用量的调用，请先核查账本。", 503)
            task_total = sum((c.charged_cny for c in ledger.charges if c.task_id == task_id),
                             Decimal(0))
            monthly_total = sum((c.charged_cny for c in ledger.charges if c.month == month),
                                Decimal(0))
            if (task_total + amount > self.settings.task_limit or
                    monthly_total + amount > self.settings.monthly_limit):
                raise AppError("BUDGET_EXCEEDED", "本次调用将超过任务或月度预算，已阻止。", 409)
            charge = Charge(task_id=task_id, month=month, stage=stage,
                            model=self.settings.model, reserved_cny=amount, charged_cny=amount)
            ledger.charges.append(charge)
        return charge.id

    def settle(self, charge_id, usage, elapsed, first_chunk):
        with self.store.ledger() as ledger:
            charge = next(c for c in ledger.charges if c.id == charge_id)
            charge.elapsed_seconds = elapsed
            charge.first_chunk_seconds = first_chunk
            if usage is None:
                return
            input_tokens, output_tokens = usage
            amount = self.cost(input_tokens, output_tokens)
            charge.input_tokens, charge.output_tokens = input_tokens, output_tokens
            if amount > charge.reserved_cny:
                charge.charged_cny = amount
                charge.status = "uncertain"
                return
            charge.charged_cny = amount
            charge.status = "settled"

    def view(self):
        month = self.month()
        with self.store.ledger() as ledger:
            total = sum((c.charged_cny for c in ledger.charges if c.month == month), Decimal(0))
        return BudgetView(month=month, spent_or_reserved_cny=total,
                          remaining_cny=max(Decimal(0), self.settings.monthly_limit - total),
                          monthly_limit_cny=self.settings.monthly_limit,
                          task_limit_cny=self.settings.task_limit,
                          pricing_confirmed=self.settings.pricing_confirmed)
