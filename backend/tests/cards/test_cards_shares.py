"""Share links: `/api/cards/shares` and the public `/api/cards/public/shares/{token}`."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update

from core import database
from domains.cards import models as m
from tests.cards.conftest import URL, add_catalog_card, own

SHARES = f"{URL}/shares"
PUBLIC = f"{URL}/public/shares"


@pytest.fixture
def cards():
    """SVI #1 (standard + reverse, with a reverse scan), SVI #2, MEW #1."""
    first = add_catalog_card(
        card_number="1",
        name="Sprigatito",
        image_path_fr="Scarlet & Violet/SVI/cards/1_sprigatito_standard_FR.jpg",
        set_name_fr="Écarlate et Violet",
        release_date=datetime(2023, 3, 31).date(),
    )
    with database.SessionLocal() as session:
        session.execute(
            update(m.CardCatalogVariant)
            .where(
                m.CardCatalogVariant.card_catalog_id == first,
                m.CardCatalogVariant.variant_type == "reverse",
            )
            .values(
                image_path_us="Scarlet & Violet/SVI/cards/1_sprigatito_reverse_EN.jpg"
            )
        )
        session.commit()
    second = add_catalog_card(card_number="2", name="Floragato", variants=("standard",))
    mew = add_catalog_card(set_code="MEW", card_number="1", name="Bulbasaur")
    return first, second, mew


def share(client, set_code="SVI", days=7):
    return client.post(SHARES, json={"set_code": set_code, "duration_days": days})


@pytest.fixture
def link(client, cards):
    own(client.user_id, cards[0], standard=2, reverse=1)
    response = share(client)
    assert response.status_code == 201, response.text
    return response.json()


def write(data_dir, relative_path, content=b"img"):
    path = data_dir / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def test_needs_the_cards_app(anon, cards_client):
    assert anon.get(SHARES).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    assert no_access.get(SHARES).status_code == 403


# ── own links ────────────────────────────────────────────────────────────────


def test_create_a_link(link):
    assert link["set_code"] == "SVI"
    # Users are French by default.
    assert link["set_name"] == "Écarlate et Violet"
    assert link["status"] == "active"
    assert len(link["token"]) == 32
    expires = datetime.fromisoformat(link["expires_at"])
    assert (
        timedelta(days=6, hours=23) < expires - datetime.now(UTC) <= timedelta(days=7)
    )


def test_create_refusals(client, cards):
    assert share(client, days=2).status_code == 422
    assert share(client, set_code="NOPE").status_code == 404
    for days in (1, 3, 30):
        assert share(client, days=days).status_code == 201


def test_list_and_revoke_own_links_only(client, other_client, link):
    assert other_client.get(SHARES).json() == []
    url = f"{SHARES}/{link['id']}"
    assert other_client.delete(url).status_code == 404
    revoked = client.delete(url)
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"
    again = client.delete(url).json()
    assert again["revoked_at"] == revoked.json()["revoked_at"]
    [listed] = client.get(SHARES).json()
    assert listed["status"] == "revoked"


# ── public page ──────────────────────────────────────────────────────────────


def test_public_page_needs_no_login(anon, cards, link):
    response = anon.get(f"{PUBLIC}/{link['token']}")
    assert response.status_code == 200
    body = response.json()
    assert body["set_code"] == "SVI"
    assert body["set_name"] == "Scarlet & Violet"
    assert body["series"] == "Scarlet & Violet"
    assert body["card_count"] == 198
    assert body["release_date"] == "2023-03-31"
    assert "user_id" not in body and "email" not in str(body)
    first, second = body["cards"]
    # English values, whoever shares.
    assert first["name"] == "Sprigatito"
    assert first["image_path"].endswith("_standard_EN.jpg")
    assert first["quantity_owned"] == 3
    assert [(v["variant_type"], v["quantity"]) for v in first["variants"]] == [
        ("standard", 2),
        ("reverse", 1),
    ]
    assert [v["variant_type"] for v in first["print_variants"]] == [
        "standard",
        "reverse",
    ]
    assert (second["name"], second["quantity_owned"], second["variants"]) == (
        "Floragato",
        0,
        [],
    )


