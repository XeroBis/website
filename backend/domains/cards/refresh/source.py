"""Parsing the saved pokecardex HTML in CARDS_SOURCE_DIR (no network).

`<source>/<series>/<set_code>/` holds, per set:
- `{code}_en_header.html` / `{code}_fr_header.html`: title, logo and symbol
  URLs, release date, card count (one per language: the logo differs).
- `{code}_en.html` / `{code}_fr.html`: one `<img>` per print of each card
  slot, in slot order, `alt="{Name} {number}/{total}"` and `src` = the scan
  CDN URL. Slot i of the EN grid is slot i of the FR grid.
- `{code}_rarity.txt`: `id,rarity[,supertype]` CSV, one row per slot in grid
  order (matched by position: the id's padding varies).
`<source>/<series>/name.txt` (`fr,en` header, one row) gives the series'
French label (display.py reads it).

The card number is the scan URL's last number, not the alt text's (which can
be wrong, or for World Championships is the number in the original set).
The `Energies` set is the exception: its CDN numbers aren't its order, so its
cards are numbered by grid position.
"""

import re
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

from core.config import settings

ENERGIES_SERIES = "Energies"
WORLD_CHAMPIONSHIPS_SERIES = "World Championships"
PENDING_PREFIX = "__pending__/"

# Any scan URL: .../sets/{code}/{FR|US}/{n}.jpg for the standard print,
# .../sets/{code}/{FR|US}/{version_id}/{n}.jpg for another print.
SCAN_URL = re.compile(r"/sets/[^/]+/(?:FR|US)/(?:(\d+)/)?(\d+)\.jpg")

# pokecardex versionId -> variant_type (from its JS bundle and the saved
# HTML). Every type is in variant_order.py; a scan with an unknown id is
# skipped.
VERSION_ID_TO_VARIANT: dict[int, str] = {
    2: "reverse",
    7: "winner_promo",
    12: "stamp_league",
    13: "stamp_professor_program",
    21: "stamp_regional_championships",
    23: "stamp_pokemon_day",
    33: "stamp_league_cup",
    34: "stamp_euic",
    35: "stamp_ocic",
    36: "stamp_laic",
    37: "stamp_naic",
    38: "holo_mirage",
    39: "holo_cosmos",
    48: "non_holo",
    49: "stamp_pokemon_tcg_gym",
    51: "text_error_before_errata",
    55: "staff_regional_championships",
    56: "staff_prerelease",
    63: "staff_league_cup",
    64: "staff_euic",
    65: "staff_ocic",
    66: "staff_laic",
    67: "staff_naic",
    68: "holo_mirror",
    71: "holo_cracked_ice",
    74: "holo_sheen",
    77: "1st_place_league_challenge",
    78: "2nd_place_league_challenge",
    79: "3rd_place_league_challenge",
    80: "4th_place_league_challenge",
    81: "holo_water_web",
    82: "top_8_euic",
    83: "top_8_ocic",
    84: "top_8_laic",
    85: "top_8_naic",
    86: "champion_euic",
    87: "champion_ocic",
    88: "champion_laic",
    89: "champion_naic",
    90: "holo_sequin",
    94: "reverse_pokeball",
    97: "stamp_gamestop",
    98: "stamp_eb_games",
    101: "stamp_25th_anniversary",
    102: "stamp_play_pokemon",
    104: "ditto_sticker",
    105: "with_pogo_code",
    107: "stamp_pokemon_center",
    110: "stamp_iono_s_gadgets",
    111: "metal",
    112: "champion_professor_program",
    113: "top_8_professor_program",
    114: "staff_professor_program",
    115: "worlds_staff",
    116: "worlds_top_thirty_two",
    117: "worlds_top_sixteen",
    118: "worlds_quarter_finalist",
    119: "worlds_semi_finalist",
    120: "worlds_finalist",
    121: "worlds_champion",
    122: "stamp_asia_championship_series",
    123: "stamp_pokemon_together",
    124: "top_8_championships_hong_kong_en",
    125: "champion_championships_hong_kong_en",
    126: "staff_championships_hong_kong_en",
    127: "stamp_championships_hong_kong_en",
    128: "stamp_championships_malaysia",
    129: "stamp_championships_singapore",
    130: "stamp_championships_philippines",
    131: "staff_championships_malaysia",
    132: "staff_championships_singapore",
    133: "staff_championships_philippines",
    134: "top_8_championships_malaysia",
    135: "top_8_championships_singapore",
    136: "top_8_championships_philippines",
    137: "champion_championships_malaysia",
    138: "champion_championships_singapore",
    139: "champion_championships_philippines",
    140: "stamp_philippines_league_regional",
    141: "stamp_singapore_league_regional",
    142: "stamp_pokemon_tcg_beginner_s_session",
    150: "holo_acid_wash",
    151: "stamp_malaysia_league_regional",
    152: "stamp_hong_kong_en_league_regional",
    153: "holo_line",
    154: "holo_star",
    159: "stamp_set_logo",
    177: "without_stamp",
    178: "holo_confetti",
    179: "stamp_eb_games_canada",
    181: "cosmos_reverse",
    183: "stamp_world_championships_2024",
    184: "stamp_7_eleven",
    185: "stamp_rain_city_showcase",
    186: "stamp_premier_ball_league",
    187: "stamp_great_ball_league",
    188: "stamp_ultra_ball_league",
    189: "stamp_horizons_the_series",
    190: "stamp_premier_ball_league_judge",
    191: "alternative_pokedex_description",
    193: "yellow_double_star_rarity_special_illustration_rare",
    197: "reverse_masterball",
    203: "stamp_master_ball_league",
    204: "stamp_master_ball_league_judge",
    205: "top_4_professor_program",
    206: "stamp_thank_you",
    208: "stamp_set_logo_right",
    209: "stamp_set_logo_left",
    210: "stamp_asia_promo",
    211: "stamp_trick_or_trade",
    212: "gold_signature",
    214: "reverse_friendball",
    215: "reverse_loveball",
    216: "reverse_duskball",
    217: "reverse_quickball",
    218: "reverse_rocketball",
    220: "finalist_professor_program",
    221: "stamp_fossil_museum",
    224: "stamp_pokemonxp",
    229: "stamp_what_s_your_favorite",
}

