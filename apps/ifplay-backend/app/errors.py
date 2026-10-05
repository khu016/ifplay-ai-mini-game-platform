"""统一错误模型与错误码。所有错误返回 {"error":{"code","message"}}。"""
from __future__ import annotations


class ApiError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class NotFoundError(ApiError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 404)


class ConflictError(ApiError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 409)


class StateError(ApiError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 409)


class ValidationError(ApiError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 422)


class PatchError(ApiError):
    """GameBundle 结构化补丁非法（非法路径/非法值/代码注入/路径不存在/补丁格式错误）。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 422)
