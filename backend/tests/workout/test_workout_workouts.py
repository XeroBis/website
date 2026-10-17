"""Logged workouts: entries with circuits, listing, editing, sharing."""

from tests.workout.conftest import URL, strength, workout_body


def circuit(*exercise_ids, name="Finisher", rounds=3) -> dict:
    return {
        "type": "circuit",
        "name": name,
        "duration_minutes": 10,
        "rounds": rounds,
        "exercises": [{"exercise_id": i, "sets": [{"reps": 10}]} for i in exercise_ids],
    }


def test_create_with_exercises_and_a_circuit(client, ex):
    entries = [
        strength(ex["Bench press"], (10, 40), (8, 42.5)),
        circuit(ex["Pull-ups"], ex["Running"]),
        {
            "type": "exercise",
            "exercise_id": ex["Running"],
            "sets": [{"duration_s": 600, "distance_m": 2000, "speed_kmh": 12}],
        },
    ]
    r = client.post(f"{URL}/workouts", json=workout_body("2026-10-05", 75, entries))
    assert r.status_code == 201
    w = r.json()
    assert (w["date"], w["duration_minutes"], w["status"]) == (
        "2026-10-05",
        75,
        "completed",
    )
    assert [e["type"] for e in w["exercises"]] == ["exercise", "circuit", "exercise"]
    bench = w["exercises"][0]
    assert bench["exercise"]["name"] == "Bench press"
    assert bench["exercise"]["muscles"][0] == {"name": "Chest", "intensity": 3}
    assert [(s["reps"], s["weight_kg"]) for s in bench["sets"]] == [(10, 40), (8, 42.5)]
    c = w["exercises"][1]
    assert (c["name"], c["duration_minutes"], c["rounds"]) == ("Finisher", 10, 3)
    assert [e["exercise"]["name"] for e in c["exercises"]] == ["Pull-ups", "Running"]
    assert w["exercises"][2]["sets"][0]["distance_m"] == 2000
    assert client.get(f"{URL}/workouts/{w['id']}").json() == w


def test_list_is_newest_first_with_filters_and_paging(client, ex, add_workout):
    a = add_workout("2026-09-01")
    b = add_workout("2026-10-01", entries=[strength(ex["Squat"], (5, 80))])
    c = add_workout("2026-10-01")
    ids = lambda r: [w["id"] for w in r.json()]  # noqa: E731
    assert ids(client.get(f"{URL}/workouts")) == [c["id"], b["id"], a["id"]]
    assert ids(client.get(f"{URL}/workouts", params={"limit": 1, "offset": 1})) == [
        b["id"]
    ]
    assert ids(client.get(f"{URL}/workouts", params={"date_from": "2026-09-15"})) == [
        c["id"],
        b["id"],
    ]
    assert ids(client.get(f"{URL}/workouts", params={"date_to": "2026-09-15"})) == [
        a["id"]
    ]
    r = client.get(f"{URL}/workouts", params={"exercise_id": ex["Squat"]})
    assert ids(r) == [b["id"]]
    assert client.get(f"{URL}/workouts", params={"limit": 101}).status_code == 422


def test_exercise_filter_includes_circuit_members(client, ex, add_workout):
    w = add_workout(entries=[circuit(ex["Pull-ups"])])
    r = client.get(f"{URL}/workouts", params={"exercise_id": ex["Pull-ups"]})
    assert [x["id"] for x in r.json()] == [w["id"]]


def test_update_replaces_everything(client, ex, add_workout):
    w = add_workout()
    body = workout_body("2026-10-06", 30, [circuit(ex["Squat"])])
    r = client.put(f"{URL}/workouts/{w['id']}", json=body)
    assert r.status_code == 200
    assert (r.json()["date"], r.json()["duration_minutes"]) == ("2026-10-06", 30)
    assert [e["type"] for e in r.json()["exercises"]] == ["circuit"]
    assert client.get(f"{URL}/workouts/{w['id']}").json() == r.json()


def test_delete(client, add_workout):
    w = add_workout()
    assert client.delete(f"{URL}/workouts/{w['id']}").status_code == 204
    assert client.get(f"{URL}/workouts/{w['id']}").status_code == 404
    assert client.delete(f"{URL}/workouts/{w['id']}").status_code == 404


def test_validation(client, ex):
    ok = strength(ex["Bench press"], (5, 50))
    for body in (
        workout_body(entries=[]),
        workout_body(duration=0, entries=[ok]),
        workout_body(duration=1441, entries=[ok]),
        {"duration_minutes": 10, "exercises": [ok]},
        workout_body(entries=[{"type": "exercise", "exercise_id": 1, "sets": []}]),
        workout_body(entries=[{"type": "yoga", "exercise_id": 1, "sets": [{}]}]),
        workout_body(entries=[strength(ex["Bench press"], (0, 50))]),
        workout_body(entries=[strength(ex["Bench press"], (5, 2000))]),
        workout_body(entries=[{**circuit(ex["Squat"]), "rounds": 0}]),
        workout_body(entries=[{**circuit(), "exercises": []}]),
    ):
        assert client.post(f"{URL}/workouts", json=body).status_code == 422, body
    r = client.post(
        f"{URL}/workouts", json=workout_body(entries=[strength(999999, (5, 5))])
    )
    assert r.status_code == 404


def test_other_users_can_read_but_not_change(
    client, other_client, workout_client, ex, add_workout
):
    mine = add_workout()
    me = {"user_id": client.user_id}
    # Bob sees nothing of his own, but Alice's workouts when he asks.
    assert other_client.get(f"{URL}/workouts").json() == []
    assert [w["id"] for w in other_client.get(f"{URL}/workouts", params=me).json()] == [
        mine["id"]
    ]
    assert (
        other_client.get(f"{URL}/workouts/{mine['id']}", params=me).status_code == 200
    )
    # Without user_id, an id that isn't his is a 404, and writes always are.
    assert other_client.get(f"{URL}/workouts/{mine['id']}").status_code == 404
    body = workout_body(entries=[strength(ex["Squat"], (1, 1))])
    assert (
        other_client.put(f"{URL}/workouts/{mine['id']}", json=body).status_code == 404
    )
    assert other_client.delete(f"{URL}/workouts/{mine['id']}").status_code == 404
    assert client.get(f"{URL}/workouts/{mine['id']}").status_code == 200

    # A user_id that can't use workout is a 404.
    media = workout_client("media@example.com", apps=("media",))
    r = client.get(f"{URL}/workouts", params={"user_id": media.user_id})
    assert r.status_code == 404
    assert client.get(f"{URL}/workouts", params={"user_id": 999999}).status_code == 404
