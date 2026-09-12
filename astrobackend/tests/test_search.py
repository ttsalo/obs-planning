"""Search resolution and filtering, offline: the SIMBAD seams in
catalog.py are replaced with canned astropy tables."""

import numpy as np
import pytest
from astropy.table import Table, MaskedColumn

import catalog
import lists
import server


@pytest.fixture()
def client():
    server.app.config.update({"TESTING": True})
    return server.app.test_client()


# A slice of SIMBAD's otypedef table: (otype, path). Enough of the
# hierarchy for the codes the tests use; note that a candidate type's
# path names the type it is a candidate of, not itself.
OTYPEDEF_ROWS = [
    ("*", "*"), ("MS*", "* > MS*"), ("Ev*", "* > Ev*"),
    ("RG*", "* > Ev* > RG*"), ("PN", "* > Ev* > PN"),
    ("Ma*", "* > Ma*"), ("bC*", "* > Ma* > bC*"), ("sg*", "* > Ma* > sg*"),
    ("s*b", "* > Ma* > sg* > s*b"),
    ("**", "* > **"), ("**?", "* > **"), ("EB*", "* > ** > EB*"),
    ("SB*", "* > ** > SB*"), ("SB?", "* > ** > SB*"),
    ("XB*", "* > ** > XB*"), ("LXB", "* > ** > XB* > LXB"),
    ("Sy*", "* > ** > Sy*"), ("Sy?", "* > ** > Sy*"),
    ("V*", "* > V*"), ("Er*", "* > V* > Er*"), ("Y*O", "* > Y*O"),
    ("Cl*", "Cl*"), ("GlC", "Cl* > GlC"), ("Gl?", "Cl* > GlC"),
    ("OpC", "Cl* > OpC"),
    ("ISM", "ISM"), ("Cld", "ISM > Cld"), ("GNe", "ISM > Cld > GNe"),
    ("RNe", "ISM > Cld > GNe > RNe"), ("HII", "ISM > HII"),
    ("SNR", "ISM > SNR"), ("SR?", "ISM > SNR"),
    ("G", "G"), ("AGN", "G > AGN"), ("SyG", "G > AGN > SyG"),
    ("Sy1", "G > AGN > SyG > Sy1"), ("Sy1?", "G > AGN > SyG > Sy1"),
]


def otypedef_table(rows=OTYPEDEF_ROWS):
    return Table(rows=rows, names=["otype", "path"], dtype=[str, str])


@pytest.fixture(autouse=True)
def fresh_catalog_cache(monkeypatch):
    # The hierarchy is canned for every test; a test that needs the seam
    # to fail or to be counted replaces it again.
    monkeypatch.setattr(catalog, "_simbad_query_otypedef", otypedef_table)
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
    """A query_tap-shaped table: (main_id, ra, dec, V, otype). An empty
    row list still has to carry the columns, which Table cannot infer."""
    names = ["main_id", "ra", "dec", "V", "otype"]
    dtype = [str, float, float, float, str]
    if not rows:
        return Table(names=names, dtype=dtype)
    return Table(rows=rows, names=names, dtype=dtype)


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

CLUSTER_ROWS = [
    ("M  13", 250.42, 36.46, 5.8, "GlC"),
    ("NGC 5139", 201.70, -47.48, 3.9, "GlC"),
]


def seam_raises(monkeypatch):
    def boom(*a, **kw):
        raise catalog.CatalogUnavailable("The SIMBAD catalog could not be queried (ConnectionError)")
    monkeypatch.setattr(catalog, "_simbad_query_objects", boom)
    monkeypatch.setattr(catalog, "_simbad_query_tap", boom)
    monkeypatch.setattr(catalog, "_simbad_query_otypedef", boom)


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
    assert asked == [[simbad_id for _, simbad_id in lists.MESSIER]]
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


