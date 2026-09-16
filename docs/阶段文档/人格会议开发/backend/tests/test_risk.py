from app.risk import check_risk


def test_self_harm():
    r = check_risk("我觉得活不下去了，想结束自己")
    assert r.is_high_risk
    assert r.category == "self_harm"


def test_medical():
    r = check_risk("我该吃多少剂量的抗抑郁药")
    assert r.is_high_risk
    assert r.category == "medical"


def test_legal():
    r = check_risk("我要起诉公司，怎么判")
    assert r.is_high_risk
    assert r.category == "legal"


def test_finance():
    r = check_risk("想借钱炒股，全部身家买入")
    assert r.is_high_risk
    assert r.category == "high_risk_finance"


def test_normal():
    r = check_risk("我该留在现在的岗位还是跳槽？")
    assert not r.is_high_risk
