# Design

## Context

See proposal.md - Why. The constraints that shape the approach:

- `POST /api/filter-targets` already samples every observing window every
  30 minutes, computes altitude, azimuth and Sun altitude over the whole
  concatenated grid, and reduces `(visible & dark).any(axis=1)` to one flag
  per candidate. The per-day information exists inside that function and is
  discarded by the reduction.
- The frontend already builds one window per day of the day range
  (`buildWindows` in `searches.jsx`), anchored to the date the window
  *begins* on, in the browser's local zone. The astro service never sees
  wall-clock times or zones. Day identity therefore already exists as
  window order.
- Astro runs 2 gunicorn workers, `--preload`, `--timeout 60`, memory limit
  1792 MiB. The frontend's axios timeout is 120 s and Cloud Run's is 120 s.
- The searches listing (`GET /api/searches`) returns every search with
  every candidate, and the header, the dialog and `ObsStage` share that one
  React Query cache entry.
- scipy is not a dependency and is not being added; `requirements.txt` must
  stay pin-compilable under Python 3.9.

Measured on the project venv, 30-minute sampling, Helsinki:

| computation | samples | time |
|---|---|---|
| 110 fixed objects, 180 nights of 4h, one transform | 1,620 | 0.38 s |
| same, chunked a day at a time | 1,620 | 1.21 s |
| 2000 fixed objects, 31 days of 24h, one transform | 1,519 | 1.43 s |
| 9 bodies, 180 nights of 4h, per-body `get_body` | 1,620 | 7.8 s |
| 9 bodies, 366 days of 24h, per-body `get_body` | 17,934 | 78.9 s |
| 9 bodies, 366 days of 24h, interpolated and stacked | 17,934 | 14.9 s |

## Goals / Non-Goals

**Goals:**
- Per-day results for any permitted range, within one interactive request
  and inside the 60-second worker timeout.
- Peak memory independent of the range length.
- No behaviour change for a search with no day range, and none for searches
  saved before this change.
- Keep the searches listing the size it is today.

**Non-Goals:**
- No background jobs, queue or progress reporting. Every evaluation stays a
  single synchronous request, which the measurements show is affordable.
- No change to catalog resolution. `catalog.py` and `/api/resolve-targets`
  are untouched, so the SIMBAD behaviour and its caching are unchanged.
- No rolling ranges. A range is fixed dates, so stored results stay valid.
- Not extending the interpolated ephemeris path to `/api/get-obj`,
  `/api/get-objs` or `/api/get-obj-timeseries` in this change. Those are
  short grids where the current path is already fast, and changing them
  would alter what the sky view draws today for no user-visible gain.

## Decisions

### D1: One search with a richer evaluation, not a second entity
Per-day results hang off the existing `TargetSearch` and its
`TargetObject`s. A definition without a day range evaluates one day; a
366-day range evaluates 366. `matched` keeps its current meaning,
"qualified on at least one evaluated day", and is now derivable as "has at
least one day record".

Alternatives considered. A separate `LongPeriodSearch` entity would leave
today's search untouched, but duplicates the whole definition (set,
window, criteria, position), needs a second dialog that is 90% the first,
and leaves the date-unaware sky view as a permanent wart. Rejected: the
criteria the issue asks to honour are exactly the existing ones, so the
definitions would have to stay in step by hand.

### D2: Four numbers per candidate per day
Over the samples of that day's window at which the candidate is both
visible per the visibility criterion and under the brightness limit - the
*qualifying* samples:

- `hours` - how long it qualified (D3).
- `max_alt` - the highest altitude reached while qualifying.
- `dark_sun` - the lowest Sun upper-limb altitude reached while qualifying.
- `peak_at` - when `max_alt` occurred, as minutes from the window's start.

A day with no qualifying samples gets **no record**, which is what makes
the grid sparse and what `matched` reduces to.

The key point is that these are not arbitrary weightings. Qualification
already requires the brightness limit, so `max_alt` is *already* "the
highest it gets while the sky is dark enough" rather than an independent
maximum that might occur in daylight. `dark_sun` then says how much
brightness margin the night had. No combined score and no weights are
needed, which is why the earlier worry about having to choose them does not
arise.

Alternatives considered. A single combined observability score was rejected:
it bakes a weighting into storage, and the issue asks for the UI to choose
what to show. Two numbers only (peak altitude and darkest sky) were
rejected because they drop "how long", which the issue names first.

