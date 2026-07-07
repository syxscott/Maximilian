"""Feature flag client."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass
class FlagInfo:
    name: str
    enabled: bool
    default_value: bool
    rollout_percentage: float | None = None
    description: str | None = None


class FlagsClient:
    """Synchronous feature-flag client with a small in-memory TTL cache."""

    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        cache_ttl_seconds: float = 5.0,
        user_id: str | None = None,
    ) -> None:
        if not base_url:
            raise ValueError("base_url is required")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.cache_ttl = cache_ttl_seconds
        self.user_id = user_id
        self._cache: dict[str, tuple[float, bool]] = {}

    def _request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> tuple[int, dict[str, Any] | list[Any] | None]:
        url = self.base_url + path
        data: bytes | None = None
        headers = {"accept": "application/json", "user-agent": "maximilian-sdk-python/0.1.0"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"

        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                raw = resp.read().decode("utf-8")
                payload: dict[str, Any] | list[Any] | None = (
                    json.loads(raw) if raw else None
                )
                return resp.status, payload
        except urllib.error.HTTPError as e:
            return e.code, None
        except urllib.error.URLError:
            return 0, None

    def is_enabled(self, name: str) -> bool:
        cached = self._cache.get(name)
        if cached and cached[0] > time.time():
            return cached[1]

        params = f"?userId={self.user_id}" if self.user_id else ""
        status, payload = self._request("GET", f"/api/flags/{name}{params}")
        if status == 404:
            self._cache[name] = (time.time() + self.cache_ttl, False)
            return False
        if status != 200 or not isinstance(payload, dict):
            return False
        enabled = bool(payload.get("enabled", False))
        self._cache[name] = (time.time() + self.cache_ttl, enabled)
        return enabled

    def evaluate(self, names: list[str]) -> dict[str, bool]:
        status, payload = self._request(
            "POST",
            "/api/flags/evaluate",
            {"flagNames": names, "userId": self.user_id},
        )
        if status != 200 or not isinstance(payload, dict):
            return {}
        return payload.get("values", {})  # type: ignore[return-value]

    def override(self, name: str, value: bool, reason: str | None = None) -> bool:
        status, _ = self._request(
            "POST",
            f"/api/flags/{name}/override",
            {"value": value, "reason": reason},
        )
        if status == 200:
            self._cache[name] = (time.time() + self.cache_ttl, value)
            return True
        return False

    def clear_override(self, name: str) -> bool:
        status, _ = self._request("DELETE", f"/api/flags/{name}/override")
        if status == 204:
            self._cache.pop(name, None)
            return True
        return False


class AsyncFlagsClient:
    """Async variant. Requires httpx."""

    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        cache_ttl_seconds: float = 5.0,
        user_id: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.cache_ttl = cache_ttl_seconds
        self.user_id = user_id

    async def is_enabled(self, name: str) -> bool:
        import httpx

        params = {"userId": self.user_id} if self.user_id else {}
        headers = {}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        async with httpx.AsyncClient(base_url=self.base_url, headers=headers) as c:
            r = await c.get(f"/api/flags/{name}", params=params)
            if r.status_code == 404:
                return False
            r.raise_for_status()
            return bool(r.json().get("enabled", False))