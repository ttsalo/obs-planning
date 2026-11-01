import logging
import math
import traceback
import uuid
from datetime import timedelta
from functools import lru_cache

import numpy as np
from apispec.ext.marshmallow import MarshmallowPlugin
from apispec_webframeworks.flask import FlaskPlugin
from flask import Flask, request, make_response, jsonify
from flasgger import APISpec, Swagger, Schema, fields, validate, swag_from
from http import HTTPStatus
from werkzeug.exceptions import HTTPException

from astropy import units as u
from astropy.time import Time
from astropy.coordinates import solar_system_ephemeris, EarthLocation, AltAz
from astropy.coordinates import get_body, GeocentricMeanEcliptic, SkyCoord
from astropy.coordinates import GCRS, CartesianRepresentation
from astropy.utils import iers

# Prevent astropy from downloading + CDS-parsing IERS_A on the WSGI
# request path — that download used to block all four gunicorn workers
# past the 30 s timeout for any "today" request (OBS-6). Astropy falls
# back to the bundled long-term IERS_B table; the resulting polar-motion
# error is well below one arcsecond and invisible in the sky renderer.
iers.conf.auto_download = False
iers.conf.iers_degraded_accuracy = "ignore"

import catalog
import schemas
from schemas import as_utc

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

app = Flask(__name__)


@app.errorhandler(Exception)
def handle_uncaught_exception(err):
    # Let Flask/Werkzeug HTTP errors (400s from schema validation,
    # 404s, etc.) flow through untouched.
    if isinstance(err, HTTPException):
        return err
    error_id = uuid.uuid4().hex[:8]
    app.logger.error(
        "unhandled-exception id=%s path=%s json=%s traceback=%s",
        error_id, request.path, request.get_json(silent=True),
        traceback.format_exc(),
    )
    return jsonify({"error": "internal", "error_id": error_id}), 500

    
spec = APISpec(
    title='Observations Planner Astro API',
    version='1.0.0',
    openapi_version='2.0',
    plugins=[
        FlaskPlugin(),
        MarshmallowPlugin(),
    ],
)

swag = Swagger(app, template=spec.to_flasgger(
        app,
        definitions=[schemas.GetObjResultSchema,
                     schemas.GetObjPostSchema,
                     schemas.GetObjTSPostSchema,
                     schemas.GetObjTSResultSchema,
                     schemas.ResolveTargetsPostSchema,
                     schemas.ResolveTargetsResultSchema,
                     schemas.FilterTargetsPostSchema,
                     schemas.FilterTargetsResultSchema,
                     schemas.GetObjsPostSchema,
                     schemas.GetObjsResultSchema]))


@app.route("/")
def index():
    return "<p>Use the API</p>"


@app.route("/health")
def health_check():
    return {"status": "pass"}, 200


# Return just a empty response, the access control headers will get
# added in the after_request handler
@app.before_request
def get_options():
    if request.method != 'OPTIONS':
        return
    resp = make_response()
    return resp


# Since this is a secondary server, we'll need to add certain access
# control headers to every request or the browser will block access
@app.after_request
def add_access_control_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin")
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return resp


get_obj_post_schema = schemas.GetObjPostSchema()
get_obj_result_schema = schemas.GetObjResultSchema()
get_obj_ts_post_schema = schemas.GetObjTSPostSchema()
get_obj_ts_result_schema = schemas.GetObjTSResultSchema()
resolve_targets_post_schema = schemas.ResolveTargetsPostSchema()
resolve_targets_result_schema = schemas.ResolveTargetsResultSchema()
filter_targets_post_schema = schemas.FilterTargetsPostSchema()
filter_targets_result_schema = schemas.FilterTargetsResultSchema()
get_objs_post_schema = schemas.GetObjsPostSchema()
get_objs_result_schema = schemas.GetObjsResultSchema()


# Physical radii of the solar-system objects we serve, in km.
OBJ_RADII_KM = {
    "mercury": 2439.7, "venus": 6051.8, "moon": 1737.4, "mars": 3389.5,
    "jupiter": 69911.0, "saturn": 58232.0, "uranus": 25362.0,
    "neptune": 24622.0, "sun": 696340.0,
}

