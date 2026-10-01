"""Public, unauthenticated city and certifier directory pages — ``/v1/directory/*``.

Backs the web app's ``/city/<city_slug>``, ``/city/<city_slug>/<certifier_slug>`` and
``/certifier/<certifier_slug>`` landing pages, which exist so a search engine can
index "kosher restaurants in <city>" and "<certifier> restaurants" pages.

Same contract as ``GET /v1/directory`` (``app.api.public_seo.get_directory``): facts
only, never a Layer 1 verdict, reason code, Fit Score or certificate state, because a
crawler supplies no profile to evaluate certificates against (CLAUDE.md fail-safe:
doubt -> UNKNOWN, never doubt -> MATCH). Every ordering is alphabetical (or a count
with an alphabetical tie-break), never driven by certifier type — the app never ranks
certifiers. "Public" means ``Restaurant.status == RestaurantStatus.OPEN`` and a
certifier "covers" a restaurant when one of its ``ACTIVE`` certificates points at that
certifier and ``Certifier.is_active`` — exactly what ``active_certifiers`` decides.
"""

from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session, selectinload

from app.api.consts import (
    CACHE_CONTROL_HEADER,
    ERROR_CERTIFIER_NOT_FOUND,
    ERROR_CITY_NOT_FOUND,
    SITEMAP_CACHE_CONTROL,
)
from app.api.public_directory_shared import (
    active_certifiers,
    directory_restaurant_out,
    majority_value,
)
from app.api.schemas_public_seo import (
    CertifierDirectoryOut,
    CityDirectoryOut,
    DirectoryCertifierCityOut,
    DirectoryCertifierFacetOut,
    DirectoryCertifierRestaurantOut,
)
from app.db.session import get_session
from app.models import Certificate, CertificateState, Certifier, Restaurant, RestaurantStatus

router = APIRouter(prefix="/v1", tags=["public"])


def _city_label_he(city_restaurants: list[Restaurant], city_slug: str) -> str:
    """The Hebrew display label for one city slug: the most common non-null
    ``Restaurant.city_he``, ties alphabetical, falling back to the slug itself when no
    restaurant in the group has one (``DirectoryCityOut.city_he`` is never null).

    Parameters:
        city_restaurants (list[Restaurant]): every restaurant under the slug.
        city_slug (str): the slug, used only as the fallback label.

    Return:
        str: the label.
    """

    return majority_value(r.city_he for r in city_restaurants) or city_slug


@router.get("/directory/cities/{city_slug}", response_model=CityDirectoryOut)
def get_city_directory(
    city_slug: str,
    response: Response,
    certifier: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> CityDirectoryOut:
    """Every public restaurant in one city, optionally narrowed to one certifier —
    facts only (see this module's docstring). One statement loads the city's
    restaurants with their certificates; the facets and the filter are derived from
    them, so ``certifiers`` and ``restaurant_count`` never depend on ``certifier``.

    Responds 404 when no public restaurant has ``city_slug``, and when ``certifier``
    is unknown, inactive, or has no public restaurant in this city.

    Parameters:
        city_slug (str): the city's ``Restaurant.city_slug``, from the path.
        response (Response): the outgoing response, mutated in place to set the
            cache-control header.
        certifier (str | None): optional ``Certifier.slug`` to narrow ``restaurants``.
        session (Session): the database session.

    Return:
        CityDirectoryOut: the city's facets and (filtered) restaurants.
    """
    restaurants = (
        session.execute(
            select(Restaurant)
            .where(Restaurant.status == RestaurantStatus.OPEN, Restaurant.city_slug == city_slug)
            .options(selectinload(Restaurant.certificates).joinedload(Certificate.certifier))
            .order_by(Restaurant.name_he, Restaurant.id)
        )
        .scalars()
        .all()
    )
    if not restaurants:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_CITY_NOT_FOUND)

    certifiers_by_slug: dict[str, Certifier] = {}
    counts: Counter[str] = Counter()
    for restaurant in restaurants:
        for active in active_certifiers(restaurant):
            certifiers_by_slug[active.slug] = active
            counts[active.slug] += 1

    facets = [
        DirectoryCertifierFacetOut(
            slug=active.slug,
            name_he=active.name_he,
            name_en=active.name_en,
            restaurant_count=counts[active.slug],
        )
        for active in sorted(
            certifiers_by_slug.values(), key=lambda value: (value.name_he, value.slug)
        )
    ]

    selected = next((facet for facet in facets if facet.slug == certifier), None)
    if certifier is not None and selected is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_CERTIFIER_NOT_FOUND)

    shown = [
        restaurant
        for restaurant in restaurants
        if certifier is None
        or any(active.slug == certifier for active in active_certifiers(restaurant))
    ]

    response.headers[CACHE_CONTROL_HEADER] = SITEMAP_CACHE_CONTROL

    return CityDirectoryOut(
        city_slug=city_slug,
        city_he=_city_label_he(restaurants, city_slug),
        city_en=majority_value(r.city_en for r in restaurants),
        restaurant_count=len(restaurants),
        certifiers=facets,
        selected_certifier=selected,
        restaurants=[directory_restaurant_out(restaurant) for restaurant in shown],
    )


