"""Resolving a target set to candidate objects.

The only module that talks to SIMBAD. Everything network-related goes
through the two ``_simbad_*`` seams at the bottom so tests can replace
them with canned astropy tables; ``astroquery`` is imported lazily inside
them so the gunicorn ``--preload`` cold start and per-worker RSS are
unchanged until the first search.
"""

import logging
import re
from functools import lru_cache

import numpy as np

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

# The Messier catalogue is a fixed list of identifiers, so it is looked
# up by name rather than searched: an identifier pattern search would
# also match Minkowski's "M 1-1" planetary nebulae.
MESSIER_IDS = [f"M {n}" for n in range(1, 111)]

# Hard limit on candidates per set: this is what the filter endpoint and
# the database are sized for.
CANDIDATE_CAP = 2000

SIMBAD_TIMEOUT = 30  # seconds; inside gunicorn's 60 s request budget


class CatalogUnavailable(Exception):
    """SIMBAD could not be reached or did not answer usefully."""


class TooManyCandidates(Exception):
    """The set would resolve to more than CANDIDATE_CAP objects."""


# SIMBAD object-type codes to readable labels. Anything not listed falls
# back to a star/galaxy guess from the code's shape, then to the code.
_OTYPE_LABELS = {
    "**": "Double star", "*": "Star", "V*": "Variable star",
    "PM*": "High proper-motion star", "RG*": "Red giant",
    "WD*": "White dwarf", "BD*": "Brown dwarf", "Ce*": "Cepheid",
    "Mi*": "Mira variable", "Pu*": "Pulsating variable",
    "Ro*": "Rotating variable", "Er*": "Eruptive variable",
    "EB*": "Eclipsing binary", "SB*": "Spectroscopic binary",
    "bC*": "Beta Cephei variable", "dS*": "Delta Scuti variable",
    "LP*": "Long-period variable", "s*b": "Blue supergiant",
    "s*r": "Red supergiant", "s*y": "Yellow supergiant",
    "G": "Galaxy", "AGN": "Active galaxy", "Sy1": "Seyfert 1 galaxy",
    "Sy2": "Seyfert 2 galaxy", "SyG": "Seyfert galaxy", "SBG": "Starburst galaxy",
    "LIN": "LINER galaxy", "EmG": "Emission-line galaxy", "IG": "Interacting galaxies",
    "GiP": "Galaxy in pair", "GiG": "Galaxy in group", "GiC": "Galaxy in cluster",
    "PaG": "Pair of galaxies", "GrG": "Group of galaxies", "ClG": "Cluster of galaxies",
    "LSB": "Low surface brightness galaxy", "H2G": "HII galaxy",
    "GlC": "Globular cluster", "OpC": "Open cluster", "Cl*": "Star cluster",
    "As*": "Asterism", "MGr": "Moving group",
    "PN": "Planetary nebula", "SNR": "Supernova remnant", "HII": "HII region",
    "RNe": "Reflection nebula", "DNe": "Dark nebula", "EmO": "Emission object",
    "Neb": "Nebula", "ISM": "Interstellar medium", "MoC": "Molecular cloud",
    "SFR": "Star-forming region", "reg": "Region",
}


def otype_label(code):
    """Readable label for a SIMBAD object-type code."""
    if code is None:
        return ""
    code = str(code).strip()
    base = code.rstrip("?")
    if base in _OTYPE_LABELS:
        label = _OTYPE_LABELS[base]
    elif base.endswith("*"):
        label = "Star"
    elif base.startswith("G") or base.endswith("G"):
        label = "Galaxy"
    else:
        label = base
    return label + (" (candidate)" if code.endswith("?") else "")


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


@lru_cache(maxsize=16)
def _resolve_messier(max_magnitude):
    table = _simbad_query_objects(tuple(MESSIER_IDS))
    candidates = []
    for row in table:
        requested = _cell(row, "user_specified_id")
        if _cell(row, "ra") is None:
            log.warning("simbad-unresolved messier id=%s", requested)
            continue
        candidate = _fixed_candidate(str(requested).strip(), row)
        if _within_magnitude(candidate, max_magnitude):
            candidates.append(candidate)
    return candidates, []


@lru_cache(maxsize=16)
def _resolve_double_stars(max_magnitude):
    # The otypes table carries the type hierarchy, so '**' there matches
    # every kind of double or multiple star, not just objects whose main
    # type is the generic '**'. TOP cap+1 lets the cap be detected without
    # paging.
    # SIMBAD's ADQL parser rejects a qualified name in ORDER BY, so the
    # magnitude column is aliased and ordered by its alias.
    adql = (
        f"SELECT TOP {CANDIDATE_CAP + 1} basic.main_id, basic.ra, basic.dec, "
        "allfluxes.V AS V, basic.otype "
        "FROM basic JOIN allfluxes ON basic.oid = allfluxes.oidref "
        "JOIN otypes ON basic.oid = otypes.oidref "
        f"WHERE otypes.otype = '**' AND allfluxes.V <= {float(max_magnitude)} "
        "ORDER BY V"
    )
    table = _simbad_query_tap(adql)
    if len(table) > CANDIDATE_CAP:
        raise TooManyCandidates(
            f"More than {CANDIDATE_CAP} double stars are at or brighter than "
            f"magnitude {max_magnitude}; lower the magnitude limit")
    candidates = [_fixed_candidate(display_name(_cell(row, "main_id")), row,
                                   object_type="Double star")
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


def resolve_set(kind, max_magnitude=None, names=()):
    """Candidates for a target set: (list of candidate dicts, unresolved
    names). Raises TooManyCandidates or CatalogUnavailable."""
    if kind == "planets":
        candidates, unresolved = _resolve_planets()
    elif kind == "messier":
        candidates, unresolved = _resolve_messier(max_magnitude)
    elif kind == "double_stars":
        candidates, unresolved = _resolve_double_stars(float(max_magnitude))
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
    _resolve_messier.cache_clear()
    _resolve_double_stars.cache_clear()
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
