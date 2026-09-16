from app.parser import parse_json, parse_role_speech, parse_summary


def test_parse_plain_json():
    obj = parse_json('{"role_type": "INTJ", "viewpoint": "x"}')
    assert obj == {"role_type": "INTJ", "viewpoint": "x"}


def test_parse_markdown_fence():
    obj = parse_json('```json\n{"a": 1}\n```')
    assert obj == {"a": 1}


def test_parse_with_extra_text():
    obj = parse_json('这是结果：\n{"a": 1}\n谢谢')
    assert obj == {"a": 1}


def test_parse_role_speech_chinese_keys():
    s = parse_role_speech(
        '{"role_type":"ENFP","观点":"试试看","依据":["a"],"假设":"前提","回应":"","改变条件":"新事实"}',
        "ENFP",
    )
    assert s.role_type == "ENFP"
    assert s.viewpoint == "试试看"
    assert s.fact_refs == ["a"]


def test_parse_role_speech_fallback():
    s = parse_role_speech("完全不是 JSON 的自由文本", "INTJ")
    assert s.role_type == "INTJ"
    assert "自由文本" in s.viewpoint


def test_parse_summary():
    raw = (
        '```json\n{"problem_and_conditions":"p","consensus":"c",'
        '"disagreements":"d","unknowns":"u","next_step":"n",'
        '"change_conditions":"cc"}\n```'
    )
    s = parse_summary(raw)
    assert s is not None
    assert s.consensus == "c"
