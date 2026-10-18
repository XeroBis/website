"""Combats: `/api/cards/combats`, the deck picker `/api/cards/decks/combat-options`
and the player picker `/api/cards/users`."""

import pytest
from sqlalchemy import select

from core import database
from domains.cards import models as m
from tests.cards.conftest import (
    URL,
    add_catalog_card,
    make_deck,
    own,
    put_in_deck,
    set_language,
)

COMBATS = f"{URL}/combats"


@pytest.fixture
def pika():
    return add_catalog_card(card_number="25", name="Pikachu")


@pytest.fixture
def decks(client, other_client, pika):
    """Alice's "Volt" (2 Pikachu) and Bob's empty "Rock"."""
    volt = make_deck(client.user_id, "Volt")
    put_in_deck(volt, own(client.user_id, pika, standard=2), 2)
    return volt, make_deck(other_client.user_id, "Rock")


def log(client, deck_a, deck_b, player_a, player_b, **body):
    return client.post(
        COMBATS,
        json={
            "deck_a_id": deck_a,
            "player_a_id": player_a,
            "deck_b_id": deck_b,
            "player_b_id": player_b,
            "winner": "a",
            "loser_score": 3,
            "played_at": "2026-10-01",
        }
        | body,
    )


@pytest.fixture
def combat(client, other_client, decks):
    response = log(client, *decks, client.user_id, other_client.user_id)
    assert response.status_code == 201, response.text
    return response.json()


def test_needs_the_cards_app(anon, cards_client):
    assert anon.get(COMBATS).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    assert no_access.get(COMBATS).status_code == 403
    assert no_access.get(f"{URL}/users").status_code == 403
    assert no_access.get(f"{URL}/decks/combat-options").status_code == 403


# ── pickers ──────────────────────────────────────────────────────────────────


def test_users_lists_cards_users_current_first(client, other_client, cards_client):
    cards_client("admin@example.com", pseudo="Ann", apps=(), is_admin=True)
    cards_client("media@example.com", pseudo="Med", apps=("media",))
    users = other_client.get(f"{URL}/users").json()
    assert users == [
        {"id": other_client.user_id, "pseudo": "Bob"},
        {"id": client.user_id, "pseudo": "Alice"},
        {"id": users[2]["id"], "pseudo": "Ann"},
    ]


def test_combat_options_list_every_cards_users_normal_decks(
    client, other_client, cards_client, decks
):
    make_deck(client.user_id, "Wants", deck_type="phantom")
    gone = cards_client("gone@example.com", pseudo="Gone", apps=("media",))
    make_deck(gone.user_id, "Hidden")
    options = client.get(f"{URL}/decks/combat-options").json()
    assert options == [
        {
            "id": decks[1],
            "name": "Rock",
            "deck_type": "normal",
            "has_wdc_cards": False,
            "owner_id": other_client.user_id,
            "owner_label": "Bob",
        },
        {
            "id": decks[0],
            "name": "Volt",
            "deck_type": "normal",
            "has_wdc_cards": False,
            "owner_id": client.user_id,
            "owner_label": "Alice",
        },
    ]


# ── create / list ────────────────────────────────────────────────────────────


def test_create_snapshots_each_side(client, other_client, decks, combat):
    assert combat["deck_a_id"] == decks[0]
    assert combat["deck_a_name"] == "Volt"
    assert combat["player_a_pseudo"] == "Alice"
    assert combat["player_b_pseudo"] == "Bob"
    assert combat["played_at"].startswith("2026-10-01T00:00:00")
    assert combat["deck_b_snapshot"] == []
    [card] = combat["deck_a_snapshot"]
    assert card["name"] == "Pikachu"
    assert card["quantity_in_deck"] == 2
    assert card["variant_type"] == "standard"
    assert "player_a_email" not in combat
    # Shared: Bob sees it too.
    assert [c["id"] for c in other_client.get(COMBATS).json()] == [combat["id"]]