def _certifier_city_groups(restaurants: list[Restaurant]) -> list[DirectoryCertifierCityOut]:
    """Group restaurants by non-null ``city_slug`` into city rows, ordered by
    ``restaurant_count`` descending, ties by ``city_he`` (the ``GET /v1/directory``
    convention) and then slug for a stable order.

    Parameters:
        restaurants (list[Restaurant]): a certifier's public restaurants.

    Return:
        list[DirectoryCertifierCityOut]: one row per distinct non-null ``city_slug``.
    """
    by_slug: dict[str, list[Restaurant]] = {}
    for restaurant in restaurants:
        if restaurant.city_slug is not None:
            by_slug.setdefault(restaurant.city_slug, []).append(restaurant)

    rows = [
        DirectoryCertifierCityOut(
            city_slug=slug,
            city_he=_city_label_he(group, slug),
            city_en=majority_value(r.city_en for r in group),
            restaurant_count=len(group),
        )
        for slug, group in by_slug.items()
    ]

    return sorted(rows, key=lambda row: (-row.restaurant_count, row.city_he, row.city_slug))


@router.get("/directory/certifiers/{certifier_slug}", response_model=CertifierDirectoryOut)
def get_certifier_directory(
    certifier_slug: str,
    response: Response,
    session: Session = Depends(get_session),
) -> CertifierDirectoryOut:
    """Every public restaurant one active certifier covers, with its per-city
    counts — facts only (see this module's docstring). Two statements: the certifier
    by slug, then its public restaurants with their certificates. Restaurants with no
    ``city_slug`` are listed but contribute to no ``cities`` row.

    Responds 404 when the certifier is unknown, inactive, or covers no public
    restaurant.

    Parameters:
        certifier_slug (str): the ``Certifier.slug``, from the path.
        response (Response): the outgoing response, mutated in place to set the
            cache-control header.
        session (Session): the database session.

    Return:
        CertifierDirectoryOut: the certifier's identity, cities and restaurants.
    """
    certifier = session.scalars(
        select(Certifier).where(Certifier.slug == certifier_slug, Certifier.is_active.is_(True))
    ).one_or_none()
    if certifier is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_CERTIFIER_NOT_FOUND)

    restaurants = (
        session.execute(
            select(Restaurant)
            .where(
                Restaurant.status == RestaurantStatus.OPEN,
                Restaurant.certificates.any(
                    and_(
                        Certificate.certifier_id == certifier.id,
                        Certificate.state == CertificateState.ACTIVE,
                    )
                ),
            )
            .options(selectinload(Restaurant.certificates).joinedload(Certificate.certifier))
            .order_by(Restaurant.name_he, Restaurant.id)
        )
        .scalars()
        .all()
    )
    if not restaurants:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_CERTIFIER_NOT_FOUND)

    response.headers[CACHE_CONTROL_HEADER] = SITEMAP_CACHE_CONTROL

    return CertifierDirectoryOut(
        slug=certifier.slug,
        name_he=certifier.name_he,
        name_en=certifier.name_en,
        restaurant_count=len(restaurants),
        cities=_certifier_city_groups(restaurants),
        restaurants=[
            DirectoryCertifierRestaurantOut(
                **directory_restaurant_out(restaurant).model_dump(),
                city_he=restaurant.city_he,
                city_en=restaurant.city_en,
                city_slug=restaurant.city_slug,
            )
            for restaurant in restaurants
        ],
    )