def test_resolve_caldwell_by_ngc_id(client, monkeypatch):
    """SIMBAD has no Caldwell numbering: the entries are asked for by
    their NGC/IC ids and the candidates named by their Caldwell ones."""
    asked = []

    def fake(names):
        asked.append(list(names))
        return objects_table([
            ("NGC 869", "NGC   869", 34.74, 57.13, 3.7, "OpC"),
            ("NGC 7000", "NGC  7000", 314.70, 44.33, None, "Cl*"),
        ])
    monkeypatch.setattr(catalog, "_simbad_query_objects", fake)

    r = resolve(client, {"kind": "caldwell"})
    assert r.status_code == 200
    assert asked == [[simbad_id for _, simbad_id in lists.CALDWELL]]
    assert "NGC 869" in asked[0] and "NGC 7000" in asked[0]
    assert "Mel 25" in asked[0]          # C 41, the Hyades
    assert r.json["count"] == 2
    c14, c20 = r.json["candidates"]
    assert c14["name"] == "C 14"
    assert c14["ra"] == pytest.approx(34.74)
    assert c14["dec"] == pytest.approx(57.13)
    assert c14["magnitude"] == pytest.approx(3.7)
    assert c14["object_type"] == "Open cluster"
    assert c20["name"] == "C 20"
    assert c20["magnitude"] is None


def test_resolve_list_skips_entries_simbad_does_not_know(client, monkeypatch):
    """A missing row and a row without coordinates both drop out; the
    rest keep the list's order."""
    monkeypatch.setattr(catalog, "_simbad_query_objects",
                        lambda names: objects_table([
                            ("NGC 7789", "NGC  7789", 359.33, 56.73, 6.7, "OpC"),
                            ("NGC 104", "NGC   104", 6.02, -72.08, 4.0, "GlC"),
                            ("NGC 188", None, None, None, None, None),
                        ]))
    r = resolve(client, {"kind": "melotte"})
    assert r.status_code == 200
    assert [c["name"] for c in r.json["candidates"]] == ["Mel 1", "Mel 245"]


def test_resolve_collinder_asks_by_alias_when_no_ngc_id(client, monkeypatch):
    asked = []

    def fake(names):
        asked.append(list(names))
        return objects_table([
            ("Collinder 399", "Cl Collinder  399", 291.35, 20.18, 3.6, "Cl*"),
            ("Trumpler 1", "Cl Trumpler    1", 23.93, 61.28, 8.1, "OpC"),
            ("NGC 2818", "NGC  2818", 139.04, -36.63, 8.2, "OpC"),
        ])
    monkeypatch.setattr(catalog, "_simbad_query_objects", fake)

    r = resolve(client, {"kind": "collinder"})
    assert r.status_code == 200
    assert "Collinder 399" in asked[0] and "Trumpler 1" in asked[0]
    assert "Cr 399" not in asked[0]
    # Asked once per distinct id even where two numbers share an object.
    assert len(asked[0]) == len(set(asked[0])) < len(lists.COLLINDER)
    assert [c["name"] for c in r.json["candidates"]] == [
        "Cr 15", "Cr 206", "Cr 399"]
    assert r.json["candidates"][2]["object_type"] == "Star cluster"


def test_lists_are_well_formed():
    assert {k: len(v) for k, v in lists.LISTS.items()} == {
        "messier": 110, "caldwell": 109, "herschel400": 400,
        "melotte": 245, "collinder": 471}
    for kind, entries in lists.LISTS.items():
        names = [name for name, _ in entries]
        assert len(set(names)) == len(names), kind
        for name, simbad_id in entries:
            assert name == name.strip() and simbad_id == simbad_id.strip()
            assert name and simbad_id
    assert [n for n, _ in lists.CALDWELL] == [f"C {i}" for i in range(1, 110)]
    assert [n for n, _ in lists.MELOTTE] == [f"Mel {i}" for i in range(1, 246)]
    assert [n for n, _ in lists.COLLINDER] == [f"Cr {i}" for i in range(1, 472)]
    assert all(n == i for n, i in lists.HERSCHEL_400)