def test_snapshot_is_frozen_and_survives_the_deck(client, decks, combat, pika):
    with database.SessionLocal() as session:
        session.execute(m.DeckCard.__table__.update().values(quantity_in_deck=1))
        session.commit()
    [listed] = client.get(COMBATS).json()
    assert listed["deck_a_snapshot"][0]["quantity_in_deck"] == 2

    client.put(f"{URL}/decks/{decks[0]}", json={"name": "Volt 2"})
    assert client.get(COMBATS).json()[0]["deck_a_name"] == "Volt 2"

    assert client.delete(f"{URL}/decks/{decks[0]}").status_code == 204
    [listed] = client.get(COMBATS).json()
    assert listed["deck_a_id"] is None
    # The name it had when it was set.
    assert listed["deck_a_name"] == "Volt"
    assert listed["deck_a_snapshot"][0]["name"] == "Pikachu"


def test_snapshot_names_follow_the_viewers_language(client, decks, combat):
    with database.SessionLocal() as session:
        card = session.scalars(select(m.CardCatalog)).one()
        card.display_name = "Pikachu FR"
        card.set_name_fr = "Écarlate et Violet"
        session.commit()
    set_language(client.user_id, "fr")
    card = client.get(COMBATS).json()[0]["deck_a_snapshot"][0]
    assert (card["name"], card["set_name"]) == ("Pikachu FR", "Écarlate et Violet")
    # The stored snapshot stays English.
    exported = client.get(f"{COMBATS}/export").json()["combats"][0]
    assert exported["deck_a_snapshot"][0]["name"] == "Pikachu"


def test_list_is_newest_played_first(client, other_client, decks):
    me, bob = client.user_id, other_client.user_id
    old = log(client, *decks, me, bob, played_at="2026-01-01").json()
    new = log(client, *decks, me, bob, played_at="2026-05-01").json()
    same_day = log(client, *decks, me, bob, played_at="2026-05-01").json()
    ids = [c["id"] for c in client.get(COMBATS).json()]
    assert ids == [same_day["id"], new["id"], old["id"]]


def test_played_at_defaults_to_today_and_drops_the_time(client, other_client, decks):
    me, bob = client.user_id, other_client.user_id
    body = log(client, *decks, me, bob, played_at=None).json()
    assert body["played_at"].endswith("T00:00:00Z")
    timed = log(client, *decks, me, bob, played_at="2026-03-04T22:30:00+00:00")
    assert timed.json()["played_at"] == "2026-03-04T00:00:00Z"


def test_same_deck_twice_and_any_player(client, other_client, decks):
    me = client.user_id
    response = log(client, decks[1], decks[1], me, me)
    assert response.status_code == 201


def test_create_refusals(client, other_client, cards_client, decks):
    me, bob = client.user_id, other_client.user_id
    phantom = make_deck(me, "Wants", deck_type="phantom")
    assert log(client, phantom, decks[1], me, bob).status_code == 422
    assert log(client, 99999, decks[1], me, bob).status_code == 404
    assert log(client, *decks, me, 99999).status_code == 404
    outsider = cards_client("out@example.com", apps=("media",))
    assert log(client, *decks, me, outsider.user_id).status_code == 404
    hidden = make_deck(outsider.user_id, "Hidden")
    assert log(client, hidden, decks[1], me, bob).status_code == 404
    assert log(client, *decks, me, bob, loser_score=0).status_code == 422
    assert log(client, *decks, me, bob, loser_score=7).status_code == 422
    assert log(client, *decks, me, bob, winner="c").status_code == 422
    assert client.get(COMBATS).json() == []


# ── update / delete ──────────────────────────────────────────────────────────


def update(client, combat, **changes):
    body = {
        field: combat[field]
        for field in (
            "deck_a_id",
            "player_a_id",
            "deck_b_id",
            "player_b_id",
            "winner",
            "loser_score",
            "played_at",
        )
    }
    return client.put(f"{COMBATS}/{combat['id']}", json=body | changes)


