"""Every `/api/workout` route: logged out → 401, no workout app → 403, unsafe
without CSRF → 403, admin-only routes → 403 for a plain workout user."""

import pytest

from tests.workout.conftest import URL, workout_body

SET = {"reps": 5}
WORKOUT = workout_body(entries=[{"type": "exercise", "exercise_id": 1, "sets": [SET]}])
TEMPLATE = {"name": "T", "exercises": WORKOUT["exercises"]}
CIRCUIT = {"name": "C", "exercises": [{"exercise_id": 1, "sets": [SET]}]}
EXERCISE = {"name": "E", "type": "strength"}

# (method, path, json body)
READS = [
    ("GET", "/users", None),
    ("GET", "/muscles", None),
    ("GET", "/exercises", None),
    ("GET", "/exercises/1", None),
    ("GET", "/equipments", None),
    ("GET", "/workouts", None),
    ("GET", "/workouts/1", None),
    ("GET", "/stats", None),
    ("GET", "/templates", None),
    ("GET", "/templates/1", None),
    ("GET", "/circuits", None),
    ("GET", "/circuits/1", None),
    ("GET", "/session", None),
    ("GET", "/workouts/export", None),
    ("GET", "/templates/export", None),
    ("GET", "/circuits/export", None),
]
WRITES = [
    ("POST", "/exercises", EXERCISE),
    ("POST", "/equipments", {"name": "Q"}),
    ("POST", "/workouts", WORKOUT),
    ("PUT", "/workouts/1", WORKOUT),
    ("DELETE", "/workouts/1", None),
    ("POST", "/templates", TEMPLATE),
    ("PUT", "/templates/1", TEMPLATE),
    ("DELETE", "/templates/1", None),
    ("POST", "/templates/1/copy", None),
    ("POST", "/circuits", CIRCUIT),
    ("PUT", "/circuits/1", CIRCUIT),
    ("DELETE", "/circuits/1", None),
    ("POST", "/session", {}),
    ("DELETE", "/session", None),
    ("POST", "/session/finish", {}),
    ("POST", "/session/exercises", {"exercise_id": 1}),
    ("DELETE", "/session/exercises/1", None),
    ("POST", "/session/circuits", {}),
    ("DELETE", "/session/circuits/1", None),
    ("POST", "/session/exercises/1/sets", SET),
    ("PUT", "/session/sets/1", SET),
    ("DELETE", "/session/sets/1", None),
    ("POST", "/workouts/import", []),
    ("POST", "/templates/import", []),
    ("POST", "/circuits/import", []),
]
ADMIN_READS = [
    ("GET", "/admin/workouts/export", None),
    ("GET", "/admin/templates/export", None),
    ("GET", "/admin/exercises/export", None),
    ("GET", "/admin/equipments/export", None),
]
ADMIN_WRITES = [
    ("PUT", "/exercises/1", EXERCISE),
    ("DELETE", "/exercises/1", None),
    ("PUT", "/equipments/1", {"name": "Q"}),
    ("DELETE", "/equipments/1", None),
    ("POST", "/admin/workouts/import", []),
    ("POST", "/admin/templates/import", []),
    ("POST", "/admin/exercises/import", []),
    ("POST", "/admin/equipments/import", []),
    ("DELETE", "/admin/workouts", None),
    ("DELETE", "/admin/templates", None),
    ("DELETE", "/admin/exercises", None),
    ("DELETE", "/admin/equipments", None),
]
ALL = READS + WRITES + ADMIN_READS + ADMIN_WRITES


def call(client, method, path, body, **kwargs):
    return client.request(method, URL + path, json=body, **kwargs)


@pytest.mark.parametrize(("method", "path", "body"), ALL)
def test_logged_out_is_401(anon, method, path, body):
    assert call(anon, method, path, body).status_code == 401


@pytest.mark.parametrize(("method", "path", "body"), ALL)
def test_without_the_workout_app_is_403(workout_client, method, path, body):
    other_apps = workout_client("media@example.com", apps=("media",))
    r = call(other_apps, method, path, body)
    assert r.status_code == 403
    assert r.json()["detail"] == "No access to this app" or path.startswith(
        ("/admin", "/exercises/1", "/equipments/1")
    )


@pytest.mark.parametrize(("method", "path", "body"), WRITES + ADMIN_WRITES)
def test_unsafe_without_csrf_is_403(admin, method, path, body):
    del admin.headers["x-csrf-token"]
    r = call(admin, method, path, body)
    assert r.status_code == 403
    assert r.json()["detail"] == "CSRF token missing or invalid"


@pytest.mark.parametrize(("method", "path", "body"), ADMIN_READS + ADMIN_WRITES)
def test_admin_only_routes_refuse_workout_users(client, method, path, body):
    r = call(client, method, path, body)
    assert r.status_code == 403
    assert r.json()["detail"] == "Admin only"


@pytest.mark.parametrize(("method", "path", "body"), READS)
def test_reads_work_for_a_workout_user(client, method, path, body):
    assert call(client, method, path, body).status_code in (200, 404)


def test_users_lists_workout_users_only_current_first(
    client, other_client, admin, workout_client
):
    workout_client("media@example.com", pseudo="Media", apps=("media",))
    r = other_client.get(f"{URL}/users")
    assert [u["pseudo"] for u in r.json()] == ["Bob", "Alice", "Root"]
    assert set(r.json()[0]) == {"id", "pseudo"}