def test_resolve_category_double_stars(client, monkeypatch):
    queries = []

    def fake(adql):
        queries.append(adql)
        return tap_table(DOUBLE_ROWS)
    monkeypatch.setattr(catalog, "_simbad_query_tap", fake)

    r = resolve(client, {"kind": "category", "otype": "**",
                         "max_magnitude": 2.5})
    assert r.status_code == 200
    assert len(queries) == 1
    adql = queries[0]
    # Any attached type in the requested subtree - SIMBAD's otypes
    # comparison is an exact match, so the subtree is spelled out...
    assert ("otypes.otype IN ('**', '**?', 'EB*', 'LXB', 'SB*', 'SB?', "
            "'Sy*', 'Sy?', 'XB*')") in adql
    # ...and the object's own type in the same top-level branch, which
    # keeps a star that lights a nebula out of a nebula search but
    # leaves a double star filed under its spectral type in.
    assert "basic.otype IN ('*', '**', '**?', " in adql
    assert "'s*b'" in adql.split("basic.otype IN")[1]
    assert "'GlC'" not in adql.split("basic.otype IN")[1]
    assert "allfluxes.V <= 2.5" in adql
    assert f"SELECT DISTINCT TOP {catalog.CANDIDATE_CAP + 1}" in adql
    names = [c["name"] for c in r.json["candidates"]]
    assert names == ["alf Vir", "alf Boo", "zet UMa"]
    assert r.json["candidates"][2]["magnitude"] == pytest.approx(2.23)
    # Each candidate is typed by its own otype - a subtype of the
    # requested '**' - not by the category that was asked for.
    assert [c["object_type"] for c in r.json["candidates"]] == [
        "Beta Cephei variable", "Red giant", "Spectroscopic binary"]
    for c in r.json["candidates"]:
        assert not c["ss_obj"]


def test_resolve_category_other_than_double_stars(client, monkeypatch):
    queries = []

    def fake(adql):
        queries.append(adql)
        return tap_table(CLUSTER_ROWS)
    monkeypatch.setattr(catalog, "_simbad_query_tap", fake)

    r = resolve(client, {"kind": "category", "otype": "GlC",
                         "max_magnitude": 9})
    assert r.status_code == 200
    assert "otypes.otype IN ('Gl?', 'GlC')" in queries[0]
    assert "basic.otype IN ('Cl*', 'Gl?', 'GlC', 'OpC')" in queries[0]
    assert [c["name"] for c in r.json["candidates"]] == ["M 13", "NGC 5139"]
    for c in r.json["candidates"]:
        assert c["object_type"] == "Globular cluster"
        assert c["ra"] is not None and c["dec"] is not None
        assert c["magnitude"] is not None


def test_resolve_category_is_cached_per_otype(client, monkeypatch):
    calls = []
    monkeypatch.setattr(catalog, "_simbad_query_tap",
                        lambda adql: calls.append(adql) or tap_table([]))
    resolve(client, {"kind": "category", "otype": "GlC", "max_magnitude": 9})
    resolve(client, {"kind": "category", "otype": "GlC", "max_magnitude": 9})
    assert len(calls) == 1
    resolve(client, {"kind": "category", "otype": "OpC", "max_magnitude": 9})
    assert len(calls) == 2


def test_resolve_category_needs_magnitude(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "category", "otype": "**"})
    assert r.status_code == 400
    assert "magnitude" in r.json["message"]


def test_resolve_category_needs_otype(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "category", "max_magnitude": 5})
    assert r.status_code == 400
    assert "object type" in r.json["message"]


@pytest.mark.parametrize("otype", ["*' OR '1'='1", "Gl C", "(GlC)",
                                   "GlC;DROP", "TOOLONGCODE", ""])