def test_update_keeps_an_unchanged_sides_snapshot(client, other_client, combat):
    with database.SessionLocal() as session:
        session.execute(m.DeckCard.__table__.delete())
        session.commit()
    response = update(other_client, combat, winner="b", loser_score=6)
    assert response.status_code == 200
    body = response.json()
    assert (body["winner"], body["loser_score"]) == ("b", 6)
    assert body["deck_a_snapshot"][0]["quantity_in_deck"] == 2


def test_update_resnapshots_a_changed_deck(client, other_client, decks, combat):
    response = update(client, combat, deck_a_id=decks[1], deck_b_id=decks[0])
    body = response.json()
    assert (body["deck_a_name"], body["deck_b_name"]) == ("Rock", "Volt")
    assert body["deck_a_snapshot"] == []
    assert body["deck_b_snapshot"][0]["name"] == "Pikachu"


def test_update_a_side_whose_deck_was_deleted(client, other_client, decks, combat):
    client.delete(f"{URL}/decks/{decks[0]}")
    combat = client.get(COMBATS).json()[0]
    response = update(client, combat, loser_score=1)
    assert response.status_code == 200
    assert response.json()["deck_a_snapshot"][0]["name"] == "Pikachu"
    # Only a side that already has no deck may stay without one.
    assert update(client, combat, deck_b_id=None).status_code == 422


def test_update_refusals(client, combat):
    phantom = make_deck(client.user_id, "Wants", deck_type="phantom")
    assert update(client, combat, deck_a_id=phantom).status_code == 422
    assert update(client, combat, player_b_id=99999).status_code == 404
    assert client.put(f"{COMBATS}/99999", json={}).status_code == 422
    assert update(client, combat | {"id": 99999}).status_code == 404


def test_any_cards_user_can_delete_a_combat(cards_client, combat):
    carol = cards_client("carol@example.com", pseudo="Carol")
    assert carol.delete(f"{COMBATS}/{combat['id']}").status_code == 204
    assert carol.get(COMBATS).json() == []
    assert carol.delete(f"{COMBATS}/{combat['id']}").status_code == 404


def test_delete_all_removes_the_combats_the_user_played(
    client, other_client, cards_client, decks
):
    me, bob = client.user_id, other_client.user_id
    carol = cards_client("carol@example.com", pseudo="Carol")
    log(client, *decks, me, bob)
    log(client, *decks, bob, me)
    kept = log(client, *decks, bob, carol.user_id).json()
    response = client.delete(COMBATS)
    assert response.json() == {"deleted_combats": 2}
    assert [c["id"] for c in client.get(COMBATS).json()] == [kept["id"]]
    assert client.get(f"{URL}/decks/{decks[0]}").status_code == 200


def test_admin_delete_all_removes_every_combat(client, other_client, admin, decks):
    log(client, *decks, client.user_id, other_client.user_id)
    log(client, *decks, other_client.user_id, other_client.user_id)
    assert admin.delete(COMBATS).json() == {"deleted_combats": 2}
    assert client.get(COMBATS).json() == []


# ── export / import ──────────────────────────────────────────────────────────


def test_export_names_decks_and_players(client, other_client, combat):
    [entry] = other_client.get(f"{COMBATS}/export").json()["combats"]
    assert entry["deck_a_name"] == "Volt"
    assert entry["deck_a_owner_email"] == "alice@example.com"
    assert entry["player_a_email"] == "alice@example.com"
    assert entry["player_a_pseudo"] == "Alice"
    assert entry["deck_b_owner_email"] == "bob@example.com"
    assert entry["played_at"].startswith("2026-10-01T00:00:00")
    assert entry["deck_a_snapshot"][0]["quantity_in_deck"] == 2


def test_export_import_round_trip(client, other_client, decks, combat):
    exported = client.get(f"{COMBATS}/export").json()
    client.delete(COMBATS)
    response = client.post(f"{COMBATS}/import-all", json=exported)
    assert response.status_code == 201, response.text
    [imported] = response.json()
    assert imported["deck_a_id"] == decks[0]
    assert imported["deck_b_id"] == decks[1]
    assert imported["player_b_id"] == other_client.user_id
    assert imported["deck_a_snapshot"] == combat["deck_a_snapshot"]


