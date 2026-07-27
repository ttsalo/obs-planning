import logging
import math
import traceback
import uuid
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
from astropy.coordinates import get_body
from astropy.utils import iers

# Prevent astropy from downloading + CDS-parsing IERS_A on the WSGI
# request path — that download used to block all four gunicorn workers
# past the 30 s timeout for any "today" request (OBS-6). Astropy falls
# back to the bundled long-term IERS_B table; the resulting polar-motion
# error is well below one arcsecond and invisible in the sky renderer.
iers.conf.auto_download = False
iers.conf.iers_degraded_accuracy = "ignore"

import schemas

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
                     schemas.GetObjTSResultSchema]))


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


def _compute_altaz(target, times, loc):
    """Single vectorized astropy call: returns (altaz, distance_km_at_first_sample).

    `times` can be scalar or array-valued Time; the returned altaz mirrors
    the input shape. `distance_km` is a plain float pulled from the first
    sample — the sun's radius changes ≤ 0.1 % across a day, well below the
    sky renderer's resolution.
    """
    with solar_system_ephemeris.set("de432s"):
        obj = get_body(target, times, loc)
        altaz = obj.transform_to(AltAz(obstime=times, location=loc))
    dist_km = float(np.atleast_1d(obj.distance.km)[0])
    return altaz, dist_km


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
    aa, dist_km = _compute_altaz(data["target"], t, loc)
    radius = _apparent_radius_deg(data["target"], dist_km)
    return jsonify(get_obj_result_schema.dump({"alt": float(aa.alt.deg),
                                               "az": float(aa.az.deg),
                                               "radius": radius})), 200


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

        target_aa, target_dist_km = _compute_altaz(data["target"], times, loc)
        target_alt = target_aa.alt.deg
        target_az = target_aa.az.deg

        if data["target"].lower() == "sun":
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

