"""HTTP client for the Maximilian API.

Mirrors the TypeScript `@max/sdk` API surface. Both sync and async
variants share the same request building logic and the same
status-to-exception mapping.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Iterator, NoReturn

from .errors import (
    ApiError,
    AuthError,
    NotFoundError,
    RateLimitError,
)


_HTTP_STATUS_REASONS: dict[int, str] = {
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    408: "Request Timeout",
    409: "Conflict",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
}


def _raise_for_status(status_code: int, body_text: str) -> NoReturn:
    """Raise the most specific error class for an HTTP status code.

    Mapping:
        401, 403 -> :class:`AuthError`
        404      -> :class:`NotFoundError`
        429      -> :class:`RateLimitError`
        other    -> :class:`ApiError`

    Always raises; annotated ``NoReturn`` so callers can use it as a
    guard without falling through to a return statement.
    """
    message = body_text or _HTTP_STATUS_REASONS.get(status_code, "API error")
    if status_code in (401, 403):
        raise AuthError(status_code, message)
    if status_code == 404:
        raise NotFoundError(status_code, message)
    if status_code == 429:
        raise RateLimitError(status_code, message)
    raise ApiError(status_code, message)


def _decode_sse_frame(event_id: str | None, data_lines: list[str]) -> dict[str, Any]:
    """Decode the collected ``data:`` lines of one SSE frame into a dict.

    Tries to parse the joined payload as JSON. On success the parsed
    keys are merged into the returned dict. When the frame carried an
    ``id:`` line, that id is exposed as ``_id``. Non-JSON payloads are
    returned under ``_raw`` so callers can still see the body.
    """
    payload = "\n".join(data_lines)
    frame: dict[str, Any] = {}
    if event_id is not None:
        frame["_id"] = event_id
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        frame["_raw"] = payload
        return frame
    if isinstance(parsed, dict):
        frame.update(parsed)
    else:
        frame["data"] = parsed
    return frame


@dataclass
class ClientConfig:
    base_url: str
    token: str | None = None
    timeout_seconds: float = 30.0
    user_agent: str = "maximilian-sdk-python/0.1.0"


class Maximilian:
    """Synchronous client."""

    def __init__(self, config: ClientConfig | None = None, **kwargs: Any) -> None:
        if config is None:
            config = ClientConfig(**kwargs)
        if not config.base_url:
            raise ValueError("base_url is required")
        self.config = config

    # ---- Internal ---------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
    ) -> dict[str, Any] | list[Any]:
        url = self.config.base_url.rstrip("/") + path
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{url}?{qs}"

        data: bytes | None = None
        headers = {
            "accept": "application/json",
            "user-agent": self.config.user_agent,
        }
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"
        if self.config.token:
            headers["authorization"] = f"Bearer {self.config.token}"

        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.config.timeout_seconds) as resp:
                raw = resp.read().decode("utf-8")
                if not raw:
                    return {}
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            body_text = e.read().decode("utf-8", errors="ignore") or e.reason or ""
            _raise_for_status(e.code, body_text)
        except urllib.error.URLError as e:
            raise ApiError(0, str(e)) from e
        # Both except branches always raise; this line is unreachable
        # but keeps static analyzers happy if `_raise_for_status` ever
        # loses its NoReturn annotation.
        raise ApiError(0, "unreachable")  # pragma: no cover

    # ---- Workspaces -------------------------------------------------------

    def list_workspaces(self) -> dict[str, Any]:
        """List workspaces for the current tenant.

        The backend returns a paginated envelope::

            {
              "items":      [<workspace_id>, ...],
              "nextCursor": <str | None>,
              "total":      <int>,
            }

        ``nextCursor`` is ``None`` when the caller has reached the end
        of the page; pass it back as ``cursor=<nextCursor>`` to fetch
        the next page (handled automatically by higher-level clients).
        """
        return self._request("GET", "/api/workspaces")  # type: ignore[return-value]

    def get_workspace(self, workspace_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/workspaces/{workspace_id}")  # type: ignore[return-value]

    def execute(
        self, workspace: str, input: str, *, timeout_seconds: int | None = None
    ) -> dict[str, Any]:
        """Run a chat message against a workspace.

        Sends ``{message, workspaceId}`` to ``POST /api/chat``. When
        ``workspaceId`` matches a workspace that's currently executing,
        the message is steered into the running tasks at the next safe
        point instead of starting a new one. When the workspace is
        idle, the message starts a brand-new run. ``workspaceId`` is
        optional on the backend, so passing an empty string is the
        same as omitting it.
        """
        body: dict[str, Any] = {"message": input}
        if workspace:
            body["workspaceId"] = workspace
        return self._request(  # type: ignore[return-value]
            "POST",
            "/api/chat",
            body=body,
        )

    # ---- Providers --------------------------------------------------------

    def list_providers(self) -> dict[str, Any]:
        return self._request("GET", "/api/providers")  # type: ignore[return-value]

    # ---- SSE --------------------------------------------------------------

    def stream_events(self, workspace: str) -> Iterator[dict[str, Any]]:
        """Yield SSE events for a workspace as parsed dicts.

        Connects to ``GET /api/workspaces/{id}/stream`` — the
        backend's ``text/event-stream`` endpoint — and parses frames
        shaped like::

            id: <seq>
            data: {"type": ..., ...}

            (blank line)

        Ephemeral frames (no ``id:`` line) are delivered too. SSE
        comment lines (``: ping`` heartbeats) are skipped. Each
        yielded dict is the parsed JSON payload of the ``data:``
        line; frames that carried an ``id:`` line also expose that
        id under ``_id``.
        """
        url = self.config.base_url.rstrip("/") + f"/api/workspaces/{workspace}/stream"
        headers = {"accept": "text/event-stream", "user-agent": self.config.user_agent}
        if self.config.token:
            headers["authorization"] = f"Bearer {self.config.token}"

        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=None) as resp:  # type: ignore[arg-type]
            event_id: str | None = None
            data_buf: list[str] = []
            while True:
                raw = resp.readline()
                if not raw:
                    # EOF — flush any pending frame, then stop. Without
                    # this guard the loop would spin forever after the
                    # server closes the stream.
                    if data_buf:
                        yield _decode_sse_frame(event_id, data_buf)
                    return
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    # Blank line terminates a frame.
                    if data_buf:
                        yield _decode_sse_frame(event_id, data_buf)
                        event_id = None
                        data_buf = []
                    continue
                if line.startswith(":"):
                    # SSE comment (used for heartbeats).
                    continue
                if line.startswith("id:"):
                    event_id = line[3:].strip()
                elif line.startswith("data:"):
                    # Per the SSE spec, strip one optional leading
                    # space after the colon.
                    data_buf.append(line[5:].lstrip())


class AsyncMaximilian:
    """Asynchronous client. Requires ``httpx``."""

    def __init__(self, config: ClientConfig | None = None, **kwargs: Any) -> None:
        if config is None:
            config = ClientConfig(**kwargs)
        self.config = config
        try:
            import httpx  # noqa: F401
        except ImportError as e:  # pragma: no cover
            raise RuntimeError(
                "AsyncMaximilian requires httpx. Install with `pip install httpx`."
            ) from e

    def _client(self):  # type: ignore[no-untyped-def]
        import httpx

        # Authorization lives on the shared client so every request —
        # list, get, execute — automatically carries the bearer token.
        # Previously only `execute()` added the header per-call, which
        # meant `list_workspaces()` and `get_workspace()` would 401
        # against any deployment that enforced auth.
        headers: dict[str, str] = {"user-agent": self.config.user_agent}
        if self.config.token:
            headers["authorization"] = f"Bearer {self.config.token}"
        return httpx.AsyncClient(
            base_url=self.config.base_url,
            headers=headers,
            timeout=self.config.timeout_seconds,
        )

    async def list_workspaces(self) -> dict[str, Any]:
        """List workspaces for the current tenant.

        Returns the same paginated envelope as the sync client —
        ``{items, nextCursor, total}``.
        """
        async with self._client() as c:
            r = await c.get("/api/workspaces")
            if r.status_code >= 400:
                _raise_for_status(r.status_code, r.text)
            return r.json()

    async def get_workspace(self, workspace_id: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.get(f"/api/workspaces/{workspace_id}")
            if r.status_code >= 400:
                _raise_for_status(r.status_code, r.text)
            return r.json()

    async def execute(self, workspace: str, input: str) -> dict[str, Any]:
        """Run a chat message against a workspace.

        Sends ``{message, workspaceId}`` to ``POST /api/chat`` — same
        payload shape as the sync client. ``workspaceId`` is omitted
        when ``workspace`` is empty so the backend treats the request
        as a brand-new run.
        """
        body: dict[str, Any] = {"message": input}
        if workspace:
            body["workspaceId"] = workspace
        async with self._client() as c:
            r = await c.post("/api/chat", json=body)
            if r.status_code >= 400:
                _raise_for_status(r.status_code, r.text)
            return r.json()


__all__ = ["Maximilian", "AsyncMaximilian", "ClientConfig"]
