# Maximilian Python SDK

Synchronous and asynchronous Python client for the Maximilian REST API.

## Install

```bash
pip install maximilian
# Optional: async support
pip install maximilian[async]
```

## Quick start

```python
from maximilian import Maximilian

client = Maximilian(base_url="https://api.maximilian.dev", token="...")
workspaces = client.list_workspaces()
result = client.execute(workspace="demo", input="plan a 3-day trip to Tokyo")
print(result)
```

## Feature flags

```python
from maximilian import FlagsClient

flags = FlagsClient(base_url="https://api.maximilian.dev", token="...")
if flags.is_enabled("META_AGENT_ENABLED"):
    print("meta-system is on")
```

## Subscriptions

```python
from maximilian import SubscriptionsClient

subs = SubscriptionsClient(base_url="https://api.maximilian.dev", token="...")
sub = subs.create(type="webhook", target="https://my.app/hook", events=["execution.complete"])
print(f"created {sub.id}, secret={sub.secret}")
```

## Async

```python
import asyncio
from maximilian import AsyncMaximilian

async def main():
    client = AsyncMaximilian(base_url="https://api.maximilian.dev", token="...")
    workspaces = await client.list_workspaces()
    print(workspaces)

asyncio.run(main())
```

## Errors

All API failures raise `maximilian.ApiError` (a subclass of
`MaximilianError`). HTTP 401/403 raise `AuthError`, 404 raises
`NotFoundError`, 429 raises `RateLimitError`.

## Compatibility

- Python 3.9+
- Pure Python; no compiled extensions.
- Async variant requires `httpx` (install via `pip install maximilian[async]`).