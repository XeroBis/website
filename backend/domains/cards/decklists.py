"""Pasted decklists: format detection, matching each line against the
catalog, and rendering cards back out as text. Shared by the converter, deck
creation/paste, upgrade drafts and every text export.

TCGplayer/PTCGL (also Pokémon TCG Live and Limitless): cards under
`Pokémon`/`Trainer`/`Energy` headers, one per line as
`<qty> <name> <SET_CODE> <number>` (`4 Charizard ex SVI 125`), matched by set
code and number.

Cardmarket: a flat list of `<qty>x <name> [Ability | Attack] (<expansion>)`.
No number, so matched by name, then narrowed by set code or expansion title,
then by the bracketed move names. Candidates still tied (a bare
`<qty>x <name>`, same-set reprints) resolve to the most recently released
print, lowest number first, rather than staying unmatched.

Rendering always uses English move names and set titles (Cardmarket's
product titles); only the card name may be French.
"""

import re
from collections import Counter
from dataclasses import dataclass
from datetime import date
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from domains.cards import models as m
from domains.cards.names import GENDER_SYMBOLS, canonical_energy_name, to_catalog_style
from domains.cards.search import stripped

Format = Literal["tcgplayer", "cardmarket"]

# qty, name, a 2–8 character set code, then a number (promo numbers like
# "SWSH001" or "TG01" included).
_TCGPLAYER_LINE = re.compile(
    r"^(?P<qty>\d+)\s+(?P<name>.+?)\s+(?P<set_code>[A-Za-z0-9]{2,8})\s+(?P<number>[A-Za-z0-9]+)$"
)
_TCGPLAYER_SECTION = re.compile(
    r"^#{0,2}\s*(Pok[eé]mon|Trainer(?:\s+Cards)?|Energy)\b", re.IGNORECASE
)
# qty + "x", then the name, optionally "[Ability, Attack, ...]", optionally
# "(Expansion)" (Cardmarket's importer needs the expansion in parentheses).
_CARDMARKET_LINE = re.compile(r"^(?P<qty>\d+)\s*[xX]\s+(?P<rest>.+)$")
_CARDMARKET_PAREN = re.compile(
    r"^(?P<name>.+?)\s*(?:\[(?P<moves>[^\]]+)\]\s*)?\((?P<set_name>[^)]+)\)\s*$"
)
_CARDMARKET_BRACKET = re.compile(r"^(?P<name>.+?)\s*\[(?P<moves>[^\]]+)\]\s*$")
_SET_CODE_SUFFIX = re.compile(r"\s*\([A-Za-z0-9]+\)\s*$")

# Verified Cardmarket product qualifiers for otherwise colliding 30C prints:
# number → (the card's English moves, what Cardmarket's bracket says). The
# expected moves guard against applying a qualifier to different data.
_CARDMARKET_30C_IDENTIFIERS = {
    "10": (("Flame Tail",), ("Flame Tail", "30")),
    "20": (("Wormhole",), ("Wormhole", "30")),
    "23": (("Thunder Shock",), ("Thunder Shock", "30")),
    "24": (("Volt Tackle",), ("Volt Tackle", "30")),
    "25": (("Spark",), ("Spark", "30")),
    "39": (("Iron Tail",), ("Iron Tail", "30")),
    "62": (("Mach Bolt", "Electro Drift"), ("Mach Bolt", "Mach Bolt")),
    "65": (("Psychic",), ("Psychic", "30C")),
    "78": (("Splash",), ("Splash", "30")),
    "79": (("Stiffen",), ("Stiffen", "30")),
    "89": (("Pay Day",), ("Pay Day",)),
    "113": (("Pay Day",), ("Pay Day", "30")),
    "121": (("Elemental Blast",), ("Elemental Blast", "30")),
}
# Cardmarket product names that differ from the printed English name.
_CARDMARKET_NAME_OVERRIDES = {
    "CRI": {
        "Magnetic Metal Energy": "Magnetic [M] Energy",
        "Nitro Fire Energy": "Nitro [R] Energy",
        "Bubbly Water Energy": "Bubbly [W] Energy",
    },
    "POR": {
        "Telepathic Psychic Energy": "Telepathic [P] Energy",
        "Growing Grass Energy": "Growing [G] Energy",
    },
    "PBL": {
        "Shadowy Darkness Energy": "Shadowy D Energy",
        "Voltaic Lightning Energy": "Voltaic L Energy",
    },
}
# Cardmarket move names that differ from TCGdex's.
_CARDMARKET_MOVE_OVERRIDES = {
    "PBL": {("Bone Sniper", "Blasting Wind"): ("Bone Snipe", "Blasting Wind")},
    "PFL": {
        ("Low Kick", "Jumping Shot"): ("Low Kick", "Jump Shot"),
        ("Voltaic Fist",): ("Voltage Fist",),
    },
    "BLK": {("Wild Lances",): ("Wild Lance",)},
    "PAF": {("Slow-Acting Syncope", "Mach Cross"): ("Slow-Acting Hold", "Mach Cross")},
    "PAR": {
        ("Powerful Cross", "Waterfall"): ("Power Cross", "Waterfall"),
        ("Exoskeleton", "Spinning Needles"): ("Exoskeleton", "Spinning Needle"),
        ("Crushing Blow", "Alloyed Hammer"): ("Knock Off", "Wild Press"),
    },
    "OBF": {("Headbang", "Crunch"): ("Headbutt", "Crunch")},
}


