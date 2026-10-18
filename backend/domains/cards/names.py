"""Card name normalization, shared by the catalog search and the HTML import,
and Basic Energy recognition for the deck limits.

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


# ── Basic Energy ─────────────────────────────────────────────────────────────

# Some prints title a basic Energy "Basic <letter> Energy" (or "Basic
# <element> Energy"); the import stores the generic "<Element> Energy".
BASIC_ENERGY_LETTER_TO_NAME = {
    "G": "Grass Energy",
    "R": "Fire Energy",
    "W": "Water Energy",
    "L": "Lightning Energy",
    "P": "Psychic Energy",
    "F": "Fighting Energy",
    "D": "Darkness Energy",
    "M": "Metal Energy",
    "Y": "Fairy Energy",
}
BASIC_ENERGY_NAMES = set(BASIC_ENERGY_LETTER_TO_NAME.values())
_BASIC_ENERGY_WORD_TO_NAME = {
    name.removesuffix(" Energy"): name for name in BASIC_ENERGY_NAMES
}
# Dated prints of the `Energies` set keep their year and number in storage
# ("Water Energy (2022) /104") but are still Basic Energy.
_DATED_BASIC_ENERGY = re.compile(r"^(?P<name>.+ Energy) \(20\d{2}\)(?: /\d+)?$")


def canonical_energy_name(name: str) -> str:
    """`Basic <letter|element> Energy` and dated basic prints as the generic
    `<Element> Energy`; any other name unchanged."""
    dated = _DATED_BASIC_ENERGY.fullmatch(name)
    if dated and dated.group("name") in BASIC_ENERGY_NAMES:
        return dated.group("name")
    parts = name.split()
    if len(parts) == 3 and parts[0] == "Basic" and parts[2] == "Energy":
        return BASIC_ENERGY_LETTER_TO_NAME.get(
            parts[1], _BASIC_ENERGY_WORD_TO_NAME.get(parts[1], name)
        )
    return name


def is_basic_energy(name: str) -> bool:
    """Exempt from the 4-copies-per-deck limit."""
    return canonical_energy_name(name) in BASIC_ENERGY_NAMES
