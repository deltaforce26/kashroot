"""Helpers shared by the public SEO directory endpoints and the sitemap.

Used by ``app.api.public_seo`` (``GET /v1/directory``, ``GET /v1/sitemap.xml``) and
``app.api.public_directory`` (the city and certifier pages) so all of them decide
"which certifier covers a restaurant" and "which pages exist" identically.

A certifier covers a restaurant only through a certificate in state ``ACTIVE`` from an
active certifier. Anything else (revoked, expired, pending) is never presented as
coverage on a landing page (CLAUDE.md fail-safe: doubt -> UNKNOWN, never doubt ->
MATCH). ``Certificate.valid_until`` is deliberately not read here; the date-based
degrade belongs to the match engine.
"""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Iterable
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.consts import (
    WEB_ROUTE_CERTIFIER_TEMPLATE,
    WEB_ROUTE_CITY_CERTIFIER_TEMPLATE,
    WEB_ROUTE_CITY_TEMPLATE,
)
from app.api.schemas_public_seo import DirectoryRestaurantOut
from app.models import Certificate, CertificateState, Certifier, Restaurant, RestaurantStatus


def directory_sitemap_paths(session: Session) -> list[str]:
    """Web paths of the city and certifier landing pages, in sitemap order: cities,
    then certifiers, then (city, certifier) pairs, each group alphabetical by slug.
    Same public filter as the restaurant entries (``RestaurantStatus.OPEN``); only
    active certifiers count, through ``ACTIVE`` certificates only, slugs are
    percent-encoded with ``quote(slug, safe="")`` to match the web app's
    ``encodeURIComponent`` canonical URLs, and a restaurant with no ``city_slug`` contributes a
    certifier entry but no city or pair entry — exactly the pages
    ``get_city_directory`` and ``get_certifier_directory`` would answer 200 for.

    Parameters:
        session (Session): the database session.

    Return:
        list[str]: the ``/city/...`` and ``/certifier/...`` paths, no lastmod.
    """
    city_slugs = session.scalars(
        select(Restaurant.city_slug)
        .where(Restaurant.status == RestaurantStatus.OPEN, Restaurant.city_slug.is_not(None))
        .distinct()
    ).all()
    pairs = session.execute(
        select(Restaurant.city_slug, Certifier.slug)
        .join(Certificate, Certificate.restaurant_id == Restaurant.id)
        .join(Certifier, Certifier.id == Certificate.certifier_id)
        .where(
            Restaurant.status == RestaurantStatus.OPEN,
            Certifier.is_active.is_(True),
            Certificate.state == CertificateState.ACTIVE,
        )
        .distinct()
    ).all()

    certifier_slugs = sorted({certifier_slug for _, certifier_slug in pairs})
    city_certifier_pairs = sorted(
        (city_slug, certifier_slug) for city_slug, certifier_slug in pairs if city_slug is not None
    )

    return [
        *(
            WEB_ROUTE_CITY_TEMPLATE.format(city_slug=quote(slug, safe=""))
            for slug in sorted(city_slugs)
        ),
        *(
            WEB_ROUTE_CERTIFIER_TEMPLATE.format(certifier_slug=quote(slug, safe=""))
            for slug in certifier_slugs
        ),
        *(
            WEB_ROUTE_CITY_CERTIFIER_TEMPLATE.format(
                city_slug=quote(city, safe=""), certifier_slug=quote(certifier, safe="")
            )
            for city, certifier in city_certifier_pairs
        ),
    ]


def active_certifiers(restaurant: Restaurant) -> list[Certifier]:
    """Active certifiers of one restaurant's ``ACTIVE`` certificates, de-duplicated by
    certifier id and sorted alphabetically by ``name_he`` (ties by slug, for a stable
    order) — the "active certifiers only" rule ``get_restaurant_public_facts``
    applies, plus the fail-safe rule that a revoked, expired or pending certificate
    never counts as coverage. Never ordered by certifier type.

    Parameters:
        restaurant (Restaurant): the restaurant, with ``certificates`` and each
            certificate's ``certifier`` already loaded.

    Return:
        list[Certifier]: the distinct active certifiers, in display order.
    """
    active_by_id: dict[uuid.UUID, Certifier] = {
        certificate.certifier.id: certificate.certifier
        for certificate in restaurant.certificates
        if certificate.certifier.is_active and certificate.state == CertificateState.ACTIVE
    }

    return sorted(active_by_id.values(), key=lambda certifier: (certifier.name_he, certifier.slug))


def certifier_names(restaurant: Restaurant) -> tuple[list[str], list[str | None]]:
    """Display names of one restaurant's active certifiers, in ``active_certifiers``
    order, with no certificate state exposed (this is identity only, not evaluation).

    Parameters:
        restaurant (Restaurant): the restaurant, with ``certificates`` and each
            certificate's ``certifier`` already loaded.

    Return:
        tuple[list[str], list[str | None]]: ``(names_he, names_en)``, parallel lists
            (same order, same length); ``names_en`` may contain ``None``.
    """
    ordered = active_certifiers(restaurant)

    return (
        [certifier.name_he for certifier in ordered],
        [certifier.name_en for certifier in ordered],
    )


def directory_restaurant_out(restaurant: Restaurant) -> DirectoryRestaurantOut:
    """Serialize one restaurant's identity-only facts for a directory city group.

    Parameters:
        restaurant (Restaurant): the restaurant, with ``certificates`` and each
            certificate's ``certifier`` already loaded.

    Return:
        DirectoryRestaurantOut: the restaurant as an API output model.
    """
    certifier_names_he, certifier_names_en = certifier_names(restaurant)

    return DirectoryRestaurantOut(
        restaurant_id=restaurant.id,
        name_he=restaurant.name_he,
        name_en=restaurant.name_en,
        address_he=restaurant.address_he,
        certifier_names_he=certifier_names_he,
        certifier_names_en=certifier_names_en,
        certifier_slugs=[certifier.slug for certifier in active_certifiers(restaurant)],
    )


def majority_value(values: Iterable[str | None]) -> str | None:
    """The most common non-null value, ties broken alphabetically.

    Parameters:
        values (Iterable[str | None]): the candidate values; ``None`` entries are
            ignored.

    Return:
        str | None: the majority value, or ``None`` if there is no non-null value.
    """
    counts = Counter(value for value in values if value is not None)

    if not counts:
        return None

    return max(sorted(counts), key=lambda value: counts[value])


def city_en_for_group(city_restaurants: list[Restaurant]) -> str | None:
    """The English display label for one ``city_he`` group: the most common non-null
    ``Restaurant.city_en`` among its restaurants, ties broken alphabetically. Grouping
    itself stays keyed by ``city_he`` only — this only picks the label shown for it.

    Parameters:
        city_restaurants (list[Restaurant]): every restaurant already grouped under
            one ``city_he`` value.

    Return:
        str | None: the majority ``city_en``, or ``None`` if none of them has one.
    """

    return majority_value(restaurant.city_en for restaurant in city_restaurants)


def city_slug_for_group(city_restaurants: list[Restaurant]) -> str | None:
    """The web landing-page slug for one ``city_he`` group: the most common non-null
    ``Restaurant.city_slug`` among its restaurants, ties broken alphabetically (the
    same rule as ``city_en_for_group``).

    Parameters:
        city_restaurants (list[Restaurant]): every restaurant already grouped under
            one ``city_he`` value.

    Return:
        str | None: the majority ``city_slug``, or ``None`` if none of them has one.
    """

    return majority_value(restaurant.city_slug for restaurant in city_restaurants)
