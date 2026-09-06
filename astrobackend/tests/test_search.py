"""Search resolution and filtering, offline: the SIMBAD seams in
catalog.py are replaced with canned astropy tables."""

import numpy as np
import pytest
from astropy.table import Table, MaskedColumn

import catalog
import server


@pytest.fixture()
def client():
    server.app.config.update({"TESTING": True})
    return server.app.test_client()


@pytest.fixture(autouse=True)
def fresh_catalog_cache():
    catalog.clear_cache()
    yield
    catalog.clear_cache()


def objects_table(rows):
    """A query_objects-shaped table. rows: (user_specified_id, main_id,
    ra, dec, V, otype); None becomes a masked cell, and an unresolved
    identifier is a row with masked coordinates and an empty main_id."""
    def column(index, dtype):
        values = [r[index] for r in rows]
        mask = [v is None for v in values]
        filled = [(0.0 if dtype is float else "") if v is None else v
                  for v in values]
        return MaskedColumn(filled, mask=mask, dtype=dtype)
    return Table({
        "main_id": column(1, str), "ra": column(2, float),
        "dec": column(3, float), "V": column(4, float),
        "otype": column(5, str), "user_specified_id": column(0, str)})


def tap_table(rows):
    """A query_tap-shaped table: (main_id, ra, dec, V, otype)."""
    return Table(rows=rows, names=["main_id", "ra", "dec", "V", "otype"],
                 dtype=[str, float, float, float, str])


MESSIER_ROWS = [
    ("M 1", "M   1", 83.63, 22.01, None, "SNR"),
    ("M 13", "M  13", 250.42, 36.46, 5.8, "GlC"),
    ("M 31", "M  31", 10.68, 41.27, 3.44, "AGN"),
    ("M 45", "M  45", 56.60, 24.11, 1.2, "OpC"),
]

DOUBLE_ROWS = [
    ("* alf Vir", 201.30, -11.16, 0.97, "bC*"),
    ("* alf Boo", 213.92, 19.18, -0.05, "RG*"),
    ("* zet UMa", 200.98, 54.93, 2.23, "SB*"),
]


def seam_raises(monkeypatch):
    def boom(*a, **kw):
        raise catalog.CatalogUnavailable("The SIMBAD catalog could not be queried (ConnectionError)")
    monkeypatch.setattr(catalog, "_simbad_query_objects", boom)
    monkeypatch.setattr(catalog, "_simbad_query_tap", boom)


def resolve(client, body):
    return client.post("/api/resolve-targets", json={"set": body})


# --- resolution -------------------------------------------------------------

def test_resolve_planets_needs_no_catalog(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "planets"})
    assert r.status_code == 200
    assert r.json["count"] == 8
    assert r.json["unresolved"] == []
    assert [c["name"] for c in r.json["candidates"]] == [
        "Mercury", "Venus", "Moon", "Mars", "Jupiter", "Saturn", "Uranus",
        "Neptune"]
    assert all(c["ss_obj"] for c in r.json["candidates"])


def test_resolve_messier(client, monkeypatch):
    asked = []

    def fake(names):
        asked.append(list(names))
        return objects_table(MESSIER_ROWS)
    monkeypatch.setattr(catalog, "_simbad_query_objects", fake)

    r = resolve(client, {"kind": "messier"})
    assert r.status_code == 200
    assert asked == [catalog.MESSIER_IDS]
    names = [c["name"] for c in r.json["candidates"]]
    assert names == ["M 1", "M 13", "M 31", "M 45"]
    m1, m13, m31 = r.json["candidates"][:3]
    assert m1["magnitude"] is None
    assert m1["object_type"] == "Supernova remnant"
    assert m13["object_type"] == "Globular cluster"
    assert m31["ra"] == pytest.approx(10.68)
    assert m31["dec"] == pytest.approx(41.27)
    assert m31["magnitude"] == pytest.approx(3.44)
    assert m31["object_type"] == "Active galaxy"
    assert not m31["ss_obj"]


