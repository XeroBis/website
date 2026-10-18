"""`/api/cards`: every route needs the `cards` app, except `public/...` (see
routers/)."""

from fastapi import APIRouter

from domains.cards.routers import (
    catalog,
    collection,
    combats,
    convert,
    decks,
    drafts,
    images,
    purchases,
    shares,
    shopping_lists,
    users,
)

router = APIRouter(prefix="/api/cards")

for module in (
    catalog,
    collection,
    decks,
    drafts,
    convert,
    images,
    combats,
    purchases,
    shopping_lists,
    shares,
    users,
):
    router.include_router(module.router)
router.include_router(shares.public_router)
