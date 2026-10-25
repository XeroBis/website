"""Purchase lists: `/api/cards/purchase-lists`, and incoming cards in the
missing views."""

import pytest

from core import database
from domains.cards import models as m
from tests.cards.conftest import URL, add_catalog_card, own

LISTS = f"{URL}/purchase-lists"
CATALOG = f"{URL}/catalog"


def article(
    name,
    code,
    number,
    amount=1,
    price="0,10 €",
    reverse=False,
    label="Reverse Holo",
    href="/en/Pokemon/Products/Singles/X/Y",
):
    """One `<tr>` of a Cardmarket order's article table, trimmed to what's
    read. `label` is the reverse icon's, which follows the site's language;
    `href` the product link."""
    extras = (
        f'<span class="icon is-24x24"><span class="icon" aria-label="{label}"'
        f' data-bs-original-title="{label}"></span></span>'
        if reverse
        else ""
    )
    return f"""
    <tr data-article-id="1" data-product-id="2" data-amount="{amount}"
        data-name="{name} " data-number="{number}">
      <td class="select min-size"><input type="checkbox"></td>
      <td data-amount="{amount}" class="amount">{amount}<span>x</span></td>
      <td class="name text-start"><a href="{href}">{name}
          ({code} {number})</a></td>
      <td class="info">
        <div class="d-md-none"><a href="{href}">{name}
          ({code} {number})</a></div>
        <a class="expansion-symbol" aria-label="Scarlet &amp; Violet"></a>
        <span class="icon" aria-label="French"></span>
        <div class="col-extras col-auto"><span class="extras d-inline-block">{extras}</span></div>
      </td>
      <td class="text-end text-nowrap price pe-2">{price}</td>
    </tr>"""


def order(*rows) -> str:
    return (
        '<div class="category-subsection"><h3>Pokémon Singles</h3>'
        '<table class="product-table"><tbody>'
        + "".join(rows)
        + "</tbody></table></div>"
    )


ORDER = order(
    article("Pikachu", "SVI", "025", amount=2, price="0,20 €"),
    article("Raichu", "SVI", "026", reverse=True, price="1,50 €"),
    article("Pikachu", "SVI", "025", price="0,20 €"),
    article("Nobody", "SVI", "999"),
    article("Eevee", "SVI", "027", reverse=True),
)


@pytest.fixture
def pika():
    return add_catalog_card(card_number="25", name="Pikachu", display_name="Pikachu FR")


@pytest.fixture
def rai():
    return add_catalog_card(card_number="26", name="Raichu")


@pytest.fixture
def eevee():
    # No reverse print: the order's reverse Eevee can't match.
    return add_catalog_card(card_number="27", name="Eevee", variants=("standard",))


def create(client, html=ORDER, name="Order 1", price="2.40"):
    return client.post(
        f"{LISTS}/cardmarket", json={"html": html, "name": name, "price": price}
    )


@pytest.fixture
def imported(client, pika, rai, eevee):
    response = create(client)
    assert response.status_code == 201, response.text
    return response.json()


def lines(detail) -> dict[tuple[int, str], int]:
    return {
        (c["catalog_id"], c["variant_type"]): c["quantity"] for c in detail["cards"]
    }


def test_needs_the_cards_app(anon, cards_client):
    assert anon.get(LISTS).status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    assert no_access.get(LISTS).status_code == 403


def test_preview_reads_the_order_without_saving(client, pika, rai, eevee):
    response = client.post(f"{LISTS}/cardmarket/preview", json={"html": ORDER})
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["total_quantity"] == 4
    # Every row's quantity × unit price, matched or not.
    assert preview["total_price"] == "2.30"
    assert preview["set_codes"] == ["SVI"]
    first, second, _, nobody, eevee_line = preview["lines"]
    assert first["label"] == "Pikachu (SVI 025)"
    assert (first["catalog_id"], first["variant_type"], first["name"]) == (
        pika,
        "standard",
        "Pikachu FR",
    )
    assert (second["catalog_id"], second["variant_type"]) == (rai, "reverse")
    assert (nobody["matched"], nobody["reason"]) == (False, "no catalog card")
    assert (eevee_line["matched"], eevee_line["reason"]) == (
        False,
        'not printed in "reverse"',
    )
    assert client.get(LISTS).json() == []


