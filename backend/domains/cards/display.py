"""Display fields in the viewer's language (`core.users.language`).

Only display responses use these. Exports, imports and public share pages
keep the English `name` / `set_name` / `image_path`, which are what imports
match by.
"""

from functools import lru_cache
from pathlib import Path

from core.config import settings


def image_path(card, language: str | None) -> str:
    if language == "fr" and card.image_path_fr:
        return card.image_path_fr
    return card.image_path


def card_name(card, language: str | None) -> str:
    # display_name already falls back to the English name.
    if language == "fr" and card.display_name:
        return card.display_name
    return card.name


def set_name(set_name: str, set_name_fr: str | None, language: str | None) -> str:
    if language == "fr" and set_name_fr:
        return set_name_fr
    return set_name


@lru_cache(maxsize=1)
def _series_names_fr() -> dict[str, str]:
    """French series labels from each `<source>/<series>/name.txt` (`fr,en`
    header, then one row)."""
    names: dict[str, str] = {}
    root = Path(settings.cards_source_dir)
    if not root.is_dir():
        return names
    for series_dir in root.iterdir():
        name_file = series_dir / "name.txt"
        if not name_file.is_file():
            continue
        try:
            header, values = name_file.read_text(encoding="utf-8").splitlines()[:2]
            columns = dict(zip(header.split(","), values.split(","), strict=True))
        except OSError, ValueError:
            continue
        if columns.get("fr"):
            names[series_dir.name] = columns["fr"]
    return names


def series_name(series: str | None, language: str | None) -> str | None:
    """The label of a series; `series` itself stays the grouping key."""
    if series is None or language != "fr":
        return series
    return _series_names_fr().get(series, series)


def set_asset_paths(series: str | None, set_code: str) -> dict[str, str | None]:
    """Logo and symbol paths under CARDS_DATA_DIR (may not exist on disk)."""
    if not series:
        return {"logo_path": None, "logo_path_fr": None, "symbol_path": None}
    base = f"{series}/{set_code}/{set_code}"
    return {
        "logo_path": f"{base}_logo_EN.png",
        "logo_path_fr": f"{base}_logo_FR.png",
        "symbol_path": f"{base}_symbol.png",
    }
