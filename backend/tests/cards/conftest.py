"""Fixtures for the cards tests: logged-in clients with the `cards` app, a
temporary CARDS_DATA_DIR, and a small catalog."""

import pytest
from fastapi.testclient import TestClient

import app
from core import database
from core.config import settings
from core.security import CSRF_COOKIE
from domains.cards import models as m
from tests.conftest import login, make_user

URL = "/api/cards"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """CARDS_DATA_DIR for this test (images, thumbnails, logos)."""
    path = tmp_path / "cards-data"
    path.mkdir()
    monkeypatch.setattr(settings, "cards_data_dir", str(path))
    return path


@pytest.fixture
def cards_client():
    """`cards_client(email, **make_user kwargs)`: a client logged in as a new
    user with the `cards` app (unless `apps` says otherwise), sending the
    CSRF header on every request."""
    clients: list[TestClient] = []

    def _make(email: str, **user) -> TestClient:
        created = make_user(email=email, **({"apps": ("cards",)} | user))
        c = TestClient(app.app)
        c.__enter__()
        assert login(c, email=email).status_code == 200
        c.headers["x-csrf-token"] = c.cookies.get(CSRF_COOKIE)
        c.user_id = created.id
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(cards_client):
    """A cards user (overrides the anonymous root `client`)."""
    return cards_client("alice@example.com", pseudo="Alice")


@pytest.fixture
def other_client(cards_client):
    """A second cards user."""
    return cards_client("bob@example.com", pseudo="Bob")


@pytest.fixture
def admin(cards_client):
    return cards_client("root@example.com", pseudo="Root", apps=(), is_admin=True)


@pytest.fixture
def anon():
    with TestClient(app.app) as c:
        yield c


def add_catalog_card(
    set_code="SVI",
    card_number="1",
    name="Sprigatito",
    variants=("standard", "reverse"),
    **fields,
) -> int:
    """Insert a catalog card (+ its variants) directly; returns its id."""
    series = fields.pop("series", "Scarlet & Violet")
    slug = name.lower().replace(" ", "-")
    defaults = {
        "display_name": name,
        "series": series,
        "set_name": "Scarlet & Violet",
        "set_code": set_code,
        "card_number": card_number,
        "image_path": f"{series}/{set_code}/cards/{card_number}_{slug}_standard_EN.jpg",
        "supertype": "Pokémon",
        "rarity": "Common",
        "card_count": 198,
    }
    with database.SessionLocal() as session:
        card = m.CardCatalog(
            name=name,
            **(defaults | fields),
            variants=[m.CardCatalogVariant(variant_type=v) for v in variants],
        )
        session.add(card)
        session.commit()
        return card.id


def own(user_id: int, catalog_id: int, **quantities: int) -> int:
    """Give `user_id` copies of a catalog card, per print
    (`own(uid, cid, standard=2, reverse=1)`); returns the `cards` row id."""
    with database.SessionLocal() as session:
        card = m.Card(
            user_id=user_id,
            catalog_id=catalog_id,
            variant_quantities=[
                m.CardVariantQuantity(variant_type=v, quantity=q)
                for v, q in (quantities or {"standard": 1}).items()
            ],
        )
        session.add(card)
        session.commit()
        return card.id


def set_language(user_id: int, language: str) -> None:
    with database.SessionLocal() as session:
        session.get(m.User, user_id).language = language
        session.commit()
