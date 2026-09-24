"""Public, unauthenticated SEO endpoints — ``/v1/*``.

Both endpoints exist so Googlebot (and any other caller with no kashrut profile) can
index the app: ``GET /v1/restaurants/{id}`` and ``GET /v1/sitemap.xml``.

Neither endpoint ever computes or returns a Layer 1 kashrut verdict, a reason code, or
a Layer 2 fit score. This is not an oversight — it follows directly from the fail-safe
rule (CLAUDE.md: doubt -> UNKNOWN, never doubt -> MATCH). A verdict is only ever the
output of the pure match engine over (Certificate x Profile); a crawler supplies no
profile, so there is nothing to evaluate the certificates against, and fabricating one
(e.g. "no profile means show everything as UNKNOWN") would still be presenting a
verdict-shaped field with no profile behind it. The honest response is to expose the
same facts a signed-in client's own detail screen renders (which certifier, what
state, what attributes, when it was last updated) and let the client render its own
"set your profile to see if this matches you" call-to-action around them — exactly the
same facts ``app.api.public.get_restaurant_detail`` already exposes per certificate,
minus the profile-dependent outcome/reasons/confidence/freshness fields that endpoint
adds on top.
"""

from __future__ import annotations

import uuid
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.consts import (
    CACHE_CONTROL_HEADER,
    DEFAULT_FORWARDED_PROTO,
    ERROR_RESTAURANT_NOT_FOUND,
    FORWARDED_HOST_HEADER,
    FORWARDED_PROTO_HEADER,
    RESTAURANT_PUBLIC_CACHE_CONTROL,
    SITEMAP_CACHE_CONTROL,
    SITEMAP_CONTENT_TYPE,
    SITEMAP_MAX_URLS,
    SITEMAP_XML_NAMESPACE,
    TRUSTED_FORWARDED_HOST_SUFFIXES,
    VARY_FORWARDED_HOST,
    VARY_HEADER,
    WEB_ROUTE_HOME,
    WEB_ROUTE_RESTAURANT_TEMPLATE,
)
from app.api.public import _geo_point_out
from app.api.schemas_public_seo import CertificateFactOut, CertifierFactOut, RestaurantPublicOut
from app.core.config import settings
from app.db.session import get_session
from app.models import Certificate, Certifier, Restaurant, RestaurantStatus

router = APIRouter(prefix="/v1", tags=["public"])


def resolve_public_web_origin(request: Request) -> str:
    """The public web app's origin, for absolute sitemap URLs.

    Resolution order: an explicit ``settings.public_web_origin`` override always wins;
    else the ``X-Forwarded-Host``/``X-Forwarded-Proto`` request headers, but only when
    ``X-Forwarded-Host`` ends with one of ``TRUSTED_FORWARDED_HOST_SUFFIXES`` (Vercel
    sets these on the external rewrite that proxies ``/v1/*`` from the web app to this
    API, and a ``*.vercel.app`` deployment host is the only proxy that legitimately
    does so); else this request's own base URL. An untrusted forwarded host is not a
    fallback trigger by itself — it is ignored outright and treated the same as no
    header at all, falling through to the base URL. This is fail-closed on purpose:
    the header is attacker-controlled on any unauthenticated request, and the sitemap
    response is cached by shared/CDN caches (``SITEMAP_CACHE_CONTROL`` is ``public``),
    so trusting an arbitrary host would let a spoofed request poison that cache with
    wrong ``<loc>`` URLs for other callers. Always returned with no trailing slash.

    Parameters:
        request (Request): the incoming request, used for its forwarded headers and
            base URL fallback.

    Return:
        str: the origin, e.g. ``"https://kashroot.example"``, with no trailing slash.
    """
    if settings.public_web_origin:
        return settings.public_web_origin.rstrip("/")

    forwarded_host = request.headers.get(FORWARDED_HOST_HEADER)
    if forwarded_host and forwarded_host.endswith(TRUSTED_FORWARDED_HOST_SUFFIXES):
        forwarded_proto = request.headers.get(FORWARDED_PROTO_HEADER, DEFAULT_FORWARDED_PROTO)

        return f"{forwarded_proto}://{forwarded_host}".rstrip("/")

    return str(request.base_url).rstrip("/")


def _certifier_fact_out(certifier: Certifier) -> CertifierFactOut:
    """Serialize a certifier's display identity only, for a certificate fact row.

    Parameters:
        certifier (Certifier): the certifier row.

    Return:
        CertifierFactOut: the certifier's display identity as an API output model.
    """

    return CertifierFactOut(id=certifier.id, name_he=certifier.name_he, name_en=certifier.name_en)


