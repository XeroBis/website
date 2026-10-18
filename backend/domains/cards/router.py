"""`/api/cards`: every route needs the `cards` app, except `public/...` (see
routers/)."""

from fastapi import APIRouter

from domains.cards.routers import catalog, images

router = APIRouter(prefix="/api/cards")

for module in (catalog, images):
    router.include_router(module.router)
