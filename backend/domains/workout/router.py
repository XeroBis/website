"""`/api/workout`: every route needs the `workout` app (see routers/)."""

from fastapi import APIRouter

from domains.workout.routers import (
    admin,
    catalog,
    circuits,
    session,
    stats,
    templates,
    transfer,
    users,
    workouts,
)

router = APIRouter(prefix="/api/workout")

# `transfer` first: its `/workouts/export` must match before `/workouts/{id}`.
for module in (
    transfer,
    users,
    catalog,
    workouts,
    templates,
    circuits,
    session,
    stats,
    admin,
):
    router.include_router(module.router)
