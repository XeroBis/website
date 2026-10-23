"""The live session: start (blank or from a template), edit, finish, discard."""

from datetime import UTC, datetime

from core import database
from domains.workout.models import Workout
from tests.workout.conftest import URL, strength

S = f"{URL}/session"


def _template(client, ex) -> dict:
    body = {
        "name": "Push",
        "exercises": [
            strength(ex["Bench press"], (10, 40), (10, 40)),
            {
                "type": "circuit",
                "name": "Finisher",
                "rounds": 3,
                "exercises": [{"exercise_id": ex["Pull-ups"], "sets": [{"reps": 8}]}],
            },
        ],
    }
    return client.post(f"{URL}/templates", json=body).json()


def test_no_session(client):
    assert client.get(S).json() is None
    assert client.delete(S).status_code == 404
    assert client.post(f"{S}/finish", json={}).status_code == 404
    assert client.post(f"{S}/exercises", json={"exercise_id": 1}).status_code == 404


def test_start_from_a_template(client, ex):
    t = _template(client, ex)
    r = client.post(S, json={"template_id": t["id"]})
    assert r.status_code == 201
    s = r.json()
    assert s["status"] == "in_progress" and s["date"] is None and s["started_at"]
    bench, finisher = s["exercises"]
    # Exercises keep their planned sets; circuit members start empty.
    assert [x["reps"] for x in bench["sets"]] == [10, 10]
    assert (finisher["name"], finisher["rounds"]) == ("Finisher", 3)
    assert finisher["exercises"][0]["sets"] == []
    assert client.get(S).json() == s
    # One at a time, and it isn't listed with completed workouts.
    assert client.post(S, json={}).status_code == 409
    assert client.get(f"{URL}/workouts").json() == []
    assert client.get(f"{URL}/workouts/{s['id']}").status_code == 404


def test_someone_elses_template_is_a_404(client, other_client, ex):
    t = _template(client, ex)
    assert other_client.post(S, json={"template_id": t["id"]}).status_code == 404
    assert other_client.get(S).json() is None


def test_repeat_a_workout(client, other_client, ex, add_workout):
    circuit = {
        "type": "circuit",
        "name": "Finisher",
        "rounds": 2,
        "exercises": [
            {"exercise_id": ex["Pull-ups"], "sets": [{"reps": 8}, {"reps": 7}]}
        ],
    }
    w = add_workout(entries=[strength(ex["Bench press"], (10, 40), (8, 45)), circuit])
    # Someone else's, through user_id (read-only sharing).
    r = other_client.post(S, json={"workout_id": w["id"], "user_id": client.user_id})
    assert r.status_code == 201
    bench, finisher = r.json()["exercises"]
    # Logged sets become the plan; circuit members start empty, like a template.
    assert [(x["reps"], x["weight_kg"]) for x in bench["sets"]] == [(10, 40), (8, 45)]
    assert (finisher["name"], finisher["rounds"]) == ("Finisher", 2)
    assert finisher["exercises"][0]["sets"] == []
    # The source workout is untouched.
    assert client.get(f"{URL}/workouts/{w['id']}").json() == w
    # Your own, without user_id.
    assert client.post(S, json={"workout_id": w["id"]}).status_code == 201


def test_repeat_refusals(client, other_client, ex, add_workout):
    w = add_workout()
    # Not yours and no user_id, unknown, or a live session: 404.
    assert other_client.post(S, json={"workout_id": w["id"]}).status_code == 404
    assert client.post(S, json={"workout_id": 999999}).status_code == 404
    live = other_client.post(S, json={}).json()
    body = {"workout_id": live["id"], "user_id": other_client.user_id}
    assert client.post(S, json=body).status_code == 404
    t = _template(client, ex)
    body = {"template_id": t["id"], "workout_id": w["id"]}
    assert client.post(S, json=body).status_code == 422
    assert client.get(S).json() is None


