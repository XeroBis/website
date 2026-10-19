"""The `cards` schema's database-level rules (see data-model.md `cards`)."""

import pytest
from sqlalchemy.exc import IntegrityError

from core import database
from domains.cards import models as m
from tests.cards.conftest import add_catalog_card
from tests.conftest import make_user


@pytest.fixture
def owner():
    return make_user(email="owner@example.com", apps=("cards",))


def _commit(*rows):
    with database.SessionLocal() as session:
        session.add_all(rows)
        session.commit()
        return [row.id for row in rows]


def test_variants_are_returned_in_display_order():
    catalog_id = add_catalog_card(
        variants=("reverse_masterball", "standard", "reverse_pokeball", "reverse")
    )
    with database.SessionLocal() as session:
        card = session.get(m.CardCatalog, catalog_id)
        assert [v.variant_type for v in card.variants] == [
            "standard",
            "reverse",
            "reverse_pokeball",
            "reverse_masterball",
        ]


def test_one_collection_row_per_user_and_catalog_card(owner):
    catalog_id = add_catalog_card()
    _commit(m.Card(user_id=owner.id, catalog_id=catalog_id))
    with pytest.raises(IntegrityError):
        _commit(m.Card(user_id=owner.id, catalog_id=catalog_id))


def test_variant_quantity_is_at_least_one(owner):
    catalog_id = add_catalog_card()
    (card_id,) = _commit(m.Card(user_id=owner.id, catalog_id=catalog_id))
    with pytest.raises(IntegrityError):
        _commit(
            m.CardVariantQuantity(card_id=card_id, variant_type="standard", quantity=0)
        )


def test_deck_card_points_at_exactly_one_of_card_or_catalog(owner):
    catalog_id = add_catalog_card()
    card_id, deck_id = _commit(
        m.Card(user_id=owner.id, catalog_id=catalog_id),
        m.Deck(user_id=owner.id, name="Deck"),
    )
    with pytest.raises(IntegrityError):
        _commit(m.DeckCard(deck_id=deck_id, card_id=card_id, catalog_id=catalog_id))
    with pytest.raises(IntegrityError):
        _commit(m.DeckCard(deck_id=deck_id))
    _commit(m.DeckCard(deck_id=deck_id, card_id=card_id))


def test_deck_name_unique_per_owner_and_type_checked(owner):
    other = make_user(email="other@example.com", apps=("cards",))
    _commit(
        m.Deck(user_id=owner.id, name="Same"), m.Deck(user_id=other.id, name="Same")
    )
    with pytest.raises(IntegrityError):
        _commit(m.Deck(user_id=owner.id, name="Same"))
    with pytest.raises(IntegrityError):
        _commit(m.Deck(user_id=owner.id, name="Odd", deck_type="wdc"))


def test_combat_score_and_winner_checked(owner):
    def combat(**fields):
        return m.Combat(
            player_a_id=owner.id,
            player_b_id=owner.id,
            deck_a_snapshot=[],
            deck_b_snapshot=[],
            deck_a_name_snapshot="A",
            deck_b_name_snapshot="B",
            **({"winner": "a", "loser_score": 1} | fields),
        )

    _commit(combat())
    for bad in ({"loser_score": 0}, {"loser_score": 7}, {"winner": "c"}):
        with pytest.raises(IntegrityError):
            _commit(combat(**bad))


def test_deleting_a_user_removes_their_cards_data(owner):
    catalog_id = add_catalog_card()
    card_id, deck_id = _commit(
        m.Card(user_id=owner.id, catalog_id=catalog_id),
        m.Deck(user_id=owner.id, name="Deck"),
    )
    _commit(
        m.CardVariantQuantity(card_id=card_id, variant_type="standard", quantity=2),
        m.DeckCard(deck_id=deck_id, card_id=card_id, quantity_in_deck=2),
        m.Purchase(user_id=owner.id, product_name="ETB", price=50),
    )
    with database.SessionLocal() as session:
        session.delete(session.get(m.User, owner.id))
        session.commit()
        assert session.query(m.Card).count() == 0
        assert session.query(m.Deck).count() == 0
        assert session.query(m.DeckCard).count() == 0
        assert session.query(m.Purchase).count() == 0
        # The shared catalog stays.
        assert session.get(m.CardCatalog, catalog_id) is not None
