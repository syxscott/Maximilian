"""HTTP client for the Maximilian API.

Mirrors the TypeScript `@max/sdk` API surface. Both sync and async
variants share the same request building logic.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, AsyncIterator, Iterator


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
            body_text = e.read().decode("utf-8", errors="ignore")
            raise ApiError(e.code, body_text or e.reason) from e
        except urllib.error.URLError as e:
            raise ApiError(0, str(e)) from e

    # ---- Workspaces -------------------------------------------------------

    def list_workspaces(self) -> list[dict[str, Any]]:
        return self._request("GET", "/api/workspaces")  # type: ignore[return-value]

    def get_workspace(self, workspace_id: str) -> dict[str, Any]:
        return self._request("GET", f"/api/workspaces/{workspace_id}")  # type: ignore[return-value]

    def execute(
        self, workspace: str, input: str, *, timeout_seconds: int | None = None
    ) -> dict[str, Any]:
        return self._request(  # type: ignore[return-value]
            "POST",
            "/api/chat",
            body={"workspaceId": workspace, "input": input},
        )

    # ---- Providers --------------------------------------------------------

    def list_providers(self) -> dict[str, Any]:
        return self._request("GET", "/api/providers")  # type: ignore[return-value]

    # ---- SSE --------------------------------------------------------------

    def stream_events(self, workspace: str) -> Iterator[dict[str, Any]]:
        """Yield SSE events for a workspace as parsed dicts.

        NOTE: requires `sseclient` for production use; this implementation
        reads raw HTTP chunks. Best-effort — for high-throughput use,
        install sseclient-py and use AsyncMaximilian.
        """
        import socket

        url = self.config.base_url.rstrip("/") + f"/api/workspaces/{workspace}/events"
        headers = {"accept": "text/event-stream", "user-agent": self.config.user_agent}
        if self.config.token:
            headers["authorization"] = f"Bearer {self.config.token}"

        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=None) as resp:  # type: ignore[arg-type]
            event_type: str | None = None
            data_buf: list[str] = []
            while True:
                line = resp.readline().decode("utf-8", errors="replace").rstrip("\n")
                if not line:
                    if data_buf:
                        yield {
                            "event": event_type or "message",
                            "data": "\n".join(data_buf),
                        }
                        event_type = None
                        data_buf = []
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                elif line.startswith("data:"):
                    data_buf.append(line[5:].strip())


class AsyncMaximilian:
    """Asynchronous client. Requires `httpx`."""

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

        return httpx.AsyncClient(
            base_url=self.config.base_url,
            headers={"user-agent": self.config.user_agent},
            timeout=self.config.timeout_seconds,
        )

    async def list_workspaces(self) -> list[dict[str, Any]]:
        async with self._client() as c:
            r = await c.get("/api/workspaces")
            r.raise_for_status()
            return r.json()

    async def get_workspace(self, workspace_id: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.get(f"/api/workspaces/{workspace_id}")
            r.raise_for_status()
            return r.json()

    async def execute(self, workspace: str, input: str) -> dict[str, Any]:
        async with self._client() as c:
            r = await c.post(
                "/api/chat",
                json={"workspaceId": workspace, "input": input},
                headers={"authorization": f"Bearer {self.config.token}"} if self.config.token else {},
            )
            r.raise_for_status()
            return r.json()


# Local re-export so type hints are clean.
from .errors import ApiError, MaximilianError  # noqa: E402