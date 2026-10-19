"""`/api/cards`: every route needs the `cards` app, except `public/...` (see
routers/)."""

from fastapi import APIRouter

from domains.cards.routers import (
    catalog,
    catalog_admin,
    collection,
    combats,
    convert,
    decks,
    drafts,
    images,
    purchase_lists,
    purchases,
    shares,
    shopping_lists,
    users,
)

router = APIRouter(prefix="/api/cards")

# catalog_admin first: its /catalog/stats and /catalog/export would otherwise
# match catalog's /catalog/{catalog_id}.
for module in (
    catalog_admin,
    catalog,
    collection,
    decks,
    drafts,
    convert,
    images,
    combats,
    purchases,
    purchase_lists,
    shopping_lists,
    shares,
    users,
):
    router.include_router(module.router)
router.include_router(shares.public_router)
router.include_router(catalog_admin.public_router)