def _certificate_fact_out(certificate: Certificate) -> CertificateFactOut:
    """Serialize one certificate's stored facts, with no evaluation against any
    profile — there is no profile on this profile-free path.

    Parameters:
        certificate (Certificate): the certificate row, with ``certifier`` loaded.

    Return:
        CertificateFactOut: the certificate's facts as an API output model.
    """

    return CertificateFactOut(
        certifier=_certifier_fact_out(certificate.certifier),
        status=certificate.state,
        valid_until=certificate.valid_until,
        attributes=dict(certificate.attributes),
    )


@router.get("/restaurants/{restaurant_id}", response_model=RestaurantPublicOut)
def get_restaurant_public_facts(
    restaurant_id: uuid.UUID,
    response: Response,
    session: Session = Depends(get_session),
) -> RestaurantPublicOut:
    """Profile-free facts for one restaurant — never a kashrut verdict, reason code,
    or fit score (see this module's docstring for why). Certificates from an inactive
    certifier are omitted, the same soft-delete convention ``GET /v1/certifiers``
    already applies (``Certifier.is_active``); there is no equivalent flag on
    ``Certificate`` or ``Restaurant`` themselves, so no further filtering applies.

    Unlike ``POST /v1/restaurants/{id}``, this is a plain GET with no request body —
    there is no profile to carry, so nothing to POST.
    """
    restaurant = session.get(
        Restaurant,
        restaurant_id,
        options=[selectinload(Restaurant.certificates).joinedload(Certificate.certifier)],
    )
    if restaurant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=ERROR_RESTAURANT_NOT_FOUND)

    response.headers[CACHE_CONTROL_HEADER] = RESTAURANT_PUBLIC_CACHE_CONTROL

    return RestaurantPublicOut(
        restaurant_id=restaurant.id,
        name_he=restaurant.name_he,
        name_en=restaurant.name_en,
        address_he=restaurant.address_he,
        city_he=restaurant.city_he,
        phone=restaurant.phone,
        website=restaurant.website,
        diet_type=restaurant.diet_type,
        price_level=restaurant.price_level,
        amenities=dict(restaurant.amenities),
        geo=_geo_point_out(restaurant.geo),
        certificates=[
            _certificate_fact_out(certificate)
            for certificate in restaurant.certificates
            if certificate.certifier.is_active
        ],
        updated_at=restaurant.updated_at,
    )


def build_sitemap_xml(origin: str, entries: list[tuple[str, str | None]]) -> str:
    """Build a sitemaps.org ``urlset`` document from already-resolved URL paths.

    Parameters:
        origin (str): the web app's origin (no trailing slash), e.g.
            ``"https://kashroot.example"``.
        entries (list[tuple[str, str | None]]): ``(path, lastmod)`` pairs, ``path``
            starting with ``/`` and ``lastmod`` an ISO ``YYYY-MM-DD`` date string or
            None.

    Return:
        str: the complete XML document, UTF-8 text, every value XML-escaped.
    """
    pieces = ['<?xml version="1.0" encoding="UTF-8"?>', f'<urlset xmlns="{SITEMAP_XML_NAMESPACE}">']
    for path, lastmod in entries:
        pieces.append("<url>")
        pieces.append(f"<loc>{escape(origin + path)}</loc>")
        if lastmod is not None:
            pieces.append(f"<lastmod>{escape(lastmod)}</lastmod>")
        pieces.append("</url>")
    pieces.append("</urlset>")

    return "".join(pieces)


@router.get("/sitemap.xml")
def get_sitemap(request: Request, session: Session = Depends(get_session)) -> Response:
    """XML sitemap of the web app's public routes: the home page and one
    ``/r/{restaurant_id}`` entry per restaurant ``POST /v1/search`` could ever return —
    the same unconditional candidate-set filter ``build_search_statement`` applies
    (``Restaurant.status == RestaurantStatus.OPEN``); every other search filter is
    request-specific narrowing, not part of "could ever be returned". Capped at
    ``SITEMAP_MAX_URLS`` (the sitemaps.org limit for one file); the corpus is ~375
    restaurants today, so a single file is enough — a larger corpus later needs a
    sitemap *index* file instead, which is out of scope here.
    """
    origin = resolve_public_web_origin(request)

    rows = session.execute(
        select(Restaurant.id, Restaurant.updated_at)
        .where(Restaurant.status == RestaurantStatus.OPEN)
        .order_by(Restaurant.id)
        .limit(SITEMAP_MAX_URLS)
    ).all()

    entries: list[tuple[str, str | None]] = [(WEB_ROUTE_HOME, None)]
    entries.extend(
        (
            WEB_ROUTE_RESTAURANT_TEMPLATE.format(restaurant_id=restaurant_id),
            updated_at.date().isoformat() if updated_at is not None else None,
        )
        for restaurant_id, updated_at in rows
    )

    xml_body = build_sitemap_xml(origin, entries)

    return Response(
        content=xml_body,
        media_type=SITEMAP_CONTENT_TYPE,
        headers={
            CACHE_CONTROL_HEADER: SITEMAP_CACHE_CONTROL,
            VARY_HEADER: VARY_FORWARDED_HOST,
        },
    )
