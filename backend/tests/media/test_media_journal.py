"""`GET /api/media/journal`: session starts and finishes by month or year."""

from datetime import date

URL = "/api/media/journal"


def _session(client, entry_id, started=None, finished=None):
    r = client.post(
        f"/api/media/library/{entry_id}/sessions",
        json={"started_on": started, "finished_on": finished},
    )
    assert r.status_code == 201, r.text


def _events(client, **params):
    r = client.get(URL, params=params)
    assert r.status_code == 200, r.text
    return [(e["date"], e["event"], e["entry"]["item"]["title"]) for e in r.json()]


def test_month_and_year(client, add_manual):
    book = add_manual(title="Book")["id"]
    film = add_manual(type="film", title="Film")["id"]
    series = add_manual(type="series", title="Show")["id"]
    _session(client, book, "2026-10-28", "2026-11-03")
    _session(client, film, None, "2026-11-03")
    _session(client, series, "2026-11-10")  # still open
    _session(client, book, "2025-11-01", "2025-11-02")  # another year

    assert _events(client, year=2026, month=11) == [
        ("2026-11-10", "started", "Show"),
        ("2026-11-03", "finished", "Film"),
        ("2026-11-03", "finished", "Book"),
    ]
    assert _events(client, year=2026, month=10) == [
        ("2026-10-28", "started", "Book"),
    ]
    assert _events(client, year=2026) == [
        ("2026-11-10", "started", "Show"),
        ("2026-11-03", "finished", "Film"),
        ("2026-11-03", "finished", "Book"),
        ("2026-10-28", "started", "Book"),
    ]
    assert _events(client, year=2025, month=11) == [
        ("2025-11-02", "finished", "Book"),
        ("2025-11-01", "started", "Book"),
    ]
    assert _events(client, year=2024) == []


def test_filters(client, add_manual):
    book = add_manual(title="Book")["id"]
    film = add_manual(type="film", title="Film")["id"]
    _session(client, book, "2026-11-01", "2026-11-05")
    _session(client, film, "2026-11-02", "2026-11-04")

    assert _events(client, year=2026, month=11, type="book") == [
        ("2026-11-05", "finished", "Book"),
        ("2026-11-01", "started", "Book"),
    ]
    assert _events(client, year=2026, month=11, event="finished") == [
        ("2026-11-05", "finished", "Book"),
        ("2026-11-04", "finished", "Film"),
    ]


def test_validation_and_isolation(client, other_client, add_manual):
    entry = add_manual()["id"]
    client.post(f"/api/media/library/{entry}/start")
    today = date.today()
    assert len(_events(client, year=today.year, month=today.month)) == 1
    assert _events(other_client, year=today.year, month=today.month) == []
    for params in ({}, {"year": 2026, "month": 13}, {"year": 2026, "event": "x"}):
        assert client.get(URL, params=params).status_code == 422