_MONTHS = {
    name: i
    for i, name in enumerate(
        (
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ),
        1,
    )
}
_RELEASE_DATE = re.compile(r"(" + "|".join(_MONTHS) + r")\s+(\d{1,2}),\s*(\d{4})")
_CARD_COUNT = re.compile(r"(\d+)\s+cards\b")
# Only strip the number off the alt text to get the name: "Name 001/100",
# "Name 003" (promo sets), else the alt verbatim (minus a trailing dash).
_ALT_NUMBER_TOTAL = re.compile(r"^(.*)\s+(\S+)/(\S+)$")
_ALT_NUMBER = re.compile(r"^(.*?)\s+(\d+)$")


def source_root() -> Path:
    return Path(settings.cards_source_dir)


class _Page(HTMLParser):
    """The `<img>` attributes, the first `<h1>`'s text and every text node of
    a saved fragment."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.images: list[dict[str, str]] = []
        self.texts: list[str] = []
        self.h1: list[str] = []
        self.has_h1 = False
        self._h1_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            self.images.append({k: v or "" for k, v in attrs})
        elif tag == "h1" and (self._h1_depth or not self.has_h1):
            self.has_h1 = True
            self._h1_depth += 1

    def handle_endtag(self, tag):
        if tag == "h1" and self._h1_depth:
            self._h1_depth -= 1

    def handle_data(self, data):
        text = data.strip()
        if text:
            self.texts.append(text)
            if self._h1_depth:
                self.h1.append(text)


def _parse(path: Path) -> _Page:
    page = _Page()
    page.feed(path.read_text(encoding="utf-8"))
    page.close()
    return page


@dataclass(frozen=True)
class SetHeader:
    set_name: str
    set_name_fr: str
    logo_url_en: str | None
    logo_url_fr: str | None
    symbol_url: str | None
    release_date: date | None
    card_count: int | None


@dataclass(frozen=True)
class CardSlot:
    name_en: str
    name_fr: str
    card_number: str
    rarity: str | None
    supertype: str | None
    scan_url_en: str | None
    scan_url_fr: str | None
    # variant_type -> {"en": url | None, "fr": url | None}, "standard" included.
    variants: dict[str, dict[str, str | None]]


def iter_sets(root: Path | None = None):
    """(series, set_code, set_dir) for every set folder, sorted."""
    root = root or source_root()
    if not root.is_dir():
        return
    for series_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        for set_dir in sorted(p for p in series_dir.iterdir() if p.is_dir()):
            yield series_dir.name, set_dir.name, set_dir


def _first_src(page: _Page, marker: str) -> str | None:
    return next((i["src"] for i in page.images if marker in i.get("src", "")), None)


def parse_set_header(set_dir: Path, code: str) -> SetHeader:
    """Raises FileNotFoundError when a header file is missing."""
    en = _parse(set_dir / f"{code}_en_header.html")
    fr = _parse(set_dir / f"{code}_fr_header.html")
    set_name = "".join(en.h1) if en.has_h1 else code
    body = " ".join(en.texts)
    release = _RELEASE_DATE.search(body)
    count = _CARD_COUNT.search(body)
    return SetHeader(
        set_name=set_name,
        set_name_fr="".join(fr.h1) if fr.has_h1 else set_name,
        logo_url_en=_first_src(en, "/logos/"),
        logo_url_fr=_first_src(fr, "/logos/"),
        symbol_url=_first_src(en, "/symboles/"),
        release_date=(
            date(int(release[3]), _MONTHS[release[1]], int(release[2]))
            if release
            else None
        ),
        card_count=int(count[1]) if count else None,
    )


def _parse_grid(path: Path) -> list[tuple[str, str, dict[str, str]]]:
    """[(name, card_number, {variant_type: scan_url})] in slot order. A slot's
    prints are consecutive `<img>`s with the same name and number; other
    images (placeholders, flags, toggles) have no scan URL and are ignored."""
    if not path.exists():
        return []
    slots: list[tuple[str, str, dict[str, str]]] = []
    for img in _parse(path).images:
        if "alt" not in img:
            continue
        src = img.get("src", "")
        match = SCAN_URL.search(src)
        if not match:
            continue
        version_id, card_number = match.groups()
        variant_type = (
            VERSION_ID_TO_VARIANT.get(int(version_id)) if version_id else "standard"
        )
        if variant_type is None:
            continue
        alt = img["alt"]
        name_match = _ALT_NUMBER_TOTAL.match(alt) or _ALT_NUMBER.match(alt)
        name = (name_match[1] if name_match else alt).strip(" —-")
        if slots and slots[-1][:2] == (name, card_number):
            slots[-1][2][variant_type] = src
        else:
            slots.append((name, card_number, {variant_type: src}))
    return slots


def _parse_rarity(path: Path) -> list[tuple[str | None, str | None]]:
    """[(rarity, supertype)] in row order, header skipped."""
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines()[1:]:
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split(",")]
        rarity = parts[1] if len(parts) > 1 else None
        supertype = parts[2] if len(parts) > 2 and parts[2] else None
        rows.append((rarity, supertype))
    return rows


def parse_set_cards(
    set_dir: Path, code: str, *, number_by_position: bool = False
) -> list[CardSlot]:
    en_slots = _parse_grid(set_dir / f"{code}_en.html")
    fr_slots = _parse_grid(set_dir / f"{code}_fr.html")
    rarities = _parse_rarity(set_dir / f"{code}_rarity.txt")
    slots = []
    for i, (name_en, scan_number, variants_en) in enumerate(en_slots):
        name_fr, _, variants_fr = (
            fr_slots[i] if i < len(fr_slots) else (name_en, scan_number, {})
        )
        rarity, supertype = rarities[i] if i < len(rarities) else (None, None)
        slots.append(
            CardSlot(
                name_en=name_en,
                name_fr=name_fr,
                card_number=str(i + 1) if number_by_position else scan_number,
                rarity=rarity,
                supertype=supertype,
                scan_url_en=variants_en.get("standard"),
                scan_url_fr=variants_fr.get("standard"),
                variants={
                    v: {"en": variants_en.get(v), "fr": variants_fr.get(v)}
                    for v in variants_en.keys() | variants_fr.keys()
                },
            )
        )
    return slots


def scan_slot(scan_url: str | None, fallback: str) -> str:
    """The CDN grid slot of a scan URL (fallback when it has none)."""
    match = SCAN_URL.search(scan_url or "")
    return match[2] if match else fallback


def pending_image_path(set_code: str, card_number: str, scan_url: str | None) -> str:
    """Unique placeholder `image_path` until the scan is downloaded."""
    return (
        f"{PENDING_PREFIX}{set_code}/{scan_slot(scan_url, card_number)}_{card_number}"
    )


def without_query(url: str) -> str:
    """A scan URL without its CDN parameters (`?class=hd`), as identity."""
    return url.split("?", 1)[0]
