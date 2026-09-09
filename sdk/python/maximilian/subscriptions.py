"""Webhook / SSE subscriptions client."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class Subscription:
    id: str
    type: str
    target: str
    events: list[str]
    secret: str
    created_at: str
    last_delivered_at: str | None = None
    total_deliveries: int = 0
    total_failures: int = 0

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "Subscription":
        return cls(
            id=data["id"],
            type=data["type"],
            target=data["target"],
            events=data.get("events", []),
            secret=data.get("secret", ""),
            created_at=data["createdAt"],
            last_delivered_at=data.get("lastDeliveredAt"),
            total_deliveries=data.get("totalDeliveries", 0),
            total_failures=data.get("totalFailures", 0),
        )


class SubscriptionsClient:
    """Manage webhook / SSE subscriptions."""

    def __init__(self, base_url: str, token: str | None = None) -> None:
        if not base_url:
            raise ValueError("base_url is required")
        self.base_url = base_url.rstrip("/")
        self.token = token

    def _request(
        self, method: str, path: str, body: dict[str, Any] | None = None
    ) -> tuple[int, Any]:
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
            with urllib.request.urlopen(req, timeout=15.0) as resp:
                raw = resp.read().decode("utf-8")
                return resp.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            return e.code, None

    def create(
        self, type: str, target: str, events: list[str] | None = None
    ) -> Subscription | None:
        status, payload = self._request(
            "POST",
            "/api/subscriptions",
            {"type": type, "target": target, "events": events or []},
        )
        if status == 201 and isinstance(payload, dict):
            return Subscription.from_json(payload)
        return None

    def list(self) -> list[Subscription]:
        status, payload = self._request("GET", "/api/subscriptions")
        if status != 200 or not isinstance(payload, dict):
            return []
        return [
            Subscription.from_json(s)
            for s in payload.get("subscriptions", [])
        ]

    def delete(self, subscription_id: str) -> bool:
        status, _ = self._request("DELETE", f"/api/subscriptions/{subscription_id}")
        return status == 204