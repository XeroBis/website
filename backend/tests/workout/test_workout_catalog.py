"""The shared catalog: any workout user adds, admins edit/delete."""

from tests.workout.conftest import URL, strength, workout_body


def test_muscles(client):
    muscles = client.get(f"{URL}/muscles").json()
    assert len(muscles) == 16
    assert muscles[0] == "Abdominals" and "Front shoulders" in muscles


def test_create_exercise_with_muscles_and_new_equipments(client):
    r = client.post(
        f"{URL}/exercises",
        json={
            "name": "  Deadlift ",
            "type": "strength",
            "muscles": [{"name": "Lower back", "intensity": 3}],
            "equipments": ["Barbell", "barbell", "Plates"],
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Deadlift"
    assert body["muscles"] == [{"name": "Lower back", "intensity": 3}]
    assert [e["name"] for e in body["equipments"]] == ["Barbell", "Plates"]
    assert [e["name"] for e in client.get(f"{URL}/equipments").json()] == [
        "Barbell",
        "Plates",
    ]
    assert client.get(f"{URL}/exercises/{body['id']}").json() == body


def test_exercise_names_are_unique_case_insensitively(client, ex):
    r = client.post(f"{URL}/exercises", json={"name": "bench PRESS", "type": "cardio"})
    assert r.status_code == 409


def test_catalog_is_shared_and_sorted(client, other_client, ex):
    names = [e["name"] for e in other_client.get(f"{URL}/exercises").json()]
    assert names == ["Bench press", "Pull-ups", "Running", "Squat"]


def test_exercise_validation(client):
    for body in (
        {"name": "", "type": "strength"},
        {"name": "X" * 101, "type": "strength"},
        {"name": "X", "type": "yoga"},
        {
            "name": "X",
            "type": "strength",
            "muscles": [{"name": "Wings", "intensity": 1}],
        },
        {
            "name": "X",
            "type": "strength",
            "muscles": [{"name": "Chest", "intensity": 4}],
        },
        {
            "name": "X",
            "type": "strength",
            "muscles": [
                {"name": "Chest", "intensity": 1},
                {"name": "Chest", "intensity": 2},
            ],
        },
    ):
        assert client.post(f"{URL}/exercises", json=body).status_code == 422, body


def test_only_admins_edit_and_delete_exercises(client, admin, ex):
    body = {"name": "Bench", "type": "strength", "muscles": [], "equipments": []}
    assert client.put(f"{URL}/exercises/{ex['Squat']}", json=body).status_code == 403
    r = admin.put(f"{URL}/exercises/{ex['Pull-ups']}", json=body)
    assert r.status_code == 200 and r.json()["name"] == "Bench"
    r = admin.put(f"{URL}/exercises/{ex['Squat']}", json=body)
    assert r.status_code == 409
    assert admin.put(f"{URL}/exercises/999999", json=body).status_code == 404
    assert client.delete(f"{URL}/exercises/{ex['Squat']}").status_code == 403
    assert admin.delete(f"{URL}/exercises/{ex['Squat']}").status_code == 204
    assert admin.get(f"{URL}/exercises/{ex['Squat']}").status_code == 404


def test_an_exercise_in_use_cant_be_deleted(client, admin, ex):
    used = [ex["Bench press"], ex["Squat"], ex["Running"]]
    client.post(
        f"{URL}/workouts",
        json=workout_body(entries=[strength(used[0], (5, 50))]),
    )
    client.post(
        f"{URL}/templates",
        json={"name": "T", "exercises": [strength(used[1], (5, 50))]},
    )
    client.post(
        f"{URL}/circuits",
        json={
            "name": "C",
            "exercises": [{"exercise_id": used[2], "sets": [{"reps": 1}]}],
        },
    )
    for exercise_id in used:
        r = admin.delete(f"{URL}/exercises/{exercise_id}")
        assert r.status_code == 409, exercise_id
    assert admin.delete(f"{URL}/exercises/{ex['Pull-ups']}").status_code == 204


def test_equipments(client, admin, ex):
    r = client.post(f"{URL}/equipments", json={"name": " Kettlebell "})
    assert r.status_code == 201 and r.json()["name"] == "Kettlebell"
    assert (
        client.post(f"{URL}/equipments", json={"name": "kettlebell"}).status_code == 409
    )
    assert client.post(f"{URL}/equipments", json={"name": " "}).status_code == 422
    eq_id = r.json()["id"]
    assert (
        client.put(f"{URL}/equipments/{eq_id}", json={"name": "KB"}).status_code == 403
    )
    r = admin.put(f"{URL}/equipments/{eq_id}", json={"name": "KB"})
    assert r.json() == {"id": eq_id, "name": "KB"}
    assert (
        admin.put(f"{URL}/equipments/{eq_id}", json={"name": "bench"}).status_code
        == 409
    )

    # Deleting an equipment unlinks it from its exercises.
    barbell = next(
        e["id"]
        for e in client.get(f"{URL}/equipments").json()
        if e["name"] == "Barbell"
    )
    assert client.delete(f"{URL}/equipments/{barbell}").status_code == 403
    assert admin.delete(f"{URL}/equipments/{barbell}").status_code == 204
    squat = client.get(f"{URL}/exercises/{ex['Squat']}").json()
    assert squat["equipments"] == []
    assert admin.delete(f"{URL}/equipments/{barbell}").status_code == 404
