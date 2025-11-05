from flask import Flask, request, make_response

from astropy.time import Time
from astropy.coordinates import solar_system_ephemeris, EarthLocation, AltAz
from astropy.coordinates import get_body


app = Flask(__name__)

@app.route("/")
def index():
    return "<p>Use the API</p>"

@app.route("/api/get-obj", methods=['OPTIONS'])
def get_obj_options():
    resp = make_response()
    resp.headers["Access-Control-Allow-Origin"] = request.headers["Origin"]
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp

@app.route("/api/get-obj", methods=['POST'])
def get_obj():
    data = request.get_json()
    t = Time(data["time"])
    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)
    with solar_system_ephemeris.set('de432s'):
        obj = get_body(data["target"], t, loc)
    aa = obj.transform_to(AltAz(obstime=t, location=loc))
    resp = make_response({"alt": aa.alt.deg, "az": aa.az.deg})
    resp.headers["Access-Control-Allow-Origin"] = request.headers["Origin"]
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp
