"""Import/export in the old app's formats: round trips, legacy entries,
duplicates, and the admin's multi-user and catalog files."""

from tests.workout.conftest import EXERCISES, URL, strength

# As the old app exported them (before and after circuits existed).
OLD_WORKOUTS = [
    {
        "date": "2023-12-25",
        "duration_minutes": 66,
        "exercises": [
            {
                "type": "strength",
                "exercise_name": "bench press",
                "sets": [{"reps": 10, "weight_kg": 38}, {"reps": 10, "weight_kg": 38}],
            },
            {
                "type": "cardio",
                "exercise_name": "Running",
                "intervals": 2,
                "duration_s": 300,
            },
            {
                "type": "cardio",
                "exercise_name": "Running",
                "sets": [{"distance_m": 5000}],
            },
        ],
    },
    {
        "date": "2026-08-12",
        "duration_minutes": 50,
        "exercises": [
            {
                "type": "exercise",
                "exercise_name": "Squat",
                "sets": [
                    {
                        "reps": 5,
                        "weight_kg": 100.0,
                        "duration_s": None,
                        "distance_m": None,
                        "speed_kmh": None,
                        "difficulty": 7.5,
                    }
                ],
            },
            {
                "type": "circuit",
                "name": "Finisher",
                "duration_minutes": 10,
                "rounds": 3,
                "exercises": [
                    {
                        "type": "exercise",
                        "exercise_name": "Pull-ups",
                        "sets": [{"reps": 8}],
                    }
                ],
            },
        ],
    },
]


def test_old_workouts_import_as_is_and_round_trip(client, ex):
    r = client.post(f"{URL}/workouts/import", json=OLD_WORKOUTS)
    assert r.json() == {"created": 2, "updated": 0, "skipped": 0, "ignored": []}

    workouts = client.get(f"{URL}/workouts").json()
    old = workouts[1]
    assert old["date"] == "2023-12-25"
    # Names matched case-insensitively; very old cardio became one set per interval.
    assert [e["exercise"]["name"] for e in old["exercises"]] == [
        "Bench press",
        "Running",
        "Running",
    ]
    assert [s["duration_s"] for s in old["exercises"][1]["sets"]] == [300, 300]
    assert workouts[0]["exercises"][1]["rounds"] == 3

    exported = client.get(f"{URL}/workouts/export").json()
    assert [w["date"] for w in exported] == ["2023-12-25", "2026-08-12"]
    assert exported[0]["exercises"][0] == {
        "type": "exercise",
        "exercise_name": "Bench press",
        "sets": [{"reps": 10, "weight_kg": 38.0}, {"reps": 10, "weight_kg": 38.0}],
    }
    assert exported[1]["exercises"][1] == {
        "type": "circuit",
        "name": "Finisher",
        "duration_minutes": 10,
        "rounds": 3,
        "exercises": [
            {"type": "exercise", "exercise_name": "Pull-ups", "sets": [{"reps": 8}]}
        ],
    }
    # Re-importing the export (or the old file) changes nothing.
    r = client.post(f"{URL}/workouts/import", json=exported).json()
    assert (r["created"], r["skipped"]) == (0, 2)
    assert r["ignored"] == ["2023-12-25 (already there)", "2026-08-12 (already there)"]
    assert (
        client.post(f"{URL}/workouts/import", json=OLD_WORKOUTS).json()["created"] == 0
    )
    assert len(client.get(f"{URL}/workouts").json()) == 2


def test_import_skips_unknown_exercises_and_in_file_duplicates(client, ex):
    unknown = {
        "date": "2026-01-01",
        "duration_minutes": 30,
        "exercises": [
            {"type": "exercise", "exercise_name": "Levitation", "sets": [{"reps": 1}]}
        ],
    }
    same_day_other_content = OLD_WORKOUTS[1] | {"duration_minutes": 51}
    files = [unknown, OLD_WORKOUTS[1], OLD_WORKOUTS[1], same_day_other_content]
    r = client.post(f"{URL}/workouts/import", json=files).json()
    assert (r["created"], r["skipped"]) == (2, 2)
    assert r["ignored"] == [
        "2026-01-01 (unknown exercise: Levitation)",
        "2026-08-12 (already there)",
    ]