def test_reverse_label_of_the_french_site(client, rai):
    html = order(
        article("Raichu", "SVI", "026"),
        article("Raichu", "SVI", "026", reverse=True, label="Reverse"),
    )
    preview = client.post(f"{LISTS}/cardmarket/preview", json={"html": html}).json()
    assert [line["variant_type"] for line in preview["lines"]] == [
        "standard",
        "reverse",
    ]


def test_additionals_rows_are_ball_reverses(client):
    victini = add_catalog_card(
        set_code="BLK",
        card_number="12",
        name="Victini",
        variants=("standard", "reverse", "reverse_pokeball", "reverse_masterball"),
    )
    magcargo = add_catalog_card(
        set_code="ASC",
        card_number="24",
        name="Ethan's Magcargo",
        variants=("standard", "reverse", "reverse_pokeball"),
    )
    poffin = add_catalog_card(
        set_code="PRE",
        card_number="101",
        name="Buddy-Buddy Poffin",
        variants=("standard", "reverse", "reverse_pokeball"),
    )
    training = add_catalog_card(
        set_code="PRE",
        card_number="98",
        name="Black Belt's Training",
        variants=("standard", "reverse", "reverse_pokeball"),
    )
    singles = "/fr/Pokemon/Products/Singles"

    def additional(name, code, number, slug):
        return article(
            name,
            f"x{code}",
            number,
            reverse=True,
            label="Reverse",
            href=f"{singles}/{slug}-x{code}{number}?sellerCountry=12&amp;language=2",
        )

    html = order(
        additional("Victini", "BLK", "012", "Black-Bolt-Additionals/Victini-V1"),
        additional("Victini", "BLK", "012", "Black-Bolt-Additionals/Victini-V2"),
        # Ascended Heroes: V1 the plain reverse, V2 the card's one ball.
        additional(
            "Magcargo", "ASC", "024", "Ascended-Heroes-Additionals/Ethans-Magcargo-V1"
        ),
        additional(
            "Magcargo", "ASC", "024", "Ascended-Heroes-Additionals/Ethans-Magcargo-V2"
        ),
        # No version: a trainer's only ball, the Poké Ball.
        additional(
            "Poffin",
            "PRE",
            "101",
            "Prismatic-Evolutions-Additionals/Buddy-Buddy-Poffin",
        ),
        # Versioned by artwork: the version names the card, not the ball.
        additional(
            "Training",
            "PRE",
            "098",
            "Prismatic-Evolutions-Additionals/Black-Belts-Training-V3",
        ),
    )
    preview = client.post(f"{LISTS}/cardmarket/preview", json={"html": html}).json()
    assert [
        (line["catalog_id"], line["variant_type"]) for line in preview["lines"]
    ] == [
        (victini, "reverse_pokeball"),
        (victini, "reverse_masterball"),
        (magcargo, "reverse"),
        (magcargo, "reverse_pokeball"),
        (poffin, "reverse_pokeball"),
        (training, "reverse_pokeball"),
    ]
    assert preview["set_codes"] == ["ASC", "BLK", "PRE"]


def test_import_creates_the_list(client, imported, pika, rai):
    detail = imported["purchase_list"]
    assert detail["name"] == "Order 1"
    assert detail["received_at"] is None
    # Repeated lines add up.
    assert lines(detail) == {(pika, "standard"): 3, (rai, "reverse"): 1}
    assert (detail["total_cards"], detail["total_quantity"]) == (2, 4)
    assert detail["price"] == "2.40"
    assert {c["rarity"] for c in detail["cards"]} == {"Common"}
    assert [u["label"] for u in imported["unmatched"]] == [
        "Nobody (SVI 999)",
        "Eevee (SVI 027)",
    ]
    # No What I Paid entry.
    assert client.get(f"{URL}/purchases").json() == []


def test_import_refusals(client, imported):
    assert create(client).status_code == 409
    assert create(client, name=" ").status_code == 422
    assert create(client, name="Other", html="<p>nothing</p>").status_code == 422
    unmatched = order(article("Nobody", "SVI", "999"))
    assert create(client, name="Other", html=unmatched).status_code == 422
    assert create(client, name="Other", price="-1").status_code == 422
    # Nothing written by a refusal.
    assert len(client.get(LISTS).json()) == 1


