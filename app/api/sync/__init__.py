"""Sheet-sync confirm page — `GET/POST /sync/proposals/{id}`.

Mounted at this API service's own origin, not behind the Vercel `/v1/*`/`/api/*`
proxy (render.yaml): the WhatsApp link points directly at
`KASHROOT_PUBLIC_API_ORIGIN`, so `/sync` needs no prefix reserved by that proxy.
"""

from __future__ import annotations

from app.api.sync.proposals import router

__all__ = ["router"]
