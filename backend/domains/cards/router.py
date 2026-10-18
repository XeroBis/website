"""`/api/cards`: every route needs the `cards` app, except `public/...` (see
routers/)."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/cards")
