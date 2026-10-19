"""Catalog management routes (`/api/cards/catalog/...`, admins only) and the
public variant badges. Jobs run inline (conftest `inline_jobs`)."""

import io
import zipfile

import pytest
from sqlalchemy import select

from core import database
from domains.cards import models as m
from domains.cards.refresh import archive, jobs
from domains.cards.refresh import variant_icons as icons
from tests.cards.conftest import URL, add_catalog_card
from tests.cards.source_files import (
    card,
    jpeg,
    logo_url,
    scan_url,
    symbol_url,
    write_set,
)

CATALOG = f"{URL}/catalog"
SV = "Scarlet & Violet"


def make_zip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buffer.getvalue()


def write(data_dir, relative: str, content: bytes = b"x"):
    path = data_dir / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


# ── access ───────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "method, path",
    [
        ("get", "/stats"),
        ("post", "/refresh"),
        ("get", "/refresh/status"),
        ("post", "/refresh/steps/import_html"),
        ("get", "/refresh/steps/import_html/status"),
        ("get", "/export"),
        ("post", "/import/metadata"),
        ("get", "/export/images"),
        ("post", "/import/images"),
        ("get", "/import/images/status"),
    ],
)
def test_management_needs_an_admin(client, anon, method, path):
    assert getattr(anon, method)(CATALOG + path).status_code == 401
    assert getattr(client, method)(CATALOG + path).status_code == 403


# ── stats ────────────────────────────────────────────────────────────────────


def test_stats(admin):
    add_catalog_card(card_number="1", name="Pikachu")
    add_catalog_card(card_number="2", name="Pikachu", variants=("standard",))
    add_catalog_card(
        set_code="MEW", name="Mew", variants=("standard", "reverse_pokeball")
    )
    assert admin.get(f"{CATALOG}/stats").json() == {
        "total_cards": 3,
        "total_sets": 2,
        "distinct_card_names": 2,
        "variant_counts": {"standard": 3, "reverse": 1, "reverse_pokeball": 1},
    }


# ── refresh ──────────────────────────────────────────────────────────────────


def test_one_step_runs_in_the_background_and_reports_its_result(admin, source_dir):
    write_set(source_dir, SV, "SVI", [card("Sprigatito", "1")])
    assert admin.get(f"{CATALOG}/refresh/steps/import_html/status").json()[
        "status"
    ] == ("idle")

    response = admin.post(f"{CATALOG}/refresh/steps/import_html")
    assert response.status_code == 202
    assert response.json() == {"status": "started"}

    state = admin.get(f"{CATALOG}/refresh/steps/import_html/status").json()
    assert state["status"] == "done"
    assert state["percent"] == 100
    assert state["result"] == {"sets_processed": 1, "cards_upserted": 1}
    assert state["last_run_result"] == state["result"]
    assert state["last_run_at"]
    assert jobs.running() is None


def test_unknown_steps_are_404(admin):
    assert admin.post(f"{CATALOG}/refresh/steps/update_embeddings").status_code == 404
    assert admin.get(f"{CATALOG}/refresh/steps/nope/status").status_code == 404


def test_a_second_job_is_refused_while_one_runs(admin):
    add_catalog_card()
    file = admin.get(f"{CATALOG}/export").json()
    assert jobs.try_start("scrape_images")
    for path in ("/refresh", "/refresh/steps/import_html", "/import/images"):
        response = admin.post(CATALOG + path)
        assert response.status_code == 409, path
    assert admin.post(f"{CATALOG}/import/metadata", json=file).status_code == 409
    assert jobs.running() == "scrape_images"
    jobs.finish("scrape_images")


def test_a_failing_step_reports_an_error_and_frees_the_lock(admin, source_dir, web):
    write_set(source_dir, SV, "SVI", [card("Sprigatito", "1")])
    admin.post(f"{CATALOG}/refresh/steps/import_html")
    # No response registered for the scans: the fake web raises.
    assert admin.post(f"{CATALOG}/refresh/steps/scrape_images").status_code == 202
    state = admin.get(f"{CATALOG}/refresh/steps/scrape_images/status").json()
    assert state["status"] == "error"
    assert state["error"]
    assert jobs.running() is None