def entry(**changes) -> dict:
    """A combat as an old `combats.json` has it."""
    return {
        "deck_a_name": "Volt",
        "deck_a_owner_email": "alice@example.com",
        "player_a_email": "alice@example.com",
        "player_a_pseudo": "Alice",
        "deck_b_name": "Rock",
        "deck_b_owner_email": "bob@example.com",
        "player_b_email": "BOB@example.com",
        "player_b_pseudo": None,
        "winner": "b",
        "loser_score": 2,
        "played_at": "2025-12-24T00:00:00",
        "deck_a_snapshot": [
            {
                "card_id": 4242,
                "variant_type": "standard",
                "quantity_in_deck": 4,
                "name": "Old Card",
                "set_name": "Old Set",
                "image_path": "old/path.jpg",
                "supertype": "Pokémon",
            }
        ],
        "deck_b_snapshot": [],
    } | changes


def test_import_an_old_file(client, other_client, decks):
    response = client.post(f"{COMBATS}/import-all", json={"combats": [entry()]})
    assert response.status_code == 201, response.text
    [combat] = response.json()
    assert combat["deck_a_id"] == decks[0]
    assert combat["player_b_id"] == other_client.user_id
    assert combat["played_at"] == "2025-12-24T00:00:00Z"
    # The file's snapshot is kept as it is.
    assert combat["deck_a_snapshot"][0]["name"] == "Old Card"


def test_import_matches_decks_by_owner(client, other_client, decks):
    bobs_volt = make_deck(other_client.user_id, "Volt")
    response = client.post(
        f"{COMBATS}/import-all",
        json={"combats": [entry(deck_a_owner_email="bob@example.com")]},
    )
    assert response.json()[0]["deck_a_id"] == bobs_volt
    # No owner email (old files): the oldest deck of that name.
    response = client.post(
        f"{COMBATS}/import-all", json={"combats": [entry(deck_a_owner_email=None)]}
    )
    assert response.json()[0]["deck_a_id"] == decks[0]


def test_import_without_a_snapshot_takes_the_decks(client, other_client, decks):
    response = client.post(
        f"{COMBATS}/import-all", json={"combats": [entry(deck_a_snapshot=None)]}
    )
    assert response.json()[0]["deck_a_snapshot"][0]["name"] == "Pikachu"


def test_import_an_unknown_deck_from_its_snapshot(client, other_client, decks):
    response = client.post(
        f"{COMBATS}/import-all", json={"combats": [entry(deck_a_name="Gone")]}
    )
    [combat] = response.json()
    assert combat["deck_a_id"] is None
    assert combat["deck_a_name"] == "Gone"


def test_import_is_all_or_nothing(client, other_client, cards_client, decks):
    # Exists, but can't use cards.
    cards_client("out@example.com", apps=("media",))
    for bad, message in (
        (entry(deck_a_name="Gone", deck_a_snapshot=None), 'unknown deck "Gone"'),
        (entry(player_b_email="nobody@example.com"), "unknown player"),
        (entry(player_b_email="out@example.com"), "unknown player"),
    ):
        response = client.post(
            f"{COMBATS}/import-all", json={"combats": [entry(), bad]}
        )
        assert response.status_code == 422
        assert message in response.json()["detail"]
        assert "Combat 2" in response.json()["detail"]
    for bad in (entry(loser_score=0), entry(winner="x"), entry(played_at="soon")):
        response = client.post(f"{COMBATS}/import-all", json={"combats": [bad]})
        assert response.status_code == 422
    assert client.post(f"{COMBATS}/import-all", json={"combats": []}).status_code == 422
    assert client.get(COMBATS).json() == []


def test_deleting_an_account_deletes_its_combats(client, other_client, combat):
    with database.SessionLocal() as session:
        session.delete(session.get(m.User, other_client.user_id))
        session.commit()
    assert client.get(COMBATS).json() == []