def test_import_validates_the_file_shape(client, ex):
    for body in (
        {"date": "2026-01-01"},
        [{"date": "2026-01-01", "exercises": []}],
        [{"date": "nope", "duration_minutes": 1, "exercises": []}],
        [OLD_WORKOUTS[1] | {"exercises": [{"type": "yoga"}]}],
    ):
        assert client.post(f"{URL}/workouts/import", json=body).status_code == 422


def test_imports_are_per_user(client, other_client, ex):
    client.post(f"{URL}/workouts/import", json=OLD_WORKOUTS)
    assert other_client.get(f"{URL}/workouts/export").json() == []
    assert (
        other_client.post(f"{URL}/workouts/import", json=OLD_WORKOUTS).json()["created"]
        == 2
    )


def test_templates_round_trip_and_name_clashes(client, ex):
    files = [
        {"name": "Leg day", "exercises": OLD_WORKOUTS[1]["exercises"]},
        {"name": "Push", "exercises": OLD_WORKOUTS[0]["exercises"][:1]},
        {"name": "leg DAY", "exercises": OLD_WORKOUTS[0]["exercises"][:1]},
        {
            "name": "Fly",
            "exercises": [{"type": "exercise", "exercise_name": "Fly", "sets": []}],
        },
    ]
    r = client.post(f"{URL}/templates/import", json=files).json()
    assert (r["created"], r["skipped"]) == (2, 2)
    assert r["ignored"] == [
        "leg DAY (name already used)",
        "Fly (unknown exercise: Fly)",
    ]
    exported = client.get(f"{URL}/templates/export").json()
    assert [t["name"] for t in exported] == ["Leg day", "Push"]
    assert exported[0]["exercises"][1]["type"] == "circuit"
    assert client.post(f"{URL}/templates/import", json=exported).json()["created"] == 0


def test_saved_circuits_round_trip(client, ex):
    files = [
        {
            "name": "Core",
            "duration_minutes": 12,
            "rounds": 4,
            "exercises": [{"exercise_name": "pull-ups", "sets": [{"reps": 8}]}],
        }
    ]
    assert client.post(f"{URL}/circuits/import", json=files).json()["created"] == 1
    exported = client.get(f"{URL}/circuits/export").json()
    assert exported == [
        {
            "name": "Core",
            "duration_minutes": 12,
            "rounds": 4,
            "exercises": [
                {"type": "exercise", "exercise_name": "Pull-ups", "sets": [{"reps": 8}]}
            ],
        }
    ]
    r = client.post(
        f"{URL}/circuits/import", json=exported + [exported[0] | {"name": "X"}]
    )
    assert r.json()["ignored"] == ["Core (name already used)"]
    bad = [
        exported[0]
        | {"name": "Y", "exercises": [{"exercise_name": "Nope", "sets": []}]}
    ]
    assert client.post(f"{URL}/circuits/import", json=bad).json()["ignored"] == [
        "Y (unknown exercise: Nope)"
    ]


# ── admin ────────────────────────────────────────────────────────────────────


def test_catalog_import_export(admin):
    files = EXERCISES + [
        {
            "name": "Wing flap",
            "type": "strength",
            "muscles": [{"name": "Wings", "intensity": 1}],
        },
        {"name": "Spin", "type": "yoga", "muscles": [], "equipments": []},
    ]
    r = admin.post(f"{URL}/admin/exercises/import", json=files).json()
    assert (r["created"], r["updated"], r["skipped"]) == (4, 0, 2)
    assert r["ignored"][0].startswith("Wing flap (")
    exported = admin.get(f"{URL}/admin/exercises/export").json()
    assert exported[0] == EXERCISES[0]
    # Same names again: updated in place, case-insensitively.
    changed = [EXERCISES[1] | {"name": "SQUAT", "type": "cardio", "equipments": []}]
    r = admin.post(f"{URL}/admin/exercises/import", json=changed).json()
    assert (r["created"], r["updated"]) == (0, 1)
    squat = next(
        e for e in admin.get(f"{URL}/exercises").json() if e["name"] == "SQUAT"
    )
    assert (squat["type"], squat["equipments"]) == ("cardio", [])

    r = admin.post(
        f"{URL}/admin/equipments/import", json=["Rope", " barbell ", "", "Rope"]
    )
    assert r.json() == {
        "created": 1,
        "updated": 0,
        "skipped": 2,
        "ignored": ["barbell (already there)", "Rope (already there)"],
    }
    assert admin.get(f"{URL}/admin/equipments/export").json() == [
        "Barbell",
        "Bench",
        "Rope",
    ]


