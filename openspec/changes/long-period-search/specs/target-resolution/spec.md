# Spec Delta

## MODIFIED Requirements

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
below -6, `CT` below 0, and `D` always holds. At most 366 windows MUST be
accepted, each at most 24 hours long, the candidate count multiplied by the
window count MUST NOT exceed 65000, and a window whose end precedes
its start MUST be rejected as invalid input. With no windows, or with
visibility `none` and brightness `D`, every candidate is matched. The
response SHALL give one matched flag per candidate, in the request's
order, the number matched, and each candidate's per-window observability
records.

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
- **WHEN** 367 windows are given
- **THEN** the request is rejected as invalid input

#### Scenario: Combined size limit
- **WHEN** 400 candidates are filtered over 366 windows, which is 146400
  candidate-windows
- **THEN** the request is rejected as invalid input

#### Scenario: A year of nightly windows accepted
- **WHEN** 9 solar-system candidates are filtered over 366 nightly windows
- **THEN** the request is accepted and answered

## ADDED Requirements

### Requirement: Per-window observability metrics
For each candidate and each window in which it qualifies, the service SHALL
report the window's index in the request, how long the candidate qualified,
the highest altitude it reached while qualifying, the lowest Sun upper-limb
altitude reached while qualifying, and the offset from the window's start at
which the highest altitude occurred. A window in which a candidate never
qualifies SHALL have no record for it.

#### Scenario: Records identify their window by position
- **WHEN** a candidate qualifies in the first and third of three windows
- **THEN** it has two records, identified by the first and third window
  positions, and none for the second

#### Scenario: Metrics cover only qualifying instants
- **WHEN** a candidate is highest while the sky is brighter than the
  brightness limit, and lower while the sky is dark enough
- **THEN** the reported highest altitude is the lower one and the reported
  offset points at the instant it occurred

#### Scenario: Candidate qualifying in no window
- **WHEN** a candidate qualifies in none of the windows
- **THEN** it is reported as not matched and has no records

#### Scenario: Times are offsets, not wall-clock
- **WHEN** records are returned for windows the caller supplied as UTC
  instants
- **THEN** each record locates itself by window position and an offset from
  that window's start, and the response contains no wall-clock date or time
  zone

### Requirement: Qualifying duration is interpolated
The reported qualifying duration SHALL be derived by interpolating the
instants at which a candidate crosses into and out of qualification between
samples, rather than by multiplying a count of qualifying samples by the
sampling step, so that durations are not quantised to the 30-minute step.

#### Scenario: Duration finer than the sampling step
- **WHEN** a candidate crosses the visibility threshold partway between two
  samples
- **THEN** the reported duration is not a whole multiple of 30 minutes

#### Scenario: Two days distinguished
- **WHEN** a candidate qualifies in two windows for durations differing by
  less than 30 minutes
- **THEN** the two reported durations differ

### Requirement: Solar-system accuracy under long grids
However the service computes solar-system positions over long sample grids,
the altitudes it filters and reports SHALL agree with a direct per-instant
ephemeris evaluation to within 0.001 degrees, so that an optimisation for
long ranges cannot change which candidates qualify.

#### Scenario: Agreement with direct evaluation
- **WHEN** the Moon and the eight planets are filtered over 180 nightly
  windows
- **THEN** every altitude agrees with a direct per-instant ephemeris
  evaluation to within 0.001 degrees

#### Scenario: Short grids unaffected
- **WHEN** a single window is filtered
- **THEN** the altitudes agree with a direct per-instant evaluation to
  within 0.001 degrees

### Requirement: Largest permitted filter answers within the request budget
A filter request at the maximum permitted size SHALL be answered within the
service's request timeout, without the memory held at any instant growing
with the number of windows.

#### Scenario: Maximum size answered
- **WHEN** a filter request at the largest permitted candidate and window
  counts is made
- **THEN** it is answered rather than timing out

#### Scenario: Memory independent of range length
- **WHEN** the same candidate list is filtered over 366 windows and over 31
  windows
- **THEN** the peak memory of the longer request is not materially greater
  than that of the shorter one