def test_resolve_messier_magnitude_limit_drops_unknown_magnitudes(client, monkeypatch):
    monkeypatch.setattr(catalog, "_simbad_query_objects",
                        lambda names: objects_table(MESSIER_ROWS))
    r = resolve(client, {"kind": "messier", "max_magnitude": 4})
    assert r.status_code == 200
    assert [c["name"] for c in r.json["candidates"]] == ["M 31", "M 45"]
    assert r.json["count"] == 2


def test_resolve_messier_is_cached_per_magnitude(client, monkeypatch):
    calls = []

    def fake(names):
        calls.append(1)
        return objects_table(MESSIER_ROWS)
    monkeypatch.setattr(catalog, "_simbad_query_objects", fake)
    assert resolve(client, {"kind": "messier"}).status_code == 200
    assert resolve(client, {"kind": "messier"}).status_code == 200
    assert len(calls) == 1
    assert resolve(client, {"kind": "messier", "max_magnitude": 6}).status_code == 200
    assert len(calls) == 2


def test_resolve_double_stars(client, monkeypatch):
    queries = []

    def fake(adql):
        queries.append(adql)
        return tap_table(DOUBLE_ROWS)
    monkeypatch.setattr(catalog, "_simbad_query_tap", fake)

    r = resolve(client, {"kind": "double_stars", "max_magnitude": 2.5})
    assert r.status_code == 200
    assert len(queries) == 1
    assert "otypes.otype = '**'" in queries[0]
    assert "allfluxes.V <= 2.5" in queries[0]
    assert f"TOP {catalog.CANDIDATE_CAP + 1}" in queries[0]
    names = [c["name"] for c in r.json["candidates"]]
    assert names == ["alf Vir", "alf Boo", "zet UMa"]
    for c in r.json["candidates"]:
        assert c["object_type"] == "Double star"
        assert not c["ss_obj"]
    assert r.json["candidates"][2]["magnitude"] == pytest.approx(2.23)


def test_resolve_double_stars_needs_magnitude(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "double_stars"})
    assert r.status_code == 400
    assert "magnitude" in r.json["message"]


def test_resolve_too_many_candidates(client, monkeypatch):
    rows = [(f"HD {i}", float(i % 360), 10.0, 5.0, "**")
            for i in range(catalog.CANDIDATE_CAP + 1)]
    monkeypatch.setattr(catalog, "_simbad_query_tap", lambda adql: tap_table(rows))
    r = resolve(client, {"kind": "double_stars", "max_magnitude": 9})
    assert r.status_code == 400
    assert r.json["error"] == "too_many"
    assert "lower the magnitude" in r.json["message"]


def test_resolve_names_mixed(client, monkeypatch):
    asked = []

    def fake(names):
        asked.append(list(names))
        return objects_table([
            ("Vega", "* alf Lyr", 279.23, 38.78, 0.03, "dS*"),
            ("Notastar", "", None, None, None, ""),
        ])
    monkeypatch.setattr(catalog, "_simbad_query_objects", fake)

    r = resolve(client, {"kind": "names", "names": ["mars", "Vega", "Notastar"]})
    assert r.status_code == 200
    # Solar-system names never reach the catalog.
    assert asked == [["Vega", "Notastar"]]
    assert r.json["unresolved"] == ["Notastar"]
    assert r.json["count"] == 2
    mars, vega = r.json["candidates"]
    assert mars == {"name": "Mars", "ss_obj": True, "ra": None, "dec": None,
                    "magnitude": None, "object_type": ""}
    assert vega["name"] == "Vega"
    assert vega["ra"] == pytest.approx(279.23)
    assert vega["magnitude"] == pytest.approx(0.03)
    assert vega["object_type"] == "Delta Scuti variable"


def test_resolve_names_empty(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "names", "names": [" ", ""]})
    assert r.status_code == 400


