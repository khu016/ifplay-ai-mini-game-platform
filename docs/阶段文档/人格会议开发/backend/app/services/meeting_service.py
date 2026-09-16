"""会议编排：创建、开始、讨论单元、纪要、保存/删除/反馈。宿主代码管状态与预算。"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..adapter import get_adapter
from ..config import get_settings
from ..errors import AppError
from ..models import (
    FactVersion,
    Feedback,
    Meeting,
    MeetingStatus,
    Message,
    Participant,
    Summary,
    STATUS_LABELS,
)
from ..parser import parse_json, parse_role_speech, parse_summary
from ..personas import DEFAULT_RECOMMENDATION, PERSONA_BY_CODE
from ..risk import check_risk
from ..state import assert_transition
from . import prompts


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _get_owned_meeting(db: Session, user_id: int, meeting_id: int) -> Meeting:
    meeting = db.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != user_id or meeting.deleted_at is not None:
        raise AppError(404, "not_found", "会议不存在")
    return meeting


def _get_participants(db: Session, meeting_id: int) -> list[dict]:
    rows = (
        db.query(Participant)
        .filter(Participant.meeting_id == meeting_id)
        .order_by(Participant.sort)
        .all()
    )
    return [
        {"type_code": r.role_type, **PERSONA_BY_CODE[r.role_type]} for r in rows
    ]


def _msg_to_dict(m: Message) -> dict:
    return {
        "id": m.id,
        "speaker": m.speaker,
        "role_type": m.role_type,
        "claim_id": m.claim_id,
        "viewpoint": m.viewpoint,
        "fact_refs": m.fact_refs or [],
        "assumptions": m.assumptions or "",
        "responds_to": m.responds_to or "",
        "change_condition": m.change_condition or "",
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


def _summary_to_dict(s: Summary) -> dict:
    return {
        "problem_and_conditions": s.problem_and_conditions,
        "consensus": s.consensus,
        "disagreements": s.disagreements,
        "unknowns": s.unknowns,
        "next_step": s.next_step,
        "change_conditions": s.change_conditions,
    }


def _meeting_item(m: Meeting) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "status": m.status,
        "status_label": STATUS_LABELS.get(m.status, m.status),
        "units_used": m.units_used,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "finished_at": m.finished_at.isoformat() if m.finished_at else None,
    }


def recommend_roles(question: str) -> list[dict]:
    adapter = get_adapter()
    system, user = prompts.recommend(question)
    try:
        raw = adapter.generate(
            task="recommend",
            context={"system": system, "user": user, "question": question},
        )
        data = parse_json(raw)
        if isinstance(data, list):
            roles = [
                {"role_type": item.get("role_type"), "reason": item.get("reason", "")}
                for item in data
                if isinstance(item, dict) and item.get("role_type") in PERSONA_BY_CODE
            ]
            if len(roles) >= 3:
                return roles[:4]
    except Exception:
        pass
    return [
        {"role_type": code, "reason": reason}
        for code, reason in DEFAULT_RECOMMENDATION
    ]


def create_meeting(db: Session, user_id: int, req) -> dict:
    risk = check_risk(req.question)
    if risk.is_high_risk:
        return {
            "safety_abort": True,
            "category": risk.category,
            "guidance": risk.guidance,
        }

    if req.mode == "manual":
        role_types = req.role_types
        if not (3 <= len(role_types) <= 5):
            raise AppError(422, "invalid_roles", "请选择 3 到 5 个人格角色")
        for rt in role_types:
            if rt not in PERSONA_BY_CODE:
                raise AppError(422, "invalid_roles", f"未知人格类型 {rt}")
        roles = [{"role_type": rt, "reason": ""} for rt in role_types]
    else:
        roles = recommend_roles(req.question)

    title = req.question[:20] + ("…" if len(req.question) > 20 else "")
    meeting = Meeting(user_id=user_id, title=title, status=MeetingStatus.NEW.value)
    db.add(meeting)
    db.flush()

    fv = FactVersion(
        meeting_id=meeting.id,
        version=1,
        question=req.question,
        known_choices=req.known_choices,
        concerns=req.concerns,
        extra_conditions="",
    )
    db.add(fv)
    db.flush()

    for i, r in enumerate(roles):
        db.add(Participant(meeting_id=meeting.id, role_type=r["role_type"], sort=i))

    meeting.current_fact_version_id = fv.id
    meeting.status = MeetingStatus.ROLE_CONFIRM.value
    db.commit()
    db.refresh(meeting)
    return {**_meeting_item(meeting), "roles": roles}


def _generate_role_speech(adapter, role: dict, fv: FactVersion, db: Session, meeting_id: int):
    history = (
        db.query(Message)
        .filter(Message.meeting_id == meeting_id)
        .order_by(Message.id)
        .all()
    )
    system, user = prompts.role_speech(role, fv, history)
    raw = adapter.generate(
        task="role_speech",
        context={"system": system, "user": user, "question": fv.question, "role": role},
    )
    return parse_role_speech(raw, fallback_role=role["type_code"])


def _save_role_message(db: Session, meeting: Meeting, fv: FactVersion, speech) -> Message:
    msg = Message(
        meeting_id=meeting.id,
        fact_version_id=fv.id,
        speaker=speech.role_type,
        role_type=speech.role_type,
        claim_id=speech.claim_id,
        viewpoint=speech.viewpoint,
        fact_refs=speech.fact_refs,
        assumptions=speech.assumptions,
        responds_to=speech.responds_to,
        change_condition=speech.change_condition,
    )
    db.add(msg)
    db.flush()
    return msg


def start_meeting(db: Session, user_id: int, meeting: Meeting) -> dict:
    assert_transition(meeting.status, MeetingStatus.HOST_CLARIFY.value)
    meeting.status = MeetingStatus.HOST_CLARIFY.value
    db.commit()

    adapter = get_adapter()
    fv = db.get(FactVersion, meeting.current_fact_version_id)
    participants = _get_participants(db, meeting.id)

    system, user = prompts.host_opening(fv)
    try:
        raw = adapter.generate(
            task="host_opening",
            context={"system": system, "user": user, "question": fv.question},
        )
        obj = parse_json(raw) or {}
        opening = obj.get("opening") or f"我们先确认一下：你正在纠结“{fv.question}”。"
        clarify = obj.get("clarify_question") or ""
    except Exception:
        opening = f"我们先确认一下：你正在纠结“{fv.question}”。"
        clarify = ""

    db.add(
        Message(
            meeting_id=meeting.id,
            fact_version_id=fv.id,
            speaker="host",
            viewpoint=opening,
        )
    )

    assert_transition(meeting.status, MeetingStatus.FIRST_ROUND.value)
    meeting.status = MeetingStatus.FIRST_ROUND.value
    db.commit()

    first_msgs = []
    for p in participants:
        role = dict(p)
        speech = _generate_role_speech(adapter, role, fv, db, meeting.id)
        first_msgs.append(_save_role_message(db, meeting, fv, speech))

    assert_transition(meeting.status, MeetingStatus.WAITING.value)
    meeting.status = MeetingStatus.WAITING.value
    db.commit()
    return {
        "opening": opening,
        "clarify_question": clarify,
        "messages": [_msg_to_dict(m) for m in first_msgs],
    }


def run_step(db: Session, meeting: Meeting, req) -> tuple[list[dict], bool]:
    if meeting.status != MeetingStatus.WAITING.value:
        raise AppError(409, "invalid_state", "当前不在等待状态，无法继续讨论")

    adapter = get_adapter()
    fv = db.get(FactVersion, meeting.current_fact_version_id)
    participants = _get_participants(db, meeting.id)
    role_set = {p["type_code"] for p in participants}

    # 条件更新：产生新事实版本
    if req.action == "add_condition":
        if not req.text.strip():
            raise AppError(422, "invalid_input", "请填写要补充的情况")
        new_fv = FactVersion(
            meeting_id=meeting.id,
            version=fv.version + 1,
            question=fv.question,
            known_choices=fv.known_choices,
            concerns=fv.concerns,
            extra_conditions=(fv.extra_conditions + "\n" + req.text.strip()).strip(),
        )
        db.add(new_fv)
        db.flush()
        meeting.current_fact_version_id = new_fv.id
        fv = new_fv
        db.add(
            Message(
                meeting_id=meeting.id,
                fact_version_id=fv.id,
                speaker="user",
                viewpoint=req.text.strip(),
            )
        )

    # 决定本轮发言角色
    if req.action == "ask":
        if not req.target_roles or req.target_roles[0] not in role_set:
            raise AppError(422, "invalid_roles", "请指定一名参会角色")
        speakers = [
            {k: v for k, v in PERSONA_BY_CODE[req.target_roles[0]].items()}
        ]
    elif req.action == "name_roles":
        speakers = [
            {k: v for k, v in PERSONA_BY_CODE[rt].items()}
            for rt in req.target_roles
            if rt in role_set
        ]
        if not speakers:
            raise AppError(422, "invalid_roles", "请指定参会角色")
    else:
        speakers = [
            {k: v for k, v in PERSONA_BY_CODE[p["type_code"]].items()}
            for p in participants
        ]

    # 用户插话/追问文本记录
    if req.text.strip() and req.action in ("continue", "change_angle", "ask", "name_roles"):
        db.add(
            Message(
                meeting_id=meeting.id,
                fact_version_id=fv.id,
                speaker="user",
                viewpoint=req.text.strip(),
            )
        )

    assert_transition(meeting.status, MeetingStatus.GENERATING.value)
    meeting.status = MeetingStatus.GENERATING.value
    db.commit()

    msgs = []
    try:
        for role in speakers:
            speech = _generate_role_speech(adapter, role, fv, db, meeting.id)
            msgs.append(_save_role_message(db, meeting, fv, speech))
        meeting.units_used += 1
        meeting.status = MeetingStatus.WAITING.value
        db.commit()
    except Exception as e:
        meeting.status = MeetingStatus.FAILED.value
        db.commit()
        raise AppError(502, "generation_failed", "生成失败，请稍后重试") from e

    limit_reached = meeting.units_used >= get_settings().max_units_per_meeting
    return [_msg_to_dict(m) for m in msgs], limit_reached


def _fallback_summary(fv: FactVersion, history: list) -> object:
    from ..schemas import SummaryModel

    return SummaryModel(
        problem_and_conditions=fv.question,
        consensus="讨论暂未形成明确共识。",
        disagreements="（信息不足，未形成分歧）",
        unknowns="需要补充更多关键信息。",
        next_step="先补充一个你目前最不能接受的代价，再比较选项。",
        change_conditions="如果关键条件变化，结论可能改变。",
    )


def summarize_meeting(db: Session, meeting: Meeting) -> dict:
    if meeting.status not in (
        MeetingStatus.WAITING.value,
        MeetingStatus.GENERATING.value,
        MeetingStatus.FAILED.value,
    ):
        raise AppError(409, "invalid_state", "当前状态无法生成纪要")

    assert_transition(meeting.status, MeetingStatus.SUMMARIZING.value)
    meeting.status = MeetingStatus.SUMMARIZING.value
    db.commit()

    adapter = get_adapter()
    fv = db.get(FactVersion, meeting.current_fact_version_id)
    history = (
        db.query(Message)
        .filter(Message.meeting_id == meeting.id)
        .order_by(Message.id)
        .all()
    )
    system, user = prompts.summarize(fv, history)
    try:
        raw = adapter.generate(
            task="summarize",
            context={"system": system, "user": user, "question": fv.question},
        )
        summary = parse_summary(raw) or _fallback_summary(fv, history)
    except Exception:
        summary = _fallback_summary(fv, history)

    s = Summary(
        meeting_id=meeting.id,
        problem_and_conditions=summary.problem_and_conditions,
        consensus=summary.consensus,
        disagreements=summary.disagreements,
        unknowns=summary.unknowns,
        next_step=summary.next_step,
        change_conditions=summary.change_conditions,
    )
    db.add(s)
    meeting.status = MeetingStatus.FINISHED.value
    meeting.finished_at = _utcnow()
    db.commit()
    db.refresh(s)
    return _summary_to_dict(s)


def meeting_detail(db: Session, meeting: Meeting) -> dict:
    participants = _get_participants(db, meeting.id)
    messages = (
        db.query(Message)
        .filter(Message.meeting_id == meeting.id)
        .order_by(Message.id)
        .all()
    )
    summary = db.query(Summary).filter(Summary.meeting_id == meeting.id).first()
    feedback = db.query(Feedback).filter(Feedback.meeting_id == meeting.id).first()
    return {
        **_meeting_item(meeting),
        "roles": participants,
        "messages": [_msg_to_dict(m) for m in messages],
        "summary": _summary_to_dict(summary) if summary else None,
        "feedback_submitted": feedback is not None,
    }


def list_meetings(db: Session, user_id: int) -> list[dict]:
    meetings = (
        db.query(Meeting)
        .filter(Meeting.user_id == user_id, Meeting.deleted_at.is_(None))
        .order_by(Meeting.id.desc())
        .all()
    )
    return [_meeting_item(m) for m in meetings]


def delete_meeting(db: Session, meeting: Meeting) -> None:
    meeting.deleted_at = _utcnow()
    meeting.status = MeetingStatus.DELETED.value
    db.commit()


def save_feedback(db: Session, meeting: Meeting, req) -> None:
    fb = Feedback(
        meeting_id=meeting.id,
        interesting=req.interesting,
        new_perspective=req.new_perspective,
        next_step_intent=req.next_step_intent,
        reuse_intent=req.reuse_intent,
    )
    db.add(fb)
    db.commit()
