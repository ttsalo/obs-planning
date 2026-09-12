"""Resolving a target set to candidate objects.

The only module that talks to SIMBAD. Everything network-related goes
through the ``_simbad_*`` seams at the bottom so tests can replace
them with canned astropy tables; ``astroquery`` is imported lazily inside
them so the gunicorn ``--preload`` cold start and per-worker RSS are
unchanged until the first search.
"""

import logging
import re
from functools import lru_cache

import numpy as np

import lists

log = logging.getLogger(__name__)

# Bodies the astro backend computes itself (see server.OBJ_RADII_KM);
# names in a name list are matched against these first.
SOLAR_SYSTEM = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter",
                "Saturn", "Uranus", "Neptune"]
_SOLAR_SYSTEM_BY_LOWER = {name.lower(): name for name in SOLAR_SYSTEM}

# What the "planets" set stands for, in the order the sky view has
# always listed them.
PLANETS = ["Mercury", "Venus", "Moon", "Mars", "Jupiter", "Saturn",
           "Uranus", "Neptune"]

# The well-known object lists (Messier, Caldwell, ...) are the fixed
# tables in lists.py: looked up by identifier, never searched, since an
# identifier pattern search for "M %" would also match Minkowski's
# "M 1-1" planetary nebulae.
LISTS = lists.LISTS

# Hard limit on candidates per set: this is what the filter endpoint and
# the database are sized for.
CANDIDATE_CAP = 2000

# What an object-type code may be made of. Every SIMBAD otype fits
# ('**', 'V*', 'GlC', 'Sy1', 's*r', 'Cl*', and the '?' candidate
# suffix); quotes, whitespace, parentheses and comment markers do not.
# The code goes into an ADQL string literal, so this pattern - not
# escaping - is what keeps the query safe: astroquery's query_tap takes
# a finished query string and offers no bind parameters.
OTYPE_PATTERN = re.compile(r"^[A-Za-z0-9*?_+-]{1,8}$")

SIMBAD_TIMEOUT = 30  # seconds; inside gunicorn's 60 s request budget


class CatalogUnavailable(Exception):
    """SIMBAD could not be reached or did not answer usefully."""


class TooManyCandidates(Exception):
    """The set would resolve to more than CANDIDATE_CAP objects."""


# SIMBAD object-type codes to readable labels. Anything not listed falls
# back to a star/galaxy guess from the code's shape, then to the code.
# Every code the frontend's category picker offers
# (obs-ui/src/categories.js) MUST be listed here with the same wording,
# so the category a user picked and the type a candidate comes back with
# read the same. A code missing from the picker is fine - a candidate can
# be of a subtype nobody would search for by itself.
_OTYPE_LABELS = {
    # Stars
    "*": "Star", "MS*": "Main sequence star", "RG*": "Red giant",
    "s*b": "Blue supergiant", "s*r": "Red supergiant",
    "s*y": "Yellow supergiant", "WD*": "White dwarf",
    "BD*": "Brown dwarf", "HS*": "Hot subdwarf", "C*": "Carbon star",
    "S*": "S star", "Em*": "Emission-line star", "Be*": "Be star",
    "WR*": "Wolf-Rayet star", "HB*": "Horizontal branch star",
    "AB*": "Asymptotic giant branch star", "TT*": "T Tauri star",
    "Y*O": "Young stellar object",
    "PM*": "High proper-motion star", "N*": "Neutron star",
    "Psr": "Pulsar", "BH": "Black hole",
    # Double and multiple stars
    "**": "Double star", "EB*": "Eclipsing binary",
    "SB*": "Spectroscopic binary", "CV*": "Cataclysmic variable star",
    "No*": "Nova", "XB*": "X-ray binary", "Sy*": "Symbiotic star",
    # Not offered as categories, but objects of these types come back
    # inside broader ones (an X-ray binary search finds them).
    "LXB": "Low-mass X-ray binary", "HXB": "High-mass X-ray binary",
    # Variable stars
    "V*": "Variable star", "Pu*": "Pulsating variable",
    "Ce*": "Cepheid", "RR*": "RR Lyrae variable", "Mi*": "Mira variable",
    "LP*": "Long-period variable", "dS*": "Delta Scuti variable",
    "bC*": "Beta Cephei variable", "RV*": "RV Tauri variable",
    "Ro*": "Rotating variable", "Er*": "Eruptive variable",
    # Clusters
    "Cl*": "Star cluster", "GlC": "Globular cluster",
    "OpC": "Open cluster", "As*": "Asterism", "MGr": "Moving group",
    # Nebulae and interstellar matter. "ISM" is the root of SIMBAD's
    # interstellar branch and the picker's broad nebula entry: the
    # generic "GNe" is a leaf that the bright named nebulae (HII regions
    # like M 42) do not carry.
    "ISM": "Nebula or interstellar matter", "GNe": "Nebula",
    "PN": "Planetary nebula", "SNR": "Supernova remnant", "HII": "HII region",
    "RNe": "Reflection nebula", "DNe": "Dark nebula", "EmO": "Emission object",
    "MoC": "Molecular cloud", "SFR": "Star-forming region", "reg": "Region",
    # Galaxies and beyond
    "G": "Galaxy", "AGN": "Active galaxy", "QSO": "Quasar",
    "BLL": "BL Lac object", "rG": "Radio galaxy",
    "Sy1": "Seyfert 1 galaxy",
    "Sy2": "Seyfert 2 galaxy", "SyG": "Seyfert galaxy", "SBG": "Starburst galaxy",
    "LIN": "LINER galaxy", "EmG": "Emission-line galaxy", "IG": "Interacting galaxies",
    "GiP": "Galaxy in pair", "GiG": "Galaxy in group", "GiC": "Galaxy in cluster",
    "PaG": "Pair of galaxies", "GrG": "Group of galaxies", "ClG": "Cluster of galaxies",
    "LSB": "Low surface brightness galaxy", "H2G": "HII galaxy",
    "BiC": "Brightest cluster galaxy",
}