def test_create_an_empty_list(client, pika):
    response = client.post(LISTS, json={"name": " Shop "})
    assert response.status_code == 201, response.text
    detail = response.json()
    assert (detail["name"], detail["cards"], detail["price"]) == (
        "Shop",
        [],
        None,
    )
    assert client.get(f"{URL}/purchases").json() == []
    # Filled by hand.
    added = client.post(
        f"{LISTS}/{detail['id']}/cards", json={"catalog_id": pika, "quantity": 2}
    )
    assert added.status_code == 201, added.text
    assert lines(added.json()) == {(pika, "standard"): 2}


def test_create_with_a_price(client):
    response = client.post(LISTS, json={"name": "Store", "price": "12.50"})
    assert response.status_code == 201, response.text
    assert response.json()["price"] == "12.50"
    # No What I Paid entry.
    assert client.get(f"{URL}/purchases").json() == []


def test_create_refusals(client, imported):
    assert client.post(LISTS, json={"name": "Order 1"}).status_code == 409
    assert client.post(LISTS, json={"name": " "}).status_code == 422
    assert client.post(LISTS, json={"name": "X", "price": "-1"}).status_code == 422
    assert len(client.get(LISTS).json()) == 1


def test_lists_are_private(client, other_client, imported):
    list_id = imported["purchase_list"]["id"]
    assert other_client.get(LISTS).json() == []
    assert other_client.get(f"{LISTS}/{list_id}").status_code == 404
    assert other_client.get(f"{LISTS}/incoming").json() == []
    assert other_client.post(f"{LISTS}/{list_id}/receive").status_code == 404
    assert other_client.delete(f"{LISTS}/{list_id}").status_code == 404


def test_edit_lines_before_receiving(client, imported, pika, rai, eevee):
    list_id = imported["purchase_list"]["id"]
    rows = {c["catalog_id"]: c["id"] for c in imported["purchase_list"]["cards"]}

    changed = client.put(
        f"{LISTS}/{list_id}/cards/{rows[pika]}",
        json={"variant_type": "standard", "quantity": 2},
    )
    assert changed.status_code == 200, changed.text
    assert lines(changed.json())[(pika, "standard")] == 2

    # Another print of the card: the line moves (or merges into that print's).
    moved = client.put(
        f"{LISTS}/{list_id}/cards/{rows[rai]}",
        json={"variant_type": "standard", "quantity": 1},
    ).json()
    assert lines(moved) == {(pika, "standard"): 2, (rai, "standard"): 1}
    added = client.post(
        f"{LISTS}/{list_id}/cards", json={"catalog_id": rai, "variant_type": "reverse"}
    )
    assert added.status_code == 201
    merged = client.put(
        f"{LISTS}/{list_id}/cards/{rows[rai]}",
        json={"variant_type": "reverse", "quantity": 2},
    ).json()
    assert lines(merged) == {(pika, "standard"): 2, (rai, "reverse"): 3}

    # By hand: onto an existing line, or a new one.
    more = client.post(f"{LISTS}/{list_id}/cards", json={"catalog_id": pika}).json()
    assert lines(more)[(pika, "standard")] == 3
    assert (
        client.post(
            f"{LISTS}/{list_id}/cards",
            json={"catalog_id": eevee, "variant_type": "reverse"},
        ).status_code
        == 422
    )
    assert (
        client.post(f"{LISTS}/{list_id}/cards", json={"catalog_id": 999999}).status_code
        == 404
    )
    assert (
        client.put(
            f"{LISTS}/{list_id}/cards/{rows[pika]}",
            json={"variant_type": "standard", "quantity": 0},
        ).status_code
        == 422
    )

    pika_row = next(c["id"] for c in more["cards"] if c["catalog_id"] == pika)
    assert client.delete(f"{LISTS}/{list_id}/cards/{pika_row}").status_code == 204
    detail = client.get(f"{LISTS}/{list_id}").json()
    assert lines(detail) == {(rai, "reverse"): 3}
    # The price isn't touched by edits.
    assert detail["price"] == "2.40"


