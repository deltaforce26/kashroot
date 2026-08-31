"""Restaurant directory API tests — ``GET/PATCH /api/admin/restaurants`` (SQLite).

Same harness as ``test_moderation_api``: ``get_session`` is overridden with the test
session and the override commits after each request, so a mutation and its audit row
land together or not at all.

The load-bearing cases are the ones about what the directory *cannot* do. A details
edit must never reach a kashrut fact, must never clear a required column, and must
re-derive the ingestion natural key when the record's identity is corrected.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import settings
from app.db.session import get_session
from app.ingestion.normalize import restaurant_dedupe_key
from app.main import create_app
from app.models import (
    AuditAction,
    AuditLog,
    Certificate,
    CertificateSource,
    CertificateState,
    CertificationLevel,
    Certifier,
    CertifierType,
    DietType,
    RecordState,
    Restaurant,
    RestaurantStatus,
)

TOKENS = {"tok-alice": "alice"}
ALICE = {"Authorization": "Bearer tok-alice"}

DIRECTORY = "/api/admin/restaurants"


@pytest.fixture
def client(session, monkeypatch):
    monkeypatch.setattr(settings, "admin_api_tokens", dict(TOKENS))
    app = create_app()

    def _override_session():
        yield session
        session.commit()

    app.dependency_overrides[get_session] = _override_session
    with TestClient(app) as test_client:
        yield test_client


def make_restaurant(
    session,
    *,
    name_he: str = "מסעדת בדיקה",
    name_en: str | None = None,
    city_he: str | None = "ירושלים",
    city_slug: str | None = "jerusalem",
    address_he: str | None = "רחוב הרצל 1",
    status: RestaurantStatus = RestaurantStatus.OPEN,
    needs_review: bool = False,
    record_state: RecordState = RecordState.LIST_VERIFIED,
) -> Restaurant:
    restaurant = Restaurant(
        dedupe_key=restaurant_dedupe_key(name_he, city_he, address_he),
        name_he=name_he,
        name_en=name_en,
        city_he=city_he,
        city_slug=city_slug,
        address_he=address_he,
        record_state=record_state,
        needs_review=needs_review,
        corroboration_count=1,
        status=status,
        amenities={},
    )
    session.add(restaurant)
    session.flush()
    return restaurant


def make_certificate(session, restaurant: Restaurant) -> Certificate:
    certifier = Certifier(
        slug=f"certifier_{uuid.uuid4().hex[:8]}",
        name_he='בד"ץ בדיקה',
        name_en="Badatz Test",
        type=CertifierType.BADATZ,
        is_active=True,
    )
    session.add(certifier)
    session.flush()
    certificate = Certificate(
        restaurant_id=restaurant.id,
        certifier_id=certifier.id,
        level=CertificationLevel.MEHADRIN,
        attributes={"glatt": True},
        state=CertificateState.ACTIVE,
        source=CertificateSource.OFFICIAL_LIST,
        corroboration_count=1,
    )
    session.add(certificate)
    session.flush()
    return certificate


def audit_rows(session, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_type == "restaurant", AuditLog.entity_id == entity_id)
            .order_by(AuditLog.seq)
        )
    )


# ----------------------------------------------------------------------------- auth


def test_directory_requires_a_moderator_token(client, session) -> None:
    restaurant = make_restaurant(session)

    assert client.get(DIRECTORY).status_code == 401
    assert client.get(f"{DIRECTORY}/{restaurant.id}").status_code == 401
    edit = client.patch(f"{DIRECTORY}/{restaurant.id}", json={"phone": "03-1234567"})
    assert edit.status_code == 401


# ----------------------------------------------------------------------------- list


def test_list_returns_every_restaurant_not_only_queued_ones(client, session) -> None:
    make_restaurant(session, name_he="אלף", needs_review=True)
    make_restaurant(session, name_he="בית", address_he="רחוב יפו 2", needs_review=False)

    body = client.get(DIRECTORY, headers=ALICE).json()

    assert body["total"] == 2
    assert [item["name_he"] for item in body["items"]] == ["אלף", "בית"]


def test_list_carries_full_details_and_certificates_as_context(client, session) -> None:
    restaurant = make_restaurant(session, name_en="Test Place")
    make_certificate(session, restaurant)

    item = client.get(DIRECTORY, headers=ALICE).json()["items"][0]

    assert item["name_en"] == "Test Place"
    assert item["dedupe_key"] == restaurant.dedupe_key
    assert item["amenities"] == {}
    assert [c["level"] for c in item["certificates"]] == ["mehadrin"]
    assert item["certificates"][0]["attributes"] == {"glatt": True}


def test_list_search_matches_name_address_and_city(client, session) -> None:
    make_restaurant(session, name_he="פלאפל הזהב", city_he="תל אביב", city_slug="tel-aviv")
    make_restaurant(session, name_he="שווארמה", address_he="רחוב הזהב 8")
    make_restaurant(session, name_he="בורגר", address_he="רחוב אחר 3")

    body = client.get(DIRECTORY, headers=ALICE, params={"q": "הזהב"}).json()

    assert body["total"] == 2
    assert {item["name_he"] for item in body["items"]} == {"פלאפל הזהב", "שווארמה"}


def test_list_filters_by_city_status_and_needs_review(client, session) -> None:
    make_restaurant(session, name_he="פתוח", city_slug="haifa")
    make_restaurant(
        session,
        name_he="סגור",
        city_slug="haifa",
        address_he="רחוב שני 2",
        status=RestaurantStatus.CLOSED_PERM,
    )
    make_restaurant(session, name_he="אחר", city_slug="tel-aviv", address_he="רחוב שלישי 3")

    by_city = client.get(DIRECTORY, headers=ALICE, params={"city": "haifa"}).json()
    by_status = client.get(DIRECTORY, headers=ALICE, params={"status": "closed_perm"}).json()
    by_review = client.get(DIRECTORY, headers=ALICE, params={"needs_review": "true"}).json()

    assert by_city["total"] == 2
    assert [item["name_he"] for item in by_status["items"]] == ["סגור"]
    assert by_review["total"] == 0


def test_get_one_returns_404_for_an_unknown_id(client) -> None:
    response = client.get(f"{DIRECTORY}/{uuid.uuid4()}", headers=ALICE)

    assert response.status_code == 404


# ---------------------------------------------------------------------------- patch


def test_patch_writes_only_the_submitted_fields_and_audits_them(client, session) -> None:
    restaurant = make_restaurant(session, name_en="Old Name")

    response = client.patch(
        f"{DIRECTORY}/{restaurant.id}",
        headers=ALICE,
        json={"phone": "03-1234567", "price_level": 2, "note": "owner called"},
    )

    assert response.status_code == 200
    session.refresh(restaurant)
    assert restaurant.phone == "03-1234567"
    assert restaurant.price_level == 2
    assert restaurant.name_en == "Old Name"

    rows = audit_rows(session, restaurant.id)
    assert len(rows) == 1
    assert rows[0].action is AuditAction.UPDATE
    assert rows[0].actor == "alice"
    assert set(rows[0].changes) == {"phone", "price_level"}
    assert rows[0].changes["price_level"] == {"before": None, "after": 2}
    assert rows[0].evidence["note"] == "owner called"


def test_patch_clears_an_optional_field_with_an_explicit_null(client, session) -> None:
    restaurant = make_restaurant(session, name_en="Removed Later")

    client.patch(f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"name_en": None})

    session.refresh(restaurant)
    assert restaurant.name_en is None


def test_patch_treats_a_blank_string_as_a_clear_not_an_empty_value(client, session) -> None:
    restaurant = make_restaurant(session, name_en="Blanked")

    client.patch(f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"name_en": "   "})

    session.refresh(restaurant)
    assert restaurant.name_en is None


def test_patch_cannot_clear_a_required_field(client, session) -> None:
    restaurant = make_restaurant(session)

    response = client.patch(f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"name_he": None})

    assert response.status_code == 422
    session.refresh(restaurant)
    assert restaurant.name_he == "מסעדת בדיקה"


def test_patch_rejects_a_blank_name(client, session) -> None:
    restaurant = make_restaurant(session)

    response = client.patch(f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"name_he": "  "})

    assert response.status_code == 422


def test_patch_rejects_a_body_with_no_editable_field(client, session) -> None:
    restaurant = make_restaurant(session)

    response = client.patch(
        f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"note": "just a note"}
    )

    assert response.status_code == 422
    assert audit_rows(session, restaurant.id) == []


def test_patch_ignores_fields_outside_the_editable_whitelist(client, session) -> None:
    """Provenance and workflow fields belong to the review queue and to ingestion.

    They are not in the request schema at all, so FastAPI drops them; the assertion
    that matters is that nothing changed and no audit row claims otherwise.
    """
    restaurant = make_restaurant(session, record_state=RecordState.LIST_VERIFIED)

    response = client.patch(
        f"{DIRECTORY}/{restaurant.id}",
        headers=ALICE,
        json={
            "phone": "03-9999999",
            "record_state": "field_verified",
            "needs_review": True,
            "corroboration_count": 99,
            "dedupe_key": "hand-written",
        },
    )

    assert response.status_code == 200
    session.refresh(restaurant)
    assert restaurant.record_state is RecordState.LIST_VERIFIED
    assert restaurant.needs_review is False
    assert restaurant.corroboration_count == 1
    assert set(audit_rows(session, restaurant.id)[0].changes) == {"phone"}


def test_patch_cannot_reach_a_kashrut_fact(client, session) -> None:
    """No field of the directory editor touches a certificate — kashrut lives there."""
    restaurant = make_restaurant(session)
    certificate = make_certificate(session, restaurant)

    client.patch(
        f"{DIRECTORY}/{restaurant.id}",
        headers=ALICE,
        json={
            "name_en": "Renamed",
            "certificates": [{"state": "active", "attributes": {"glatt": False}}],
            "attributes": {"glatt": False},
            "state": "active",
        },
    )

    session.refresh(certificate)
    assert certificate.state is CertificateState.ACTIVE
    assert certificate.attributes == {"glatt": True}
    assert (
        session.scalars(select(AuditLog).where(AuditLog.entity_type == "certificate")).all() == []
    )


def test_patch_validates_city_slug_diet_type_price_and_amenities(client, session) -> None:
    restaurant = make_restaurant(session)
    path = f"{DIRECTORY}/{restaurant.id}"

    assert client.patch(path, headers=ALICE, json={"city_slug": "Tel Aviv"}).status_code == 422
    assert client.patch(path, headers=ALICE, json={"diet_type": "treif"}).status_code == 422
    assert client.patch(path, headers=ALICE, json={"price_level": 9}).status_code == 422
    unknown_key = client.patch(path, headers=ALICE, json={"amenities": {"wifi": True}})
    coerced_value = client.patch(path, headers=ALICE, json={"amenities": {"parking": "yes"}})
    assert unknown_key.status_code == 422
    assert coerced_value.status_code == 422

    ok = client.patch(
        path,
        headers=ALICE,
        json={
            "city_slug": "tel-aviv",
            "diet_type": "dairy",
            "price_level": 3,
            "amenities": {"parking": True, "delivery": False},
        },
    )

    assert ok.status_code == 200
    session.refresh(restaurant)
    assert restaurant.city_slug == "tel-aviv"
    assert restaurant.diet_type is DietType.DAIRY
    assert restaurant.amenities == {"parking": True, "delivery": False}


def test_patch_normalizes_urls_and_rejects_nonsense(client, session) -> None:
    restaurant = make_restaurant(session)
    path = f"{DIRECTORY}/{restaurant.id}"

    assert client.patch(path, headers=ALICE, json={"website": "not a url"}).status_code == 422

    client.patch(path, headers=ALICE, json={"website": "https://example.com/menu"})

    session.refresh(restaurant)
    assert restaurant.website == "https://example.com/menu"
    assert isinstance(restaurant.website, str)


def test_correcting_the_identity_rederives_the_dedupe_key(client, session) -> None:
    restaurant = make_restaurant(session, name_he="שם שגוי")
    old_key = restaurant.dedupe_key

    client.patch(f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"name_he": "שם נכון"})

    session.refresh(restaurant)
    assert restaurant.dedupe_key != old_key
    assert restaurant.dedupe_key == restaurant_dedupe_key(
        "שם נכון", restaurant.city_he, restaurant.address_he
    )
    assert "dedupe_key" in audit_rows(session, restaurant.id)[0].changes


def test_editing_a_non_identity_field_leaves_the_dedupe_key_alone(client, session) -> None:
    restaurant = make_restaurant(session)
    old_key = restaurant.dedupe_key

    client.patch(f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"phone": "03-1112222"})

    session.refresh(restaurant)
    assert restaurant.dedupe_key == old_key


def test_a_rename_onto_another_records_identity_is_refused(client, session) -> None:
    first = make_restaurant(session, name_he="ראשונה", address_he="רחוב א 1")
    second = make_restaurant(session, name_he="שנייה", address_he="רחוב ב 2")

    response = client.patch(
        f"{DIRECTORY}/{second.id}",
        headers=ALICE,
        json={"name_he": "ראשונה", "address_he": "רחוב א 1"},
    )

    assert response.status_code == 409
    session.refresh(second)
    assert second.name_he == "שנייה"
    assert second.dedupe_key != first.dedupe_key
    assert audit_rows(session, second.id) == []


def test_patch_of_an_unknown_restaurant_is_404(client) -> None:
    response = client.patch(
        f"{DIRECTORY}/{uuid.uuid4()}", headers=ALICE, json={"phone": "03-1234567"}
    )

    assert response.status_code == 404


def test_an_edit_that_changes_nothing_writes_an_empty_audit_row(client, session) -> None:
    """The row is still written: "alice looked at this and confirmed it" is a fact the
    trail should carry, and ``apply_changes`` never invents a write that did not happen.
    """
    restaurant = make_restaurant(session, name_en="Same")

    client.patch(f"{DIRECTORY}/{restaurant.id}", headers=ALICE, json={"name_en": "Same"})

    rows = audit_rows(session, restaurant.id)
    assert len(rows) == 1
    assert rows[0].changes == {}