### D3: Qualifying hours by boundary interpolation, not sample counting
Counting qualifying samples on a 30-minute grid quantises `hours` to half
an hour, so a 4-hour window yields nine possible values and adjacent days
tie constantly - useless for ranking days. Instead, at each transition
between a qualifying and a non-qualifying sample, interpolate the crossing
point linearly in the quantity that crossed its threshold, and accumulate
exact durations.

This is the same technique `interpolateTransition` in `obs.jsx` already
uses to place a path's colour break at the mathematically correct instant
rather than at a sample boundary, so the idea is established in the
codebase. It costs no extra samples and therefore no extra astropy time.

Alternatives considered. Sampling every 10 minutes triples the grid and
triples the solar-system bill for a coarser answer than interpolation
gives. Rejected.

### D4: Three caps, each guarding a different resource
The size limit that matters is now the result grid, not the day count:

| cap | value | guards |
|---|---|---|
| candidates | 2000 (unchanged) | catalog and payload |
| windows | 366 (was 31) | range length |
| candidates x windows | 65,000 (new) | stored and transferred cells |

65,000 is chosen to cover the cases worth supporting and to preserve
everything legal today:

| evaluation | cells | permitted |
|---|---|---|
| 8 planets over a year | 2,928 | yes |
| Messier over a year | 40,260 | yes |
| Caldwell over a year | 39,894 | yes |
| 2000 candidates over 31 days (today's maximum) | 62,000 | yes |
| Herschel 400 over a year | 146,400 | no, needs 162 days or fewer |
| 2000-candidate category over a year | 732,000 | no |

No separate sample cap is needed: 366 windows of at most 24 hours bounds
the grid at 17,934 samples, whose worst-case cost is the 14.9 s measured
above. Exceeding the combined cap is reported like the existing
`too_many`, naming both numbers and what to reduce.

Note this rejects nothing that an existing scenario asserts. The spec's
size scenarios are 110 candidates, 60 matches, 100 matched candidates, and
a 40-day range rejected; none asserts a 2000-candidate multi-week search,
and that combination stays legal anyway.

### D5: Interpolated, stacked solar-system positions
The expensive operation is `get_body`, at roughly 0.5 ms per body per
sample, which is about 1500 times the per-point cost of the fixed-object
transform. Two changes, inside the filter endpoint only:

1. **Coarse grid plus cubic interpolation.** Evaluate `get_body` on a grid
   of 4 nodes per day spanning the range, take each body's *geocentric*
   cartesian position, and interpolate to the fine sample grid with a
   Catmull-Rom cubic. Geocentric cartesian position varies smoothly even
   for the Moon, and interpolating position rather than altitude keeps
   Earth's rotation - 15 degrees per hour, far too fast to interpolate -
   out of the interpolated quantity entirely. Distance is carried, so the
   topocentric parallax correction and the Sun's apparent radius still come
   out of the frame transform rather than being approximated.
2. **One stacked transform.** Build a single `GCRS` coordinate array of
   shape (bodies, samples) and transform it to `AltAz` once, instead of once
   per body. Each body otherwise pays the per-sample frame setup again; this
   is the same amortisation the fixed-object path already gets by sharing
   one transform across all objects.

Together these take the worst permitted case from 78.9 s to 14.9 s, split
4.9 s ephemeris and 10.0 s transform. Measured altitude error against the
current per-body computation, over 180 nights:

| body | max altitude error |
|---|---|
| Moon | 0.000193 deg |
| Mercury | 0.000005 deg |
| Venus | 0.000001 deg |
| Mars, Jupiter, Saturn, Uranus, Neptune, Sun | below 0.0000005 deg |

The Moon is the only body whose motion needs the denser nodes; at 1 node
per day it is the sole outlier. 4 nodes per day is used for every body
rather than per-body densities, because the ephemeris is 4.9 s of the 14.9 s
worst case and a per-body schedule is not worth the branch.

All of this is well inside the arcsecond-level accuracy the project already
accepts from the bundled IERS_B table, and is confined to the filter
endpoint, so nothing the sky view draws today changes.

Alternatives considered. Raising `--timeout` past 79 s was rejected: it
would let one request occupy half the worker pool for over a minute and
still exceeds no useful budget. scipy's `CubicSpline` was rejected because
scipy is not a dependency and adding one that must pin-compile under
Python 3.9 is a cost the 20 lines of Catmull-Rom avoids. Interpolating
altitude and azimuth directly was rejected as wrong: they move 15 degrees
per hour with Earth's rotation.

### D6: Reduce a day at a time
The filter loops over windows, computing and reducing each day before the
next, so peak memory is one day's `(candidates, samples)` array instead of
the whole range's. Measured cost of day-at-a-time chunking is 1.21 s against
0.38 s for one shot on a 110-object half-year, and peak array size falls
from 178,200 points to 990. The reduction is per-day anyway, so this is
structure the computation wants rather than a concession.

The ephemeris coarse grid (D5) is computed once for the whole range, before
the loop, since it is small and shared.

### D7: Per-day records stored as a JSON column, sparsely, compactly
`TargetObject` gains `Days`, a JSON text column following the existing
`Names` pattern on `TargetSearch` (a `driver.Valuer` and `sql.Scanner`
pair). Each record is a fixed-order array, not an object:

```
[day_index, hours, max_alt, dark_sun, peak_minutes]
```

`day_index` is the offset from the day range's start date; `peak_minutes`
is minutes from that window's start. Both are zone-free, so the astro
service and the database never deal with wall-clock time or time zones -
the frontend, which built the windows, owns that mapping. Array form rather
than keyed objects roughly halves the payload, which matters at 65,000
cells.

Alternatives considered. A `TargetObjectDay` table would allow queries by
date across searches ("what is good tonight across everything"), but costs
up to 65,000 hard-deleted and reinserted rows per re-evaluation, a
two-level GORM preload, and a migration. Nothing in this change needs the
cross-search query. Rejected for now; the JSON column does not preclude
adding the table later if that query becomes a feature.

### D8: Per-day records come from their own endpoint
`GET /api/searches/:id/days` returns the per-day grid for one search. The
searches listing keeps returning definitions, the evaluation record and
candidates with their `matched` flags, and **not** the day records.

Without this split, a Messier search over half a year adds about 20,000
cells to every listing, and the listing is refetched whenever the dialog
opens or any mutation invalidates the key - which the header, the dialog
and `ObsStage` all share. One search's grid is at most 65,000 cells, so a
single on-demand fetch keyed by search id serves both the calendar and the
date-aware sky view, cached by React Query.

### D9: The evaluation record stores what it used
`TargetSearch` gains `EvaluatedLat`, `EvaluatedLon` and the four
observation-window bounds, alongside the existing `EvaluatedPosition` name.
A search is **stale** when the position it names still exists but its
coordinates differ from the stored ones, or - only when `visibility` is
`window` - its observation window differs. The window is excluded from the
comparison for `horizon` and `none` visibility because the evaluation did
not consult it, so changing it cannot have invalidated the result.

This mirrors an existing distinction in the codebase: the path query key in
`obs.jsx` includes the position's coordinates but not its window, precisely
because the astro request carries only lat and lon. Staleness is computed
in the frontend from data it already holds; nothing is stored about it.

### D10: Date-aware sky view, with the fallback that makes it safe
For the date the application is showing:

| situation | drawn |
|---|---|
| date inside the evaluated range, candidate has a record for it | drawn |
| date inside the evaluated range, no record | omitted |
| date outside the evaluated range | every `matched` candidate |
| search has no per-day data at all | every `matched` candidate |

The last two rows are exactly today's behaviour, and they are not a
nicety. A search with no day range evaluates a single day, so without the
out-of-range fallback, picking any other date would empty the sky for every
search anyone has saved so far. The same row covers searches stored before
this change, satisfying the existing compatibility requirement that they
still render. The view must indicate which mode it is in, otherwise its
meaning changes silently as the user crosses the range boundary.

A welcome consequence: the `MAX_PATHS_ALWAYS` threshold of 10 now applies
to the per-date count rather than the any-day count, so a Messier search
showing twelve objects tonight gets paths where today's sixty-match count
suppresses them.

### D11: The calendar is HTML, in a dialog opened from the top bar
One row per target, one cell per day, shaded by a metric the user chooses
from the four in D2, with a hover readout of that day's numbers and a click
that sets the application's date.

It is plain HTML rather than a Konva mode. The stage is a fixed 1000x500
virtual scene scaled to container width, which would make 180 columns of
day labels unreadable, and hover, scroll and click-to-set-date are what
HTML and antd already do well.

It opens as a dialog from a control in the top bar, beside the position and
search indicators and consistent with those two dialogs. **This reverses an
earlier decision.** The calendar was first built as a collapsible panel
under the stage, on the reasoning that a dialog breaks the loop that gives
the feature its value: clicking a day should change the sky *behind* the
calendar, which a dialog covers. The user asked for a dialog, and the loop
is preserved instead by closing the dialog when a day is activated, so a
single click still lands on that night. The cost is that comparing several
nights means reopening the dialog each time; the benefit is that the sky
view keeps the whole window and the three dialogs behave alike.

The best-period summary in words ("best from 12 Oct to 3 Dec, peak 8 Nov")
is derived in the frontend by thresholding the chosen metric and grouping
runs of days. It is presentation, so no threshold is stored and the rule can
change freely.

### D12: The astro response stays positional and zone-free
`POST /api/filter-targets` keeps returning `matched` and `count`, and adds
per-candidate day records indexed by **window position**, in request order,
matching the existing convention that lets the frontend zip results onto
the candidates it already holds. The service continues to receive only UTC
window instants and to return only window indices and offsets, so all
wall-clock and time-zone handling stays in `buildWindows` where it is today.

## Risks / Trade-offs

- **Worst permitted evaluation is 15 s of astronomy time** → Inside the
  60 s worker timeout and the 120 s frontend timeout, but it occupies one of
  two workers for that time. The caps in D4 bound it; the realistic cases
  measured are 3 to 8 s. A Cloud Run cold start adds several seconds of
  astropy import on top, which the existing `--preload` already covers.
- **A new ephemeris code path could diverge from the one the sky view
  uses** → Confined to the filter endpoint (D5 Non-Goals), and covered by a
  test asserting agreement with the current per-body computation to within
  a tolerance well above the measured 0.0002 degrees.
- **65,000 cells is about 2 MB of JSON worst case** → On its own endpoint
  (D8), fetched once per selected search and cached; sparse storage means
  typical searches are far smaller. The cap is what keeps the bound.
- **Date-awareness changes what an existing ranged search draws** → It
  draws strictly fewer objects, and only ones that are genuinely not
  observable on the shown date, which is the defect being fixed. The
  fallback rows in D10 mean no search loses objects without per-day data to
  justify it, and the mode is shown in the UI.
- **Interpolation error is largest for the Moon** → 0.0002 degrees at 4
  nodes per day, four orders of magnitude inside the arcsecond accuracy the
  project already accepts. A test pins the node density so a later change
  cannot quietly coarsen it.
- **Boundary interpolation makes `hours` more precise than the 30-minute
  sampling of the underlying path** → `hours` is exact for the sampled
  trajectory, not for the true one; a target skimming a limit between two
  samples can be missed entirely. This is already true of today's matched
  flag, so it is not a new limitation, but the calendar presents the number
  more prominently and should not be read as minute-accurate.

## Migration Plan

1. AutoMigrate adds `target_objects.days` and the six evaluated-position
   columns to `target_searches`. Both are additive; AutoMigrate never drops.
2. Existing rows read as having no per-day data and no stored coordinates.
   They render through the fallback rows of D10 and are never reported
   stale, since there is nothing to compare. Re-evaluating and saving a
   search fills both in.
3. `InitTestData` is unchanged. The seeded `Planets` search keeps no day
   range, so it evaluates one day and behaves as it does today; its
   per-day column stays empty until someone re-evaluates it.
4. No backfill. A search's per-day grid is only meaningful for the range
   and position it was evaluated for, neither of which can be reconstructed
   for an old row.
5. Rollback is a code revert. The added columns are ignored by the previous
   version, and no existing column changes meaning, so a rollback needs no
   database action.

## Open Questions

- Which of the four metrics should the calendar shade by on first open.
  Qualifying hours is the obvious default, but this is a presentation
  default that can change without touching specs, storage or tasks.
- Whether the interpolated ephemeris path should later replace the per-body
  computation in `/api/get-objs` and `/api/get-obj-timeseries` as well. Out
  of scope here (Non-Goals); worth revisiting once it has proven itself in
  the filter endpoint.
