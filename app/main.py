"""FastAPI application entry point.

Modular monolith: feature modules (search, restaurants, moderation, owner portal) each
mount their own router here as they land. Only health checks exist today.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.api.admin import router as admin_router
from app.core.config import settings
from app.db.session import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "version": __version__, "env": settings.env}


@router.get("/health/db")
def health_db(session: Session = Depends(get_session)) -> dict[str, Any]:
    postgis = session.execute(text("select postgis_version()")).scalar_one()
    return {"status": "ok", "postgis": postgis}


def create_app() -> FastAPI:
    application = FastAPI(
        title="Kashroot API",
        version=__version__,
        description=(
            "Kosher restaurant discovery. Kashrut verdicts are binary and evidence-backed; "
            "fit scores rank soft preferences only and never mix with the verdict."
        ),
    )
    application.include_router(router)
    application.include_router(admin_router)
    return application


app = create_app()