def test_resolve_unknown_kind(client):
    r = resolve(client, {"kind": "comets"})
    assert r.status_code == 400


def test_resolve_catalog_unavailable(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "messier"})
    assert r.status_code == 502
    assert r.json["error"] == "catalog"
    assert "SIMBAD" in r.json["message"]
    # The service is fine for other requests afterwards.
    assert client.get("/health").status_code == 200


def test_otype_labels():
    assert catalog.otype_label("**") == "Double star"
    assert catalog.otype_label("G") == "Galaxy"
    assert catalog.otype_label("Sy1?") == "Seyfert 1 galaxy (candidate)"
    assert catalog.otype_label("XYZ*") == "Star"
    assert catalog.otype_label("zzz") == "zzz"
    assert catalog.display_name("* alf Vir") == "alf Vir"
    assert catalog.display_name("NAME Sirius") == "Sirius"
    assert catalog.display_name("M  31") == "M 31"


# --- filtering ----------------------------------------------------------------

HELSINKI = {"lat": 60.17, "lon": 24.94}
FULL_SKY = {"min_az": 0, "max_az": 360, "min_alt": 0, "max_alt": 90}

# RA 96, Dec -25 transits Helsinki at about 23:30 UTC on 2025-12-10 at an
# altitude of ~5 degrees: below the horizon three hours either side.
BRIEF = {"name": "Brief", "ss_obj": False, "ra": 96.0, "dec": -25.0}
VEGA = {"name": "Vega", "ss_obj": False, "ra": 279.23, "dec": 38.78}
SOUTH = {"name": "South", "ss_obj": False, "ra": 96.0, "dec": -60.0}
SUN = {"name": "Sun", "ss_obj": True}

NIGHT = {"start": "2025-12-10T20:30:00Z", "end": "2025-12-11T02:30:00Z"}


def filt(client, candidates, windows, visibility="horizon", brightness="D",
         position=HELSINKI, obs_window=FULL_SKY):
    return client.post("/api/filter-targets", json={
        "candidates": candidates, **position, "obs_window": obs_window,
        "windows": windows, "visibility": visibility,
        "max_brightness": brightness})


def test_filter_premise_brief_object(client):
    # Self-check of the fixture: below the horizon at the window's ends,
    # above it in the middle.
    r = client.post("/api/get-objs", json={**HELSINKI, "targets": [BRIEF],
                                           "time": NIGHT["start"]})
    assert r.json["results"][0]["alt"] < 0
    r = client.post("/api/get-objs", json={**HELSINKI, "targets": [BRIEF],
                                           "time": NIGHT["end"]})
    assert r.json["results"][0]["alt"] < 0
    r = client.post("/api/get-objs", json={**HELSINKI, "targets": [BRIEF],
                                           "time": "2025-12-10T23:30:00Z"})
    assert r.json["results"][0]["alt"] > 0


def test_filter_object_visible_only_mid_window(client):
    r = filt(client, [BRIEF], [NIGHT])
    assert r.status_code == 200
    assert r.json == {"matched": [True], "count": 1}

    # A window that ends before it rises.
    r = filt(client, [BRIEF], [{"start": "2025-12-10T18:00:00Z",
                                "end": "2025-12-10T20:00:00Z"}])
    assert r.json == {"matched": [False], "count": 0}


def test_filter_never_dark_enough(client):
    # Midsummer at latitude 63: the Sun's upper limb stays above -6
    # degrees all night, so nothing satisfies nautical twilight.
    far_north = {"lat": 63.0, "lon": 24.94}
    window = [{"start": "2025-06-21T19:00:00Z", "end": "2025-06-22T03:00:00Z"}]
    r = filt(client, [VEGA], window, visibility="none", brightness="NT",
             position=far_north)
    assert r.json == {"matched": [False], "count": 0}
    # Same object and window with no brightness limit is fine.
    r = filt(client, [VEGA], window, visibility="none", brightness="D",
             position=far_north)
    assert r.json == {"matched": [True], "count": 1}


def test_filter_no_criteria_short_circuit(client, monkeypatch):
    def no_astro(*a, **kw):
        raise AssertionError("no computation expected")
    monkeypatch.setattr(server, "_candidates_altaz", no_astro)
    r = filt(client, [BRIEF, SOUTH, SUN], [NIGHT], visibility="none",
             brightness="D")
    assert r.json == {"matched": [True, True, True], "count": 3}


def test_filter_no_windows_matches_everything(client):
    r = filt(client, [SOUTH], [], visibility="window", brightness="N")
    assert r.json == {"matched": [True], "count": 1}


def test_filter_multi_night(client):
    below = [{"start": "2025-12-10T08:00:00Z", "end": "2025-12-10T10:00:00Z"},
             {"start": "2025-12-10T12:00:00Z", "end": "2025-12-10T14:00:00Z"}]
    r = filt(client, [BRIEF], below)
    assert r.json["matched"] == [False]
    r = filt(client, [BRIEF], below + [NIGHT])
    assert r.json["matched"] == [True]


def test_filter_flag_order_mixed_list(client):
    # Vega is circumpolar from Helsinki, the Sun is down at night, the
    # far-southern object never rises, and the brief one peeks up.
    r = filt(client, [VEGA, SUN, SOUTH, BRIEF], [NIGHT])
    assert r.json == {"matched": [True, False, False, True], "count": 2}


def test_filter_observation_window(client):
    # Vega is up all night but the window only admits the south-east
    # quadrant above 60 degrees, which it never reaches from Helsinki.
    narrow = {"min_az": 90, "max_az": 180, "min_alt": 60, "max_alt": 90}
    r = filt(client, [VEGA], [NIGHT], visibility="window", obs_window=narrow)
    assert r.json["matched"] == [False]
    r = filt(client, [VEGA], [NIGHT], visibility="window", obs_window=FULL_SKY)
    assert r.json["matched"] == [True]


def test_filter_wrapping_azimuth_window(client):
    # Vega crosses the north through the night from Helsinki, azimuth
    # roughly 330 -> 30: inside a window that wraps through north
    # (270 -> 90), outside the same arc's complement (90 -> 270).
    wrapping = {"min_az": 270, "max_az": 90, "min_alt": 0, "max_alt": 90}
    complement = {"min_az": 90, "max_az": 270, "min_alt": 0, "max_alt": 90}
    r = filt(client, [VEGA], [NIGHT], visibility="window", obs_window=wrapping)
    assert r.json["matched"] == [True]
    r = filt(client, [VEGA], [NIGHT], visibility="window", obs_window=complement)
    assert r.json["matched"] == [False]
    # Equal limits are an empty window.
    empty = {"min_az": 10, "max_az": 10, "min_alt": 0, "max_alt": 90}
    r = filt(client, [VEGA], [NIGHT], visibility="window", obs_window=empty)
    assert r.json["matched"] == [False]


def test_filter_brightness_thresholds(client):
    # Helsinki in December reaches full night; every limit is satisfiable.
    for brightness in ["N", "AT", "NT", "CT", "D"]:
        r = filt(client, [VEGA], [NIGHT], visibility="none", brightness=brightness)
        assert r.json["matched"] == [True], brightness
    # A daytime window satisfies only D.
    day = [{"start": "2025-12-10T10:00:00Z", "end": "2025-12-10T12:00:00Z"}]
    for brightness in ["N", "AT", "NT", "CT"]:
        r = filt(client, [VEGA], day, visibility="none", brightness=brightness)
        assert r.json["matched"] == [False], brightness
    r = filt(client, [VEGA], day, visibility="none", brightness="D")
    assert r.json["matched"] == [True]


