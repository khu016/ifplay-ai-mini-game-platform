"""确定性高风险检查（不依赖模型）。命中即中止人格讨论、转入安全引导。"""

from dataclasses import dataclass


@dataclass
class RiskResult:
    is_high_risk: bool
    category: str | None = None
    guidance: str | None = None


# 危机类：命中即中止，给出支持性引导（联系方式待按上线地区核验）
SELF_HARM_KEYWORDS = [
    "自杀", "自残", "自伤", "不想活", "结束生命", "结束自己", "割腕", "跳楼",
    "轻生", "活不下去", "了结自己", "想死", "不想活了", "伤害自己",
]

# 专业边界类：不生成角色化结论，建议寻求专业人士
MEDICAL_KEYWORDS = [
    "确诊", "诊断", "用药", "处方", "剂量", "手术", "癌症", "肿瘤",
    "抑郁症", "焦虑症", "精神科", "急救",
]
LEGAL_KEYWORDS = [
    "起诉", "被告", "判刑", "量刑", "违法认定", "离婚财产分割", "打官司",
]
FINANCE_KEYWORDS = [
    "高利贷", "赌博", "博彩", "杠杆", "全部身家", "网贷", "借钱炒股",
    "借钱投资", "套路贷",
]
ILLEGAL_KEYWORDS = ["毒品", "贩毒", "枪支", "诈骗", "洗钱", "色情交易", "盗窃"]


def check_risk(text: str) -> RiskResult:
    t = text or ""
    if any(k in t for k in SELF_HARM_KEYWORDS):
        return RiskResult(
            is_high_risk=True,
            category="self_harm",
            guidance=(
                "你提到的内容让我很在意。如果你正处在痛苦或危险中，请优先联系身边信任的人，"
                "或拨打当地紧急支持热线（具体号码待按上线地区核验后展示）。我无法在这里替代专业帮助。"
            ),
        )
    if any(k in t for k in MEDICAL_KEYWORDS):
        return RiskResult(
            is_high_risk=True,
            category="medical",
            guidance="这涉及医疗/健康判断，我不做角色化结论。建议咨询合格的专业医生。",
        )
    if any(k in t for k in LEGAL_KEYWORDS):
        return RiskResult(
            is_high_risk=True,
            category="legal",
            guidance="这涉及法律定性或具体法律行动，建议咨询合格的律师。",
        )
    if any(k in t for k in FINANCE_KEYWORDS):
        return RiskResult(
            is_high_risk=True,
            category="high_risk_finance",
            guidance="这涉及高风险资金操作，我不做角色化建议。请谨慎，并考虑咨询专业人士。",
        )
    if any(k in t for k in ILLEGAL_KEYWORDS):
        return RiskResult(
            is_high_risk=True,
            category="illegal",
            guidance="这个话题我无法继续讨论。",
        )
    return RiskResult(is_high_risk=False)
