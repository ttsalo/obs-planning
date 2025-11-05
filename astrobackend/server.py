import math
from flask import Flask, request, make_response

from astropy import units as u
from astropy.time import Time
from astropy.timeseries import TimeSeries
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

    loc = EarthLocation.from_geodetic(lat=data["lat"], lon=data["lon"], height=0)

    if data.get("timespan") == "day":
        ts = TimeSeries(time_start=data["time"],
                        time_delta=1800 * u.s,
                        n_samples=48)
        with solar_system_ephemeris.set('de432s'):
            aas = [get_body(data["target"], t["time"], loc).transform_to(
                AltAz(obstime=t["time"], location=loc)) for t in ts]
        resp = make_response({"series": [{"alt": aa.alt.deg, "az": aa.az.deg}
                                         for aa in aas]})
    else:
        t = Time(data["time"])
        with solar_system_ephemeris.set('de432s'):
            obj = get_body(data["target"], t, loc)
        aa = obj.transform_to(AltAz(obstime=t, location=loc))
        # Fixed just for moon for now
        radius = math.atan(1737.4 / obj.distance.km) * 180 / math.pi
        resp = make_response({"alt": aa.alt.deg, "az": aa.az.deg,
                              "radius": radius})

    resp.headers["Access-Control-Allow-Origin"] = request.headers["Origin"]
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"

    return resp