# Fixed timeseries shape — must match the frontend's day view (48 samples
# at 30-minute intervals).
TS_N_SAMPLES = 48
TS_STEP_SECONDS = 1800


def _apparent_radius_deg(target, distance_km):
    return math.atan(OBJ_RADII_KM[target.lower()] / float(distance_km)) * 180 / math.pi


def _compute_body(target, times, loc):
    """Single vectorized astropy call: returns (obj, altaz, distance_km).

    `times` can be scalar or array-valued Time; the returned altaz mirrors
    the input shape. `obj` is the body's GCRS SkyCoord (needed for phase
    geometry). `distance_km` is a plain float pulled from the first
    sample — the sun's radius changes ≤ 0.1 % across a day, well below the
    sky renderer's resolution.
    """
    with solar_system_ephemeris.set("de432s"):
        obj = get_body(target, times, loc)
        altaz = obj.transform_to(AltAz(obstime=times, location=loc))
    dist_km = float(np.atleast_1d(obj.distance.km)[0])
    return obj, altaz, dist_km


def _compute_altaz(target, times, loc):
    """Like _compute_body but without the SkyCoord, for callers that only
    need the horizontal coordinates."""
    _, altaz, dist_km = _compute_body(target, times, loc)
    return altaz, dist_km


def _moon_phase(t, loc, moon, moon_aa):
    """Moon-only extras for /api/get-obj: illuminated fraction, waxing flag,
    and the bright-limb bearing in the observer's alt/az frame (degrees
    clockwise from 'up' toward the zenith, toward increasing azimuth)."""
    with solar_system_ephemeris.set("de432s"):
        sun = get_body("sun", t, loc)
    sun_aa = sun.transform_to(AltAz(obstime=t, location=loc))

    # Illuminated fraction via the phase angle (astroplan's formula).
    elong = sun.separation(moon)
    i = np.arctan2(sun.distance * np.sin(elong),
                   moon.distance - sun.distance * np.cos(elong))
    k = float((1 + np.cos(i)) / 2)

    # Waxing iff the moon is east of the sun in ecliptic longitude.
    ecl = GeocentricMeanEcliptic(obstime=t)
    dlon = (moon.transform_to(ecl).lon.deg - sun.transform_to(ecl).lon.deg) % 360
    waxing = bool(dlon < 180)

    # Great-circle initial bearing moon->sun in the alt/az frame. The
    # azimuth difference only enters via sin/cos, so no wrap handling is
    # needed; the formula is defined everywhere except exactly at the
    # zenith, where azimuth itself is undefined.
    a_m, a_s = float(moon_aa.alt.rad), float(sun_aa.alt.rad)
    daz = float(sun_aa.az.rad - moon_aa.az.rad)
    chi = math.degrees(math.atan2(
        math.cos(a_s) * math.sin(daz),
        math.cos(a_m) * math.sin(a_s)
        - math.sin(a_m) * math.cos(a_s) * math.cos(daz))) % 360
    return {"illumination": k, "waxing": waxing, "bright_limb_angle": chi}


def _fixed_altaz(ras, decs, times, loc):
    """Altitude and azimuth (degrees) of fixed ICRS objects.

    One vectorized transform for the whole list: for a scalar `times`
    the arrays are shaped (n_obj,), for an array `times` (n_obj, n_t),
    via astropy's broadcasting of the coordinate and obstime shapes.
    """
    coords = SkyCoord(ra=np.atleast_1d(np.asarray(ras, dtype=float)) * u.deg,
                      dec=np.atleast_1d(np.asarray(decs, dtype=float)) * u.deg,
                      frame="icrs")
    if times.isscalar:
        aa = coords.transform_to(AltAz(obstime=times, location=loc))
    else:
        aa = coords[:, np.newaxis].transform_to(
            AltAz(obstime=times[np.newaxis, :], location=loc))
    return np.asarray(aa.alt.deg), np.asarray(aa.az.deg)


