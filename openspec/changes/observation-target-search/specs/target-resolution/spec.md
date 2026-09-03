## Purpose

The astronomy service's contract for target searches: turning a target
set into candidate objects, telling which of a supplied candidate list are
observable under the given criteria, and providing sky positions and
paths for arbitrary lists of solar-system and fixed objects.

## ADDED Requirements

### Requirement: Resolving a target set to candidates
The astronomy service SHALL resolve a target set, as a request of its
own that applies no observing criteria, to a list of candidate objects,
each with a name, a solar-system flag, and for fixed objects RA and Dec in
degrees plus, when the catalog provides them, a visual magnitude and an
object type. The response SHALL include the candidates, their count and
the unresolved names. `planets` resolves to the eight built-in
bodies without any catalog access. `messier` resolves to the Messier
objects M1 to M110 from the SIMBAD catalog, limited to those at or
brighter than the maximum magnitude when one is given. `double_stars`
resolves to SIMBAD objects of the double-or-multiple-star type (including
its subtypes) at or brighter than the given maximum magnitude. `names`
resolves each name case-insensitively against the built-in bodies (Sun
included) first and against SIMBAD otherwise; names SIMBAD does not know
are returned in an `unresolved` list rather than failing the request.
A set that yields more than 2000 candidates MUST be rejected as invalid
input with a message asking for a tighter limit, and a catalog that
cannot be reached or does not answer within the request's time budget
MUST be reported as a bad-gateway error with a readable message.

#### Scenario: Planets need no catalog
- **WHEN** a `planets` set is resolved while SIMBAD is unreachable
- **THEN** the eight bodies are returned as candidates and no error occurs

#### Scenario: Messier with a magnitude limit
- **WHEN** a `messier` set is resolved with maximum magnitude 6
- **THEN** every candidate is a Messier object with magnitude at most 6 and
  none of the fainter ones appear

#### Scenario: Mixed name list
- **WHEN** a `names` set of "mars", "Vega" and "Notastar" is resolved
- **THEN** the candidates are Mars (solar-system) and Vega (with RA, Dec,
  magnitude and type) and the unresolved list is exactly "Notastar"

#### Scenario: Too many candidates
- **WHEN** a `double_stars` set is resolved with a maximum magnitude that
  matches more than 2000 objects
- **THEN** the request is rejected as invalid input with a message asking
  for a lower magnitude limit

#### Scenario: Catalog unreachable
- **WHEN** a `messier` set is resolved and SIMBAD does not respond
- **THEN** the request fails with a bad-gateway status and a message naming
  the catalog, and the service remains healthy for other requests

### Requirement: Filtering candidates by observing windows
Given a list of up to 2000 candidates (each a solar-system body by name
or a fixed object with RA and Dec), a position (latitude, longitude, and
an observation window of minimum and maximum azimuth and altitude), a
list of observing windows as UTC start and end instants, a visibility
criterion (`window`, `horizon` or `none`) and a maximum brightness (`N`,
`AT`, `NT`, `CT` or `D`), the service SHALL, as a request of its own that
never consults the catalog, sample each window at 30-minute steps from
its start, the end instant included, and report a candidate as matched if
at any sample it satisfies both criteria. Visibility `window` means
altitude strictly between the position's minimum and maximum altitude
and azimuth inside its azimuth limits: strictly between the minimum and
maximum azimuth, or, when the maximum is below the minimum, greater than
the minimum or less than the maximum (the window wraps through north);
`horizon` means altitude above 0; `none` always holds. Brightness is
judged from the altitude of the Sun's upper
limb at the sample: `N` requires below -18 degrees, `AT` below -12, `NT`
below -6, `CT` below 0, and `D` always holds. At most 31 windows MUST be
accepted, each at most 24 hours long, and a window whose end precedes
its start MUST be rejected as invalid input. With no windows, or with
visibility `none` and brightness `D`, every candidate is matched. The
response SHALL give one matched flag per candidate, in the request's
order, and the number matched.

#### Scenario: Object visible only mid-window matched
- **WHEN** a candidate is below the horizon at a window's start and end
  but above it at 23:30 within the window, and the criteria are `horizon`
  and `D`
- **THEN** the candidate is reported as matched

#### Scenario: Object never dark enough unmatched
- **WHEN** the windows fall in midsummer at latitude 63 so the Sun never
  drops below -6 degrees, and the brightness limit is `NT`
- **THEN** no candidate is reported as matched, whatever its altitude

#### Scenario: No filtering
- **WHEN** visibility is `none` and brightness is `D`
- **THEN** every candidate is reported as matched

#### Scenario: Multi-night window
- **WHEN** three nightly windows are given and a candidate satisfies the
  criteria only during the third
- **THEN** the candidate is reported as matched

#### Scenario: Azimuth window wrapping through north
- **WHEN** the position's azimuth limits are 270 to 90 and a candidate
  passes through azimuth 0 above the horizon during a window, with
  visibility `window` and brightness `D`
- **THEN** the candidate is reported as matched, and with limits 90 to
  270 it is not

#### Scenario: Filtering works without the catalog
- **WHEN** a list of fixed candidates with coordinates is filtered while
  SIMBAD is unreachable
- **THEN** the flags are returned normally

#### Scenario: Too many windows
- **WHEN** 32 windows are given
- **THEN** the request is rejected as invalid input

### Requirement: Batched sky positions
The service SHALL return, in one request, the current altitude and azimuth
for a list of targets as seen from a position at a time, where each
target is either a solar-system body by name or a fixed object with RA and
Dec. Solar-system bodies also get their apparent radius, and the Moon its
phase fields, exactly as the single-object endpoint provides them. The
response order MUST match the request order and MUST carry the target's
name so results can be matched by the caller. Up to 2000 targets MUST be
accepted.

#### Scenario: Mixed batch
- **WHEN** a batch of Mars (solar-system), the Moon and M31 (RA 10.68, Dec
  41.27) is requested
- **THEN** three results come back in that order, Mars and the Moon with a
  radius, the Moon with phase fields, and M31 with altitude and azimuth
  only

#### Scenario: Batch matches single-object results
- **WHEN** Jupiter is requested in a batch and separately from the
  single-object endpoint for the same position and time
- **THEN** both give the same altitude, azimuth and radius

### Requirement: Paths for fixed objects
The 24-hour timeseries endpoint SHALL accept an optional RA and Dec; when
they are given the target name is only a label and the series is computed
for those fixed coordinates, with the same 48 half-hour samples and Sun
altitude values as for solar-system bodies.

#### Scenario: Fixed-object path
- **WHEN** a timeseries is requested for "M31" with RA 10.68 and Dec 41.27
- **THEN** 48 samples are returned with altitude, azimuth, Sun altitude and
  timestamp, and the altitudes are consistent with the object's
  declination and the position's latitude

#### Scenario: Solar-system path unchanged
- **WHEN** a timeseries is requested for "jupiter" without RA and Dec
- **THEN** the response is what the endpoint returned before this change
