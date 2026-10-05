"""API 请求/响应 Pydantic 模型。"""
from __future__ import annotations

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    idea: str = Field(..., min_length=1, max_length=4000)


class SubmitClarificationRequest(BaseModel):
    answer: str = Field(..., min_length=1, max_length=2000)


class ConfirmPlanRequest(BaseModel):
    pass


class ModifyPlanRequest(BaseModel):
    request_text: str = Field(..., min_length=1, max_length=2000)


class RecommendPlanRequest(BaseModel):
    pass


class CreateModificationRequest(BaseModel):
    request_text: str = Field(..., min_length=1, max_length=2000)
    idempotency_key: str = Field(..., min_length=1, max_length=128)


class CreateTaskRequest(BaseModel):
    idempotency_key: str = Field(..., min_length=1, max_length=128)


class ResumeTaskRequest(BaseModel):
    idempotency_key: str = Field(..., min_length=1, max_length=128)
    confirm_retry: bool = Field(..., description="必须为 true 才允许恢复，防止误重试产生重复计费")


class RestoreVersionRequest(BaseModel):
    pass


class ErrorBody(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorBody
