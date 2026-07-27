from datetime import datetime, timezone

import astropy.utils.data
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

    
def test_apidocs(client):
    response = client.get("/apidocs/")
    assert response.status_code == 200

    
@pytest.mark.parametrize("obj", ["sun", "moon"])
def test_get_obj(client, obj):
    response = client.post("/api/get-obj",
            json={"target": obj, "lat": 60, "lon": 24,
                  "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 200
    assert isinstance(response.json["az"], float)
    assert isinstance(response.json["alt"], float)
    assert isinstance(response.json["radius"], float)

    
def test_get_obj_validation(client):
    response = client.post("/api/get-obj",
            json={"trget": "sun", "lat": 60, "lon": 24,
                  "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 400
    assert b"Missing data for required field." in response.data


def test_get_obj_ts_validation(client):
    response = client.post("/api/get-obj-timeseries",
            json={"target": "sun", "lat": 60, "lon": 24,
                  "time": "2025-12-10T22:42:33.015Z",
                  "timespn": "day"})
    assert response.status_code == 400
    assert b"Missing data for required field." in response.data


@pytest.mark.parametrize("obj", ["sun", "moon", "jupiter"])
def test_get_obj_timeseries(client, obj):
    response = client.post("/api/get-obj-timeseries",
            json={"target": obj, "lat": 60, "lon": 24, "timespan": "day",
                  "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 200
    assert isinstance(response.json["series"][0]["az"], float)
    assert isinstance(response.json["series"][0]["alt"], float)
    assert isinstance(response.json["series"][0]["sun_alt"], float)
    assert "2025-12-10T22:42:33.015" in response.json["series"][0]["ts"]


def test_get_obj_timeseries_validation(client):
    response = client.post("/api/get-obj-timeseries",
            json={"target": "sun", "lat": 60, "lon": 24, "timespan": "fortnight",
                  "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 400
    assert b"Must be one of" in response.data


def test_get_obj_sunrise(client):
    response = client.post("/api/get-obj",
            json={"target": "sun", "lat": 60.21, "lon": 24.85,
                  "time": "2025-12-12T07:15:00.000Z"})
    assert response.status_code == 200
#    assert (response.json["alt"] + response.json["radius"]) == 0


def test_get_obj_timeseries_shape_and_length(client):
    response = client.post("/api/get-obj-timeseries",
            json={"target": "moon", "lat": 60, "lon": 24, "timespan": "day",
                  "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 200
    series = response.json["series"]
    assert len(series) == 48
    for pt in series:
        assert set(pt.keys()) == {"alt", "az", "sun_alt", "ts"}
        assert isinstance(pt["alt"], float)
        assert isinstance(pt["az"], float)
        assert isinstance(pt["sun_alt"], float)
        assert pt["ts"].endswith("Z")
    # Adjacent samples are 30 minutes apart.
    from datetime import datetime
    t0 = datetime.fromisoformat(series[0]["ts"].replace("Z", ""))
    t1 = datetime.fromisoformat(series[1]["ts"].replace("Z", ""))
    assert (t1 - t0).total_seconds() == 30 * 60


def test_get_obj_timeseries_reuses_cached_sun_series(client, monkeypatch):
    from astropy.coordinates import get_body as real_get_body
    call_log = []

    def counting_get_body(body, times, loc, *a, **kw):
        call_log.append(str(body).lower())
        return real_get_body(body, times, loc, *a, **kw)
    monkeypatch.setattr(server, "get_body", counting_get_body)
    server._sun_alt_series.cache_clear()

    common = {"lat": 60, "lon": 24, "timespan": "day",
              "time": "2025-12-10T22:42:33.015Z"}
    r1 = client.post("/api/get-obj-timeseries", json={"target": "moon", **common})
    assert r1.status_code == 200
    assert "sun" in call_log, f"first call should compute the sun; got {call_log}"
    call_log.clear()

    r2 = client.post("/api/get-obj-timeseries", json={"target": "jupiter", **common})
    assert r2.status_code == 200
    assert "sun" not in call_log, \
        f"second call should hit the sun cache; got {call_log}"
    # And the sun_alt values are identical across the two responses.
    for i in range(48):
        assert r1.json["series"][i]["sun_alt"] == r2.json["series"][i]["sun_alt"]


def test_get_obj_timeseries_today_hits_no_network(client, monkeypatch):
    # Regression guard for OBS-6: astropy used to auto-download+parse
    # IERS_A on the request path for "today" times, blowing past
    # gunicorn's worker timeout. `iers.conf.auto_download = False` in
    # server.py should prevent any network attempt for today's date.
    def no_network(*a, **kw):
        raise AssertionError(
            f"unexpected network call during request: args={a} kwargs={kw}")
    monkeypatch.setattr(astropy.utils.data, "download_file", no_network)

    today = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    response = client.post("/api/get-obj-timeseries",
            json={"target": "moon", "lat": 60, "lon": 24, "timespan": "day",
                  "time": today})
    assert response.status_code == 200
    assert isinstance(response.json["series"][0]["az"], float)


def test_get_obj_timeseries_500_is_logged(app, monkeypatch, caplog):
    # Flask's TESTING=True short-circuits the errorhandler by
    # propagating exceptions. Turn it off so this test exercises the
    # actual production error path.
    app.config["TESTING"] = False
    app.config["PROPAGATE_EXCEPTIONS"] = False
    client = app.test_client()

    def boom(*a, **kw):
        raise RuntimeError("simulated astropy failure")
    monkeypatch.setattr(server, "get_body", boom)

    with caplog.at_level("ERROR"):
        response = client.post("/api/get-obj-timeseries",
                json={"target": "moon", "lat": 60, "lon": 24,
                      "timespan": "day",
                      "time": "2025-12-10T22:42:33.015Z"})
    assert response.status_code == 500
    assert response.json["error"] == "internal"
    assert len(response.json["error_id"]) == 8
    joined = "\n".join(rec.message for rec in caplog.records)
    assert "astro-timeseries-fail" in joined
    assert "unhandled-exception" in joined
    assert "simulated astropy failure" in joined
