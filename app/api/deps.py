"""API dependencies: moderator authentication + media storage.

TEMPORARY AUTH — until real moderator accounts exist (PRD FR8 / UserRole.MODERATOR),
the admin API authenticates with static bearer tokens from
``settings.admin_api_tokens`` (env ``KASHROOT_ADMIN_API_TOKENS``, JSON mapping of
token -> moderator actor name). The resolved actor name flows into every AuditLog
entry the moderator writes, so even this stopgap keeps the audit trail attributable.

Rules:
* Token comparison is constant-time (``hmac.compare_digest``) and checks every
  configured token without early exit.
* Tokens are secrets — they must never appear in logs, error details, or audit rows.
"""

from __future__ import annotations

import hmac
from functools import lru_cache

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.storage import MediaStorage

_bearer_scheme = HTTPBearer(auto_error=False)


@lru_cache
def _default_media_storage() -> MediaStorage:
    """One storage client per process, of whichever backend the configuration selects
    (Supabase Storage, S3/MinIO, or memory). Settings are read only here, at
    construction — lazily, so importing the app never opens a storage client.
    """
    from app.storage import media_storage_from_settings

    return media_storage_from_settings(settings)


def get_media_storage() -> MediaStorage:
    """FastAPI dependency for the media backend. Tests override this with the
    in-memory fake (``app.dependency_overrides[get_media_storage]``) — no test may
    ever reach S3.
    """
    return _default_media_storage()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_moderator(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> str:
    """Resolve the bearer token to a moderator actor name, or 401.

    Returns the actor name that must be written into every AuditLog row produced by
    the request.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthorized()

    tokens = settings.admin_api_tokens
    if not isinstance(tokens, dict):  # pragma: no cover - settings validator parses str
        raise _unauthorized()

    presented = credentials.credentials.encode("utf-8")
    actor: str | None = None
    # Compare against every configured token (no early exit) in constant time each.
    for token, name in tokens.items():
        if hmac.compare_digest(token.encode("utf-8"), presented):
            actor = name
    if actor is None:
        raise _unauthorized()
    return actor