def test_resolve_category_malformed_otype(client, monkeypatch, otype):
    # The schema rejects the shape before catalog.py is reached, so the
    # raising seam proves no query was attempted.
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "category", "otype": otype,
                         "max_magnitude": 5})
    assert r.status_code == 400


def test_resolve_category_guards_adql_itself(monkeypatch):
    # catalog.py re-checks the shape, so it is safe independently of
    # whoever called it.
    seam_raises(monkeypatch)
    with pytest.raises(ValueError):
        catalog.resolve_set("category", 5, (), "*' OR '1'='1")


def test_resolve_category_unknown_otype_is_empty(client, monkeypatch):
    # Well-formed but not a type SIMBAD defines: a successful empty
    # result without a query, since SIMBAD would reject the code.
    def boom(adql):
        raise AssertionError("no query expected")
    monkeypatch.setattr(catalog, "_simbad_query_tap", boom)
    r = resolve(client, {"kind": "category", "otype": "ZZ9",
                         "max_magnitude": 5})
    assert r.status_code == 200
    assert r.json["candidates"] == []
    assert r.json["count"] == 0


def test_resolve_category_retired_code_resolves_as_its_successor(client, monkeypatch):
    # A search saved with a code SIMBAD has since retired ('Neb' for
    # nebulae) still resolves, under the code that replaced it.
    queries = []

    def fake(adql):
        queries.append(adql)
        return tap_table([("NGC 1976", 83.82, -5.39, 4.0, "HII")])
    monkeypatch.setattr(catalog, "_simbad_query_tap", fake)
    r = resolve(client, {"kind": "category", "otype": "Neb",
                         "max_magnitude": 5})
    assert r.status_code == 200
    assert "otypes.otype IN ('Cld', 'GNe', 'HII', 'ISM', 'RNe', 'SNR', 'SR?')" in queries[0]
    assert r.json["candidates"][0]["object_type"] == "HII region"


def test_resolve_category_hierarchy_is_fetched_once(client, monkeypatch):
    fetches = []

    def fake_otypedef():
        fetches.append(1)
        return otypedef_table()
    monkeypatch.setattr(catalog, "_simbad_query_otypedef", fake_otypedef)
    monkeypatch.setattr(catalog, "_simbad_query_tap",
                        lambda adql: tap_table([]))
    resolve(client, {"kind": "category", "otype": "GlC", "max_magnitude": 9})
    resolve(client, {"kind": "category", "otype": "OpC", "max_magnitude": 9})
    resolve(client, {"kind": "category", "otype": "G", "max_magnitude": 12})
    assert len(fetches) == 1


def test_resolve_category_hierarchy_unavailable(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "category", "otype": "GlC",
                         "max_magnitude": 9})
    assert r.status_code == 502
    assert r.json["error"] == "catalog"


def test_resolve_category_candidate_types_are_labelled(client, monkeypatch):
    # SIMBAD's candidate codes are mostly truncations ('Gl?', 'SB?'),
    # which only the hierarchy can map back to a type.
    monkeypatch.setattr(catalog, "_simbad_query_tap", lambda adql: tap_table(
        [("NGC 1", 1.0, 1.0, 8.0, "Gl?"), ("NGC 2", 2.0, 2.0, 8.5, "GlC")]))
    r = resolve(client, {"kind": "category", "otype": "GlC",
                         "max_magnitude": 9})
    assert [c["object_type"] for c in r.json["candidates"]] == [
        "Globular cluster (candidate)", "Globular cluster"]


def test_resolve_too_many_candidates(client, monkeypatch):
    rows = [(f"NGC {i}", float(i % 360), 10.0, 5.0, "GlC")
            for i in range(catalog.CANDIDATE_CAP + 1)]
    monkeypatch.setattr(catalog, "_simbad_query_tap", lambda adql: tap_table(rows))
    r = resolve(client, {"kind": "category", "otype": "GlC",
                         "max_magnitude": 9})
    assert r.status_code == 400
    assert r.json["error"] == "too_many"
    # The message names the category, so the user knows which knob to turn.
    assert "Globular cluster" in r.json["message"]
    assert "lower the magnitude" in r.json["message"]


