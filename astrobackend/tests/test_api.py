import pytest
import server


@pytest.fixture()
def app():
    app = server.app
    app.config.update({
        "TESTING": True,
    })

    # other setup can go here

    yield app

    # clean up / reset resources here


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def runner(app):
    return app.test_cli_runner()


def test_root(client):
    response = client.get("/")
    assert b"<p>Use the API</p>" in response.data

    
@pytest.mark.parametrize("obj", ["sun", "moon"])
def test_get_obj(client, obj):
    response = client.post("/api/get-obj",
            json={"target": obj, "lat": 60, "lon": 24,
                  "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 200
    assert isinstance(response.json["az"], float)
    assert isinstance(response.json["alt"], float)
    assert isinstance(response.json["radius"], float)

    
@pytest.mark.parametrize("obj", ["sun", "moon"])
def test_get_obj_timeseries(client, obj):
    response = client.post("/api/get-obj",
            json={"target": obj, "lat": 60, "lon": 24, "timespan": "day",
                  "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 200
    assert isinstance(response.json["series"][0]["az"], float)
    assert isinstance(response.json["series"][0]["alt"], float)
    assert isinstance(response.json["series"][0]["sun_alt"], float)
    assert "2025-12-10T22:42:33.015" in response.json["series"][0]["ts"]

