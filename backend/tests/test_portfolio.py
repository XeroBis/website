import pytest
from sqlalchemy import select

from domains.portfolio.models import Tag
from tests.conftest import csrf, login, make_user

URL = "/api/portfolio/projects"


def body(**overrides):
    return {
        "name": "Cards",
        "description_fr": "Collection de cartes",
        "description_en": "Card collection",
        "repo_url": "https://github.com/XeroBis/pkm_cards",
        "featured": False,
        "position": 0,
        "tags": ["Angular", "FastAPI"],
    } | overrides


@pytest.fixture
def admin(client):
    make_user(email="admin@example.com", is_admin=True)
    login(client, email="admin@example.com")
    return client


def create(client, **overrides):
    r = client.post(URL, json=body(**overrides), headers=csrf(client))
    assert r.status_code == 201, r.text
    return r.json()


def tag_names(db) -> list[str]:
    return sorted(db.scalars(select(Tag.name)))


# ── public ───────────────────────────────────────────────────────────────────


def test_list_is_public_and_empty_at_first(client):
    r = client.get(URL)
    assert r.status_code == 200
    assert r.json() == []


def test_list_and_detail_while_logged_out(admin):
    project = create(admin)
    admin.cookies.clear()
    assert admin.get(URL).json() == [project]
    assert admin.get(f"{URL}/{project['id']}").json() == project
    assert project == {
        "id": project["id"],
        "name": "Cards",
        "description_fr": "Collection de cartes",
        "description_en": "Card collection",
        "repo_url": "https://github.com/XeroBis/pkm_cards",
        "featured": False,
        "position": 0,
        "tags": ["Angular", "FastAPI"],
    }


def test_list_order_is_position_then_newest(admin):
    a = create(admin, name="A", position=2)
    b = create(admin, name="B", position=1, featured=True)
    c = create(admin, name="C", position=2)
    assert [p["id"] for p in admin.get(URL).json()] == [b["id"], c["id"], a["id"]]


def test_tags_are_sorted_case_insensitively(admin):
    assert create(admin, tags=["vue", "Angular", "fastapi"])["tags"] == [
        "Angular",
        "fastapi",
        "vue",
    ]


def test_detail_unknown_is_404(client):
    assert client.get(f"{URL}/999").status_code == 404


def test_tags_list_is_public(admin):
    create(admin, name="A", tags=["python", "Angular"])
    create(admin, name="B", tags=["Python"])
    admin.cookies.clear()
    assert admin.get("/api/portfolio/tags").json() == ["Angular", "python"]


# ── admin: create / update / delete ─────────────────────────────────────────


def test_create_strips_and_reuses_tags_case_insensitively(admin, db):
    create(admin, name="A", tags=["Python"])
    project = create(
        admin, name="  B  ", tags=[" python ", "PYTHON", "Docker"], repo_url=""
    )
    assert project["name"] == "B"
    assert project["tags"] == ["Docker", "Python"]
    assert project["repo_url"] is None
    assert tag_names(db) == ["Docker", "Python"]


def test_create_rejects_duplicate_name_case_insensitively(admin):
    create(admin, name="Cards")
    r = admin.post(URL, json=body(name="CARDS"), headers=csrf(admin))
    assert r.status_code == 409


def test_update_replaces_fields_and_drops_unused_tags(admin, db):
    project = create(admin, tags=["Angular", "FastAPI"])
    r = admin.put(
        f"{URL}/{project['id']}",
        json=body(
            name="Pokemon Cards",
            description_en="Cards!",
            repo_url=None,
            featured=True,
            position=3,
            tags=["Angular", "Postgres"],
        ),
        headers=csrf(admin),
    )
    assert r.status_code == 200
    assert r.json() | {"id": 0} == body(
        id=0,
        name="Pokemon Cards",
        description_en="Cards!",
        repo_url=None,
        featured=True,
        position=3,
        tags=["Angular", "Postgres"],
    )
    assert tag_names(db) == ["Angular", "Postgres"]


def test_update_keeps_its_own_name(admin):
    project = create(admin)
    r = admin.put(f"{URL}/{project['id']}", json=body(), headers=csrf(admin))
    assert r.status_code == 200


