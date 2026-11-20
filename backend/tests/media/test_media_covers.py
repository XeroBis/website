"""Setting an entry's cover: upload or URL, shared by everyone with the item."""

import httpx2
import pytest

from domains.media import covers

URL = "/api/media"
PNG = b"\x89PNG\r\n\x1a\nfake"


@pytest.fixture(autouse=True)
def public_dns(monkeypatch):
    """Every host is public unless a test says otherwise."""
    addresses = {"internal.example": ["10.0.0.5"], "localhost": ["127.0.0.1"]}
    monkeypatch.setattr(
        covers, "resolve", lambda host: addresses.get(host, ["93.184.216.34"])
    )


def _upload(client, entry_id, data=PNG, content_type="image/png"):
    return client.put(
        f"{URL}/library/{entry_id}/cover",
        content=data,
        headers={"content-type": content_type},
    )


def test_upload_replaces_the_shared_cover(client, other_client, add_manual):
    entry = add_manual(title="Dune")
    assert entry["item"]["has_cover"] is False

    r = _upload(client, entry["id"])
    assert r.status_code == 200, r.text
    item = r.json()["item"]
    assert item["has_cover"] is True
    assert item["updated_at"] != entry["item"]["updated_at"]

    cover = client.get(f"{URL}/items/{item['id']}/cover")
    assert (cover.content, cover.headers["content-type"]) == (PNG, "image/png")

    # A second upload overwrites it; anyone with the media app sees it.
    assert (
        _upload(client, entry["id"], b"\xff\xd8jpeg", "image/jpeg").status_code == 200
    )
    cover = other_client.get(f"{URL}/items/{item['id']}/cover")
    assert (cover.content, cover.headers["content-type"]) == (
        b"\xff\xd8jpeg",
        "image/jpeg",
    )


def test_upload_rules(client, other_client, add_manual):
    entry = add_manual()
    bad_type = _upload(client, entry["id"], b"<svg/>", "image/svg+xml")
    assert bad_type.status_code == 422
    assert _upload(client, entry["id"], b"", "image/png").status_code == 422
    too_big = _upload(client, entry["id"], b"x" * (2 * 1024 * 1024 + 1))
    assert too_big.status_code == 422
    # Only on your own entries.
    assert _upload(other_client, entry["id"]).status_code == 404


def test_cover_from_url(client, add_manual, web):
    entry = add_manual()
    web.routes["img.example/a.png"] = httpx2.Response(
        302, headers={"location": "https://img.example/b.png"}
    )
    web.routes["img.example/b.png"] = httpx2.Response(
        200, content=PNG, headers={"content-type": "image/png"}
    )
    r = client.post(
        f"{URL}/library/{entry['id']}/cover/from-url",
        json={"url": "https://img.example/a.png"},
    )
    assert r.status_code == 200, r.text
    cover = client.get(f"{URL}/items/{entry['item']['id']}/cover")
    assert cover.content == PNG


def test_cover_from_url_refuses_private_and_non_images(client, add_manual, web):
    entry = add_manual()

    def from_url(url):
        return client.post(
            f"{URL}/library/{entry['id']}/cover/from-url", json={"url": url}
        )

    assert from_url("file:///etc/passwd").status_code == 422
    assert from_url("http://localhost/x.png").status_code == 422
    assert from_url("http://internal.example/x.png").status_code == 422
    # A redirect into the private network is refused too.
    web.routes["img.example/hop"] = httpx2.Response(
        302, headers={"location": "http://internal.example/x.png"}
    )
    assert from_url("https://img.example/hop").status_code == 422
    web.routes["img.example/page"] = httpx2.Response(
        200, content=b"<html>", headers={"content-type": "text/html"}
    )
    assert from_url("https://img.example/page").status_code == 422
    assert not any(r.url.host == "internal.example" for r in web.requests)
    assert client.get(f"{URL}/items/{entry['item']['id']}/cover").status_code == 404