# Codes SIMBAD has retired since the picker first offered them, mapped to
# what it offers now, so a search saved with one still resolves. SIMBAD
# itself rejects some of these ("Unknown object type") and silently
# rewrites others ('Neb' to 'ISM', 'YSO' to 'Y*O'); the map keeps the
# outcome explicit. The frontend carries the same map (categories.js).
_OTYPE_ALIASES = {"Neb": "ISM", "YSO": "Y*O", "pr*": "Y*O", "SyS": "Sy*",
                  "Fl*": "Er*"}


def otype_label(code):
    """Readable label for a SIMBAD object-type code. A candidate code
    ('Gl?', 's?b', 'Sy1?') is labelled as the type it is a candidate of
    when the hierarchy says which one that is; it is consulted only once
    fetched, so a label never starts a catalog request."""
    if code is None:
        return ""
    code = str(code).strip()
    candidate = "?" in code
    base = code.rstrip("?")
    if candidate:
        steps = _known_otype_paths().get(code)
        if steps and len(steps) > 1:
            base = steps[-2]
    if base in _OTYPE_LABELS:
        label = _OTYPE_LABELS[base]
    elif base.endswith("*"):
        label = "Star"
    elif base.startswith("G") or base.endswith("G"):
        label = "Galaxy"
    else:
        label = base
    return label + (" (candidate)" if candidate else "")


def display_name(main_id):
    """SIMBAD main identifiers carry a leading '* ' for stars and 'NAME '
    for proper names; neither belongs on the sky view."""
    name = str(main_id).strip()
    name = re.sub(r"^(\*\s+|NAME\s+)", "", name)
    return re.sub(r"\s+", " ", name)


def _cell(row, column):
    """A table cell as a plain Python value, None when masked. Column
    names are matched case-insensitively: SIMBAD's TAP service lowercases
    aliases (the V magnitude comes back as 'v')."""
    if column not in row.colnames:
        matches = [c for c in row.colnames if c.lower() == column.lower()]
        if not matches:
            return None
        column = matches[0]
    value = row[column]
    if value is np.ma.masked or value is None:
        return None
    if isinstance(value, (bytes, np.bytes_)):
        value = value.decode()
    if isinstance(value, (np.floating, float)):
        value = float(value)
        return None if np.isnan(value) else value
    if isinstance(value, np.generic):
        return value.item()
    return value


def _fixed_candidate(name, row, object_type=None):
    return {"name": name, "ss_obj": False,
            "ra": _cell(row, "ra"), "dec": _cell(row, "dec"),
            "magnitude": _cell(row, "V"),
            "object_type": object_type if object_type is not None
            else otype_label(_cell(row, "otype"))}


def _solar_system_candidate(name):
    return {"name": name, "ss_obj": True, "ra": None, "dec": None,
            "magnitude": None, "object_type": ""}


def _within_magnitude(candidate, max_magnitude):
    """With a limit, objects without a catalogued magnitude are dropped:
    the user asked for 'at or brighter than' and we can't tell."""
    if max_magnitude is None:
        return True
    return candidate["magnitude"] is not None and \
        candidate["magnitude"] <= max_magnitude