@lru_cache(maxsize=64)
def _sun_alt_series(lat, lon, start_isot, n_samples, step_seconds):
    """Sun upper-limb altitude at each of `n_samples` steps from `start_isot`.

    Cached per (lat, lon, start_isot) so the 8 planet requests in a burst
    share one astropy computation. Keyed by isot to keep the key hashable
    and deterministic. Returned as a plain tuple of Python floats so the
    cache entry cannot leak numpy references.
    """
    loc = EarthLocation.from_geodetic(lat=lat, lon=lon, height=0)
    start = Time(start_isot)
    times = start + np.arange(n_samples) * step_seconds * u.s
    altaz, dist_km = _compute_altaz("sun", times, loc)
    sun_radius_deg = _apparent_radius_deg("sun", dist_km)
    return tuple((altaz.alt.deg + sun_radius_deg).tolist())


@app.route("/api/get-obj", methods=['POST'], swag=True)
def get_obj():
    """
    Return the altitude and azimuth of a given observation target
    ---
    description:
      Return the altitude and azimuth of a given observation target as seen
      from a given location at a specified time.
    parameters:
      - name: body
        in: body
        required: true
        description: Observation place, time and target
        schema:
          $ref: '#/definitions/GetObjPost'
    responses:
      200:
        description: Observation details successfully calculated.
        schema:
          $ref: '#/definitions/GetObjResult'
    """
    try:
        data = get_obj_post_schema.load(request.json)
    except Exception as err:
        return jsonify(err.messages), 400

    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)
    t = Time(data["time"])
    obj, aa, dist_km = _compute_body(data["target"], t, loc)
    radius = _apparent_radius_deg(data["target"], dist_km)
    result = {"alt": float(aa.alt.deg), "az": float(aa.az.deg),
              "radius": radius}
    # Phase fields only for the moon: the extra sun computation must not
    # land on the ~8 planet requests that hit this endpoint every minute.
    if data["target"].lower() == "moon":
        result.update(_moon_phase(t, loc, obj, aa))
    return jsonify(get_obj_result_schema.dump(result)), 200


@app.route("/api/get-obj-timeseries", methods=['POST'], swag=True)
def get_obj_timeseries():
    """
    Return the altitude and azimuth time series of a given observation target
    ---
    description:
      Return the altitude and azimuth of a given observation target as seen
      from a given location at intervals in a given time period.
    parameters:
      - name: body
        in: body
        required: true
        description: Observation place, time, timespan and target
        schema:
          $ref: '#/definitions/GetObjTSPost'
    responses:
      200:
        description: Observation time series successfully calculated.
        schema:
          $ref: '#/definitions/GetObjTSResult'
    """
    try:
        data = get_obj_ts_post_schema.load(request.json)
    except Exception as err:
        return jsonify(err.messages), 400

    try:
        loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)
        start = Time(data["time"])
        times = start + np.arange(TS_N_SAMPLES) * TS_STEP_SECONDS * u.s

        fixed = data.get("ra") is not None and data.get("dec") is not None
        if fixed:
            # A fixed object: the target string is only a label.
            alts, azs = _fixed_altaz([data["ra"]], [data["dec"]], times, loc)
            target_alt, target_az = alts[0], azs[0]
        else:
            target_aa, target_dist_km = _compute_altaz(data["target"], times, loc)
            target_alt = target_aa.alt.deg
            target_az = target_aa.az.deg

        if not fixed and data["target"].lower() == "sun":
            sun_radius_deg = _apparent_radius_deg("sun", target_dist_km)
            sun_alt_series = target_alt + sun_radius_deg
        else:
            sun_alt_series = _sun_alt_series(
                round(float(data["lat"]), 3),
                round(float(data["lon"]), 3),
                start.isot,
                TS_N_SAMPLES,
                TS_STEP_SECONDS,
            )

        ts_isot = times.isot
        series = [
            {"alt": float(target_alt[i]),
             "az": float(target_az[i]),
             "sun_alt": float(sun_alt_series[i]),
             "ts": ts_isot[i] + "Z"}
            for i in range(TS_N_SAMPLES)
        ]
        return jsonify({"series": series}), 200
    except Exception:
        app.logger.exception(
            "astro-timeseries-fail target=%s lat=%s lon=%s time=%s",
            data.get("target"), data.get("lat"), data.get("lon"), data.get("time"),
        )
        raise