def test_update_to_another_projects_name_is_409(admin):
    create(admin, name="A")
    b = create(admin, name="B")
    r = admin.put(f"{URL}/{b['id']}", json=body(name="a"), headers=csrf(admin))
    assert r.status_code == 409


def test_update_unknown_is_404(admin):
    assert admin.put(f"{URL}/999", json=body(), headers=csrf(admin)).status_code == 404


def test_delete_removes_project_and_unused_tags(admin, db):
    a = create(admin, name="A", tags=["Shared", "OnlyA"])
    create(admin, name="B", tags=["Shared"])
    r = admin.delete(f"{URL}/{a['id']}", headers=csrf(admin))
    assert r.status_code == 204
    assert admin.get(f"{URL}/{a['id']}").status_code == 404
    assert tag_names(db) == ["Shared"]


def test_delete_unknown_is_404(admin):
    assert admin.delete(f"{URL}/999", headers=csrf(admin)).status_code == 404


# ── editors: access control ───────────────────────────────────────────────────


def test_writes_need_a_session(admin):
    project = create(admin)
    admin.cookies.clear()
    assert admin.post(URL, json=body(name="X")).status_code == 401
    assert admin.put(f"{URL}/{project['id']}", json=body()).status_code == 401
    assert admin.delete(f"{URL}/{project['id']}").status_code == 401


def test_writes_need_the_portfolio_app(admin):
    project = create(admin)
    make_user(email="user@example.com", apps=["workout", "cards", "media"])
    login(admin)  # now a user without the portfolio app
    h = csrf(admin)
    assert admin.post(URL, json=body(name="X"), headers=h).status_code == 403
    assert (
        admin.put(f"{URL}/{project['id']}", json=body(), headers=h).status_code == 403
    )
    assert admin.delete(f"{URL}/{project['id']}", headers=h).status_code == 403
    assert len(admin.get(URL).json()) == 1


def test_users_with_the_portfolio_app_can_write(client):
    make_user(email="editor@example.com", apps=["portfolio"])
    login(client, email="editor@example.com")
    project = create(client)
    h = csrf(client)
    r = client.put(f"{URL}/{project['id']}", json=body(name="Renamed"), headers=h)
    assert r.json()["name"] == "Renamed"
    assert client.delete(f"{URL}/{project['id']}", headers=h).status_code == 204


def test_writes_need_csrf(admin):
    project = create(admin)
    assert admin.post(URL, json=body(name="X")).status_code == 403
    assert admin.put(f"{URL}/{project['id']}", json=body()).status_code == 403
    assert admin.delete(f"{URL}/{project['id']}").status_code == 403


# ── admin: validation ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "   "},
        {"name": "x" * 101},
        {"description_fr": ""},
        {"description_en": "x" * 1001},
        {"repo_url": "http://github.com/x"},
        {"repo_url": "github.com/x"},
        {"repo_url": "https://"},
        {"repo_url": "https://exa mple.com"},
        {"repo_url": "https://example.com/" + "x" * 300},
        {"position": -1},
        {"tags": [" "]},
        {"tags": ["x" * 31]},
        {"tags": [f"t{i}" for i in range(11)]},
    ],
)
def test_create_validates_fields(admin, overrides):
    r = admin.post(URL, json=body(**overrides), headers=csrf(admin))
    assert r.status_code == 422


def test_create_requires_both_descriptions(admin):
    payload = body()
    del payload["description_en"]
    assert admin.post(URL, json=payload, headers=csrf(admin)).status_code == 422


def test_any_https_forge_is_accepted(admin):
    url = "https://gitlab.com/someone/project"
    assert create(admin, repo_url=url)["repo_url"] == url


def test_defaults(admin):
    r = admin.post(
        URL,
        json={"name": "Min", "description_fr": "fr", "description_en": "en"},
        headers=csrf(admin),
    )
    assert r.status_code == 201
    assert r.json() | {"id": 0} == {
        "id": 0,
        "name": "Min",
        "description_fr": "fr",
        "description_en": "en",
        "repo_url": None,
        "featured": False,
        "position": 0,
        "tags": [],
    }
