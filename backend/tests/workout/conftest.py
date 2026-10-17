"""Fixtures for the workout tests: logged-in clients with the `workout` app,
and a small exercise catalog."""

import pytest
from fastapi.testclient import TestClient

import app
from core.security import CSRF_COOKIE
from tests.conftest import login, make_user

URL = "/api/workout"


@pytest.fixture
def workout_client():
    """`workout_client(email, **make_user kwargs)`: a client logged in as a new
    user with the `workout` app (unless `apps` says otherwise), sending the
    CSRF header on every request."""
    clients: list[TestClient] = []

    def _make(email: str, **user) -> TestClient:
        created = make_user(email=email, **({"apps": ("workout",)} | user))
        c = TestClient(app.app)
        c.__enter__()
        assert login(c, email=email).status_code == 200
        c.headers["x-csrf-token"] = c.cookies.get(CSRF_COOKIE)
        c.user_id = created.id
        clients.append(c)
        return c

    yield _make
    for c in clients:
        c.__exit__(None, None, None)


@pytest.fixture
def client(workout_client):
    """A workout user (overrides the anonymous root `client`)."""
    return workout_client("alice@example.com", pseudo="Alice")


@pytest.fixture
def other_client(workout_client):
    """A second workout user."""
    return workout_client("bob@example.com", pseudo="Bob")


@pytest.fixture
def admin(workout_client):
    return workout_client("root@example.com", pseudo="Root", apps=(), is_admin=True)


@pytest.fixture
def anon():
    with TestClient(app.app) as c:
        yield c


EXERCISES = [
    {
        "name": "Bench press",
        "type": "strength",
        "muscles": [
            {"name": "Chest", "intensity": 3},
            {"name": "Triceps", "intensity": 2},
        ],
        "equipments": ["Barbell", "Bench"],
    },
    {
        "name": "Squat",
        "type": "strength",
        "muscles": [
            {"name": "Quads", "intensity": 3},
            {"name": "Glutes", "intensity": 2},
        ],
        "equipments": ["Barbell"],
    },
    {
        "name": "Running",
        "type": "cardio",
        "muscles": [{"name": "Calves", "intensity": 1}],
        "equipments": [],
    },
    {"name": "Pull-ups", "type": "strength", "muscles": [], "equipments": []},
]


@pytest.fixture
def ex(client) -> dict[str, int]:
    """The catalog above, created by `client`: name -> exercise id."""
    ids = {}
    for body in EXERCISES:
        r = client.post(f"{URL}/exercises", json=body)
        assert r.status_code == 201, r.text
        ids[body["name"]] = r.json()["id"]
    return ids


def strength(exercise_id: int, *sets: tuple[int, float]) -> dict:
    """A top-level exercise entry: `strength(id, (10, 40), (8, 45))`."""
    return {
        "type": "exercise",
        "exercise_id": exercise_id,
        "sets": [{"reps": r, "weight_kg": w} for r, w in sets],
    }


def workout_body(day: str = "2026-10-05", duration: int = 60, entries=None) -> dict:
    return {"date": day, "duration_minutes": duration, "exercises": entries or []}


@pytest.fixture
def add_workout(client, ex):
    """Log a workout as `client`; defaults to one bench press entry."""

    def _add(day="2026-10-05", entries=None, duration=60, as_client=None) -> dict:
        body = workout_body(
            day, duration, entries or [strength(ex["Bench press"], (10, 40))]
        )
        r = (as_client or client).post(f"{URL}/workouts", json=body)
        assert r.status_code == 201, r.text
        return r.json()

    return _add
