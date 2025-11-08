#!/usr/bin/env python3

# Utility module to fetch data such as jplephem from the network,
# separated so that docker can cache the data

from astropy.time import Time
from astropy.coordinates import solar_system_ephemeris, EarthLocation
from astropy.coordinates import get_body_barycentric, get_body

t = Time("2025-09-22 23:22")
loc = EarthLocation.of_site('greenwich')
# Force loading of the smaller jplephem dataset
with solar_system_ephemeris.set('de432s'):
    jup = get_body('jupiter', t, loc)
print(jup)
