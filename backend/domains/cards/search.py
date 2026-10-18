"""Name matching and sorting shared by the catalog browse and the collection
search, so a card matches and sorts the same way in both."""

from sqlalchemy import ColumnElement, Integer, asc, case, cast, desc, func, or_

from domains.cards.models import CardCatalog
from domains.cards.names import PUNCTUATION_TO_STRIP, to_catalog_style

SORT_OPTIONS = (
    "name_asc",
    "name_desc",
    "card_number_asc",
    "card_number_desc",
    "set_release_asc",
    "set_release_desc",
    "set_name_asc",
    "set_name_desc",
)


def numeric_card_number():
    """`card_number` as an integer when it is all digits, else NULL, so "10"
    sorts after "2" and "TG01"/promos sort last."""
    return case(
        (
            CardCatalog.card_number.op("~")(r"^\d+$"),
            cast(CardCatalog.card_number, Integer),
        ),
        else_=None,
    )


def stripped(column):
    """`column` without the punctuation to_catalog_style() strips."""
    for char in PUNCTUATION_TO_STRIP:
        column = func.replace(column, char, "")
    return column


def name_filter(search: str) -> ColumnElement[bool]:
    """Partial, case-insensitive, punctuation-insensitive match on the
    English or French name. A leading `^` anchors to the start, a trailing
    `$` to the end (both: exact)."""
    starts = search.startswith("^")
    ends = search.endswith("$")
    term = search[1 if starts else 0 : -1 if ends else None]
    pattern = ("" if starts else "%") + to_catalog_style(term) + ("" if ends else "%")
    return or_(
        stripped(CardCatalog.name).ilike(pattern),
        stripped(CardCatalog.display_name).ilike(pattern),
    )


def card_filters(
    search: str | None = None,
    set_code: str | None = None,
    set_name: str | None = None,
    supertype: list[str] | None = None,
    rarity: list[str] | None = None,
    card_number: str | None = None,
) -> list[ColumnElement[bool]]:
    """WHERE conditions on the catalog card shared by the catalog browse and
    the collection search: `set_name` and `card_number` partial, the lists
    OR within a filter, everything AND across."""
    conditions = []
    if search:
        conditions.append(name_filter(search))
    if set_code:
        conditions.append(CardCatalog.set_code == set_code)
    if set_name:
        conditions.append(CardCatalog.set_name.ilike(f"%{set_name}%"))
    if supertype:
        conditions.append(CardCatalog.supertype.in_(supertype))
    if rarity:
        conditions.append(CardCatalog.rarity.in_(rarity))
    if card_number:
        conditions.append(CardCatalog.card_number.ilike(f"%{card_number}%"))
    return conditions


def name_column(language: str | None):
    """The displayed name, which name sorts follow."""
    return CardCatalog.display_name if language == "fr" else CardCatalog.name


def order_by(sort: str, name) -> list:
    """ORDER BY for one of SORT_OPTIONS (unknown → name A-Z). Ties: card
    number, then name, then the catalog id (so pages never overlap). A set
    without release date sorts as the oldest."""
    return [*_order_by(sort, name), asc(CardCatalog.id)]


def _order_by(sort: str, name) -> list:
    number = numeric_card_number()
    by_number = [number.nulls_last(), asc(CardCatalog.card_number), asc(name)]
    match sort:
        case "name_desc":
            return [desc(name)]
        case "card_number_asc":
            return by_number
        case "card_number_desc":
            return [
                number.desc().nulls_last(),
                desc(CardCatalog.card_number),
                asc(name),
            ]
        case "set_release_asc":
            return [
                asc(CardCatalog.release_date).nulls_first(),
                asc(CardCatalog.set_name),
                *by_number,
            ]
        case "set_release_desc":
            return [
                desc(CardCatalog.release_date).nulls_last(),
                asc(CardCatalog.set_name),
                *by_number,
            ]
        case "set_name_asc":
            return [asc(CardCatalog.set_name), *by_number]
        case "set_name_desc":
            return [desc(CardCatalog.set_name), *by_number]
    return [asc(name)]
