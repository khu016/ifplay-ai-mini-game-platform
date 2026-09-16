from fastapi import HTTPException


class AppError(HTTPException):
    """统一错误结构：{"error": {"code", "message"}}"""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(
            status_code=status_code,
            detail={"error": {"code": code, "message": message}},
        )


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}