def test_full_refresh_runs_every_step(admin, source_dir, data_dir, web):
    write_set(source_dir, SV, "SVI", [card("Sprigatito", "1", versions=(2,))])
    (source_dir / SV / "SVI" / "badges.html").write_text(
        f'<img src="{icons.sources()["reverse.svg"]}">', "utf-8"
    )
    web.add(scan_url("SVI", "US", "1"), jpeg())
    web.add(scan_url("SVI", "FR", "1"), jpeg())
    web.add(scan_url("SVI", "US", "1", 2), jpeg())
    web.add(scan_url("SVI", "FR", "1", 2), jpeg())
    web.add(logo_url("SVI", "US"), b"logo")
    web.add(logo_url("SVI", "FR"), b"logo")
    web.add(symbol_url("SVI"), b"symbol")
    web.add(icons.sources()["reverse.svg"], b"<svg/>")
    web.json("https://api.tcgdex.net/v2/en/sets", [])

    assert admin.post(f"{CATALOG}/refresh").status_code == 202

    state = admin.get(f"{CATALOG}/refresh/status").json()
    assert state["status"] == "done", state
    assert state["total_steps"] == 6
    assert state["result"] == {
        "sets_processed": 1,
        "cards_upserted": 1,
        "matched": 0,
        "unmatched": 1,
        "skipped": 0,
        "failed": 0,
        "french_missing": 0,
        "images_downloaded": 1,
        "thumbnails_generated": 2,
        "set_logos_updated": 1,
        "variant_icons_downloaded": 1,
        "variant_icons_unavailable": [],
    }
    for step in jobs.STEPS:
        step_state = admin.get(f"{CATALOG}/refresh/steps/{step}/status").json()
        assert step_state["status"] == "done", step
    thumbnails = data_dir / SV / "SVI" / "thumbnails"
    assert sorted(p.name for p in thumbnails.iterdir()) == [
        "1_sprigatito_standard_EN.jpg",
        "1_sprigatito_standard_FR.jpg",
    ]
    assert (data_dir / "variant-icons" / "reverse.svg").is_file()


def test_full_refresh_stops_at_a_failing_step(admin, source_dir, monkeypatch):
    def boom(db, progress):
        raise RuntimeError("TCGdex down")

    label, _ = jobs.STEPS["import_card_details"]
    monkeypatch.setitem(jobs.STEPS, "import_card_details", (label, boom))
    admin.post(f"{CATALOG}/refresh")
    state = admin.get(f"{CATALOG}/refresh/status").json()
    assert state["status"] == "error"
    assert state["step"] == "import_card_details"
    assert admin.get(f"{CATALOG}/refresh/steps/import_html/status").json()[
        "status"
    ] == ("done")
    assert admin.get(f"{CATALOG}/refresh/steps/import_card_details/status").json()[
        "status"
    ] == ("error")
    assert jobs.running() is None


# ── catalog metadata ─────────────────────────────────────────────────────────


def test_export_then_import_keeps_ids_and_french_names(admin):
    card_id = add_catalog_card(
        display_name="Poussacha",
        name="Sprigatito",
        details={"en": {"hp": 70}},
        image_path_fr=f"{SV}/SVI/cards/1_sprigatito_standard_FR.jpg",
    )
    response = admin.get(f"{CATALOG}/export")
    assert response.status_code == 200
    assert "cards_metadata.json" in response.headers["content-disposition"]
    file = response.json()
    assert file["total_cards"] == 1
    exported = file["cards"][0]
    assert exported["pokemon_name"] == "Sprigatito"
    assert exported["display_name"] == "Poussacha"
    assert exported["local_path"].endswith("1_sprigatito_standard_EN.jpg")
    assert [v["variant_type"] for v in exported["variants"]] == ["standard", "reverse"]

    exported["pokemon_name"] = "Sprigatito (fixed)"
    exported["variants"].append(
        {"variant_type": "reverse_pokeball", "image_path_us": "p.jpg"}
    )
    new = dict(exported, card_number="2", local_path="SV/SVI/cards/2.jpg")
    file = {"total_cards": 2, "cards": [exported, new]}
    response = admin.post(f"{CATALOG}/import/metadata", json=file)
    assert response.status_code == 200
    assert response.json() == {"created": 1, "updated": 1}

    with database.SessionLocal() as db:
        row = db.get(m.CardCatalog, card_id)
        assert (row.name, row.display_name) == ("Sprigatito (fixed)", "Poussacha")
        assert [v.variant_type for v in row.variants] == [
            "standard",
            "reverse",
            "reverse_pokeball",
        ]
        assert row.variants[2].image_path_us == "p.jpg"
        assert db.scalar(select(m.CardCatalog).where(m.CardCatalog.card_number == "2"))


def test_an_old_file_without_french_names_keeps_the_stored_ones(admin):
    card_id = add_catalog_card(display_name="Poussacha", name="Sprigatito")
    old = admin.get(f"{CATALOG}/export").json()
    for entry in old["cards"]:
        del entry["display_name"]
        entry["image_embedding"] = None  # extra old fields are ignored
    old["cards"].append(
        dict(old["cards"][0], card_number="9", local_path="SV/SVI/cards/9.jpg")
    )
    old["total_cards"] = 2
    assert admin.post(f"{CATALOG}/import/metadata", json=old).status_code == 200
    with database.SessionLocal() as db:
        assert db.get(m.CardCatalog, card_id).display_name == "Poussacha"
        new = db.scalar(select(m.CardCatalog).where(m.CardCatalog.card_number == "9"))
        assert new.display_name == "Sprigatito"


