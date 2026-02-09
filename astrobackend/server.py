import math

from apispec.ext.marshmallow import MarshmallowPlugin
from apispec_webframeworks.flask import FlaskPlugin
from flask import Flask, request, make_response, jsonify
from flasgger import APISpec, Swagger, Schema, fields, validate, swag_from
from http import HTTPStatus

from astropy import units as u
from astropy.time import Time
from astropy.timeseries import TimeSeries
from astropy.coordinates import solar_system_ephemeris, EarthLocation, AltAz
from astropy.coordinates import get_body

import schemas

app = Flask(__name__)

    
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
    #data = request.get_json()

    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)

    t = Time(data["time"])
    with solar_system_ephemeris.set('de432s'):
        obj = get_body(data["target"], t, loc)
    aa = obj.transform_to(AltAz(obstime=t, location=loc))
    radius = math.atan(
        {"mercury": 2439.7,
         "venus": 6051.8,
         "moon": 1737.4,
         "mars": 3389.5,
         "jupiter": 69911.0,
         "saturn": 58232.0,
         "uranus": 25362.0,
         "neptune": 24622.0,
         "sun": 696340.0}[data["target"].lower()]
        / obj.distance.km) * 180 / math.pi
    return jsonify(get_obj_result_schema.dump({"alt": aa.alt.deg,
                                               "az": aa.az.deg,
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

    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)

    if data.get("timespan") == "day":
        ts = TimeSeries(time_start=data["time"],
                        time_delta=1800 * u.s,
                        n_samples=48)
        with solar_system_ephemeris.set('de432s'):
            aas = [get_body(data["target"], t["time"], loc).transform_to(
                AltAz(obstime=t["time"], location=loc)) for t in ts]
            if not data["target"] == "sun":
                sun_aas = [get_body("sun", t["time"], loc).transform_to(
                    AltAz(obstime=t["time"], location=loc)) for t in ts]
                sun_radius = 696340.0 / sun_aas[0].distance.km * 180 / math.pi
                resp = make_response(
                    {"series": [{"alt": i[0].alt.deg, "az": i[0].az.deg,
                                 "sun_alt": i[1].alt.deg + sun_radius,
                                 "ts": i[0].obstime.value.isoformat() + "Z"}
                                for i in zip(aas, sun_aas)]})
            else:
                sun_radius = 696340.0 / aas[0].distance.km * 180 / math.pi
                resp = make_response(
                    {"series": [{"alt": aa.alt.deg,
                                 "az": aa.az.deg,
                                 "sun_alt": aa.alt.deg +
                                 sun_radius,
                                 "ts": aa.obstime.value.isoformat() + "Z"}
                                for aa in aas]})
        
    return resp

