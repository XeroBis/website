"""Status transitions and series progress.

Implements documentation/data-model.md's "Business rules". Functions mutate
the entry (and its sessions) in place; the caller commits.
"""

from datetime import date

from domains.media.models import EntryStatus, LibraryEntry, MediaType, ReadingSession


class RuleError(Exception):
    """A transition that isn't allowed from the entry's current state."""


def open_session(entry: LibraryEntry) -> ReadingSession | None:
    return next((s for s in entry.sessions if s.finished_on is None), None)


def _is_series(entry: LibraryEntry) -> bool:
    return entry.media_item.type == MediaType.series


def start(entry: LibraryEntry, today: date) -> None:
    """want / done / dropped → in_progress. Reuses an open session (resuming a
    dropped item), otherwise opens one today; a new series session restarts at
    S1 E0."""
    if entry.status == EntryStatus.in_progress:
        raise RuleError("Already in progress")
    entry.status = EntryStatus.in_progress
    if open_session(entry) is None:
        entry.sessions.append(ReadingSession(started_on=today))
        if _is_series(entry):
            entry.current_season, entry.current_episode = 1, 0


def finish(entry: LibraryEntry, today: date) -> None:
    """→ done. Closes the open session today, or records a finish-only session."""
    if entry.status == EntryStatus.done:
        raise RuleError("Already done")
    entry.status = EntryStatus.done
    session = open_session(entry)
    if session is None:
        entry.sessions.append(ReadingSession(started_on=None, finished_on=today))
    else:
        session.finished_on = max(today, session.started_on or today)


def drop(entry: LibraryEntry) -> None:
    """→ dropped. The open session stays open so a later Start resumes it."""
    if entry.status not in (EntryStatus.want, EntryStatus.in_progress):
        raise RuleError("Only a wanted or in-progress item can be dropped")
    entry.status = EntryStatus.dropped


def _known_count(counts: list[int] | None, season: int) -> int | None:
    if counts and 1 <= season <= len(counts) and counts[season - 1] > 0:
        return counts[season - 1]
    return None


def at_last_known_episode(entry: LibraryEntry) -> bool:
    """On (or past) the last episode of the last known season: the app offers
    Finish instead of +1 episode. Past the known seasons (set by hand after a
    new season aired) counts are unknown, so +1 just increments."""
    counts = entry.media_item.season_episode_counts
    if not _is_series(entry) or not counts:
        return False
    season, episode = entry.current_season or 1, entry.current_episode or 0
    last = _known_count(counts, len(counts))
    return season == len(counts) and last is not None and episode >= last


def next_episode(entry: LibraryEntry) -> None:
    """+1 episode, rolling to the next season's E1 when this season's count is
    known and reached. Never auto-finishes."""
    if not _is_series(entry):
        raise RuleError("+1 episode is only for series")
    if entry.status != EntryStatus.in_progress:
        raise RuleError("Start the series first")
    if at_last_known_episode(entry):
        raise RuleError("That was the last known episode: finish it instead")
    counts = entry.media_item.season_episode_counts
    season, episode = entry.current_season or 1, entry.current_episode or 0
    season_count = _known_count(counts, season)
    if season_count is not None and episode >= season_count:
        entry.current_season, entry.current_episode = season + 1, 1
    else:
        entry.current_season, entry.current_episode = season, episode + 1


def series_progress(entry: LibraryEntry) -> tuple[int, int] | None:
    """(episodes watched, total episodes) when every season's count is known."""
    counts = entry.media_item.season_episode_counts
    if not _is_series(entry) or not counts or any(c <= 0 for c in counts):
        return None
    season = entry.current_season or 1
    if season > len(counts):
        return None
    watched = sum(counts[: season - 1]) + (entry.current_episode or 0)
    total = sum(counts)
    return min(watched, total), total


def apply_initial_status(entry: LibraryEntry, status: EntryStatus, today: date) -> None:
    """Status chosen on the add form, reached through the normal transitions."""
    if status == EntryStatus.in_progress:
        start(entry, today)
    elif status == EntryStatus.done:
        finish(entry, today)
    elif status == EntryStatus.dropped:
        drop(entry)
