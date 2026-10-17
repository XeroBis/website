from datetime import date

TODAY = date.today().isoformat()


def act(client, entry_id, action, expect=200):
    r = client.post(f"/api/media/library/{entry_id}/{action}")
    assert r.status_code == expect, r.text
    return r.json()


def test_new_entry_is_want_without_sessions(add_manual):
    entry = add_manual()
    assert entry["status"] == "want"
    assert entry["sessions"] == []
    assert entry["owned_formats"] == []


def test_start_opens_a_session_today(client, add_manual):
    entry = act(client, add_manual()["id"], "start")
    assert entry["status"] == "in_progress"
    assert entry["sessions"] == [
        {"id": entry["sessions"][0]["id"], "started_on": TODAY, "finished_on": None}
    ]


def test_finish_closes_the_open_session(client, add_manual):
    entry_id = add_manual()["id"]
    act(client, entry_id, "start")
    entry = act(client, entry_id, "finish")
    assert entry["status"] == "done"
    assert [(s["started_on"], s["finished_on"]) for s in entry["sessions"]] == [
        (TODAY, TODAY)
    ]
    assert entry["last_finished_on"] == TODAY


def test_finish_without_open_session_records_finish_only_session(client, add_manual):
    entry = act(client, add_manual(type="film")["id"], "finish")
    assert entry["status"] == "done"
    assert [(s["started_on"], s["finished_on"]) for s in entry["sessions"]] == [
        (None, TODAY)
    ]


def test_drop_keeps_session_open_and_start_resumes_it(client, add_series):
    entry = add_series([3, 3])
    entry = act(client, entry["id"], "start")
    session_id = entry["sessions"][0]["id"]
    act(client, entry["id"], "next-episode")
    act(client, entry["id"], "next-episode")

    dropped = act(client, entry["id"], "drop")
    assert dropped["status"] == "dropped"
    assert dropped["sessions"][0]["finished_on"] is None

    resumed = act(client, entry["id"], "start")
    assert resumed["status"] == "in_progress"
    assert [s["id"] for s in resumed["sessions"]] == [session_id]
    # Resuming keeps series progress.
    assert (resumed["current_season"], resumed["current_episode"]) == (1, 2)


def test_start_again_after_done_is_a_new_session_and_resets_series(client, add_series):
    entry_id = add_series([2])["id"]
    act(client, entry_id, "start")
    act(client, entry_id, "next-episode")
    act(client, entry_id, "next-episode")
    act(client, entry_id, "finish")

    again = act(client, entry_id, "start")
    assert again["status"] == "in_progress"
    assert len(again["sessions"]) == 2
    assert again["sessions"][0]["finished_on"] is None  # open one listed first
    assert (again["current_season"], again["current_episode"]) == (1, 0)


def test_reread_book(client, add_manual):
    entry_id = add_manual()["id"]
    for _ in range(2):
        act(client, entry_id, "start")
        entry = act(client, entry_id, "finish")
    assert len(entry["sessions"]) == 2
    assert all(s["finished_on"] == TODAY for s in entry["sessions"])


def test_invalid_transitions_are_409(client, add_manual):
    entry_id = add_manual()["id"]
    act(client, entry_id, "start")
    act(client, entry_id, "start", expect=409)
    act(client, entry_id, "finish")
    act(client, entry_id, "finish", expect=409)
    act(client, entry_id, "drop", expect=409)


def test_initial_status_goes_through_the_rules(add_manual, add_series):
    started = add_manual(status="in_progress")
    assert started["status"] == "in_progress"
    assert started["sessions"][0]["started_on"] == TODAY

    done = add_manual(title="Read already", status="done")
    assert done["sessions"][0] == {
        "id": done["sessions"][0]["id"],
        "started_on": None,
        "finished_on": TODAY,
    }

    series = add_series([4], status="in_progress")
    assert (series["current_season"], series["current_episode"]) == (1, 0)


# --- +1 episode --------------------------------------------------------------


def test_next_episode_rolls_over_seasons_and_stops_at_last_known(client, add_series):
    entry = add_series([2, 3])
    # Specials and the announced empty season are ignored.
    assert entry["item"]["season_episode_counts"] == [2, 3]
    entry_id = entry["id"]
    act(client, entry_id, "start")

    seen = []
    for _ in range(5):
        e = act(client, entry_id, "next-episode")
        seen.append((e["current_season"], e["current_episode"]))
    assert seen == [(1, 1), (1, 2), (2, 1), (2, 2), (2, 3)]

    assert e["at_last_known_episode"] is True
    assert e["progress"] == {"watched": 5, "total": 5}
    # Never auto-finishes: +1 is refused, Finish is offered instead.
    assert e["status"] == "in_progress"
    act(client, entry_id, "next-episode", expect=409)
    assert act(client, entry_id, "finish")["status"] == "done"


def test_next_episode_progress(client, add_series):
    entry_id = add_series([10, 10])["id"]
    act(client, entry_id, "start")
    e = act(client, entry_id, "next-episode")
    assert e["progress"] == {"watched": 1, "total": 20}
    assert e["at_last_known_episode"] is False


def test_next_episode_with_unknown_counts_just_increments(client, add_manual):
    entry_id = add_manual(type="series", title="Homemade")["id"]
    e = act(client, entry_id, "start")
    assert (e["current_season"], e["current_episode"]) == (1, 0)
    for _ in range(30):
        e = act(client, entry_id, "next-episode")
    assert (e["current_season"], e["current_episode"]) == (1, 30)
    assert e["progress"] is None
    assert e["at_last_known_episode"] is False

    # Season is changed by hand.
    r = client.patch(
        f"/api/media/library/{entry_id}",
        json={"current_season": 2, "current_episode": 0},
    )
    assert r.status_code == 200
    e = act(client, entry_id, "next-episode")
    assert (e["current_season"], e["current_episode"]) == (2, 1)


def test_next_episode_past_known_seasons_increments(client, add_series):
    """A new season aired but TMDB counts are stale: set S3 by hand, +1 works."""
    entry_id = add_series([2, 2])["id"]
    act(client, entry_id, "start")
    client.patch(
        f"/api/media/library/{entry_id}",
        json={"current_season": 3, "current_episode": 0},
    )
    e = act(client, entry_id, "next-episode")
    assert (e["current_season"], e["current_episode"]) == (3, 1)
    assert e["progress"] is None


def test_next_episode_needs_an_in_progress_series(client, add_manual, add_series):
    act(client, add_manual(type="film")["id"], "start")
    film_id = add_manual(type="film", title="Other")["id"]
    act(client, film_id, "next-episode", expect=409)
    act(client, add_series([3])["id"], "next-episode", expect=409)


def test_season_fields_are_series_only(client, add_manual):
    r = client.patch(
        f"/api/media/library/{add_manual()['id']}", json={"current_episode": 3}
    )
    assert r.status_code == 422
