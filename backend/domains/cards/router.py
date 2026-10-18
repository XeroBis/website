"""`/api/cards`: every route needs the `cards` app, except `public/...` (see
routers/)."""

from fastapi import APIRouter

from domains.cards.routers import catalog, collection, convert, decks, drafts, images

router = APIRouter(prefix="/api/cards")

for module in (catalog, collection, decks, drafts, convert, images):
    router.include_router(module.router)
