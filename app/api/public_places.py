"""Google Places (New) enrichment for one restaurant's detail page — ``/v1/*``.

Split out of ``app.api.public`` (already at STANDARDS.md's file-size limit): two
read-only endpoints, both degrading rather than erroring on any Google/network
failure so a restaurant's own kashrut verdict is never blocked on this router.
Neither endpoint is ever called from a search/list response — only from a single
restaurant's own detail page.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.consts import ERROR_RESTAURANT_NOT_FOUND
from app.api.schemas_places import PlacesEnrichmentOut
from app.db.session import get_session
from app.models import Restaurant
from app.services.places import PlacesService, get_places_service
from app.services.places_consts import (
    DEFAULT_PHOTO_WIDTH_PX,
    ERROR_PHOTO_NOT_FOUND,
    MAX_PHOTO_WIDTH_PX,
    MIN_PHOTO_WIDTH_PX,
)
from app.services.rate_limit import require_places_photo_rate_limit

router = APIRouter(prefix="/v1", tags=["places"])

#: Short cache: keeps a page load from hammering our own cache layer on repeated
#: client requests, but stays well under the upstream Places cache TTL.
PLACES_RESPONSE_CACHE_CONTROL = "private, max-age=300"


def _get_place_id_or_404(session: Session, restaurant_id: uuid.UUID) -> str | None:
    """
    Resolve the place id to enrich from, 404 when the restaurant itself does not
    exist.

    Prefers ``Restaurant.google_business_place_id`` (resolved by
    ``app.ingestion.places_resolve`` from Places Text Search, so it names the
    business itself) and falls back to ``google_place_id`` (the legacy Geocoding
    API's street-address place id) only when no business id was resolved — e.g. a
    restaurant sharing an address with another business (the פינת הגלידה case),
    where the address id is still better than nothing.

    Parameters:
        session (Session): The open session.
        restaurant_id (uuid.UUID): The restaurant's primary key.

    Return:
        str | None: The place id to enrich from (possibly ``None``).
    """
    row = session.execute(
        select(Restaurant.google_business_place_id, Restaurant.google_place_id).where(
            Restaurant.id == restaurant_id
        )
    ).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_RESTAURANT_NOT_FOUND)
    business_place_id, address_place_id = row

    return business_place_id or address_place_id


@router.get("/restaurants/{restaurant_id}/places", response_model=PlacesEnrichmentOut)
def get_restaurant_places(
    restaurant_id: uuid.UUID,
    response: Response,
    session: Session = Depends(get_session),
    places_service: PlacesService = Depends(get_places_service),
) -> PlacesEnrichmentOut:
    """Google Places photos + opening hours for one restaurant.

    Never kashrut evidence, never persisted, never called for a list of
    restaurants — one restaurant's own detail page only. 404 when the restaurant
    itself is unknown; a restaurant with no ``google_place_id``, or any Google/
    network failure, still returns 200 with a degraded body
    (``place_id_known=False`` or ``photos=[]``/``hours=null``).
    """
    place_id = _get_place_id_or_404(session, restaurant_id)
    response.headers["Cache-Control"] = PLACES_RESPONSE_CACHE_CONTROL

    return places_service.enrichment(restaurant_id, place_id)


@router.get("/restaurants/{restaurant_id}/photos/{index}")
def get_restaurant_photo(
    restaurant_id: uuid.UUID,
    index: int = Path(ge=0),
    w: int = Query(DEFAULT_PHOTO_WIDTH_PX, ge=MIN_PHOTO_WIDTH_PX, le=MAX_PHOTO_WIDTH_PX),
    session: Session = Depends(get_session),
    places_service: PlacesService = Depends(get_places_service),
    _rate_limit: None = Depends(require_places_photo_rate_limit),
) -> Response:
    """Redirect to one Google Places photo's short-lived media URL.

    Photo bytes never transit this server and are never persisted — this is a 302
    to the ``photoUri`` Google's Photo Media endpoint returns
    (``skipHttpRedirect=true``), with the API key only ever sent server-side. 404
    for an unknown restaurant, a restaurant with no place id, an out-of-range
    index, or any Google/network failure.
    """
    place_id = _get_place_id_or_404(session, restaurant_id)
    photo_uri = places_service.photo_redirect_uri(place_id, index, w)
    if photo_uri is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_PHOTO_NOT_FOUND)

    return Response(status_code=status.HTTP_302_FOUND, headers={"Location": photo_uri})