@dataclass
class Entry:
    """One decklist line: `card` is the matched catalog card (None when
    unmatched), `name` what gets rendered (the parsed name when unmatched)."""

    quantity: int
    name: str
    card: m.CardCatalog | None = None


def entry(card: m.CardCatalog, quantity: int, language: str = "en") -> Entry:
    """A matched line, named in `language` (moves and sets stay English)."""
    name = card.display_name if language == "fr" and card.display_name else card.name
    return Entry(quantity, name, card)


# ── moves ────────────────────────────────────────────────────────────────────


def move_names(card: m.CardCatalog) -> list[str]:
    """English abilities, then attacks, in their stored order."""
    details = (card.details or {}).get("en") or {}
    return [
        move["name"].strip()
        for kind in ("abilities", "attacks")
        for move in details.get(kind) or []
        if isinstance(move, dict)
        and isinstance(move.get("name"), str)
        and move["name"].strip()
    ]


def number_key(card_number: str) -> str:
    """Catalog numbers are often zero-padded ("016") but pasted ones aren't:
    compare numeric numbers as integers, others case-insensitively."""
    stripped_number = card_number.strip()
    return (
        str(int(stripped_number))
        if stripped_number.isdigit()
        else stripped_number.upper()
    )


def cardmarket_identifiers(
    set_code: str | None, card_number: str | None, moves: list[str]
) -> list[str]:
    """What Cardmarket puts in the bracket for these moves."""
    replacement = _CARDMARKET_MOVE_OVERRIDES.get(set_code or "", {}).get(tuple(moves))
    if replacement:
        return list(replacement)
    if set_code == "30C":
        rule = _CARDMARKET_30C_IDENTIFIERS.get(number_key(card_number or ""))
        if rule and tuple(moves) == rule[0]:
            return list(rule[1])
    return moves


# ── parsing ──────────────────────────────────────────────────────────────────


