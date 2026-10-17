"""Saved circuits: per user and private."""

from tests.workout.conftest import URL


def saved(ex, name="Core") -> dict:
    return {
        "name": name,
        "duration_minutes": 12,
        "rounds": 4,
        "exercises": [
            {"exercise_id": ex["Pull-ups"], "sets": [{"reps": 8}]},
            {"exercise_id": ex["Running"], "sets": [{"duration_s": 60}]},
        ],
    }


def test_crud(client, ex):
    r = client.post(f"{URL}/circuits", json=saved(ex))
    assert r.status_code == 201
    c = r.json()
    assert (c["name"], c["duration_minutes"], c["rounds"], c["type"]) == (
        "Core",
        12,
        4,
        "circuit",
    )
    assert [e["exercise"]["name"] for e in c["exercises"]] == ["Pull-ups", "Running"]
    assert client.get(f"{URL}/circuits/{c['id']}").json() == c
    assert client.post(f"{URL}/circuits", json=saved(ex, "core")).status_code == 409

    body = saved(ex, "Abs") | {"rounds": None, "exercises": saved(ex)["exercises"][1:]}
    r = client.put(f"{URL}/circuits/{c['id']}", json=body)
    assert (r.json()["name"], r.json()["rounds"], len(r.json()["exercises"])) == (
        "Abs",
        None,
        1,
    )
    assert [x["name"] for x in client.get(f"{URL}/circuits").json()] == ["Abs"]
    assert client.delete(f"{URL}/circuits/{c['id']}").status_code == 204
    assert client.get(f"{URL}/circuits").json() == []


def test_validation(client, ex):
    for body in (
        saved(ex) | {"name": " "},
        saved(ex) | {"exercises": []},
        saved(ex) | {"rounds": 1001},
        saved(ex) | {"duration_minutes": 0},
    ):
        assert client.post(f"{URL}/circuits", json=body).status_code == 422, body
    body = saved(ex) | {"exercises": [{"exercise_id": 999999, "sets": [{"reps": 1}]}]}
    assert client.post(f"{URL}/circuits", json=body).status_code == 404


def test_private(client, other_client, ex):
    c = client.post(f"{URL}/circuits", json=saved(ex)).json()
    assert other_client.get(f"{URL}/circuits").json() == []
    assert other_client.get(f"{URL}/circuits/{c['id']}").status_code == 404
    assert (
        other_client.put(f"{URL}/circuits/{c['id']}", json=saved(ex)).status_code == 404
    )
    assert other_client.delete(f"{URL}/circuits/{c['id']}").status_code == 404
