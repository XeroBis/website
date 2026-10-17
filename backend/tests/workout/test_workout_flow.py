"""The dev-stack check of step 5 as one test: the admin loads the catalog, a
user starts a session from a template, logs sets, sees it in the stats,
exports and re-imports, imports an old export; someone without the workout
app gets nothing, and once granted can view but not edit."""

from fastapi.testclient import TestClient

import app
from core.security import CSRF_COOKIE
from tests.conftest import REGISTER_SECRET
from tests.workout.conftest import EXERCISES, URL
from tests.workout.test_workout_transfer import OLD_WORKOUTS


def test_session_stats_transfer_and_isolation(workout_client):
    admin = workout_client("root@example.com", apps=(), is_admin=True)
    assert (
        admin.post(f"{URL}/admin/exercises/import", json=EXERCISES).json()["created"]
        == 4
    )
    ex = {e["name"]: e["id"] for e in admin.get(f"{URL}/exercises").json()}

    # A template, then a live session from it.
    template = admin.post(
        f"{URL}/templates",
        json={
            "name": "Push",
            "exercises": [
                {
                    "type": "exercise",
                    "exercise_id": ex["Bench press"],
                    "sets": [{"reps": 10, "weight_kg": 40}] * 3,
                }
            ],
        },
    ).json()
    session = admin.post(f"{URL}/session", json={"template_id": template["id"]}).json()
    bench = session["exercises"][0]
    first, second, _third = (s["id"] for s in bench["sets"])
    admin.put(f"{URL}/session/sets/{second}", json={"reps": 8, "weight_kg": 45})
    workout = admin.post(
        f"{URL}/session/finish",
        json={"checked_set_ids": [first, second], "date": "2026-10-18"},
    ).json()
    assert [(s["reps"], s["weight_kg"]) for s in workout["exercises"][0]["sets"]] == [
        (10, 40),
        (8, 45),
    ]

    # On the dashboard.
    stats = admin.get(
        f"{URL}/stats", params={"date_from": "2026-10-01", "date_to": "2026-10-31"}
    ).json()
    assert (stats["workouts"], stats["volume_kg"]) == (1, 760)
    assert stats["days"] == [{"date": "2026-10-18", "workout_ids": [workout["id"]]}]

    # Export, re-import (nothing new), then the old app's export.
    exported = admin.get(f"{URL}/workouts/export").json()
    assert admin.post(f"{URL}/workouts/import", json=exported).json()["created"] == 0
    assert (
        admin.post(f"{URL}/workouts/import", json=OLD_WORKOUTS).json()["created"] == 2
    )
    assert len(admin.get(f"{URL}/workouts").json()) == 3

    # Someone signs up: no workout access.
    with TestClient(app.app) as bob:
        r = bob.post(
            "/api/auth/register",
            json={
                "email": "bob@example.com",
                "password": "bob-password-123",
                "pseudo": "Bob",
            },
            headers={"X-Register-Secret": REGISTER_SECRET},
        )
        assert r.status_code == 201
        bob.headers["x-csrf-token"] = bob.cookies.get(CSRF_COOKIE)
        assert bob.get(f"{URL}/workouts").status_code == 403
        assert bob.get(f"{URL}/workouts/{workout['id']}").status_code == 403

        # Granted: his own empty log, the admin's workouts read-only.
        r = admin.put(
            f"/api/auth/users/{r.json()['id']}/apps", json={"apps": ["workout"]}
        )
        assert r.json()["apps"] == ["workout"]
        assert bob.get(f"{URL}/workouts").json() == []
        assert bob.get(f"{URL}/workouts/{workout['id']}").status_code == 404
        viewing = {"user_id": admin.user_id}
        assert len(bob.get(f"{URL}/workouts", params=viewing).json()) == 3
        body = {
            "date": "2026-10-18",
            "duration_minutes": 1,
            "exercises": [
                {"type": "exercise", "exercise_id": ex["Squat"], "sets": [{"reps": 1}]}
            ],
        }
        assert bob.put(f"{URL}/workouts/{workout['id']}", json=body).status_code == 404
        assert bob.delete(f"{URL}/workouts/{workout['id']}").status_code == 404
        assert len(admin.get(f"{URL}/workouts").json()) == 3
