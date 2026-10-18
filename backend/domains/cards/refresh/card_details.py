"""Refresh step `import_card_details`: card text (HP, attacks, …) in English and
French from TCGdex, into `card_catalog.details`. Only fills cards without
details; never touches a card's identity. Every TCGdex response is cached as
JSON under `card-details/` in CARDS_DATA_DIR, so a rerun only asks for what
it hasn't seen."""

import json
import logging
import unicodedata
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx2
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from domains.cards import models as m
from domains.cards.refresh import http, source

logger = logging.getLogger(__name__)

API = "https://api.tcgdex.net/v2"
CACHE_FOLDER = "card-details"
FIELDS = (
    "name",
    "hp",
    "types",
    "stage",
    "evolveFrom",
    "attacks",
    "abilities",
    "effect",
    "weaknesses",
    "resistances",
    "retreat",
    "illustrator",
    "regulationMark",
)
WORKERS = 6
BATCH = 24
# Reprints and sets TCGdex numbers differently: never matched.
SKIPPED_SERIES = {source.WORLD_CHAMPIONSHIPS_SERIES, source.ENERGIES_SERIES}
FAILURES = (httpx2.HTTPError, ValueError, KeyError, TypeError)


def _normalize(value: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", value.casefold()) if c.isalnum()
    )


def _number(value: str) -> str:
    return str(int(value)) if value.isdigit() else value.upper()


def read_json(client: httpx2.Client, cache: Path, language: str, resource: str):
    """A TCGdex resource from the cache, else the API (cached); None on 404."""
    path = cache / language / f"{resource}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    response = client.get(f"{API}/{language}/{resource}")
    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)
    return payload


def _skipped(row: m.CardCatalog) -> bool:
    return (
        bool(row.details and (row.details.get("en") or row.details.get("fr")))
        or row.series in SKIPPED_SERIES
        or "promo" in row.set_name.casefold()
    )


def import_details(
    db: Session, data_dir: Path, on_progress: Callable[[int, int], None] | None = None
) -> dict:
    """Matches each card's set to one TCGdex set by name, then the card by
    number; the fetched card must name the same set and number."""
    progress = on_progress or (lambda done, total: None)
    cache = data_dir / CACHE_FOLDER
    rows = db.scalars(
        select(m.CardCatalog).order_by(m.CardCatalog.set_code, m.CardCatalog.id)
    ).all()
    total = len(rows)
    result = dict(matched=0, unmatched=0, skipped=0, failed=0, french_missing=0)
    done = 0

    def tick(outcome: str) -> None:
        nonlocal done
        result[outcome] += 1
        done += 1
        progress(done, total)

    with http.client() as client:
        sets_by_name: dict[str, list[str]] | None = None
        set_cards: dict[str, dict[str, list[str]]] = {}
        work = []
        for row in rows:
            if _skipped(row):
                tick("skipped")
                continue
            try:
                if sets_by_name is None:
                    sets_by_name = {}
                    for item in read_json(client, cache, "en", "sets"):
                        sets_by_name.setdefault(_normalize(item["name"]), []).append(
                            item["id"]
                        )
                candidates = sets_by_name.get(_normalize(row.set_name), [])
                if len(candidates) != 1:
                    tick("unmatched")
                    continue
                set_id = candidates[0]
                if set_id not in set_cards:
                    payload = read_json(client, cache, "en", f"sets/{set_id}")
                    by_number: dict[str, list[str]] = {}
                    for item in payload["cards"]:
                        by_number.setdefault(_number(item["localId"]), []).append(
                            item["id"]
                        )
                    set_cards[set_id] = by_number
                matches = set_cards[set_id].get(_number(row.card_number), [])
                if len(matches) != 1:
                    tick("unmatched")
                    continue
                work.append((row.id, set_id, row.card_number, matches[0]))
            except FAILURES:
                logger.exception(
                    "Card details failed for %s/%s", row.set_code, row.card_number
                )
                tick("failed")

        def fetch(item):
            row_id, set_id, local_id, card_id = item
            details, french_missing = {}, 0
            for language in ("en", "fr"):
                payload = read_json(client, cache, language, f"cards/{card_id}")
                if payload is None:
                    french_missing += language == "fr"
                    continue
                if payload.get("set", {}).get("id") != set_id or _number(
                    payload.get("localId", "")
                ) != _number(local_id):
                    raise ValueError("TCGdex card identity mismatch")
                details[language] = {k: payload[k] for k in FIELDS if k in payload}
            return row_id, details, french_missing

        # Workers only download; the session stays on this thread.
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for offset in range(0, len(work), BATCH):
                pending = {
                    pool.submit(fetch, item): item
                    for item in work[offset : offset + BATCH]
                }
                for future in as_completed(pending):
                    try:
                        row_id, details, missing = future.result()
                    except FAILURES:
                        logger.exception(
                            "Card details failed for %s", pending[future][3]
                        )
                        tick("failed")
                        continue
                    result["french_missing"] += missing
                    if details.get("en"):
                        db.execute(
                            update(m.CardCatalog)
                            .where(m.CardCatalog.id == row_id)
                            .values(details=details)
                        )
                        tick("matched")
                    else:
                        tick("unmatched")
                db.commit()
    return result