def test_resolve_withdrawn_double_stars_kind(client, monkeypatch):
    seam_raises(monkeypatch)
    r = resolve(client, {"kind": "double_stars", "max_magnitude": 5})
    assert r.status_code == 400


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
    # Before the hierarchy has been fetched a truncated candidate code
    # gets the shape-based guess; fetching it is never a label's job.
    assert catalog.otype_label("SB?") == "SB (candidate)"
    catalog._otype_paths()
    assert catalog.otype_label("Gl?") == "Globular cluster (candidate)"
    assert catalog.otype_label("SB?") == "Spectroscopic binary (candidate)"
    assert catalog.otype_label("XYZ*") == "Star"
    assert catalog.otype_label("zzz") == "zzz"
    # Codes the frontend's picker offers whose label the shape-based
    # fallback would get wrong, or not know at all.
    assert catalog.otype_label("QSO") == "Quasar"
    assert catalog.otype_label("rG") == "Radio galaxy"
    assert catalog.otype_label("BLL") == "BL Lac object"
    assert catalog.otype_label("Psr") == "Pulsar"
    assert catalog.otype_label("BH") == "Black hole"
    assert catalog.otype_label("Y*O") == "Young stellar object"
    assert catalog.otype_label("GlC") == "Globular cluster"
    assert catalog.otype_label("GNe") == "Nebula"
    assert catalog.otype_label("ISM") == "Nebula or interstellar matter"
    # Nothing the picker offers may fall through to the shape-based
    # guess: those two branches would label 'rG' a galaxy by luck and
    # 'QSO' not at all.
    for code in ("*", "MS*", "RG*", "s*b", "s*r", "s*y", "WD*", "BD*",
                 "HS*", "C*", "S*", "Em*", "Be*", "WR*", "HB*", "AB*",
                 "TT*", "Y*O", "PM*", "N*", "Psr", "BH",
                 "**", "EB*", "SB*", "CV*", "No*", "XB*", "Sy*",
                 "V*", "Pu*", "Ce*", "RR*", "Mi*", "LP*", "dS*", "bC*",
                 "RV*", "Ro*", "Er*",
                 "Cl*", "GlC", "OpC", "As*", "MGr",
                 "ISM", "PN", "SNR", "HII", "RNe", "DNe", "MoC", "SFR",
                 "G", "AGN", "QSO", "BLL", "rG", "Sy1", "Sy2", "SBG",
                 "LIN", "EmG", "IG", "PaG", "GrG", "ClG", "LSB"):
        assert code in catalog._OTYPE_LABELS, f"{code} has no label"
        assert catalog.OTYPE_PATTERN.match(code), f"{code} is not code-shaped"
        assert code not in catalog._OTYPE_ALIASES, f"{code} is retired"
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
def test_resolve_lists_live_simbad(client):
    """Every entry of every list resolves in SIMBAD (lists.py was
    written against that; this is the check to rerun if it drifts)."""
    for kind, entries in lists.LISTS.items():
        r = resolve(client, {"kind": kind})
        assert r.status_code == 200, r.json
        found = [c["name"] for c in r.json["candidates"]]
        missing = [name for name, _ in entries if name not in found]
        assert missing == [], f"{kind}: {missing}"


@pytest.mark.network
def test_resolve_double_stars_live_simbad(client):
    r = resolve(client, {"kind": "double_stars", "max_magnitude": 0.0})
    assert r.status_code == 200, r.json
    assert r.json["count"] >= 1
    for c in r.json["candidates"]:
        assert c["object_type"] == "Double star"
        assert c["ra"] is not None and c["dec"] is not None
        assert c["magnitude"] is not None and c["magnitude"] <= 0.0