def _resolve_planets():
    return [_solar_system_candidate(p) for p in PLANETS], []


@lru_cache(maxsize=32)
def _resolve_list(kind, max_magnitude):
    """One well-known list: every entry SIMBAD resolves, named by the
    list's own designation rather than SIMBAD's main identifier."""
    entries = LISTS[kind]
    # A list can name the same object under two numbers; ask once.
    ids = tuple(dict.fromkeys(simbad_id for _, simbad_id in entries))
    table = _simbad_query_objects(ids)
    by_requested = {}
    for row in table:
        requested = _cell(row, "user_specified_id")
        if requested is not None:
            by_requested[str(requested).strip()] = row
    candidates = []
    for name, simbad_id in entries:
        row = by_requested.get(simbad_id)
        if row is None or _cell(row, "ra") is None:
            log.warning("simbad-unresolved list=%s name=%s id=%s",
                        kind, name, simbad_id)
            continue
        candidate = _fixed_candidate(name, row)
        if _within_magnitude(candidate, max_magnitude):
            candidates.append(candidate)
    return candidates, []


@lru_cache(maxsize=1)
def _otype_paths():
    """SIMBAD's object-type hierarchy: {code: [root, ..., code]} for
    every type it defines, from the ``otypedef`` table (a few hundred
    rows, fetched once per process). A candidate type's path names the
    type it is a candidate of ('SR?' has 'ISM > SNR'), so the code
    itself is appended when it is not already the last element."""
    table = _simbad_query_otypedef()
    paths = {}
    for row in table:
        code = _cell(row, "otype")
        path = _cell(row, "path")
        if code is None or path is None:
            continue
        code = str(code).strip()
        steps = [step.strip() for step in str(path).split(">")]
        if steps[-1] != code:
            steps.append(code)
        paths[code] = steps
    return paths


def _known_otype_paths():
    """The hierarchy if some earlier call has fetched it, else empty."""
    return _otype_paths() if _otype_paths.cache_info().currsize else {}


def _adql_list(codes):
    """An ADQL IN-list of object-type codes. The codes come from SIMBAD's
    own table, but they are interpolated into the query, so each is held
    to the same shape as a user-supplied one."""
    for code in codes:
        if not OTYPE_PATTERN.match(code):
            raise CatalogUnavailable(
                f"The SIMBAD catalog defines a malformed object type {code!r}")
    return "(" + ", ".join(f"'{code}'" for code in codes) + ")"


@lru_cache(maxsize=16)
def _resolve_category(otype, max_magnitude):
    # The code is interpolated into the query, so re-check its shape
    # here: the module stays safe whatever its caller did.
    if not OTYPE_PATTERN.match(otype or ""):
        raise ValueError(f"malformed object type {otype!r}")
    otype = _OTYPE_ALIASES.get(otype, otype)
    # SIMBAD's `otypes` table is a flat list of every type ever attached
    # to an object (from its identifiers and from papers), and comparing
    # its otype column is an exact match, NOT a walk of the hierarchy: a
    # subtype search has to name every code in the subtree itself. Nor
    # does an attached type make an object one: a star that lights a
    # nebula carries 'RNe', and a globular cluster's X-ray binary 'GlC'.
    # So a candidate's own type must also fall in the requested type's
    # top-level branch (star, cluster, interstellar, galaxy, ...) - the
    # branch rather than the subtree, because for stars a secondary type
    # is legitimate (Rigel is a double star under 's*b'). Both lists are
    # expanded here from the cached hierarchy: joining `otypedef` in the
    # query with LIKE on its path made SIMBAD scan the whole `otypes`
    # table, some 40 s per query whatever the result size.
    # DISTINCT because several attached types can match one object;
    # TOP cap+1 lets the cap be detected without paging; the magnitude
    # column is aliased because SIMBAD's ADQL parser rejects a qualified
    # name in ORDER BY.
    paths = _otype_paths()
    if otype not in paths:
        log.warning("simbad-unknown-otype otype=%s", otype)
        return [], []
    root = paths[otype][0]
    subtree = sorted(c for c, p in paths.items() if otype in p)
    branch = sorted(c for c, p in paths.items() if p[0] == root)
    adql = (
        f"SELECT DISTINCT TOP {CANDIDATE_CAP + 1} basic.main_id, basic.ra, "
        "basic.dec, allfluxes.V AS V, basic.otype "
        "FROM basic JOIN otypes ON otypes.oidref = basic.oid "
        "JOIN allfluxes ON allfluxes.oidref = basic.oid "
        f"WHERE otypes.otype IN {_adql_list(subtree)} "
        f"AND basic.otype IN {_adql_list(branch)} "
        f"AND allfluxes.V <= {float(max_magnitude)} "
        "ORDER BY V"
    )
    table = _simbad_query_tap(adql)
    if len(table) > CANDIDATE_CAP:
        raise TooManyCandidates(
            f"More than {CANDIDATE_CAP} objects of type "
            f"\"{otype_label(otype)}\" are at or brighter than magnitude "
            f"{max_magnitude}; lower the magnitude limit")
    # No object_type override: each candidate is typed by its own
    # catalogued otype, which is often a subtype of the requested one.
    candidates = [_fixed_candidate(display_name(_cell(row, "main_id")), row)
                  for row in table if _cell(row, "ra") is not None]
    return candidates, []