def test_edit_and_finish_keeps_only_checked_sets(client, ex):
    client.post(S, json={})
    bench = client.post(
        f"{S}/exercises", json={"exercise_id": ex["Bench press"]}
    ).json()
    assert bench["sets"] == []
    s1 = client.post(
        f"{S}/exercises/{bench['id']}/sets", json={"reps": 10, "weight_kg": 40}
    )
    assert s1.status_code == 201
    s1 = s1.json()
    client.post(f"{S}/exercises/{bench['id']}/sets", json={"reps": 10})  # unchecked
    r = client.put(f"{S}/sets/{s1['id']}", json={"reps": 12, "weight_kg": 42.5})
    assert (r.json()["reps"], r.json()["weight_kg"]) == (12, 42.5)
    s3 = client.post(f"{S}/exercises/{bench['id']}/sets", json={"reps": 1}).json()
    assert client.delete(f"{S}/sets/{s3['id']}").status_code == 204

    circuit = client.post(
        f"{S}/circuits",
        json={
            "name": "C",
            "rounds": 2,
            "exercise_ids": [ex["Pull-ups"], ex["Running"]],
        },
    ).json()
    assert [e["exercise"]["name"] for e in circuit["exercises"]] == [
        "Pull-ups",
        "Running",
    ]
    pullups, running = circuit["exercises"]
    p1 = client.post(f"{S}/exercises/{pullups['id']}/sets", json={"reps": 8}).json()
    client.post(f"{S}/exercises/{running['id']}/sets", json={"duration_s": 60})
    squat = client.post(
        f"{S}/exercises", json={"exercise_id": ex["Squat"], "circuit_id": circuit["id"]}
    ).json()
    empty = client.post(f"{S}/circuits", json={"exercise_ids": [ex["Squat"]]}).json()
    current = client.get(S).json()
    assert [e["type"] for e in current["exercises"]] == [
        "exercise",
        "circuit",
        "circuit",
    ]
    assert len(current["exercises"][1]["exercises"]) == 3
    assert squat["sets"] == [] and empty["name"] is None

    r = client.post(
        f"{S}/finish",
        json={"checked_set_ids": [s1["id"], p1["id"]], "date": "2026-10-17"},
    )
    assert r.status_code == 200
    w = r.json()
    assert (w["status"], w["date"], w["duration_minutes"]) == (
        "completed",
        "2026-10-17",
        1,
    )
    assert w["ended_at"]
    # Unchecked sets are gone, then emptied exercises, then emptied circuits.
    assert len(w["exercises"]) == 2
    assert [x["id"] for x in w["exercises"][0]["sets"]] == [s1["id"]]
    assert [e["id"] for e in w["exercises"][1]["exercises"]] == [pullups["id"]]
    assert client.get(S).json() is None
    assert client.get(f"{URL}/workouts").json()[0]["id"] == w["id"]


def test_finish_dates_and_times_from_the_start(client):
    s = client.post(S, json={}).json()
    with database.SessionLocal() as db:
        db.get(Workout, s["id"]).started_at = datetime(2026, 10, 3, 23, 30, tzinfo=UTC)
        db.commit()
    w = client.post(f"{S}/finish", json={}).json()
    assert w["date"] == "2026-10-03"
    # Elapsed since then, capped at a day.
    assert w["duration_minutes"] == 1440


def test_remove_entries_and_discard(client, ex):
    client.post(S, json={})
    row = client.post(f"{S}/exercises", json={"exercise_id": ex["Squat"]}).json()
    c = client.post(f"{S}/circuits", json={"exercise_ids": [ex["Squat"]]}).json()
    assert client.delete(f"{S}/exercises/{row['id']}").status_code == 204
    assert client.delete(f"{S}/circuits/{c['id']}").status_code == 204
    assert client.get(S).json()["exercises"] == []
    assert client.delete(f"{S}/exercises/{row['id']}").status_code == 404
    assert client.delete(f"{S}/circuits/{c['id']}").status_code == 404
    assert client.delete(S).status_code == 204
    assert client.get(S).json() is None


def test_unknown_ids_and_validation(client, ex):
    client.post(S, json={})
    assert (
        client.post(f"{S}/exercises", json={"exercise_id": 999999}).status_code == 404
    )
    r = client.post(
        f"{S}/exercises", json={"exercise_id": ex["Squat"], "circuit_id": 999999}
    )
    assert r.status_code == 404
    assert (
        client.post(f"{S}/circuits", json={"exercise_ids": [999999]}).status_code == 404
    )
    assert (
        client.post(f"{S}/exercises/999999/sets", json={"reps": 1}).status_code == 404
    )
    assert client.put(f"{S}/sets/999999", json={"reps": 1}).status_code == 404
    row = client.post(f"{S}/exercises", json={"exercise_id": ex["Squat"]}).json()
    r = client.post(f"{S}/exercises/{row['id']}/sets", json={"reps": 0})
    assert r.status_code == 422


def test_cant_touch_someone_elses_session(client, other_client, ex):
    client.post(S, json={})
    row = client.post(f"{S}/exercises", json={"exercise_id": ex["Squat"]}).json()
    set_ = client.post(f"{S}/exercises/{row['id']}/sets", json={"reps": 5}).json()
    other_client.post(S, json={})
    assert (
        other_client.post(
            f"{S}/exercises/{row['id']}/sets", json={"reps": 1}
        ).status_code
        == 404
    )
    assert (
        other_client.put(f"{S}/sets/{set_['id']}", json={"reps": 1}).status_code == 404
    )
    assert other_client.delete(f"{S}/sets/{set_['id']}").status_code == 404
    assert other_client.delete(f"{S}/exercises/{row['id']}").status_code == 404
    # Another user's live session isn't readable through sharing either.
    r = other_client.get(f"{URL}/workouts", params={"user_id": client.user_id})
    assert r.json() == []