@pytest.mark.parametrize(
    "change",
    [
        lambda f: f.update(total_cards=5),
        lambda f: f["cards"][0].update(pokemon_name=" "),
        lambda f: f["cards"].append(dict(f["cards"][0])) or f.update(total_cards=2),
        lambda f: f["cards"][0]["variants"].append({"variant_type": "nope"}),
        lambda f: f["cards"][0]["variants"].append({"variant_type": "reverse"}),
        lambda f: f.update(cards=[], total_cards=0),
        lambda f: f["cards"][0].pop("set_code"),
    ],
)
def test_invalid_files_are_422_and_change_nothing(admin, change):
    card_id = add_catalog_card(name="Sprigatito")
    file = admin.get(f"{CATALOG}/export").json()
    file["cards"][0]["pokemon_name"] = "Changed"
    change(file)
    assert admin.post(f"{CATALOG}/import/metadata", json=file).status_code == 422
    with database.SessionLocal() as db:
        assert db.get(m.CardCatalog, card_id).name == "Sprigatito"
    assert jobs.running() is None


def test_an_image_path_of_another_card_is_409(admin):
    add_catalog_card(card_number="1", name="A")
    other = add_catalog_card(card_number="2", name="B")
    file = admin.get(f"{CATALOG}/export").json()
    file["cards"][0]["local_path"] = file["cards"][1]["local_path"]
    file["cards"] = file["cards"][:1]
    file["total_cards"] = 1
    response = admin.post(f"{CATALOG}/import/metadata", json=file)
    assert response.status_code == 409
    with database.SessionLocal() as db:
        assert db.get(m.CardCatalog, other).name == "B"
    assert jobs.running() is None
    assert jobs.get_state(jobs.IMPORT_METADATA)["status"] == "error"


# ── images export ────────────────────────────────────────────────────────────


@pytest.fixture
def image_tree(data_dir):
    for path in (
        f"{SV}/SVI/cards/1_a_standard_EN.jpg",
        f"{SV}/SVI/cards/1_a_standard_FR.jpg",
        f"{SV}/SVI/cards/1_a_reverse_EN.jpg",
        f"{SV}/SVI/thumbnails/1_a_standard_EN.jpg",
        f"{SV}/SVI/SVI_logo_EN.png",
        f"{SV}/SVI/SVI_logo_FR.png",
        f"{SV}/SVI/SVI_symbol.png",
        f"{SV}/MEW/cards/1_b_standard_EN.jpg",
        "variant-icons/reverse.svg",
        "card-details/en/sets.json",
    ):
        write(data_dir, path, path.encode())
    return data_dir


