"""Card name normalization, shared by the catalog search and the HTML import.

`card_catalog.name` keeps its real punctuation and gender symbols
("Lillie's Determination", "Nidoran♀"). `to_catalog_style` turns a typed
term into the same plain style the search compares against (gender symbols
spelled out, `’ ' . :` removed); search.py strips the same characters on the
SQL side.
"""

import re
import unicodedata

GENDER_SYMBOLS = {"♀": " Female", "♂": " Male"}
PUNCTUATION_TO_STRIP = "’'.:"
_PUNCTUATION = re.compile(f"[{re.escape(PUNCTUATION_TO_STRIP)}]")


def to_catalog_style(name: str) -> str:
    for symbol, word in GENDER_SYMBOLS.items():
        name = name.replace(symbol, word)
    name = _PUNCTUATION.sub("", name)
    return re.sub(r"\s+", " ", name).strip()


def normalize(text: str) -> str:
    """Catalog style, lowercased, without accents."""
    stripped = unicodedata.normalize("NFKD", to_catalog_style(text))
    return "".join(c for c in stripped if not unicodedata.combining(c)).lower()


def slugify(name: str) -> str:
    """Filesystem-safe slug for image filenames ("Mr. Mime" -> "mr_mime",
    "Nidoran♀" -> "nidoran_female")."""
    return re.sub(r"[^a-z0-9]+", "_", normalize(name)).strip("_") or "card"