def _clean_lines(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = raw.strip().lstrip("*").strip()
        if not line or line.lower().startswith("total"):
            continue
        lines.append(line)
    return lines


def detect_format(text: str) -> Format | None:
    """Whichever format more lines look like; None when no line does."""
    tcgplayer = cardmarket = 0
    for line in _clean_lines(text):
        if _TCGPLAYER_SECTION.match(line):
            continue
        if _CARDMARKET_LINE.match(line):
            cardmarket += 1
        elif _TCGPLAYER_LINE.match(line):
            tcgplayer += 1
    if not tcgplayer and not cardmarket:
        return None
    return "cardmarket" if cardmarket > tcgplayer else "tcgplayer"


def parse(db: Session, text: str) -> tuple[Format | None, list[Entry]]:
    """The detected format and every parsed line, matched or not."""
    detected = detect_format(text or "")
    if detected == "tcgplayer":
        return detected, _parse_tcgplayer(db, text)
    if detected == "cardmarket":
        return detected, _parse_cardmarket(db, text)
    return None, []


def matched_cards(db: Session, text: str) -> dict[int, tuple[m.CardCatalog, int]]:
    """catalog id → (card, total quantity) over the matched lines of a pasted
    decklist; unmatched lines are dropped, repeats add up."""
    return tally(parse(db, text)[1])


def tally(lines: list[Entry]) -> dict[int, tuple[m.CardCatalog, int]]:
    """matched_cards() over already parsed lines."""
    totals: dict[int, tuple[m.CardCatalog, int]] = {}
    for line in lines:
        if line.card is not None:
            previous = totals.get(line.card.id, (line.card, 0))[1]
            totals[line.card.id] = (line.card, previous + line.quantity)
    return totals


def _parse_tcgplayer(db: Session, text: str) -> list[Entry]:
    parsed = []
    for line in _clean_lines(text):
        if _TCGPLAYER_SECTION.match(line):
            continue
        match = _TCGPLAYER_LINE.match(line)
        if match:
            parsed.append(match)
    # One query for every set named; repeated numbers keep the lowest id.
    codes = {match["set_code"].lower() for match in parsed}
    by_number: dict[tuple[str, str], m.CardCatalog] = {}
    if codes:
        for card in db.scalars(
            select(m.CardCatalog)
            .where(func.lower(m.CardCatalog.set_code).in_(codes))
            .order_by(m.CardCatalog.id)
        ):
            key = (card.set_code.lower(), number_key(card.card_number))
            by_number.setdefault(key, card)
    entries = []
    for match in parsed:
        card = by_number.get((match["set_code"].lower(), number_key(match["number"])))
        quantity = int(match["qty"])
        entries.append(
            Entry(quantity, card.name, card)
            if card
            else Entry(quantity, match["name"].strip())
        )
    return entries


def _parse_cardmarket(db: Session, text: str) -> list[Entry]:
    entries = []
    for line in _clean_lines(text):
        match = _CARDMARKET_LINE.match(line)
        if not match:
            continue
        quantity = int(match["qty"])
        rest = match["rest"].strip()
        card = _resolve_cardmarket(db, rest)
        entries.append(
            Entry(quantity, card.name, card) if card else Entry(quantity, rest)
        )
    return entries


def _bracket_names(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    return [name.strip() for name in re.split(r"[,|]", raw) if name.strip()]


def _resolve_cardmarket(db: Session, rest: str) -> m.CardCatalog | None:
    """`Name [moves] (Expansion)` first; then a bracket without expansion;
    then the whole line as a bare name (a name ending in "ex"/"V" would
    otherwise lose that word to the expansion split below); then older
    un-parenthesized `Name Expansion` lines, longest name first."""
    paren = _CARDMARKET_PAREN.match(rest)
    if paren:
        card = _match_by_name(
            db,
            paren["name"].strip(),
            paren["set_name"].strip(),
            _bracket_names(paren["moves"]),
        )
        if card:
            return card
    bracket = _CARDMARKET_BRACKET.match(rest)
    if bracket:
        return _match_by_name(
            db, bracket["name"].strip(), "", _bracket_names(bracket["moves"])
        )
    card = _match_by_name(db, rest, "")
    if card:
        return card
    words = rest.split()
    for split_at in range(len(words) - 1, 0, -1):
        card = _match_by_name(
            db, " ".join(words[:split_at]), " ".join(words[split_at:])
        )
        if card:
            return card
    return None


def _matchable(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _stripped_name():
    """`card_catalog.name` without the punctuation to_catalog_style() strips
    and with gender symbols spelled out, so "Mr Mime" or "Nidoran [F]" match
    "Mr. Mime" / "Nidoran ♀"."""
    column = stripped(m.CardCatalog.name)
    for symbol, word in GENDER_SYMBOLS.items():
        column = func.replace(func.replace(column, f" {symbol}", word), symbol, word)
    return column


def _match_by_name(
    db: Session, name: str, set_name: str, bracket: list[str] | None = None
) -> m.CardCatalog | None:
    for aliases in _CARDMARKET_NAME_OVERRIDES.values():
        canonical = next(
            (
                real
                for real, product in aliases.items()
                if name.casefold() == product.casefold()
            ),
            None,
        )
        if canonical:
            name = canonical
            break
    name = name.replace("[F]", "♀").replace("[M]", "♂")
    candidates = db.scalars(
        select(m.CardCatalog)
        .where(_stripped_name().ilike(to_catalog_style(name)))
        .order_by(m.CardCatalog.id)
    ).all()
    if not candidates:
        return None
    by_code = [
        card
        for card in candidates
        if card.set_code.casefold() == set_name.strip().casefold()
    ]
    if by_code:
        candidates, set_name = by_code, ""
    if len(candidates) == 1:
        return candidates[0]

    wanted_set = _matchable(set_name)
    if wanted_set:
        candidates = [
            card
            for card in candidates
            if _matchable(card.set_name)
            and (
                _matchable(card.set_name) in wanted_set
                or wanted_set in _matchable(card.set_name)
            )
        ]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    if bracket:
        wanted_moves = Counter(_matchable(move) for move in bracket)
        by_moves = [
            card
            for card in candidates
            if wanted_moves
            <= Counter(
                _matchable(move)
                for move in cardmarket_identifiers(
                    card.set_code, card.card_number, move_names(card)
                )
            )
        ]
        candidates = by_moves or candidates
    return _most_recent_print(candidates)


def _most_recent_print(candidates: list[m.CardCatalog]) -> m.CardCatalog:
    """The latest release (undated sets count as the oldest), lowest number
    first among same-day prints."""

    def number_order(card: m.CardCatalog) -> tuple:
        number = (card.card_number or "").strip()
        return (0, int(number), "") if number.isdigit() else (1, 0, number.upper())

    latest = max(card.release_date or date.min for card in candidates)
    return min(
        (card for card in candidates if (card.release_date or date.min) == latest),
        key=number_order,
    )


# ── rendering ────────────────────────────────────────────────────────────────


def clean_set_name(set_name: str) -> str:
    """Set title without a trailing "(CODE)" ("Twilight Masquerade (TWM)"),
    as Cardmarket expects."""
    return _SET_CODE_SUFFIX.sub("", set_name).strip()


def render(entries: list[Entry], format: Format, include_sets: bool = True) -> str:
    if format == "tcgplayer":
        return render_tcgplayer(entries)
    return render_cardmarket(entries, include_sets)


def render_tcgplayer(entries: list[Entry]) -> str:
    """Grouped under `Pokémon (n)` / `Trainer (n)` / `Energy (n)`; set code
    and number always (`???` / `?` for an unmatched line)."""
    groups: dict[str, list[Entry]] = {"Pokémon": [], "Trainer": [], "Energy": []}
    for line in entries:
        section = (line.card.supertype if line.card else None) or "Pokémon"
        groups.setdefault(section, []).append(line)
    blocks = []
    for section, lines in groups.items():
        if not lines:
            continue
        rows = [f"{section} ({sum(line.quantity for line in lines)})"]
        for line in lines:
            set_code = line.card.set_code if line.card else "???"
            number = line.card.card_number if line.card else "?"
            rows.append(f"{line.quantity} {line.name} {set_code} {number}")
        blocks.append("\n".join(rows))
    return "\n\n".join(blocks)


def _cardmarket_name(line: Entry) -> str:
    name = canonical_energy_name(line.name)
    if line.card:
        name = _CARDMARKET_NAME_OVERRIDES.get(line.card.set_code, {}).get(name, name)
    return re.sub(r"\s*♀", " [F]", re.sub(r"\s*♂", " [M]", name))


def render_cardmarket(entries: list[Entry], include_sets: bool = True) -> str:
    """`<qty>x <name> [moves] (<expansion>)`: the bracket only for Pokémon
    with known moves, the expansion unless `include_sets` is off."""
    rows = []
    for line in entries:
        card = line.card
        bracket = suffix = ""
        if card is not None:
            moves = cardmarket_identifiers(
                card.set_code, card.card_number, move_names(card)
            )
            if moves and card.supertype in (None, "Pokémon", "Pokemon"):
                bracket = f" [{' | '.join(moves)}]"
            if include_sets and card.set_name:
                suffix = f" ({clean_set_name(card.set_name)})"
        rows.append(f"{line.quantity}x {_cardmarket_name(line)}{bracket}{suffix}")
    return "\n".join(rows)
