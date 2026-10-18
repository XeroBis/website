"""Small saved-pokecardex fixtures for the refresh tests, written into the
temporary CARDS_SOURCE_DIR (same shapes as domains/cards/source/)."""

import io
from pathlib import Path

from PIL import Image

SCANS = "https://pokecardex-scans.b-cdn.net/sets"
ASSETS = "https://pokecardex.b-cdn.net/assets/images"


def scan_url(code: str, language: str, number: str, version: int | None = None):
    version_part = f"{version}/" if version else ""
    return f"{SCANS}/{code}/{language}/{version_part}{number}.jpg?class=hd"


def logo_url(code: str, language: str) -> str:
    return f"{ASSETS}/logos/{language}/{code}.png"


def symbol_url(code: str) -> str:
    return f"{ASSETS}/symboles/{code}.png"


def card(name, number, *, name_fr=None, versions=(), alt=None, **extra) -> dict:
    """A card slot: `versions` = pokecardex version ids of its other prints;
    `alt` = the number its alt text shows (default: `number`)."""
    return {
        "name": name,
        "name_fr": name_fr or name,
        "number": number,
        "versions": versions,
        "alt": alt or number,
        "rarity": extra.get("rarity", "Common"),
        "supertype": extra.get("supertype", "Pokémon"),
        "fr": extra.get("fr", True),
    }


def write_set(
    root: Path,
    series: str,
    code: str,
    cards: list[dict],
    *,
    name: str = "Scarlet & Violet",
    name_fr: str = "Écarlate et Violet",
    count: int = 198,
) -> Path:
    folder = root / series / code
    folder.mkdir(parents=True, exist_ok=True)
    for language, title, cdn in (("en", name, "US"), ("fr", name_fr, "FR")):
        (folder / f"{code}_{language}_header.html").write_text(
            f'<div><h1 class="t">{title.replace("&", "&amp;")}</h1>'
            f'<img alt="{title}" src="{logo_url(code, cdn)}">'
            f'<img alt="{title}" src="{symbol_url(code)}">'
            f"<div>March 31, 2023</div><div>{count} cards</div></div>",
            encoding="utf-8",
        )
        imgs = ['<img alt="Anglais" src="https://pokecardex.b-cdn.net/flag.png">']
        for c in cards:
            if language == "fr" and not c["fr"]:
                continue
            alt = f'{c["name" if language == "en" else "name_fr"]} {c["alt"]}/{count}'
            for version in (None, *c["versions"]):
                imgs.append(
                    f'<img alt="{alt}" src="{scan_url(code, cdn, c["number"], version)}">'
                )
        (folder / f"{code}_{language}.html").write_text("".join(imgs), "utf-8")
    rows = ["id,rarity,supertype"] + [
        f'{c["number"]},{c["rarity"]},{c["supertype"]}' for c in cards
    ]
    (folder / f"{code}_rarity.txt").write_text("\n".join(rows), "utf-8")
    return folder


def write_series_name(root: Path, series: str, french: str) -> None:
    (root / series).mkdir(parents=True, exist_ok=True)
    (root / series / "name.txt").write_text(f"fr,en\n{french},{series}", "utf-8")


def jpeg(width: int = 600, height: int = 840) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "red").save(buffer, "JPEG")
    return buffer.getvalue()
