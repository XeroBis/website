"""`GET /stats`: the dashboard aggregates."""

from tests.workout.conftest import URL, strength


def test_empty(client):
    r = client.get(f"{URL}/stats").json()
    assert r == {
        "date_from": None,
        "date_to": None,
        "workouts": 0,
        "exercises": 0,
        "volume_kg": 0,
        "days": [],
        "weeks": [],
        "weekdays": [0] * 7,
        "top_exercises": [],
        "muscles": [],
        "progression": [],
    }


def test_aggregates(client, ex, add_workout):
    bench, squat, run = ex["Bench press"], ex["Squat"], ex["Running"]
    # Monday 2026-10-05 and Wednesday 2026-10-07, then Monday 2026-10-19.
    a = add_workout(
        "2026-10-05", [strength(bench, (10, 40), (5, 50)), strength(squat, (5, 100))]
    )
    b = add_workout(
        "2026-10-07",
        [
            strength(bench, (3, 60), (10, -10)),
            {"type": "exercise", "exercise_id": run, "sets": [{"duration_s": 600}]},
        ],
    )
    c = add_workout("2026-10-19", [strength(bench, (8, 50))])
    add_workout("2026-10-07", [strength(bench, (1, 70))])  # second the same day

    r = client.get(f"{URL}/stats").json()
    assert (r["date_from"], r["date_to"]) == ("2026-10-05", "2026-10-19")
    assert r["workouts"] == 4
    assert r["exercises"] == 6
    # Negative (assisted) weights and sets without weight add nothing.
    assert r["volume_kg"] == 400 + 250 + 500 + 180 + 400 + 70
    assert [d["date"] for d in r["days"]] == ["2026-10-05", "2026-10-07", "2026-10-19"]
    assert r["days"][0]["workout_ids"] == [a["id"]]
    assert (
        len(r["days"][1]["workout_ids"]) == 2 and b["id"] in r["days"][1]["workout_ids"]
    )
    # Every week of the range, empty ones included.
    assert r["weeks"] == [
        {"week_start": "2026-10-05", "workouts": 3, "volume_kg": 1400},
        {"week_start": "2026-10-12", "workouts": 0, "volume_kg": 0},
        {"week_start": "2026-10-19", "workouts": 1, "volume_kg": 400},
    ]
    assert r["weekdays"] == [2, 0, 2, 0, 0, 0, 0]
    assert r["top_exercises"] == [
        {"name": "Bench press", "count": 4},
        {"name": "Running", "count": 1},
        {"name": "Squat", "count": 1},
    ]
    chest = next(m for m in r["muscles"] if m["name"] == "Chest")
    assert chest == {
        "name": "Chest",
        "total": 12,
        "exercises": [{"name": "Bench press", "count": 4}],
    }
    assert [m["name"] for m in r["muscles"]] == [
        "Calves",
        "Chest",
        "Glutes",
        "Quads",
        "Triceps",
    ]

    progression = {p["name"]: p["points"] for p in r["progression"]}
    assert list(progression) == ["Bench press", "Squat"]  # Running has no weighted set
    assert progression["Bench press"] == [
        # Max weight of the day, and the best Epley 1RM of the day.
        {"date": "2026-10-05", "max_weight_kg": 50, "est_1rm_kg": 58.3},
        {"date": "2026-10-07", "max_weight_kg": 70, "est_1rm_kg": 72.3},
        {"date": "2026-10-19", "max_weight_kg": 50, "est_1rm_kg": 63.3},
    ]
    assert c["id"] in r["days"][2]["workout_ids"]


def test_range_and_sharing(client, other_client, ex, add_workout):
    add_workout("2026-09-30")
    add_workout("2026-10-05")
    params = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
    r = client.get(f"{URL}/stats", params=params).json()
    assert (r["date_from"], r["date_to"], r["workouts"]) == (
        "2026-10-01",
        "2026-10-31",
        1,
    )
    # Weeks start on the Monday of date_from's week.
    assert [w["week_start"] for w in r["weeks"]] == [
        "2026-09-28",
        "2026-10-05",
        "2026-10-12",
        "2026-10-19",
        "2026-10-26",
    ]
    assert other_client.get(f"{URL}/stats").json()["workouts"] == 0
    shared = other_client.get(f"{URL}/stats", params={"user_id": client.user_id}).json()
    assert shared["workouts"] == 2
    bad = {"date_from": "2026-10-31", "date_to": "2026-10-01"}
    assert client.get(f"{URL}/stats", params=bad).status_code == 422