def test_receive_adds_to_the_collection_and_closes(client, imported, pika, rai):
    own(client.user_id, pika, standard=1)
    list_id = imported["purchase_list"]["id"]
    received = client.post(f"{LISTS}/{list_id}/receive")
    assert received.status_code == 200, received.text
    assert received.json()["received_at"] is not None

    owned = {c["catalog_id"]: c for c in client.get(f"{URL}/collection").json()}
    assert owned[pika]["quantity"] == 4
    assert {v["variant_type"]: v["quantity"] for v in owned[rai]["variants"]} == {
        "reverse": 1
    }
    with database.SessionLocal() as session:
        sources = {row.source for row in session.query(m.CollectionHistory)}
    assert sources == {"purchase"}
    assert client.get(f"{URL}/purchases").json() == []

    # Read-only once received.
    assert client.post(f"{LISTS}/{list_id}/receive").status_code == 409
    assert (
        client.post(f"{LISTS}/{list_id}/cards", json={"catalog_id": pika}).status_code
        == 409
    )
    row_id = received.json()["cards"][0]["id"]
    assert client.delete(f"{LISTS}/{list_id}/cards/{row_id}").status_code == 409
    assert client.get(f"{LISTS}/incoming").json() == []


def test_rename_delete_and_listing_order(client, imported, pika):
    first = imported["purchase_list"]["id"]
    second = create(client, name="Order 2").json()["purchase_list"]["id"]
    assert client.put(f"{LISTS}/{first}", json={"name": "Order 2"}).status_code == 409
    renamed = client.put(f"{LISTS}/{first}", json={"name": " First "}).json()
    assert renamed["name"] == "First"

    client.post(f"{LISTS}/{second}/receive")
    third = create(client, name="Order 3").json()["purchase_list"]["id"]
    # Incoming first, then received, each newest first.
    assert [row["id"] for row in client.get(LISTS).json()] == [third, first, second]

    assert client.delete(f"{LISTS}/{first}").status_code == 204
    assert [row["id"] for row in client.get(LISTS).json()] == [third, second]


def test_incoming_per_print(client, imported, pika, rai):
    other_set = add_catalog_card(set_code="PAL", card_number="1", name="Sprigatito")
    list_id = imported["purchase_list"]["id"]
    client.post(f"{LISTS}/{list_id}/cards", json={"catalog_id": other_set})
    create(client, name="Order 2")
    incoming = client.get(f"{LISTS}/incoming", params={"set_code": "SVI"}).json()
    assert incoming == [
        {"catalog_id": pika, "variant_type": "standard", "quantity": 6},
        {"catalog_id": rai, "variant_type": "reverse", "quantity": 2},
    ]
    assert len(client.get(f"{LISTS}/incoming").json()) == 3


def test_missing_views_count_incoming_cards(client, imported, pika, rai, eevee):
    def text(**params):
        response = client.post(
            f"{CATALOG}/sets/missing/text", params=params, json={"set_codes": ["SVI"]}
        )
        assert response.status_code == 200
        return response.text

    def summary(**params):
        rows = client.get(f"{CATALOG}/sets/missing/summary", params=params).json()
        return {row["set_code"]: row["missing"] for row in rows}.get("SVI", 0)

    def numbers(**params):
        rows = client.get(f"{CATALOG}/missing-intervals", params=params).json()
        return {row["set_code"]: row["missing_numbers"] for row in rows}["SVI"]

    assert "Pikachu" not in text() and "Eevee" in text()
    assert "Pikachu" in text(include_incoming=False)
    assert summary(include_incoming=False) == summary() + 1
    assert numbers() == [27]
    assert numbers(include_incoming=False) == [25, 26, 27]
    # By print: the reverse Raichu is incoming, the reverse Pikachu isn't.
    assert numbers(variant_type="reverse") == [25]
    assert "Raichu" not in text(variant_type="reverse")
    assert "Pikachu" in text(variant_type="reverse")

    client.post(f"{LISTS}/{imported['purchase_list']['id']}/receive")
    # Received: owned now, no longer incoming.
    assert numbers(include_incoming=False) == [27]
