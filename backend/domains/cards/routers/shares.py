"""Share links to one set of a user's collection.

`/api/cards/shares` creates, lists and revokes the user's own links.
`/api/cards/public/shares/{token}` is the public read-only page (no auth
dependency, no CSRF) with its own image, logo and symbol routes, which only
serve files of that one set: card images otherwise sit behind
`require_app("cards")`. An unknown, expired or revoked token is the same
404."""

import logging
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import exists, func, or_, select
from sqlalchemy.orm import Session, selectinload

from core.database import get_db
from core.models import User
from domains.cards import deck_rules, display, search
from domains.cards import models as m
from domains.cards import schemas as s
from domains.cards.access import cards_user, not_found, owned
from domains.cards.routers.images import data_file

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/shares", tags=["cards"])
public_router = APIRouter(prefix="/public/shares", tags=["cards"])

# Not cached, so a revoked or expired link stops showing its images.
NO_STORE = {"Cache-Control": "private, no-store"}


def _set_names(db: Session, set_codes) -> dict[str, tuple[str, str | None]]:
    """set code → (English, French) title, one query."""
    if not set_codes:
        return {}
    return {
        code: (name, name_fr)
        for code, name, name_fr in db.execute(
            select(
                m.CardCatalog.set_code,
                func.min(m.CardCatalog.set_name),
                func.min(m.CardCatalog.set_name_fr),
            )
            .where(m.CardCatalog.set_code.in_(set_codes))
            .group_by(m.CardCatalog.set_code)
        )
    }


def shares_out(
    db: Session, shares: list[m.SetShare], language: str | None
) -> list[s.ShareOut]:
    names = _set_names(db, {share.set_code for share in shares})
    result = []
    for share in shares:
        name = names.get(share.set_code)
        result.append(
            s.ShareOut(
                id=share.id,
                set_code=share.set_code,
                set_name=display.set_name(*name, language) if name else None,
                token=share.token,
                created_at=share.created_at,
                expires_at=share.expires_at,
                revoked_at=share.revoked_at,
            )
        )
    return result


