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
# list_workspaces returns a paginated envelope: {"items": [...], "nextCursor", "total"}
page = client.list_workspaces()
for workspace_id in page["items"]:
    print(workspace_id)
# `execute` accepts (workspace, message). `workspace` may be "" to start a brand-new run;
# when it points at an in-flight workspace the message is steered into it instead.
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
    page = await client.list_workspaces()
    print(page["items"], page["nextCursor"], page["total"])

asyncio.run(main())
```

## Streaming (SSE)

```python
from maximilian import Maximilian

client = Maximilian(base_url="https://api.maximilian.dev", token="...")
for event in client.stream_events(workspace="demo"):
    # Each `event` is the parsed JSON payload of an SSE `data:` frame.
    # Frames that carried an `id:` line also expose that id as `event["_id"]`.
    print(event)
```

## Errors

All API failures raise an exception from the `maximilian.errors` module.
The SDK maps HTTP status codes to specific subclasses:

| Status   | Exception        |
| -------- | ---------------- |
| 401, 403 | `AuthError`      |
| 404      | `NotFoundError`  |
| 429      | `RateLimitError` |
| other    | `ApiError`       |

All four are subclasses of `MaximilianError`, so a single `except
MaximilianError` clause catches them all. Import the typed classes
directly when you need to handle a specific case:

```python
from maximilian import Maximilian, AuthError, NotFoundError, RateLimitError

client = Maximilian(base_url="https://api.maximilian.dev", token="...")
try:
    client.get_workspace("does-not-exist")
except NotFoundError:
    print("workspace missing — create one first")
except AuthError:
    print("bad token")
```

## Compatibility

- Python 3.9+
- Pure Python; no compiled extensions.
- Async variant requires `httpx` (install via `pip install maximilian[async]`).
