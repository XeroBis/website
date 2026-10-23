"""Reading a Cardmarket order's article table, saved as HTML, for purchase
lists (see data-model.md `cards` "Rules").

Each `<tr data-article-id>` row is one article: `data-amount` copies of the
card linked in its name cell (`Gyarados ex (SVI 045)`), its extras (a
`Reverse Holo` icon) and a unit price cell (`0,20 €`). A ball reverse links to
the set's Additionals expansion, its code `x`-prefixed:
`…/Singles/Black-Bolt-Additionals/Victini-V1-xBLK012`, `Victini (xBLK 012)`.
"""

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from domains.cards import models as m
from domains.cards.decklists import additionals_print, number_key

# "Gyarados ex (SVI 045)": the set code and number Cardmarket appends.
_CODE_AND_NUMBER = re.compile(
    r"\((?P<code>[A-Za-z0-9-]+)\s+(?P<number>[A-Za-z0-9]+)\)\s*$"
)
# An Additionals product link, and its version when it has one.
_ADDITIONALS_HREF = re.compile(r"-Additionals/")
_VERSION_IN_HREF = re.compile(r"-V(?P<version>\d+)-x[A-Za-z0-9]+(?:[?#]|$)")
# The reverse icon's label: "Reverse Holo" in English, "Reverse" in French.
_REVERSE_EXTRAS = {"Reverse Holo", "Reverse"}


@dataclass
class Article:
    """One row as read; `card` and `variant_type` once matched."""

    quantity: int
    label: str
    unit_price: Decimal
    extras: list[str] = field(default_factory=list)
    href: str = ""
    card: m.CardCatalog | None = None
    variant_type: str = "standard"
    reason: str | None = None

    @property
    def matched(self) -> bool:
        return self.card is not None


class _OrderTable(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.articles: list[Article] = []
        self._row: dict | None = None
        # Where the text being read goes: "name" (the card link) or "price".
        self._capture: str | None = None
        self._extras_depth = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = (attributes.get("class") or "").split()
        if tag == "tr" and "data-article-id" in attributes:
            amount = attributes.get("data-amount") or "1"
            self._row = {
                "quantity": int(amount) if amount.isdigit() else 1,
                "name": "",
                "price": "",
                "extras": [],
                "href": "",
                "name_done": False,
            }
            return
        if self._row is None:
            return
        if self._extras_depth:
            self._extras_depth += 1
            if attributes.get("aria-label"):
                self._row["extras"].append(attributes["aria-label"].strip())
        elif tag == "span" and "extras" in classes:
            self._extras_depth = 1
        elif (
            tag == "a"
            and not self._row["name_done"]
            and "/Products/" in (attributes.get("href") or "")
        ):
            self._capture = "name"
            self._row["href"] = attributes["href"]
        elif tag == "td" and "price" in classes:
            self._capture = "price"

    def handle_endtag(self, tag):
        if self._row is None:
            return
        if self._extras_depth:
            self._extras_depth -= 1
        if tag == "a" and self._capture == "name":
            self._capture = None
            self._row["name_done"] = True
        elif tag == "td" and self._capture == "price":
            self._capture = None
        elif tag == "tr":
            row, self._row = self._row, None
            self.articles.append(
                Article(
                    quantity=row["quantity"],
                    label=" ".join(row["name"].split()),
                    unit_price=_price(row["price"]),
                    extras=row["extras"],
                    href=row["href"],
                )
            )

    def handle_data(self, data):
        if self._row is not None and self._capture:
            self._row[self._capture] += data


def _price(text: str) -> Decimal:
    """`1.234,56 €` → 1234.56; unreadable → 0."""
    digits = re.sub(r"[^\d,.]", "", text)
    if "," in digits:
        digits = digits.replace(".", "").replace(",", ".")
    try:
        return Decimal(digits or "0")
    except InvalidOperation:
        return Decimal(0)


def _catalog_key(article: Article) -> tuple[str, str] | None:
    """(lowercase set code, number key) from "Name (SVI 045)", the main
    set's code for an Additionals product ("xBLK" → "blk")."""
    found = _CODE_AND_NUMBER.search(article.label)
    if not found:
        return None
    code = found["code"].lower()
    if _ADDITIONALS_HREF.search(article.href) and code.startswith("x"):
        code = code[1:]
    return code, number_key(found["number"])


def _print(article: Article, card: m.CardCatalog) -> str | None:
    """An Additionals product's print by its version; else the reverse
    extra → `reverse`, none → `standard`."""
    if _ADDITIONALS_HREF.search(article.href):
        found = _VERSION_IN_HREF.search(article.href)
        return additionals_print(card, int(found["version"]) if found else None)
    if _REVERSE_EXTRAS.intersection(article.extras):
        return "reverse"
    return "standard"


def read(db: Session, html: str) -> list[Article]:
    """Every article row of the page, matched against the catalog by set
    code + number (padding and case ignored), with its print."""
    table = _OrderTable()
    table.feed(html)
    table.close()
    articles = table.articles
    keys = [_catalog_key(article) for article in articles]
    codes = {key[0] for key in keys if key}
    by_number: dict[tuple[str, str], m.CardCatalog] = {}
    if codes:
        for card in db.scalars(
            select(m.CardCatalog)
            .where(func.lower(m.CardCatalog.set_code).in_(codes))
            .options(selectinload(m.CardCatalog.variants))
            .order_by(m.CardCatalog.id)
        ):
            key = (card.set_code.lower(), number_key(card.card_number))
            by_number.setdefault(key, card)
    for article, key in zip(articles, keys, strict=True):
        card = by_number.get(key) if key else None
        if card is None:
            article.reason = "no catalog card"
            continue
        variant = _print(article, card)
        if variant is None:
            article.reason = "unknown Additionals print"
            continue
        if variant not in {v.variant_type for v in card.variants}:
            article.reason = f'not printed in "{variant}"'
            continue
        article.card = card
        article.variant_type = variant
    return articles


def total_price(articles: list[Article]) -> Decimal:
    """Σ quantity × unit price over every row, matched or not."""
    return sum((a.quantity * a.unit_price for a in articles), Decimal(0))