# --- Target searches --------------------------------------------------------

# Maximum altitude of the Sun's upper limb for each brightness limit;
# None means no limit. Same thresholds as the frontend's altToBrightness.
BRIGHTNESS_SUN_ALT = {"N": -18.0, "AT": -12.0, "NT": -6.0, "CT": 0.0, "D": None}


def _error(status, code, message):
    return jsonify({"error": code, "message": message}), status


@app.route("/api/resolve-targets", methods=['POST'], swag=True)
def resolve_targets():
    """
    Resolve a target set to candidate objects
    ---
    description:
      Turn a target set (the planets, a well-known object list - Messier,
      Caldwell, Herschel 400, Melotte or Collinder - one object category
      at or brighter than a magnitude, or a list of names) into candidate
      objects with coordinates, magnitude and type. A category
      is a SIMBAD object-type code and matches that type's subtypes too,
      for objects whose own type is in the same top-level branch of the
      hierarchy; each candidate is typed by its own catalogued type. A
      code SIMBAD has retired resolves as its successor. Applies no
      observing criteria; see /api/filter-targets for those. Needs SIMBAD
      for everything but the planets.
    parameters:
      - name: body
        in: body
        required: true
        description: The target set
        schema:
          $ref: '#/definitions/ResolveTargetsPost'
    responses:
      200:
        description: Candidates, their count, and names not found.
        schema:
          $ref: '#/definitions/ResolveTargetsResult'
      400:
        description: Invalid set, or one that matches too many objects.
      502:
        description: SIMBAD could not be reached.
    """
    try:
        data = resolve_targets_post_schema.load(request.json)
    except Exception as err:
        return jsonify(err.messages), 400

    target_set = data["set"]
    kind = target_set["kind"]
    max_magnitude = target_set.get("max_magnitude")
    otype = (target_set.get("otype") or "").strip()
    names = [n for n in target_set.get("names") or [] if n.strip()]
    if kind == "category":
        # Both checks before any catalog call: the schema has already
        # rejected a malformed code, so only an absent one gets here.
        if not otype:
            return _error(400, "invalid", "A category needs an object type")
        if max_magnitude is None:
            return _error(400, "invalid", "A category needs a maximum magnitude")
    if kind == "names" and not names:
        return _error(400, "invalid", "A name list needs at least one name")

    try:
        candidates, unresolved = catalog.resolve_set(kind, max_magnitude, names,
                                                     otype)
    except catalog.TooManyCandidates as err:
        return _error(400, "too_many", str(err))
    except catalog.CatalogUnavailable as err:
        return _error(502, "catalog", str(err))

    return jsonify(resolve_targets_result_schema.dump(
        {"candidates": candidates, "count": len(candidates),
         "unresolved": unresolved})), 200


