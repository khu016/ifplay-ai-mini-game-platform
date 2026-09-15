class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(code)
        self.code, self.message, self.status = code, message, status

    def payload(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}
