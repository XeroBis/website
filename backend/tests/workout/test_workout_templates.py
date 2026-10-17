"""Templates: per user, names unique per user, readable and copyable by
other workout users."""

from tests.workout.conftest import URL, strength


def template(ex, name="Leg day") -> dict:
    return {
        "name": name,
        "exercises": [
            strength(ex["Squat"], (12, 50), (12, 50)),
            {
                "type": "circuit",
                "name": None,
                "exercises": [{"exercise_id": ex["Pull-ups"], "sets": [{"reps": 8}]}],
            },
        ],
    }


def test_crud(client, ex):
    r = client.post(f"{URL}/templates", json=template(ex))
    assert r.status_code == 201
    t = r.json()
    assert t["name"] == "Leg day" and t["user_id"] == client.user_id
    assert [e["type"] for e in t["exercises"]] == ["exercise", "circuit"]
    assert client.get(f"{URL}/templates/{t['id']}").json() == t

    client.post(f"{URL}/templates", json=template(ex, "arms"))
    assert [x["name"] for x in client.get(f"{URL}/templates").json()] == [
        "arms",
        "Leg day",
    ]

    r = client.put(f"{URL}/templates/{t['id']}", json=template(ex, "Legs"))
    assert r.json()["name"] == "Legs"
    assert client.delete(f"{URL}/templates/{t['id']}").status_code == 204
    assert client.get(f"{URL}/templates/{t['id']}").status_code == 404


def test_names_unique_per_user(client, other_client, ex):
    t = client.post(f"{URL}/templates", json=template(ex)).json()
    assert (
        client.post(f"{URL}/templates", json=template(ex, " leg DAY ")).status_code
        == 409
    )
    # Renaming to its own name is fine; another user may use it too.
    assert (
        client.put(f"{URL}/templates/{t['id']}", json=template(ex)).status_code == 200
    )
    assert other_client.post(f"{URL}/templates", json=template(ex)).status_code == 201


def test_validation(client, ex):
    for body in (
        {"name": "", "exercises": template(ex)["exercises"]},
        {"name": "x" * 101, "exercises": template(ex)["exercises"]},
        {"name": "Empty", "exercises": []},
    ):
        assert client.post(f"{URL}/templates", json=body).status_code == 422
    body = {"name": "Bad", "exercises": [strength(999999, (1, 1))]}
    assert client.post(f"{URL}/templates", json=body).status_code == 404


def test_shared_read_only_and_copy(client, other_client, ex):
    t = client.post(f"{URL}/templates", json=template(ex)).json()
    other_client.post(f"{URL}/templates", json=template(ex)).json()
    alice = {"user_id": client.user_id}

    assert [
        x["id"] for x in other_client.get(f"{URL}/templates", params=alice).json()
    ] == [t["id"]]
    assert (
        other_client.get(f"{URL}/templates/{t['id']}", params=alice).status_code == 200
    )
    assert other_client.get(f"{URL}/templates/{t['id']}").status_code == 404
    assert (
        other_client.put(f"{URL}/templates/{t['id']}", json=template(ex)).status_code
        == 404
    )
    assert other_client.delete(f"{URL}/templates/{t['id']}").status_code == 404

    # Bob already has a "Leg day": the copy is "Leg day (2)", with the same entries.
    r = other_client.post(f"{URL}/templates/{t['id']}/copy", params=alice)
    assert r.status_code == 201
    copy = r.json()
    assert (copy["name"], copy["user_id"]) == ("Leg day (2)", other_client.user_id)
    strip = lambda entries: [  # noqa: E731
        {k: v for k, v in e.items() if k != "id"} | {"sets": [], "exercises": []}
        for e in entries
    ]
    assert strip(copy["exercises"]) == strip(t["exercises"])
    assert copy["exercises"][0]["sets"][0]["weight_kg"] == 50
    r = other_client.post(f"{URL}/templates/{t['id']}/copy", params=alice)
    assert r.json()["name"] == "Leg day (3)"
    # Without user_id, someone else's template is a 404.
    assert other_client.post(f"{URL}/templates/{t['id']}/copy").status_code == 404
