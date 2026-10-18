"""Shopping lists: `/api/cards/shopping-lists`."""

import pytest

from tests.cards.conftest import URL, add_catalog_card, own, set_language

LISTS = f"{URL}/shopping-lists"


@pytest.fixture
def pika():
    return add_catalog_card(card_number="25", name="Pikachu", display_name="Pikachu FR")


@pytest.fixture
def rai():
    return add_catalog_card(card_number="26", name="Raichu")


def create(client, name="Round 1", text="2 Pikachu SVI 25\n1 Nobody SVI 999"):
    return client.post(LISTS, json={"name": name, "decklist_text": text})


@pytest.fixture
def shopping(client, pika, rai):
    response = create(client)
    assert response.status_code == 201, response.text
    return response.json()


def test_needs_the_cards_app(anon, cards_client):
    assert anon.get(LISTS).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    assert no_access.get(LISTS).status_code == 403


def test_create_from_a_decklist_drops_unmatched_lines(shopping, pika):
    assert (shopping["lines_added"], shopping["lines_skipped"]) == (1, 1)
    detail = shopping["shopping_list"]
    assert detail["name"] == "Round 1"
    [card] = detail["cards"]
    assert card["catalog_id"] == pika
    # Users are French by default.
    assert (card["name"], card["name_en"], card["name_fr"]) == (
        "Pikachu FR",
        "Pikachu",
        "Pikachu FR",
    )
    assert (card["quantity_needed"], card["quantity_owned"]) == (2, 0)
    assert (
        detail["total_cards"],
        detail["total_quantity_needed"],
        detail["fully_got_cards"],
    ) == (1, 2, 0)


def test_create_empty_and_refusals(client, shopping):
    empty = client.post(LISTS, json={"name": " Empty "})
    assert empty.status_code == 201
    assert empty.json()["shopping_list"]["name"] == "Empty"
    assert empty.json()["shopping_list"]["cards"] == []
    assert create(client).status_code == 409
    assert client.post(LISTS, json={"name": "  "}).status_code == 422
    assert create(client, "New", "1 Nobody SVI 999").status_code == 422
    assert [x["name"] for x in client.get(LISTS).json()] == ["Empty", "Round 1"]


def test_names_follow_the_viewers_language(client, shopping):
    set_language(client.user_id, "en")
    [card] = client.get(f"{LISTS}/{shopping['shopping_list']['id']}").json()["cards"]
    assert card["name"] == "Pikachu"
    assert card["name_fr"] == "Pikachu FR"


def test_list_is_private_with_totals(client, other_client, shopping):
    list_id = shopping["shopping_list"]["id"]
    assert other_client.get(LISTS).json() == []
    for request in (
        other_client.get(f"{LISTS}/{list_id}"),
        other_client.put(f"{LISTS}/{list_id}", json={"name": "Mine"}),
        other_client.delete(f"{LISTS}/{list_id}"),
        other_client.post(
            f"{LISTS}/{list_id}/paste", json={"decklist_text": "1 Raichu SVI 26"}
        ),
    ):
        assert request.status_code == 404
    [summary] = client.get(LISTS).json()
    assert summary["total_cards"] == 1
    assert summary["total_quantity_needed"] == 2
    assert "cards" not in summary


def test_paste_merges_and_never_lowers(client, shopping, pika, rai):
    list_id = shopping["shopping_list"]["id"]
    card_id = shopping["shopping_list"]["cards"][0]["id"]
    client.put(f"{LISTS}/{list_id}/cards/{card_id}", json={"quantity_owned": 2})
    response = client.post(
        f"{LISTS}/{list_id}/paste",
        json={"decklist_text": "1 Pikachu SVI 25\n3 Raichu SVI 26\n1 Raichu SVI 26"},
    )
    assert response.status_code == 200
    assert (response.json()["lines_added"], response.json()["lines_skipped"]) == (2, 0)
    cards = {c["catalog_id"]: c for c in response.json()["shopping_list"]["cards"]}
    assert (cards[pika]["quantity_needed"], cards[pika]["quantity_owned"]) == (3, 2)
    assert (cards[rai]["quantity_needed"], cards[rai]["quantity_owned"]) == (4, 0)
    nothing = client.post(f"{LISTS}/{list_id}/paste", json={"decklist_text": "hello"})
    assert nothing.status_code == 422


def test_owned_tally_stays_in_range(client, other_client, shopping):
    list_id = shopping["shopping_list"]["id"]
    card_id = shopping["shopping_list"]["cards"][0]["id"]
    url = f"{LISTS}/{list_id}/cards/{card_id}"
    before = client.get(f"{LISTS}/{list_id}").json()["updated_at"]
    response = client.put(url, json={"quantity_owned": 2})
    assert response.status_code == 200
    assert response.json()["quantity_owned"] == 2
    detail = client.get(f"{LISTS}/{list_id}").json()
    assert detail["fully_got_cards"] == 1
    assert detail["updated_at"] > before
    assert client.put(url, json={"quantity_owned": 3}).status_code == 422
    assert client.put(url, json={"quantity_owned": -1}).status_code == 422
    assert other_client.put(url, json={"quantity_owned": 1}).status_code == 404
    assert (
        client.put(
            f"{LISTS}/{list_id}/cards/99999", json={"quantity_owned": 1}
        ).status_code
        == 404
    )


def test_not_linked_to_the_collection(client, shopping, pika):
    own(client.user_id, pika, standard=4)
    list_id = shopping["shopping_list"]["id"]
    [card] = client.get(f"{LISTS}/{list_id}").json()["cards"]
    assert card["quantity_owned"] == 0


def test_rename_remove_card_and_delete(client, shopping):
    list_id = shopping["shopping_list"]["id"]
    client.post(LISTS, json={"name": "Other"})
    assert client.put(f"{LISTS}/{list_id}", json={"name": "Other"}).status_code == 409
    assert client.put(f"{LISTS}/{list_id}", json={"name": ""}).status_code == 422
    renamed = client.put(f"{LISTS}/{list_id}", json={"name": " Round 2 "})
    assert renamed.json()["name"] == "Round 2"
    assert client.put(f"{LISTS}/{list_id}", json={"name": "Round 2"}).status_code == 200

    card_id = shopping["shopping_list"]["cards"][0]["id"]
    assert client.delete(f"{LISTS}/{list_id}/cards/{card_id}").status_code == 204
    assert client.get(f"{LISTS}/{list_id}").json()["cards"] == []
    assert client.delete(f"{LISTS}/{list_id}/cards/{card_id}").status_code == 404

    assert client.delete(f"{LISTS}/{list_id}").status_code == 204
    assert client.get(f"{LISTS}/{list_id}").status_code == 404