def _window_samples_one(window):
    """Every 30 minutes from one window's start, the end instant
    included; naive UTC datetimes. The last step may be short, so
    callers must take interval lengths from the samples themselves."""
    start, end = as_utc(window["start"]), as_utc(window["end"])
    steps = int((end - start).total_seconds() // TS_STEP_SECONDS)
    samples = [start + timedelta(seconds=k * TS_STEP_SECONDS)
               for k in range(steps + 1)]
    if samples[-1] != end:
        samples.append(end)
    return samples


def _window_samples(windows):
    """Every window's samples concatenated; naive UTC datetimes."""
    samples = []
    for window in windows:
        samples.extend(_window_samples_one(window))
    return samples


def _az_in_window(az, obs_window):
    """Elementwise: is the azimuth inside the position's azimuth limits?
    Azimuth is circular, so a maximum below the minimum wraps through
    north (125 -> 45 covers south-east round to north-east); equal limits
    match nothing. Same rule as the frontend's azInWindow."""
    lo, hi = obs_window["min_az"], obs_window["max_az"]
    if lo <= hi:
        return (az > lo) & (az < hi)
    return (az > lo) | (az < hi)


def _check_candidates(candidates):
    """The 400 message for a candidate the filter can't compute, or None."""
    for c in candidates:
        if c["ss_obj"]:
            if c["name"].lower() not in OBJ_RADII_KM:
                return f"Unknown solar-system body {c['name']!r}"
        elif c.get("ra") is None or c.get("dec") is None:
            return f"Candidate {c['name']!r} needs ra and dec"
    return None


def _candidates_altaz(candidates, times, loc, ss=None):
    """(n_obj, n_t) altitude and azimuth arrays for a mixed list.

    `ss` optionally supplies already-computed solar-system positions
    for exactly these times, as (alt, az, row-index-by-name) from
    _ss_altaz, so a long evaluation can compute the ephemeris once for
    its whole range instead of once per window.
    """
    n = len(candidates)
    alt = np.empty((n, len(times)))
    az = np.empty((n, len(times)))
    fixed = [i for i, c in enumerate(candidates) if not c["ss_obj"]]
    if fixed:
        alts, azs = _fixed_altaz([candidates[i]["ra"] for i in fixed],
                                 [candidates[i]["dec"] for i in fixed],
                                 times, loc)
        alt[fixed] = alts
        az[fixed] = azs
    for i, c in enumerate(candidates):
        if not c["ss_obj"]:
            continue
        if ss is None:
            aa, _ = _compute_altaz(c["name"].lower(), times, loc)
            alt[i] = aa.alt.deg
            az[i] = aa.az.deg
        else:
            ss_alt, ss_az, row = ss
            k = row[c["name"].lower()]
            alt[i] = ss_alt[k]
            az[i] = ss_az[k]
    return alt, az


def _catmull_rom(nodes, values, targets):
    """Cubic interpolation of `values` sampled at uniform `nodes`,
    evaluated at `targets`.

    `nodes` must be uniformly spaced and ascending; `values` is shaped
    (..., len(nodes)) and interpolated along its last axis. Exact for a
    linear function and third-order accurate for a smooth one, which is
    ample for a body's geocentric position between daily nodes, and it
    needs nothing but numpy — scipy is deliberately not a dependency
    here (see the long-period-search design).

    The two end segments reuse the end node as the missing neighbour,
    so callers wanting full accuracy throughout should pad the node
    grid by one node beyond each end of the targets.
    """
    nodes = np.asarray(nodes, dtype=float)
    values = np.asarray(values, dtype=float)
    n = len(nodes)
    if n < 2:
        raise ValueError("at least two nodes are needed")
    step = (nodes[-1] - nodes[0]) / (n - 1)
    # Fractional node index of each target, clamped into the last
    # segment so a target exactly at the final node still has a
    # segment to sit in.
    pos = np.clip((np.asarray(targets, dtype=float) - nodes[0]) / step,
                  0.0, n - 1 - 1e-12)
    left = np.floor(pos).astype(int)
    frac = pos - left

    def node(offset):
        return values[..., np.clip(left + offset, 0, n - 1)]

    p0, p1, p2, p3 = node(-1), node(0), node(1), node(2)
    f2 = frac * frac
    f3 = f2 * frac
    return 0.5 * (2.0 * p1
                  + (-p0 + p2) * frac
                  + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f2
                  + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * f3)


def _circ_dist(a, b):
    """Smallest absolute angular separation in degrees, 0 to 180."""
    d = np.abs(np.asarray(a, dtype=float) - b) % 360.0
    return np.minimum(d, 360.0 - d)


def _az_margin(az, lo, hi):
    """Signed degrees to the nearer azimuth limit: positive inside the
    window, negative outside. The sign flips exactly where
    _az_in_window does, so interpolating this to zero locates an
    azimuth-limit crossing however the window wraps."""
    inside = _az_in_window(np.asarray(az, dtype=float),
                           {"min_az": lo, "max_az": hi})
    d = np.minimum(_circ_dist(az, lo), _circ_dist(az, hi))
    return np.where(inside, d, -d)


# Stands in for an unbounded margin when a criterion is not applied.
# A finite value keeps the duration arithmetic free of inf and nan.
_WIDE_MARGIN = 1.0e6


def _qualify_margin(alt, az, sun_alt, visibility, obs_window, threshold):
    """Signed margin, strictly positive exactly where a candidate
    qualifies, shaped like `alt`.

    The minimum over the active criteria of each criterion's signed
    distance from its own limit, in degrees. Using the same strict
    comparisons as checkObsWindow in transitions.jsx means `> 0` is the
    same predicate the single-flag filter used; interpolating the
    margin to its zero crossing then locates the instant a candidate
    enters or leaves qualification, whichever criterion crossed.
    """
    terms = []
    if visibility == "window":
        terms.append(alt - obs_window["min_alt"])
        terms.append(obs_window["max_alt"] - alt)
        terms.append(_az_margin(az, obs_window["min_az"],
                                obs_window["max_az"]))
    elif visibility == "horizon":
        terms.append(alt - 0.0)
    if threshold is not None:
        terms.append(np.broadcast_to(threshold - np.asarray(sun_alt),
                                     alt.shape))
    if not terms:
        return np.full(alt.shape, _WIDE_MARGIN)
    out = terms[0]
    for term in terms[1:]:
        out = np.minimum(out, term)
    return out


def _qualifying_hours(margin, secs):
    """Hours each candidate qualifies within one window.

    `margin` is (n_obj, n_t), `secs` the (n_t - 1,) interval lengths.
    Where an interval's endpoints straddle zero the crossing instant is
    interpolated linearly in the margin, so a duration is not quantised
    to the sampling step (OBS-19).
    """
    a, b = margin[:, :-1], margin[:, 1:]
    qa, qb = a > 0, b > 0
    denom = np.abs(a - b)
    with np.errstate(divide="ignore", invalid="ignore"):
        entering = np.where(qb & ~qa, np.abs(b) / denom, 0.0)
        leaving = np.where(qa & ~qb, np.abs(a) / denom, 0.0)
    frac = np.where(qa & qb, 1.0, 0.0) + entering + leaving
    return (frac * secs[np.newaxis, :]).sum(axis=1) / 3600.0


def _window_records(margin, alt, sun_alt, secs, offsets):
    """Per-candidate observability records for one window.

    Yields (candidate index, hours, max altitude, darkest Sun altitude,
    peak offset in minutes) for every candidate qualifying at one or
    more samples. The extremes are taken over the qualifying samples
    only, so the altitude is the highest reached while the sky was dark
    enough rather than an independent maximum.
    """
    qualifying = margin > 0
    hours = _qualifying_hours(margin, secs)
    masked_alt = np.where(qualifying, alt, -np.inf)
    peak = masked_alt.argmax(axis=1)
    rows = np.arange(alt.shape[0])
    max_alt = masked_alt[rows, peak]
    sun_grid = np.broadcast_to(np.asarray(sun_alt), alt.shape)
    darkest = np.where(qualifying, sun_grid, np.inf).min(axis=1)
    for i in np.nonzero(qualifying.any(axis=1))[0]:
        yield (int(i), round(float(hours[i]), 4),
               round(float(max_alt[i]), 4), round(float(darkest[i]), 4),
               round(float(offsets[peak[i]]), 2))


# Ephemeris nodes per day for the filter endpoint's solar-system
# positions. At this spacing the Moon, the fastest-moving body, comes
# out within 0.0002 degrees of a direct per-sample evaluation and the
# planets far closer. Lowering it degrades the Moon first; raising it
# costs ephemeris time for no visible gain.
EPH_NODES_PER_DAY = 4


def _ss_altaz(names, times, loc):
    """Altitude, azimuth and distance of solar-system bodies over a
    sample grid: three (n_body, n_t) arrays, in `names` order.

    `get_body` costs about 0.5 ms per body per sample, which a
    year-long grid turns into over a minute — past the worker timeout.
    So the ephemeris is evaluated on a coarse node grid and each
    body's geocentric position interpolated to the samples, after
    which every body is transformed to the observer's frame in one
    call rather than one call each. Together those take the largest
    permitted evaluation from about 79 seconds to about 15 (see the
    long-period-search design).

    Position is what gets interpolated, never altitude or azimuth:
    those sweep 15 degrees an hour with the Earth's rotation, while a
    body's geocentric position varies smoothly enough for daily nodes.
    Distance is carried through the transform, so the observer's
    parallax — about a degree for the Moon — and a body's apparent
    radius stay exact rather than being approximated.
    """
    jd = np.atleast_1d(times.jd)
    first, last = float(jd.min()), float(jd.max())
    pad = 1.0 / EPH_NODES_PER_DAY
    count = max(int(np.ceil((last - first) * EPH_NODES_PER_DAY)) + 4, 4)
    nodes = Time(np.linspace(first - pad, last + pad, count), format="jd")
    with solar_system_ephemeris.set("de432s"):
        xyz = np.stack([
            _catmull_rom(nodes.jd,
                         get_body(name, nodes).cartesian.xyz.to_value(u.km),
                         jd)
            for name in names])                     # (n_body, 3, n_t)
        rep = CartesianRepresentation(xyz.transpose(1, 0, 2) * u.km)
        obstime = times[np.newaxis, :]
        altaz = GCRS(rep, obstime=obstime).transform_to(
            AltAz(obstime=obstime, location=loc))
    return (np.asarray(altaz.alt.deg), np.asarray(altaz.az.deg),
            np.asarray(altaz.distance.to_value(u.km)))


def _sun_upper_limb(sun_alt_deg, sun_dist_km):
    """Sun upper-limb altitude from its centre altitude and distance.

    Vectorized over the samples, so the limb follows the Sun's own
    distance through the year instead of one sample's value standing
    in for a whole range."""
    radius = np.degrees(np.arctan(
        OBJ_RADII_KM["sun"] / np.asarray(sun_dist_km, dtype=float)))
    return np.asarray(sun_alt_deg) + radius


@app.route("/api/filter-targets", methods=['POST'], swag=True)
def filter_targets():
    """
    Flag which candidates are observable in the given windows
    ---
    description:
      Sample each observing window every 30 minutes (end included) and
      report, for each candidate, whether at any sample it is both
      visible per the visibility criterion and the sky is at most as
      bright as the brightness limit. Alongside each matched flag the
      response carries that candidate's per-window observability
      records, one per window it qualifies in, each giving the window's
      index, how long it qualified, the highest altitude and darkest sky
      it reached while qualifying, and the minutes from the window's
      start to its altitude peak. Durations are interpolated to the
      instant qualification starts and ends, so they are not multiples
      of the sampling step. A window a candidate never qualifies in has
      no record, so a candidate with no records is one that did not
      match. Windows are identified by position and times by offset, so
      no wall-clock date or time zone appears in the response. Never
      consults the catalog.
    parameters:
      - name: body
        in: body
        required: true
        description: Candidates, position, windows and criteria
        schema:
          $ref: '#/definitions/FilterTargetsPost'
    responses:
      200:
        description: A matched flag and per-window records per candidate,
          in request order.
        schema:
          $ref: '#/definitions/FilterTargetsResult'
      400:
        description: Invalid input.
    """
    try:
        data = filter_targets_post_schema.load(request.json)
    except Exception as err:
        return jsonify(err.messages), 400

    candidates = data["candidates"]
    visibility = data["visibility"]
    threshold = BRIGHTNESS_SUN_ALT[data["max_brightness"]]
    obs_window = data.get("obs_window")
    if visibility == "window" and obs_window is None:
        return _error(400, "invalid",
                      "Visibility 'window' needs the position's obs_window")
    problem = _check_candidates(candidates)
    if problem is not None:
        return _error(400, "invalid", problem)
    cells = len(candidates) * len(data["windows"])
    if cells > schemas.MAX_CELLS:
        return _error(400, "too_many",
                      f"{len(candidates)} candidates over "
                      f"{len(data['windows'])} days is {cells} evaluations, "
                      f"more than the {schemas.MAX_CELLS} that can be done "
                      f"at once. Use fewer objects or a shorter range.")

    n = len(candidates)
    if n == 0 or not data["windows"]:
        # Nothing to compute: no candidates, or no window to compute
        # them over. The second case keeps the long-standing rule that
        # a filter with no windows matches everything, and is not
        # reachable from the UI, which always builds at least one.
        return jsonify(filter_targets_result_schema.dump(
            {"matched": [True] * n, "count": n,
             "days": [[] for _ in range(n)]})), 200

    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)

    per_window = [_window_samples_one(w) for w in data["windows"]]
    bounds = np.cumsum([0] + [len(s) for s in per_window])

    # The solar-system bodies are computed once over every window's
    # samples at once, because the ephemeris cost is per body per
    # sample and a coarse node grid spanning the whole range is what
    # makes it affordable. The Sun is always among them: a record
    # carries the darkest sky it saw whether or not the sky gated the
    # match. The arrays are (bodies, samples) with at most nine
    # bodies, so holding the range's worth costs nothing.
    ss_names = ["sun"] + sorted({c["name"].lower() for c in candidates
                                 if c["ss_obj"]} - {"sun"})
    ss_row = {name: i for i, name in enumerate(ss_names)}
    all_times = Time([t for samples in per_window for t in samples])
    ss_alt, ss_az, ss_dist = _ss_altaz(ss_names, all_times, loc)
    sun_limb = _sun_upper_limb(ss_alt[0], ss_dist[0])

    matched = np.zeros(n, dtype=bool)
    days = [[] for _ in range(n)]

    # Then one window at a time: the reduction is per window anyway,
    # and the fixed objects, which are the many, are computed and
    # reduced a window at a time so peak memory stays at one window's
    # (candidates, samples) array however long the range is (OBS-19).
    for index, samples in enumerate(per_window):
        lo, hi = int(bounds[index]), int(bounds[index + 1])
        times = Time(samples)
        alt, az = _candidates_altaz(candidates, times, loc,
                                    ss=(ss_alt[:, lo:hi], ss_az[:, lo:hi],
                                        ss_row))
        sun_alt = sun_limb[lo:hi]
        margin = _qualify_margin(alt, az, sun_alt, visibility, obs_window,
                                 threshold)
        secs = np.array([(samples[k + 1] - samples[k]).total_seconds()
                         for k in range(len(samples) - 1)])
        offsets = np.array([(s - samples[0]).total_seconds() / 60.0
                            for s in samples])
        for i, hours, max_alt, darkest, peak in _window_records(
                margin, alt, sun_alt, secs, offsets):
            matched[i] = True
            days[i].append([index, hours, max_alt, darkest, peak])

    return jsonify(filter_targets_result_schema.dump(
        {"matched": [bool(m) for m in matched],
         "count": int(matched.sum()), "days": days})), 200