@router.post("", response_model=s.ShareOut, status_code=status.HTTP_201_CREATED)
def create_share(
    body: s.ShareCreate, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """A link to one set, valid 1, 3, 7 or 30 days."""
    if not db.scalar(select(exists().where(m.CardCatalog.set_code == body.set_code))):
        raise not_found("Set")
    share = m.SetShare(
        user_id=user.id,
        set_code=body.set_code,
        token=secrets.token_urlsafe(24),
        expires_at=datetime.now(UTC) + timedelta(days=body.duration_days),
    )
    db.add(share)
    db.commit()
    logger.info(
        "cards share %s created (user %s, set %s)", share.id, user.id, share.set_code
    )
    return shares_out(db, [share], user.language)[0]


@router.get("", response_model=list[s.ShareOut])
def list_shares(user: User = Depends(cards_user), db: Session = Depends(get_db)):
    """The user's links, newest first, whatever their status."""
    shares = db.scalars(
        select(m.SetShare)
        .where(m.SetShare.user_id == user.id)
        .order_by(m.SetShare.created_at.desc(), m.SetShare.id.desc())
    ).all()
    return shares_out(db, shares, user.language)


@router.delete("/{share_id}", response_model=s.ShareOut)
def revoke_share(
    share_id: int, user: User = Depends(cards_user), db: Session = Depends(get_db)
):
    """Revoke one of the user's links (again: no change). The row is kept."""
    share = owned(db, m.SetShare, share_id, user.id, "Share")
    if share.revoked_at is None:
        share.revoked_at = datetime.now(UTC)
        db.commit()
        logger.info("cards share %s revoked (user %s)", share.id, user.id)
    return shares_out(db, [share], user.language)[0]


# ── public ───────────────────────────────────────────────────────────────────


def _active_share(db: Session, token: str) -> m.SetShare:
    share = db.scalar(select(m.SetShare).where(m.SetShare.token == token))
    if (
        share is None
        or share.revoked_at is not None
        or share.expires_at <= datetime.now(UTC)
    ):
        raise not_found("Share link")
    return share


@public_router.get("/{token}", response_model=s.SharedSetOut)
def get_shared_set(token: str, db: Session = Depends(get_db)):
    """The set's cards by number with what the owner has of each, recomputed
    on every read. English values; nothing about the owner."""
    share = _active_share(db, token)
    cards = db.scalars(
        select(m.CardCatalog)
        .where(m.CardCatalog.set_code == share.set_code)
        .options(selectinload(m.CardCatalog.variants))
        .order_by(search.numeric_card_number().nulls_last(), m.CardCatalog.card_number)
    ).all()
    if not cards:
        raise not_found("Share link")
    owned_cards = deck_rules.owned_cards(db, share.user_id, [card.id for card in cards])
    result = []
    for card in cards:
        copies = owned_cards.get(card.id)
        scans = {variant.variant_type: variant for variant in card.variants}
        result.append(
            s.SharedSetCardOut(
                id=card.id,
                name=card.name,
                set_code=card.set_code,
                set_name=card.set_name,
                card_number=card.card_number,
                image_path=card.image_path,
                rarity=card.rarity,
                supertype=card.supertype,
                quantity_owned=(
                    sum(vq.quantity for vq in copies.variant_quantities)
                    if copies
                    else 0
                ),
                variants=[
                    s.OwnedVariantOut(
                        variant_type=vq.variant_type,
                        quantity=vq.quantity,
                        image_path_fr=getattr(
                            scans.get(vq.variant_type), "image_path_fr", None
                        ),
                        image_path_us=getattr(
                            scans.get(vq.variant_type), "image_path_us", None
                        ),
                    )
                    for vq in (copies.variant_quantities if copies else [])
                ],
                print_variants=[
                    s.CatalogVariantOut.model_validate(variant)
                    for variant in card.variants
                ],
            )
        )
    first = cards[0]
    return s.SharedSetOut(
        set_code=share.set_code,
        set_name=first.set_name,
        series=first.series,
        card_count=first.card_count,
        release_date=first.release_date,
        expires_at=share.expires_at,
        cards=result,
    )


@public_router.get("/{token}/images/{relative_path:path}")
def get_shared_image(token: str, relative_path: str, db: Session = Depends(get_db)):
    """A scan (or its thumbnail) of a card or print of the shared set."""
    share = _active_share(db, token)
    # A thumbnail has no column: it is its scan's path with /thumbnails/.
    scan = relative_path.replace("/thumbnails/", "/cards/")
    card = m.CardCatalog
    variant = m.CardCatalogVariant
    in_set = db.scalar(
        select(
            exists().where(
                card.set_code == share.set_code,
                or_(card.image_path == scan, card.image_path_fr == scan),
            )
            | exists().where(
                variant.card_catalog_id == card.id,
                card.set_code == share.set_code,
                or_(variant.image_path_fr == scan, variant.image_path_us == scan),
            )
        )
    )
    if not in_set:
        raise not_found("Image")
    return FileResponse(data_file(relative_path), headers=NO_STORE)


def _set_asset(db: Session, share: m.SetShare) -> dict[str, str | None]:
    series = db.scalar(
        select(m.CardCatalog.series)
        .where(m.CardCatalog.set_code == share.set_code)
        .limit(1)
    )
    return display.set_asset_paths(series, share.set_code)


@public_router.get("/{token}/logo")
def get_shared_logo(token: str, db: Session = Depends(get_db)):
    """The English logo, else the French one (a few sets only have that)."""
    paths = _set_asset(db, _active_share(db, token))
    for path in (paths["logo_path"], paths["logo_path_fr"]):
        if path:
            try:
                file = data_file(path)
            except HTTPException:
                continue
            return FileResponse(file, headers=NO_STORE)
    raise not_found("Image")


@public_router.get("/{token}/symbol")
def get_shared_symbol(token: str, db: Session = Depends(get_db)):
    path = _set_asset(db, _active_share(db, token))["symbol_path"]
    if path is None:
        raise not_found("Image")
    return FileResponse(data_file(path), headers=NO_STORE)