def exported_names(admin, query: str = "") -> list[str]:
    response = admin.get(f"{CATALOG}/export/images{query}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "card_images.zip" in response.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        assert zf.testzip() is None
        names = zf.namelist()
        assert all(zf.read(n) == n.encode() for n in names)
        return names


def test_images_export_streams_every_image_by_default(
    admin, image_tree, connections_while_streaming
):
    assert exported_names(admin) == [
        f"{SV}/MEW/cards/1_b_standard_EN.jpg",
        f"{SV}/SVI/SVI_logo_EN.png",
        f"{SV}/SVI/SVI_logo_FR.png",
        f"{SV}/SVI/SVI_symbol.png",
        f"{SV}/SVI/cards/1_a_reverse_EN.jpg",
        f"{SV}/SVI/cards/1_a_standard_EN.jpg",
        f"{SV}/SVI/cards/1_a_standard_FR.jpg",
        f"{SV}/SVI/thumbnails/1_a_standard_EN.jpg",
    ]
    assert connections_while_streaming == [0]


@pytest.mark.parametrize(
    "query, expected",
    [
        (
            "?french=false&variants=false&logos=false&symbols=false&set_code=SVI",
            [
                f"{SV}/SVI/cards/1_a_standard_EN.jpg",
                f"{SV}/SVI/thumbnails/1_a_standard_EN.jpg",
            ],
        ),
        ("?english=false&standard=false&symbols=false", [f"{SV}/SVI/SVI_logo_FR.png"]),
        (
            "?standard=false&logos=false",
            [f"{SV}/SVI/SVI_symbol.png", f"{SV}/SVI/cards/1_a_reverse_EN.jpg"],
        ),
    ],
)
def test_images_export_filters(admin, image_tree, query, expected):
    assert exported_names(admin, query) == expected


def test_nothing_to_export_is_404(admin, image_tree):
    assert admin.get(f"{CATALOG}/export/images?set_code=NOPE").status_code == 404


def test_the_export_is_a_valid_zip64_beyond_65535_entries(tmp_path):
    """Streamed without seeking, the central directory still lists them all."""
    from domains.cards.refresh import archive

    scan = write(tmp_path, "a.jpg", b"img")
    files = [(scan, f"S/SET/cards/{i}_EN.jpg") for i in range(70_000)]
    with zipfile.ZipFile(io.BytesIO(b"".join(archive.stream_zip(files)))) as zf:
        assert len(zf.infolist()) == 70_000


# ── images import ────────────────────────────────────────────────────────────


def post_zip(admin, body: bytes, query: str = ""):
    return admin.post(
        f"{CATALOG}/import/images{query}",
        content=body,
        headers={"content-type": "application/zip"},
    )


def test_images_import_restores_selected_files_and_links_pending_scans(
    admin, data_dir, source_dir, monkeypatch
):
    write_set(source_dir, SV, "SVI", [card("Bulbasaur", "1")])
    admin.post(f"{CATALOG}/refresh/steps/import_html")
    write(data_dir, f"{SV}/SVI/SVI_symbol.png", b"kept")
    body = make_zip(
        {
            f"{SV}/SVI/cards/1_bulbasaur_standard_EN.jpg": b"en",
            f"{SV}/SVI/cards/1_bulbasaur_standard_FR.jpg": b"fr",
            f"{SV}/SVI/SVI_symbol.png": b"replaced?",
            f"{SV}/SVI/SVI_logo_FR.png": b"logo-fr",
            "../escape_logo_EN.png": b"no",
            "notes.txt": b"ignored",
        }
    )

    # Checked right after the upload: no connection held while receiving it.
    connections = []
    is_zip = archive.is_zip
    monkeypatch.setattr(
        archive,
        "is_zip",
        lambda path: connections.append(database.engine.pool.checkedout())
        or is_zip(path),
    )
    response = post_zip(admin, body, "?french=true&logos=false")
    assert response.status_code == 202
    assert connections == [0]

    state = admin.get(f"{CATALOG}/import/images/status").json()
    assert state["status"] == "done", state
    assert state["result"] == {"copied": 2, "skipped": 1, "linked": 2}
    assert (data_dir / f"{SV}/SVI/SVI_symbol.png").read_bytes() == b"kept"
    assert not (data_dir / f"{SV}/SVI/SVI_logo_FR.png").exists()
    assert not (data_dir.parent / "escape_logo_EN.png").exists()
    assert not (data_dir / "notes.txt").exists()
    assert not list(data_dir.glob(".upload-*"))
    with database.SessionLocal() as db:
        row = db.scalar(select(m.CardCatalog))
        assert row.image_path == f"{SV}/SVI/cards/1_bulbasaur_standard_EN.jpg"
        assert row.image_path_fr == f"{SV}/SVI/cards/1_bulbasaur_standard_FR.jpg"


@pytest.mark.parametrize("body", [b"", b"not a zip"])
def test_a_body_that_is_not_a_zip_is_422_and_frees_the_lock(admin, data_dir, body):
    assert post_zip(admin, body).status_code == 422
    state = admin.get(f"{CATALOG}/import/images/status").json()
    assert state["status"] == "error"
    assert jobs.running() is None
    assert not list(data_dir.glob(".upload-*"))


def test_images_import_needs_csrf(admin):
    del admin.headers["x-csrf-token"]
    assert post_zip(admin, make_zip({"a": b"b"})).status_code == 403
    assert jobs.running() is None


# ── public variant badges ────────────────────────────────────────────────────


def test_variant_badges_are_public(anon, data_dir):
    write(data_dir, "variant-icons/holo_cosmos.png", b"\x89PNG")
    response = anon.get(f"{URL}/public/variant-icons/holo_cosmos.png")
    assert response.status_code == 200
    assert response.content == b"\x89PNG"
    assert response.headers["cache-control"] == "public, max-age=86400"


def test_a_missing_badge_gets_an_uncached_placeholder(anon):
    response = anon.get(f"{URL}/public/variant-icons/holo_cosmos.png")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert response.headers["cache-control"] == "no-store"
    assert ">39<" in response.text


def test_only_known_badge_files_are_served(anon, data_dir):
    write(data_dir, "variant-icons/other.png")
    write(data_dir, "secret.png")
    for name in ("other.png", "..%2Fsecret.png", "standard.png"):
        assert anon.get(f"{URL}/public/variant-icons/{name}").status_code == 404
