"""`/api/cards/images/{path}`: files from CARDS_DATA_DIR, cards users only."""

from tests.cards.conftest import URL


def test_serves_a_file_with_long_private_caching(
    client, data_dir, connections_while_streaming
):
    scan = data_dir / "Scarlet & Violet" / "SVI" / "cards" / "001_a_standard_EN.jpg"
    scan.parent.mkdir(parents=True)
    scan.write_bytes(b"\xff\xd8jpeg")
    response = client.get(
        f"{URL}/images/Scarlet & Violet/SVI/cards/001_a_standard_EN.jpg"
    )
    assert response.status_code == 200
    assert response.content == b"\xff\xd8jpeg"
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"
    assert connections_while_streaming == [0]


def test_needs_the_cards_app(anon, cards_client, data_dir):
    (data_dir / "logo.png").write_bytes(b"png")
    assert anon.get(f"{URL}/images/logo.png").status_code == 401
    no_access = cards_client("nope@example.com", apps=("media",))
    assert no_access.get(f"{URL}/images/logo.png").status_code == 403


def test_missing_files_and_folders_are_404(client, data_dir):
    (data_dir / "SVI").mkdir()
    assert client.get(f"{URL}/images/nope.png").status_code == 404
    assert client.get(f"{URL}/images/SVI").status_code == 404


def test_paths_cannot_escape_the_data_folder(client, data_dir):
    (data_dir.parent / "secret.txt").write_text("no")
    assert client.get(f"{URL}/images/..%2Fsecret.txt").status_code == 404
    assert client.get(f"{URL}/images/%2E%2E/secret.txt").status_code == 404