def test_public_page_is_live(anon, client, cards, link):
    own(client.user_id, cards[1])
    body = anon.get(f"{PUBLIC}/{link['token']}").json()
    assert body["cards"][1]["quantity_owned"] == 1


def test_a_logged_in_viewer_reads_it_too(other_client, link):
    assert other_client.get(f"{PUBLIC}/{link['token']}").status_code == 200


def expire(share_id):
    with database.SessionLocal() as session:
        session.get(m.SetShare, share_id).expires_at = datetime.now(UTC) - timedelta(
            seconds=1
        )
        session.commit()


def test_expired_revoked_and_unknown_are_the_same_404(anon, client, link, data_dir):
    write(data_dir, "Scarlet & Violet/SVI/SVI_symbol.png")
    assert anon.get(f"{PUBLIC}/nope").status_code == 404
    token = link["token"]
    expire(link["id"])
    expired = anon.get(f"{PUBLIC}/{token}")
    assert expired.status_code == 404
    assert anon.get(f"{PUBLIC}/{token}/symbol").status_code == 404

    other = share(client).json()
    client.delete(f"{SHARES}/{other['id']}")
    revoked = anon.get(f"{PUBLIC}/{other['token']}")
    assert revoked.status_code == 404
    assert revoked.json() == expired.json() == anon.get(f"{PUBLIC}/nope").json()


# ── public images ────────────────────────────────────────────────────────────


def test_serves_the_sets_scans_thumbnails_and_variant_scans(anon, link, data_dir):
    base = f"{PUBLIC}/{link['token']}/images"
    for path in (
        "Scarlet & Violet/SVI/cards/1_sprigatito_standard_EN.jpg",
        "Scarlet & Violet/SVI/cards/1_sprigatito_standard_FR.jpg",
        "Scarlet & Violet/SVI/thumbnails/1_sprigatito_standard_EN.jpg",
        "Scarlet & Violet/SVI/cards/1_sprigatito_reverse_EN.jpg",
    ):
        write(data_dir, path, path.encode())
        response = anon.get(f"{base}/{path}")
        assert response.status_code == 200, path
        assert response.content == path.encode()
        assert response.headers["cache-control"] == "private, no-store"


def test_refuses_files_of_other_sets_and_escapes(anon, cards, link, data_dir):
    base = f"{PUBLIC}/{link['token']}/images"
    other_set = "Scarlet & Violet/MEW/cards/1_bulbasaur_standard_EN.jpg"
    write(data_dir, other_set)
    assert anon.get(f"{base}/{other_set}").status_code == 404
    write(data_dir, "Scarlet & Violet/SVI/cards/secret.jpg")
    assert anon.get(f"{base}/Scarlet & Violet/SVI/cards/secret.jpg").status_code == 404
    # In the set but not downloaded.
    assert (
        anon.get(
            f"{base}/Scarlet & Violet/SVI/cards/2_floragato_standard_EN.jpg"
        ).status_code
        == 404
    )
    (data_dir.parent / "secret.txt").write_text("no")
    assert anon.get(f"{base}/..%2Fsecret.txt").status_code == 404


def test_logo_falls_back_to_french_and_symbol(anon, link, data_dir):
    token = link["token"]
    assert anon.get(f"{PUBLIC}/{token}/logo").status_code == 404
    write(data_dir, "Scarlet & Violet/SVI/SVI_logo_FR.png", b"fr")
    assert anon.get(f"{PUBLIC}/{token}/logo").content == b"fr"
    write(data_dir, "Scarlet & Violet/SVI/SVI_logo_EN.png", b"en")
    logo = anon.get(f"{PUBLIC}/{token}/logo")
    assert logo.content == b"en"
    assert logo.headers["cache-control"] == "private, no-store"
    assert anon.get(f"{PUBLIC}/{token}/symbol").status_code == 404
    write(data_dir, "Scarlet & Violet/SVI/SVI_symbol.png", b"sym")
    assert anon.get(f"{PUBLIC}/{token}/symbol").content == b"sym"