@lru_cache(maxsize=64)
def _resolve_names(names):
    candidates = []
    lookup = []
    for name in names:
        body = _SOLAR_SYSTEM_BY_LOWER.get(name.lower())
        if body is not None:
            candidates.append(_solar_system_candidate(body))
        else:
            lookup.append(name)
    unresolved = []
    if lookup:
        table = _simbad_query_objects(tuple(lookup))
        by_requested = {}
        for row in table:
            requested = _cell(row, "user_specified_id")
            if requested is not None:
                by_requested[str(requested).strip()] = row
        for name in lookup:
            row = by_requested.get(name)
            if row is None or _cell(row, "ra") is None:
                unresolved.append(name)
            else:
                candidates.append(_fixed_candidate(name, row))
    return candidates, unresolved


def resolve_set(kind, max_magnitude=None, names=(), otype=None):
    """Candidates for a target set: (list of candidate dicts, unresolved
    names). Raises TooManyCandidates or CatalogUnavailable."""
    if kind == "planets":
        candidates, unresolved = _resolve_planets()
    elif kind in LISTS:
        candidates, unresolved = _resolve_list(kind, max_magnitude)
    elif kind == "category":
        candidates, unresolved = _resolve_category(otype, float(max_magnitude))
    elif kind == "names":
        cleaned = tuple(dict.fromkeys(n.strip() for n in names if n.strip()))
        candidates, unresolved = _resolve_names(cleaned)
    else:
        raise ValueError(f"unknown set kind {kind!r}")
    if len(candidates) > CANDIDATE_CAP:
        raise TooManyCandidates(
            f"The set resolves to more than {CANDIDATE_CAP} objects; "
            "tighten the criteria")
    # Copies, so callers can't mutate the cached lists.
    return [dict(c) for c in candidates], list(unresolved)


def clear_cache():
    _otype_paths.cache_clear()
    _resolve_list.cache_clear()
    _resolve_category.cache_clear()
    _resolve_names.cache_clear()


# --- SIMBAD seam ----------------------------------------------------------

def _simbad():
    from astroquery.simbad import Simbad
    simbad = Simbad()
    simbad.TIMEOUT = SIMBAD_TIMEOUT
    simbad.ROW_LIMIT = CANDIDATE_CAP + 1
    simbad.add_votable_fields("V", "otype")
    return simbad


def _guard(call, what):
    """Run one SIMBAD call, turning any failure (connection, timeout,
    HTTP error, unparsable reply) into CatalogUnavailable."""
    try:
        table = call()
    except Exception as err:  # noqa: BLE001 - astroquery raises many kinds
        log.error("simbad-unavailable what=%s error=%r", what, err)
        raise CatalogUnavailable(
            f"The SIMBAD catalog could not be queried ({err.__class__.__name__})"
        ) from err
    if table is None:
        raise CatalogUnavailable("The SIMBAD catalog returned no answer")
    return table


def _simbad_query_objects(names):
    """Rows for each requested identifier, in request order, with
    user_specified_id naming the request and masked coordinates for
    identifiers SIMBAD does not know."""
    return _guard(lambda: _simbad().query_objects(list(names)),
                  f"query_objects n={len(names)}")


def _simbad_query_tap(adql):
    return _guard(lambda: _simbad().query_tap(adql), "query_tap")


def _simbad_query_otypedef():
    """Every object type SIMBAD defines with its place in the hierarchy:
    rows of (otype, path), the path being ' > '-separated codes from the
    root down."""
    return _guard(lambda: _simbad().query_tap(
        "SELECT otype, path FROM otypedef"), "query_tap otypedef")
