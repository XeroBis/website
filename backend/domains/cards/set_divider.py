"""Print-ready binder divider for a set: `make set-divider CODE=…`.

Writes `<out-dir>/<CODE>_set_divider.docx` with the layout of the dividers in
documentation/docx/set_dividers (logo, symbol, 3 fanned highlight cards, a
CARTES / SORTIE / CODE DU SET table). Ported from the old cards repo's
scripts/generate_set_divider.py.

python-docx can't write anchored/floating images, so this clones a template
divider (`<out-dir>/MEG_set_divider.docx`) and patches its word/document.xml:
the logo, symbol and highlight images, the logo's size (and the highlight
cards' vertical position, which follows the logo's height) and the three
table values.

The set's facts come from the catalog (CARTES = its number of cards, SORTIE =
its release date), the images from CARDS_DATA_DIR: the English logo, the
symbol and the highlights' English standard scans.

    python -m domains.cards.set_divider 30C --out-dir /dividers
    python -m domains.cards.set_divider DLR --out-dir /dividers --highlights 11 23 84
"""

import argparse
import re
import shutil
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from PIL import Image
from sqlalchemy import select

from core.config import settings
from core.database import SessionLocal
from domains.cards.display import set_asset_paths
from domains.cards.models import CardCatalog
from domains.cards.set_divider_b import BACKGROUNDS, build_divider_b

TEMPLATE_NAME = "MEG_set_divider.docx"

# Bounding box the logo is scaled into (keeping its aspect ratio), in EMU
# (914400 = 1 inch): fits very wide logos and near-square ones alike.
LOGO_MAX_CX = 6400800  # 7in
LOGO_MAX_CY = 2286000  # 2.5in

# Layout constants shared by every existing divider: the 2 outer cards share
# one vertical position, the front card sits CARD_FRONT_V_LIFT higher, and
# that position is the logo's height + CARD_V_OFFSET_FROM_LOGO.
CARD_V_OFFSET_FROM_LOGO = 2103016
CARD_FRONT_V_LIFT = 274320

FR_MONTHS = (
    "janvier février mars avril mai juin juillet août septembre octobre "
    "novembre décembre"
).split()

HIGHLIGHT_NAME = re.compile(r"(?:[\s-])(ex|GX|V|VMAX|VSTAR)\b")

# The regular pull pool: full arts, illustration rares, secret and hyper
# rares (numbered past the set's printed count) are left out, so the divider
# features the set's ordinary ex/V cards rather than its rarest pulls.
REGULAR_RARITIES = {
    None,
    "",
    "Double Rare",
    "Holo Rare V",
    "Holo Rare VMAX",
    "Holo Rare VSTAR",
    "Promo",
    "Uncommon",
}


@dataclass
class Card:
    number: str
    name: str
    rarity: str | None
    scan: Path


def fr_date(day: date) -> str:
    return f"{day.day} {FR_MONTHS[day.month - 1]} {day.year}"


def number_key(number: str) -> tuple[int, str]:
    match = re.match(r"\d+", number)
    return (int(match.group()) if match else 10**9, number)


def pick_highlights(
    cards: list[Card], count: int = 3, main_only: bool = False
) -> list[Card]:
    """The lowest-numbered distinct ex/V/GX Pokemon of the regular pool,
    widening to every ex/V/GX card, then to every card, when that's short
    (e.g. energy sets). `main_only` never widens past the regular pool (no
    ultra rare): fewer cards rather than a secret rare, unless it's empty."""

    def distinct(pool: list[Card]) -> list[Card]:
        seen, picked = set(), []
        for card in sorted(pool, key=lambda c: number_key(c.number)):
            key = HIGHLIGHT_NAME.split(card.name, maxsplit=1)[0].strip()
            if key not in seen:
                seen.add(key)
                picked.append(card)
        return picked

    special = [c for c in cards if HIGHLIGHT_NAME.search(c.name)]
    regular = [c for c in special if c.rarity in REGULAR_RARITIES]
    if main_only:
        # Fewer cards rather than ultra rares; a set with no regular ex
        # (energy sets) shows its own cards, however few.
        return distinct(regular or cards)[:count]
    for pool in (regular, special, cards):
        picked = distinct(pool)
        if len(picked) >= count:
            return picked[:count]
    raise SystemExit(f"Only {len(picked)} card(s) with a scan, pass --highlights.")


def set_types(rows: list[CardCatalog]) -> list[str]:
    """Each Pokemon card's types (TCGdex details), one entry per card, so a
    type appears as often as the set has cards of it."""
    types = []
    for row in rows:
        en = (row.details or {}).get("en") or {}
        types.extend(en.get("types") or [])
    return types


def replace_label_value(xml: str, label: str, value: str) -> str:
    """Replaces the <w:t> run right after the one holding `label`."""
    pattern = re.compile(
        r"(<w:t[^>]*>" + re.escape(label) + r"</w:t>.*?<w:t[^>]*>)([^<]*)(</w:t>)",
        re.DOTALL,
    )
    xml, found = pattern.subn(lambda m: m.group(1) + value + m.group(3), xml, 1)
    if found != 1:
        raise RuntimeError(f"No {label!r} label in the template")
    return xml


def replace_card_vertical_offsets(xml: str, outer: int, front: int) -> str:
    """The 3 highlight cards' <wp:positionV> offsets, in anchor order."""
    values = iter([outer, outer, front])
    pattern = re.compile(
        r'(<wp:positionV relativeFrom="page"><wp:posOffset>)\d+'
        r"(</wp:posOffset></wp:positionV>)"
    )
    xml, found = pattern.subn(lambda m: f"{m.group(1)}{next(values)}{m.group(2)}", xml)
    if found != 3:
        raise RuntimeError(f"Expected 3 card positions in the template, found {found}")
    return xml


