"""The shared catalog: browse/search, sets with the user's completion, missing
numbers, filter options, one card's details and where it's used. Any cards
user reads; only admins correct a name."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import and_, case, desc, distinct, exists, func, select, true
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.deps import require_admin
from core.models import User
from domains.cards import decklists, display, search
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, not_found
from domains.cards.variant_order import ALL_VARIANT_TYPES, variant_sort_key

router = APIRouter(prefix="/catalog", tags=["cards"])


def catalog_out(card: m.CardCatalog, language: str | None) -> s.CatalogCardOut:
    """A catalog card with its display fields in the viewer's language."""
    out = s.CatalogCardOut.model_validate(card)
    out.name = display.card_name(card, language)
    out.set_name = display.set_name(card.set_name, card.set_name_fr, language)
    out.image_path = display.image_path(card, language)
    return out


def _check_variant_types(variant_types: list[str] | None) -> None:
    if variant_types and any(v not in ALL_VARIANT_TYPES for v in variant_types):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown variant type"
        )


def _owned_by(user_id: int):
    """ON clause joining a catalog card to the user's collection row."""
    return and_(m.Card.catalog_id == m.CardCatalog.id, m.Card.user_id == user_id)


# ── browse ───────────────────────────────────────────────────────────────────


@router.get("", response_model=s.CatalogPage)
def browse_catalog(
    search_term: str | None = Query(None, alias="search"),
    set_code: str | None = None,
    set_name: str | None = Query(None, description="Partial set name"),
    supertype: list[str] | None = Query(None),
    rarity: list[str] | None = Query(None, description="Raw rarity values"),
    card_number: str | None = Query(None, description="Partial card number"),
    variant_type: list[str] | None = Query(
        None, description="Cards printed in one of these variants"
    ),
    sort: str = Query("name_asc", description=", ".join(search.SORT_OPTIONS)),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    conditions = search.card_filters(
        search_term, set_code, set_name, supertype, rarity, card_number
    )
    if variant_type:
        conditions.append(
            m.CardCatalog.variants.any(
                m.CardCatalogVariant.variant_type.in_(variant_type)
            )
        )

    # COUNT(*) OVER () rides on the page query instead of a second count. It
    # only exists on returned rows, so a page past the end counts separately.
    rows = db.execute(
        select(m.CardCatalog, func.count().over().label("total"))
        .where(*conditions)
        .options(selectinload(m.CardCatalog.variants))
        .order_by(*search.order_by(sort, search.name_column(user.language)))
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    if rows:
        total = rows[0].total
    else:
        total = db.scalar(
            select(func.count()).select_from(m.CardCatalog).where(*conditions)
        )
    return s.CatalogPage(
        total=total,
        page=page,
        page_size=page_size,
        items=[catalog_out(row[0], user.language) for row in rows],
    )


# ── sets ─────────────────────────────────────────────────────────────────────


@router.get("/sets", response_model=list[s.SetOut])
def list_sets(
    rarity: list[str] | None = Query(None, description="Raw rarity values"),
    variant_type: list[str] | None = Query(
        None, description="Count each of these prints independently"
    ),
    reverse: bool = Query(False, description="Count every print of every card"),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """One row per set, newest first, World Championships sets last, with the
    user's completion of the selected cards (see data-model.md "Rules").

    - No `variant_type`/`reverse`: a card counts when owned in any print;
      without `rarity`, only normal numbering (number ≤ card_count) counts.
    - `variant_type`: each existing selected print counts on its own, owned
      when that exact print has a positive quantity; all numbering.
    - `reverse` without `variant_type`: the same over every print.
    """
    _check_variant_types(variant_type)
    card = m.CardCatalog
    number = search.numeric_card_number()
    by_print = bool(variant_type) or reverse
    if by_print:
        included = card.rarity.in_(rarity) if rarity else true()
    elif rarity:
        included = card.rarity.in_(rarity)
    else:
        included = and_(number.isnot(None), number <= card.card_count)

    series = func.max(card.series)
    release_date = func.min(card.release_date)
    query = select(
        card.set_code,
        card.set_name,
        func.max(card.set_name_fr).label("set_name_fr"),
        series.label("series"),
        func.max(card.card_count).label("card_count"),
        release_date.label("release_date"),
    ).outerjoin(m.Card, _owned_by(user.id))
    if by_print:
        query = query.outerjoin(
            m.CardCatalogVariant, m.CardCatalogVariant.card_catalog_id == card.id
        ).outerjoin(
            m.CardVariantQuantity,
            and_(
                m.CardVariantQuantity.card_id == m.Card.id,
                m.CardVariantQuantity.variant_type == m.CardCatalogVariant.variant_type,
            ),
        )
        if variant_type:
            included = and_(
                included, m.CardCatalogVariant.variant_type.in_(variant_type)
            )
        owned = and_(included, m.CardVariantQuantity.quantity > 0)
        unit = m.CardCatalogVariant.id
    else:
        owned = and_(
            included,
            m.Card.variant_quantities.any(m.CardVariantQuantity.quantity > 0),
        )
        unit = card.id
    query = query.add_columns(
        func.count(case((included, unit))).label("total"),
        func.count(case((owned, unit))).label("owned"),
    )
    rows = db.execute(
        query.group_by(card.set_code, card.set_name).order_by(
            case((series == "World Championships", 1), else_=0),
            desc(release_date).nulls_last(),
            card.set_name,
        )
    ).all()
    return [
        s.SetOut(
            set_code=row.set_code,
            set_name=display.set_name(row.set_name, row.set_name_fr, user.language),
            set_name_fr=row.set_name_fr,
            series=row.series,
            series_display_name=display.series_name(row.series, user.language),
            card_count=row.card_count,
            release_date=row.release_date,
            **display.set_asset_paths(row.series, row.set_code),
            completion_percent=(
                round(row.owned / row.total * 100) if row.total else None
            ),
        )
        for row in rows
    ]


@router.get("/sets/{set_code}/cards", response_model=list[s.CatalogCardOut])
def list_set_cards(
    set_code: str, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Every card of a set, by number (numeric first, then the others)."""
    cards = db.scalars(
        select(m.CardCatalog)
        .where(m.CardCatalog.set_code == set_code)
        .options(selectinload(m.CardCatalog.variants))
        .order_by(search.numeric_card_number().nulls_last(), m.CardCatalog.card_number)
    ).all()
    if not cards:
        raise not_found("Set")
    return [catalog_out(card, user.language) for card in cards]


# ── missing cards as text ────────────────────────────────────────────────────


def _missing_cards(
    db: Session,
    user_id: int,
    set_codes: list[str],
    rarity: list[str] | None,
    exclude_deck_allocated: bool,
    variant_type: str | None = None,
) -> list[m.CardCatalog]:
    """Cards of `set_codes` the user owns no copy of, by set then number.
    With `variant_type`, only cards printed in it and owned 0 times in that
    exact print; `exclude_deck_allocated` doesn't count copies (of that
    print) in normal decks."""
    vq = m.CardVariantQuantity
    owned_copies = select(vq.card_id, func.sum(vq.quantity).label("copies"))
    in_decks = select(
        m.DeckCard.card_id, func.sum(m.DeckCard.quantity_in_deck).label("copies")
    ).where(m.DeckCard.card_id.isnot(None))
    if variant_type is not None:
        owned_copies = owned_copies.where(vq.variant_type == variant_type)
        in_decks = in_decks.where(m.DeckCard.variant_type == variant_type)
    owned_copies = owned_copies.group_by(vq.card_id).subquery()
    in_decks = in_decks.group_by(m.DeckCard.card_id).subquery()
    have = func.coalesce(owned_copies.c.copies, 0)
    query = (
        select(m.CardCatalog)
        .outerjoin(m.Card, _owned_by(user_id))
        .outerjoin(owned_copies, owned_copies.c.card_id == m.Card.id)
        .where(m.CardCatalog.set_code.in_(set_codes))
    )
    if exclude_deck_allocated:
        query = query.outerjoin(in_decks, in_decks.c.card_id == m.Card.id)
        have = have - func.coalesce(in_decks.c.copies, 0)
    query = query.where(have <= 0)
    if rarity:
        query = query.where(m.CardCatalog.rarity.in_(rarity))
    if variant_type is not None:
        query = query.where(
            m.CardCatalog.variants.any(
                m.CardCatalogVariant.variant_type == variant_type
            )
        )
    return db.scalars(
        query.order_by(
            m.CardCatalog.set_code,
            search.numeric_card_number().nulls_last(),
            m.CardCatalog.card_number,
        )
    ).all()


def _missing_text(
    cards: list[m.CardCatalog], format: decklists.Format, language: str
) -> Response:
    """One copy of each, names in `language` (moves and sets English)."""
    entries = [decklists.entry(card, 1, language) for card in cards]
    return Response(decklists.render(entries, format), media_type="text/plain")


@router.get("/sets/{set_code}/missing/text", response_class=Response)
def export_set_missing_text(
    set_code: str,
    rarity: list[str] | None = Query(None, description="Raw rarity values"),
    format: decklists.Format = "cardmarket",
    language: Literal["en", "fr"] = "en",
    exclude_deck_allocated: bool = Query(
        False, description="Copies in normal decks don't count as owned"
    ),
    variant_type: str | None = Query(None, description="One exact print"),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The set's cards the user owns no copy of, as a TCGplayer/PTCGL or
    Cardmarket list (shopping list)."""
    if not db.scalar(select(exists().where(m.CardCatalog.set_code == set_code))):
        raise not_found("Set")
    if variant_type is not None:
        _check_variant_types([variant_type])
    cards = _missing_cards(
        db, user.id, [set_code], rarity, exclude_deck_allocated, variant_type
    )
    return _missing_text(cards, format, language)


@router.post("/sets/missing/text", response_class=Response)
def export_sets_missing_text(
    body: s.SetCodes,
    rarity: list[str] | None = Query(None, description="Raw rarity values"),
    format: decklists.Format = "cardmarket",
    language: Literal["en", "fr"] = "en",
    exclude_deck_allocated: bool = Query(
        False, description="Copies in normal decks don't count as owned"
    ),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The same over several sets at once, by set then number."""
    known = set(
        db.scalars(
            select(m.CardCatalog.set_code)
            .distinct()
            .where(m.CardCatalog.set_code.in_(body.set_codes))
        )
    )
    unknown = sorted(set(body.set_codes) - known)
    if unknown:
        raise not_found(f"Set {', '.join(unknown)}")
    cards = _missing_cards(db, user.id, list(known), rarity, exclude_deck_allocated)
    return _missing_text(cards, format, language)


# ── missing numbers ──────────────────────────────────────────────────────────


def _intervals(states: dict[int, str]) -> list[dict[str, int]]:
    """Inclusive ranges over consecutive numbers: they start and end on a
    missing number ("anchor"), can cross other rarities ("bridge"), and are
    cut by an owned number ("stop") or a gap in the numbering."""
    result: list[dict[str, int]] = []

    def flush(run: list[tuple[int, str]]) -> None:
        start = last_anchor = None
        for number, state in run:
            if state == "stop":
                if start is not None:
                    result.append({"start_number": start, "end_number": last_anchor})
                start = last_anchor = None
            elif state == "anchor":
                start = number if start is None else start
                last_anchor = number
        if start is not None:
            result.append({"start_number": start, "end_number": last_anchor})

    run: list[tuple[int, str]] = []
    previous = None
    for number, state in sorted(states.items()):
        if previous is not None and number != previous + 1:
            flush(run)
            run = []
        run.append((number, state))
        previous = number
    flush(run)
    return result


@router.get("/missing-intervals", response_model=list[s.MissingSetIntervals])
def list_missing_intervals(
    rarity: list[str] | None = Query(None, description="Raw rarity values"),
    variant_type: str | None = Query(None, description="One exact print"),
    reverse: bool = Query(False, description="Same as variant_type=reverse"),
    user: User = Depends(cards_user),
    db: Session = Depends(get_db),
):
    """The user's missing numeric card numbers per set, as ranges. Only sets
    with at least one missing selected card. A number shared by several
    selected cards stays missing until all of them are owned."""
    requested = variant_type or ("reverse" if reverse else None)
    if requested is not None:
        _check_variant_types([requested])
    number = search.numeric_card_number()
    query = (
        select(
            m.CardCatalog.id,
            m.CardCatalog.set_code,
            m.CardCatalog.set_name,
            m.CardCatalog.set_name_fr,
            m.CardCatalog.series,
            number.label("number"),
            m.CardCatalog.rarity,
            m.Card.id.label("owned_card_id"),
        )
        .outerjoin(m.Card, _owned_by(user.id))
        .where(number.isnot(None))
    )
    if requested:
        query = (
            query.add_columns(m.CardVariantQuantity.quantity.label("variant_quantity"))
            .outerjoin(
                m.CardVariantQuantity,
                and_(
                    m.CardVariantQuantity.card_id == m.Card.id,
                    m.CardVariantQuantity.variant_type == requested,
                ),
            )
            .where(
                exists().where(
                    m.CardCatalogVariant.card_catalog_id == m.CardCatalog.id,
                    m.CardCatalogVariant.variant_type == requested,
                )
            )
        )

    grouped: dict[tuple[str, str, str | None], dict[int, str]] = {}
    for row in db.execute(query):
        owned = row.owned_card_id is not None
        if requested:
            owned = owned and (row.variant_quantity or 0) > 0
        selected = not rarity or row.rarity in rarity
        name = display.set_name(row.set_name, row.set_name_fr, user.language)
        states = grouped.setdefault((row.set_code, name, row.series), {})
        previous = states.get(row.number)
        if selected and not owned:
            states[row.number] = "anchor"
        elif selected and previous != "anchor":
            states[row.number] = "stop"
        elif previous is None:
            states[row.number] = "bridge"

    def numbers(states: dict[int, str], state: str) -> list[int]:
        return sorted(n for n, st in states.items() if st == state)

    result = [
        s.MissingSetIntervals(
            set_code=code,
            set_name=name,
            series=series,
            symbol_path=display.set_asset_paths(series, code)["symbol_path"],
            missing_count=len(numbers(states, "anchor")),
            intervals=_intervals(states),
            missing_numbers=numbers(states, "anchor"),
            owned_numbers=numbers(states, "stop"),
            excluded_numbers=numbers(states, "bridge"),
        )
        for (code, name, series), states in grouped.items()
        if "anchor" in states.values()
    ]
    return sorted(result, key=lambda r: (r.set_name.lower(), r.set_code))


# ── filter options ───────────────────────────────────────────────────────────


@router.get("/supertypes", response_model=list[str])
def list_supertypes(_: User = Depends(cards_user), db: Session = Depends(get_db)):
    column = m.CardCatalog.supertype
    return db.scalars(
        select(distinct(column)).where(column.isnot(None)).order_by(column)
    ).all()


@router.get("/rarities", response_model=list[str])
def list_rarities(_: User = Depends(cards_user), db: Session = Depends(get_db)):
    column = m.CardCatalog.rarity
    return db.scalars(
        select(distinct(column)).where(column.isnot(None)).order_by(column)
    ).all()


@router.get("/variant-types", response_model=list[str])
def list_variant_types(_: User = Depends(cards_user), db: Session = Depends(get_db)):
    """Non-standard prints present anywhere in the catalog, in display order."""
    column = m.CardCatalogVariant.variant_type
    types = db.scalars(select(distinct(column)).where(column != "standard")).all()
    return sorted(types, key=variant_sort_key)


# ── one card ─────────────────────────────────────────────────────────────────


def _catalog_card_or_404(db: Session, catalog_id: int) -> m.CardCatalog:
    card = db.get(m.CardCatalog, catalog_id)
    if card is None:
        raise not_found("Card")
    return card


@router.get("/{catalog_id}", response_model=s.CatalogCardOut)
def get_catalog_card(
    catalog_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    return catalog_out(_catalog_card_or_404(db, catalog_id), user.language)


@router.patch("/{catalog_id}", response_model=s.CatalogCardOut)
def update_catalog_card_name(
    catalog_id: int,
    body: s.CatalogNameUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Correct the English name (a parsing mistake). The French name comes
    from the French source page; fix it there."""
    card = _catalog_card_or_404(db, catalog_id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Name is empty")
    card.name = name
    db.commit()
    return catalog_out(card, user.language)


@router.get("/{catalog_id}/variants", response_model=list[s.CatalogVariantOut])
def get_catalog_card_variants(
    catalog_id: int, _: User = Depends(cards_user), db: Session = Depends(get_db)
):
    return _catalog_card_or_404(db, catalog_id).variants


@router.get("/{catalog_id}/deck-usage", response_model=s.CatalogDeckUsage)
def get_catalog_card_deck_usage(
    catalog_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """The user's normal decks holding owned copies of this card (summed over
    prints), and their phantom decks wanting it."""
    _catalog_card_or_404(db, catalog_id)
    quantity = func.sum(m.DeckCard.quantity_in_deck)
    usage = select(m.Deck.id, m.Deck.name, quantity).join(m.Deck.deck_cards)
    allocated = db.execute(
        usage.join(m.Card, m.Card.id == m.DeckCard.card_id)
        .where(m.Card.catalog_id == catalog_id, m.Card.user_id == user.id)
        .group_by(m.Deck.id)
        .order_by(m.Deck.name)
    ).all()
    phantom = db.execute(
        usage.where(
            m.DeckCard.catalog_id == catalog_id,
            m.Deck.deck_type == "phantom",
            m.Deck.user_id == user.id,
        )
        .group_by(m.Deck.id)
        .order_by(m.Deck.name)
    ).all()

    def out(rows) -> list[s.DeckUsage]:
        return [
            s.DeckUsage(deck_id=row[0], deck_name=row[1], quantity_in_deck=row[2])
            for row in rows
        ]

    return s.CatalogDeckUsage(
        allocated_decks=out(allocated), phantom_decks=out(phantom)
    )
