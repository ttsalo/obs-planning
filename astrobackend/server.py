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
      Turn a target set (the planets, the Messier objects, double stars
      at or brighter than a magnitude, or a list of names) into candidate
      objects with coordinates, magnitude and type. Applies no observing
      criteria; see /api/filter-targets for those. Needs SIMBAD for
      everything but the planets.
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
    names = [n for n in target_set.get("names") or [] if n.strip()]
    if kind == "double_stars" and max_magnitude is None:
        return _error(400, "invalid", "Double stars need a maximum magnitude")
    if kind == "names" and not names:
        return _error(400, "invalid", "A name list needs at least one name")

    try:
        candidates, unresolved = catalog.resolve_set(kind, max_magnitude, names)
    except catalog.TooManyCandidates as err:
        return _error(400, "too_many", str(err))
    except catalog.CatalogUnavailable as err:
        return _error(502, "catalog", str(err))

    return jsonify(resolve_targets_result_schema.dump(
        {"candidates": candidates, "count": len(candidates),
         "unresolved": unresolved})), 200


def _window_samples(windows):
    """Every 30 minutes from each window's start, the end instant
    included, concatenated over the windows; naive UTC datetimes."""
    samples = []
    for window in windows:
        start, end = as_utc(window["start"]), as_utc(window["end"])
        steps = int((end - start).total_seconds() // TS_STEP_SECONDS)
        for k in range(steps + 1):
            samples.append(start + timedelta(seconds=k * TS_STEP_SECONDS))
        if samples[-1] != end:
            samples.append(end)
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


def _candidates_altaz(candidates, times, loc):
    """(n_obj, n_t) altitude and azimuth arrays for a mixed list."""
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
        if c["ss_obj"]:
            aa, _ = _compute_altaz(c["name"].lower(), times, loc)
            alt[i] = aa.alt.deg
            az[i] = aa.az.deg
    return alt, az


@app.route("/api/filter-targets", methods=['POST'], swag=True)
def filter_targets():
    """
    Flag which candidates are observable in the given windows
    ---
    description:
      Sample each observing window every 30 minutes (end included) and
      report, for each candidate, whether at any sample it is both
      visible per the visibility criterion and the sky is at most as
      bright as the brightness limit. Never consults the catalog.
    parameters:
      - name: body
        in: body
        required: true
        description: Candidates, position, windows and criteria
        schema:
          $ref: '#/definitions/FilterTargetsPost'
    responses:
      200:
        description: One matched flag per candidate, in request order.
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

    n = len(candidates)
    if n == 0 or not data["windows"] or (visibility == "none" and threshold is None):
        return jsonify(filter_targets_result_schema.dump(
            {"matched": [True] * n, "count": n})), 200

    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)
    times = Time(_window_samples(data["windows"]))

    alt, az = _candidates_altaz(candidates, times, loc)

    if visibility == "window":
        visible = ((alt > obs_window["min_alt"]) & (alt < obs_window["max_alt"])
                   & _az_in_window(az, obs_window))
    elif visibility == "horizon":
        visible = alt > 0
    else:
        visible = np.ones_like(alt, dtype=bool)

    if threshold is None:
        dark = np.ones(len(times), dtype=bool)
    else:
        sun_aa, sun_dist_km = _compute_altaz("sun", times, loc)
        sun_alt = sun_aa.alt.deg + _apparent_radius_deg("sun", sun_dist_km)
        dark = np.asarray(sun_alt) < threshold

    matched = (visible & dark[np.newaxis, :]).any(axis=1)
    return jsonify(filter_targets_result_schema.dump(
        {"matched": [bool(m) for m in matched],
         "count": int(matched.sum())})), 200


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