def test_multi_user_files(admin, client, other_client, workout_client, ex):
    client.post(f"{URL}/workouts/import", json=OLD_WORKOUTS)
    client.post(
        f"{URL}/templates",
        json={"name": "T", "exercises": [strength(ex["Squat"], (1, 1))]},
    )
    ids = {"user_ids": [client.user_id, other_client.user_id]}
    exported = admin.get(f"{URL}/admin/workouts/export", params=ids).json()
    assert [(f["user_email"], len(f["workouts"])) for f in exported] == [
        ("alice@example.com", 2),
        ("bob@example.com", 0),
    ]
    templates = admin.get(f"{URL}/admin/templates/export", params=ids).json()
    assert [t["name"] for t in templates[0]["templates"]] == ["T"]

    # The old app's prod file: matched by email (case-insensitively).
    files = [
        {"user_email": "BOB@example.com", "workouts": OLD_WORKOUTS},
        {"user_email": "ghost@example.com", "workouts": OLD_WORKOUTS},
    ]
    r = admin.post(f"{URL}/admin/workouts/import", json=files).json()
    assert (r["created"], r["skipped"]) == (2, 2)
    assert r["ignored"] == ["ghost@example.com (no such user)"]
    assert len(other_client.get(f"{URL}/workouts").json()) == 2
    r = admin.post(
        f"{URL}/admin/templates/import",
        json=[
            {"user_email": "bob@example.com", "templates": templates[0]["templates"]}
        ],
    )
    assert r.json()["created"] == 1
    assert [t["name"] for t in other_client.get(f"{URL}/templates").json()] == ["T"]


def test_multi_user_circuits(admin, client, other_client, ex):
    client.post(
        f"{URL}/circuits",
        json={
            "name": "Core",
            "rounds": 3,
            "exercises": [{"exercise_id": ex["Squat"], "sets": [{"reps": 5}]}],
        },
    )
    ids = {"user_ids": [client.user_id, other_client.user_id]}
    exported = admin.get(f"{URL}/admin/circuits/export", params=ids).json()
    assert [(f["user_email"], len(f["circuits"])) for f in exported] == [
        ("alice@example.com", 1),
        ("bob@example.com", 0),
    ]
    files = [
        {"user_email": "BOB@example.com", "circuits": exported[0]["circuits"]},
        {"user_email": "ghost@example.com", "circuits": exported[0]["circuits"]},
    ]
    r = admin.post(f"{URL}/admin/circuits/import", json=files).json()
    assert (r["created"], r["skipped"]) == (1, 1)
    assert r["ignored"] == ["ghost@example.com (no such user)"]
    assert [c["name"] for c in other_client.get(f"{URL}/circuits").json()] == ["Core"]

    r = admin.delete(f"{URL}/admin/circuits", params={"user_ids": [client.user_id]})
    assert r.status_code == 204
    assert client.get(f"{URL}/circuits").json() == []
    assert len(other_client.get(f"{URL}/circuits").json()) == 1
    assert client.get(f"{URL}/admin/circuits/export", params=ids).status_code == 403


def test_delete_all(admin, client, other_client, ex, add_workout):
    add_workout()
    add_workout(as_client=other_client)
    client.post(
        f"{URL}/templates",
        json={"name": "T", "exercises": [strength(ex["Squat"], (1, 1))]},
    )
    client.post(f"{URL}/session", json={})

    assert admin.delete(f"{URL}/admin/exercises").status_code == 409
    r = admin.delete(f"{URL}/admin/workouts", params={"user_ids": [client.user_id]})
    assert r.status_code == 204
    assert (
        client.get(f"{URL}/workouts").json() == []
        and client.get(f"{URL}/session").json() is None
    )
    assert len(other_client.get(f"{URL}/workouts").json()) == 1
    admin.delete(f"{URL}/admin/templates", params={"user_ids": [client.user_id]})
    assert client.get(f"{URL}/templates").json() == []

    admin.delete(f"{URL}/admin/workouts", params={"user_ids": [other_client.user_id]})
    assert admin.delete(f"{URL}/admin/exercises").status_code == 204
    assert admin.get(f"{URL}/exercises").json() == []
    assert admin.delete(f"{URL}/admin/equipments").status_code == 204
    assert admin.get(f"{URL}/equipments").json() == []