@app.route("/api/get-objs", methods=['POST'], swag=True)
def get_objs():
    """
    Return the altitude and azimuth of a list of targets
    ---
    description:
      Like /api/get-obj for many targets at once, in request order.
      Solar-system bodies (by name) also get their apparent radius, and
      the moon its phase fields; fixed objects (ra, dec) get altitude and
      azimuth only.
    parameters:
      - name: body
        in: body
        required: true
        description: Observation place, time and targets
        schema:
          $ref: '#/definitions/GetObjsPost'
    responses:
      200:
        description: One result per target, in request order.
        schema:
          $ref: '#/definitions/GetObjsResult'
      400:
        description: Invalid input.
    """
    try:
        data = get_objs_post_schema.load(request.json)
    except Exception as err:
        return jsonify(err.messages), 400

    targets = data["targets"]
    problem = _check_candidates(targets)
    if problem is not None:
        return _error(400, "invalid", problem)

    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)
    t = Time(data["time"])
    results = [None] * len(targets)

    fixed = [i for i, tg in enumerate(targets) if not tg["ss_obj"]]
    if fixed:
        alts, azs = _fixed_altaz([targets[i]["ra"] for i in fixed],
                                 [targets[i]["dec"] for i in fixed], t, loc)
        for i, a, z in zip(fixed, alts, azs):
            results[i] = {"name": targets[i]["name"],
                          "alt": float(a), "az": float(z)}

    for i, tg in enumerate(targets):
        if not tg["ss_obj"]:
            continue
        body = tg["name"].lower()
        obj, aa, dist_km = _compute_body(body, t, loc)
        result = {"name": tg["name"], "alt": float(aa.alt.deg),
                  "az": float(aa.az.deg),
                  "radius": _apparent_radius_deg(body, dist_km)}
        if body == "moon":
            result.update(_moon_phase(t, loc, obj, aa))
        results[i] = result

    return jsonify(get_objs_result_schema.dump({"results": results})), 200