def build_divider(
    template: Path,
    code: str,
    logo: Path,
    symbol: Path,
    highlights: list[Card],
    cartes: int,
    release: date,
    out_path: Path,
) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        with zipfile.ZipFile(template) as z:
            z.extractall(work)

        shutil.copy(logo, work / "word/media/image1.png")
        shutil.copy(symbol, work / "word/media/image2.png")
        for i, card in enumerate(highlights, start=3):
            shutil.copy(card.scan, work / f"word/media/image{i}.jpg")

        logo_w, logo_h = Image.open(logo).size
        scale = min(LOGO_MAX_CX / logo_w, LOGO_MAX_CY / logo_h)
        logo_cx, logo_cy = round(logo_w * scale), round(logo_h * scale)
        outer = logo_cy + CARD_V_OFFSET_FROM_LOGO

        doc = work / "word/document.xml"
        xml = doc.read_text(encoding="utf-8")
        # The logo is the first picture: its extents are each tag's first match.
        xml = re.sub(
            r'<wp:extent cx="\d+" cy="\d+"/>',
            f'<wp:extent cx="{logo_cx}" cy="{logo_cy}"/>',
            xml,
            count=1,
        )
        xml = re.sub(
            r'<a:ext cx="\d+" cy="\d+"/>',
            f'<a:ext cx="{logo_cx}" cy="{logo_cy}"/>',
            xml,
            count=1,
        )
        xml = replace_card_vertical_offsets(xml, outer, outer - CARD_FRONT_V_LIFT)
        xml = replace_label_value(xml, "CARTES", str(cartes))
        xml = replace_label_value(xml, "SORTIE", fr_date(release))
        xml = replace_label_value(xml, "CODE DU SET", code)
        doc.write_text(xml, encoding="utf-8")

        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in sorted(work.rglob("*")):
                if f.is_file():
                    zf.write(f, f.relative_to(work))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("code", help="Set code, e.g. 30C, DLR")
    parser.add_argument(
        "--out-dir",
        type=Path,
        required=True,
        help=f"Where the divider goes; must hold {TEMPLATE_NAME}.",
    )
    parser.add_argument(
        "--style",
        choices=["classic", "B"],
        default="classic",
        help="classic: the template's layout, 3 cards (<CODE>_set_divider.docx); "
        "B: a full-page picture, a background and 12 cards scattered over it "
        "(<CODE>_B_divider.docx).",
    )
    parser.add_argument(
        "--highlights",
        nargs="+",
        metavar="NUMBER",
        help="Card numbers to feature, 3 for classic, any for B (default: the "
        "lowest-numbered distinct ex/V/GX Pokemon of the regular pull pool).",
    )
    parser.add_argument(
        "--background",
        choices=list(BACKGROUNDS),
        default="white",
        help="B only: the background behind the cards.",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="B only: also write a 100 dpi <CODE>_B_divider.png next to it.",
    )
    parser.add_argument("--release-date", type=date.fromisoformat, metavar="YYYY-MM-DD")
    parser.add_argument("--force", action="store_true", help="Overwrite a divider.")
    args = parser.parse_args()

    code = args.code.upper()
    template = args.out_dir / TEMPLATE_NAME
    classic = args.style == "classic"
    count = 3 if classic else 12
    if classic and args.highlights and len(args.highlights) != 3:
        raise SystemExit("The classic style takes exactly 3 --highlights.")
    name = f"{code}_set_divider" if classic else f"{code}_B_divider"
    out_path = args.out_dir / f"{name}.docx"
    if classic and not template.exists():
        raise SystemExit(f"Missing template: {template}")
    if out_path.exists() and not args.force:
        raise SystemExit(
            f"{out_path.name} already exists, pass --force (make: FORCE=1) to overwrite."
        )

    with SessionLocal() as db:
        rows = db.scalars(select(CardCatalog).where(CardCatalog.set_code == code)).all()
    if not rows:
        raise SystemExit(f"No set {code} in the catalog.")

    data = Path(settings.cards_data_dir)
    assets = set_asset_paths(rows[0].series, code)
    logo, symbol = data / assets["logo_path"], data / assets["symbol_path"]
    for path in (logo, symbol):
        if not path.exists():
            raise SystemExit(f"Missing {path}, run the catalog's set logos step.")

    release = args.release_date or rows[0].release_date
    if release is None:
        raise SystemExit(f"No release date for {code}, pass --release-date.")

    cards = [
        Card(r.card_number, r.name, r.rarity, data / r.image_path)
        for r in rows
        if (data / r.image_path).is_file()
    ]
    if args.highlights:
        by_number = {c.number: c for c in cards}
        missing = [n for n in args.highlights if n not in by_number]
        if missing:
            raise SystemExit(f"No downloaded scan for card(s) {', '.join(missing)}.")
        highlights = [by_number[n] for n in args.highlights]
    else:
        highlights = pick_highlights(cards, count, main_only=not classic)

    if classic:
        build_divider(
            template, code, logo, symbol, highlights, len(rows), release, out_path
        )
    else:
        build_divider_b(
            code,
            logo,
            symbol,
            [c.scan for c in highlights],
            len(rows),
            fr_date(release),
            out_path,
            args.out_dir / f"{name}.png" if args.preview else None,
            args.background,
            rows[0].series,
            set_types(rows),
        )
    picked = ", ".join(f"{c.number} {c.name}" for c in highlights)
    print(f"{code}: cartes={len(rows)} sortie={fr_date(release)} highlights={picked}")
    print(f"-> {out_path.name}")


if __name__ == "__main__":
    main()
