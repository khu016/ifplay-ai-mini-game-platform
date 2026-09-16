from pydantic import BaseModel, Field


# ---- 认证 ----
class RequestCodeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class VerifyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    code: str = Field(min_length=4, max_length=8)
    age_confirmed: bool


# ---- 会议 ----
class RecommendRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class CreateMeetingRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    known_choices: str = Field(default="", max_length=200)
    concerns: str = Field(default="", max_length=200)
    mode: str = Field(default="quick", pattern="^(quick|manual)$")
    role_types: list[str] = Field(default_factory=list)


class StepRequest(BaseModel):
    action: str = Field(
        pattern="^(continue|add_condition|ask|name_roles|change_angle)$"
    )
    text: str = Field(default="", max_length=500)
    target_roles: list[str] = Field(default_factory=list)


class FeedbackRequest(BaseModel):
    interesting: bool | None = None
    new_perspective: bool | None = None
    next_step_intent: bool | None = None
    reuse_intent: bool | None = None


# ---- 模型结构化输出 ----
class RoleSpeech(BaseModel):
    role_type: str
    claim_id: str = ""
    viewpoint: str
    fact_refs: list[str] = Field(default_factory=list)
    assumptions: str = ""
    responds_to: str = ""
    change_condition: str = ""


class SummaryModel(BaseModel):
    problem_and_conditions: str
    consensus: str
    disagreements: str
    unknowns: str
    next_step: str
    change_conditions: str