def test_filter_needs_no_catalog(client, monkeypatch):
    def boom(*a, **kw):
        raise AssertionError("filtering must not touch SIMBAD")
    monkeypatch.setattr(catalog, "_simbad", boom)
    r = filt(client, [VEGA, BRIEF], [NIGHT])
    assert r.json["matched"] == [True, True]


def test_filter_samples_end_included(client, monkeypatch):
    seen = {}

    def spy(candidates, times, loc):
        seen["n"] = len(times)
        return np.full((len(candidates), len(times)), 10.0), \
            np.full((len(candidates), len(times)), 180.0)
    monkeypatch.setattr(server, "_candidates_altaz", spy)
    # 20:30..02:30 is 12 half-hour steps: 13 samples on the grid.
    filt(client, [VEGA], [NIGHT])
    assert seen["n"] == 13
    # An end off the grid is added as an extra sample.
    filt(client, [VEGA], [{"start": "2025-12-10T20:30:00Z",
                           "end": "2025-12-10T21:40:00Z"}])
    assert seen["n"] == 4


def test_filter_validation(client):
    many = [{"start": f"2025-12-{d:02d}T20:00:00Z", "end": f"2025-12-{d:02d}T23:00:00Z"}
            for d in range(1, 32)]
    assert filt(client, [VEGA], many).status_code == 200
    extra = [{"start": "2026-01-01T20:00:00Z", "end": "2026-01-01T23:00:00Z"}]
    assert filt(client, [VEGA], many + extra).status_code == 400

    inverted = [{"start": "2025-12-11T02:30:00Z", "end": "2025-12-10T20:30:00Z"}]
    assert filt(client, [VEGA], inverted).status_code == 400
    too_long = [{"start": "2025-12-10T00:00:00Z", "end": "2025-12-11T01:00:00Z"}]
    assert filt(client, [VEGA], too_long).status_code == 400

    crowd = [dict(VEGA, name=f"S{i}") for i in range(schemas_max() + 1)]
    assert filt(client, crowd, [NIGHT]).status_code == 400

    assert filt(client, [VEGA], [NIGHT], visibility="sometimes").status_code == 400
    assert filt(client, [VEGA], [NIGHT], brightness="dusk").status_code == 400
    assert filt(client, [VEGA], [NIGHT], visibility="window",
                obs_window=None).status_code == 400
    assert filt(client, [VEGA], [NIGHT], visibility="window",
                obs_window={"min_az": 400, "max_az": 45, "min_alt": 0,
                            "max_alt": 90}).status_code == 400
    assert filt(client, [VEGA], [NIGHT], visibility="window",
                obs_window={"min_az": 0, "max_az": 360, "min_alt": 40,
                            "max_alt": 20}).status_code == 400
    assert filt(client, [{"name": "X", "ss_obj": False}], [NIGHT]).status_code == 400
    assert filt(client, [{"name": "Pluto", "ss_obj": True}], [NIGHT]).status_code == 400


def schemas_max():
    import schemas
    return schemas.MAX_CANDIDATES


# --- live ---------------------------------------------------------------------

@pytest.mark.network
def test_resolve_names_live_simbad(client):
    r = resolve(client, {"kind": "names", "names": ["M31", "Notastar42"]})
    assert r.status_code == 200
    assert r.json["unresolved"] == ["Notastar42"]
    m31 = r.json["candidates"][0]
    assert m31["ra"] == pytest.approx(10.68, abs=0.01)
    assert m31["dec"] == pytest.approx(41.27, abs=0.01)


@pytest.mark.network
def test_resolve_double_stars_live_simbad(client):
    r = resolve(client, {"kind": "double_stars", "max_magnitude": 0.0})
    assert r.status_code == 200, r.json
    assert r.json["count"] >= 1
    for c in r.json["candidates"]:
        assert c["object_type"] == "Double star"
        assert c["ra"] is not None and c["dec"] is not None
        assert c["magnitude"] is not None and c["magnitude"] <= 0.0
