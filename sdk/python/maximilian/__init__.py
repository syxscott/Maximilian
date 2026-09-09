"""Maximilian Python SDK.

Synchronous + asynchronous client for the Maximilian REST API.

Usage:
    from maximilian import Maximilian
    client = Maximilian(base_url="https://api.maximilian.dev", token="...")
    result = client.execute(workspace="demo", input="plan a trip to Tokyo")
    for event in client.stream_events(workspace="demo"):
        print(event)
"""

from .client import Maximilian, AsyncMaximilian
from .flags import FlagsClient, AsyncFlagsClient
from .subscriptions import Subscription, SubscriptionsClient
from .errors import (
    MaximilianError,
    ApiError,
    AuthError,
    NotFoundError,
    RateLimitError,
)

__version__ = "0.1.0"

__all__ = [
    "Maximilian",
    "AsyncMaximilian",
    "FlagsClient",
    "AsyncFlagsClient",
    "Subscription",
    "SubscriptionsClient",
    "MaximilianError",
    "ApiError",
    "AuthError",
    "NotFoundError",
    "RateLimitError",
    "__version__",
]
