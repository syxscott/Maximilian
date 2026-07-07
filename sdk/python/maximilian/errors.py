"""Error types raised by the Maximilian SDK."""


class MaximilianError(Exception):
    """Base class for all SDK errors."""


class ApiError(MaximilianError):
    """Raised when the API returns a non-2xx response."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        super().__init__(f"HTTP {status}: {message}")


class AuthError(ApiError):
    """Raised on 401 / 403."""


class NotFoundError(ApiError):
    """Raised on 404."""


class RateLimitError(ApiError):
    """Raised on 429 — retryable."""