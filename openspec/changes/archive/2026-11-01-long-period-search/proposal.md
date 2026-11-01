# Proposal

## Why

A search today answers "what can I see in this window", once, for one night
or for a range of at most 31 days, and collapses the answer to a single
matched flag per object. It cannot answer the question observers actually
plan around: *when* over the coming months is each target at its best. The
evaluation already computes everything needed to answer that — altitude,
azimuth and sky brightness at every sampled instant — and then throws it
away in a single `any()` reduction.

Keeping that detail per day turns the same machinery into a planning tool,
and makes the sky view honest about the date it is showing: a search with a
day range currently draws every object that matched on *any* night of the
range, including objects that are nowhere near observable tonight.

## What Changes

- Every evaluation produces a **per-day observability record** for each
  candidate, over whatever day range the definition carries. A definition
  without a range still means one day, so the existing single-night
  behaviour is the degenerate case of the same mechanism.
- Each record holds four numbers: qualifying hours, the highest altitude
  reached while qualifying, the darkest sky reached while qualifying, and
  when the altitude peak occurred. A day on which a candidate never
  qualifies gets no record, so the grid is sparse.
- Qualifying hours are computed by **interpolating the boundary** where a
  candidate enters and leaves qualification, rather than counting 30-minute
  samples, so days can be ranked without ties on a half-hour quantum.
- The **day-range cap rises from 31 days to 366**, and a new cap on
  candidates times days replaces the day count as the real size limit.
- The astronomy service computes solar-system positions from a **coarse
  ephemeris grid with cubic interpolation and a single stacked coordinate
  transform**, which is what makes a year-long evaluation finish inside the
  worker timeout. Verified accurate to 0.0002 degrees of altitude.
- The sky view becomes **date-aware**: for a date inside the evaluated
  range it draws the candidates that qualify on that date. Outside the
  range, and for any search with no per-day data, it falls back to today's
  any-day behaviour and says so.
- A new **observability calendar** shows one row per target and one cell
  per day, shaded by a metric the user picks, with a derived summary of each
  target's best periods in words. Clicking a day sets the application's
  date, so the sky view beside it shows that night.
- The evaluation record stores the **coordinates and observation window it
  used**, not just the position's name, so a search whose position has since
  been edited can be marked stale instead of silently misleading.
- Per-day records are fetched **on their own endpoint**, not with the
  searches listing, so the listing every dialog and the sky view share does
  not grow by a megabyte per search.

## Capabilities

### New Capabilities
- `observability-calendar`: the per-day observability metrics — what they
  mean, how a day is scored, when a day has no record — and how a search's
  per-day results are presented: the calendar grid, the metric choice, the
  best-period summary, and the click-through that moves the shown date.

### Modified Capabilities
- `observation-target-search`: the day range grows to 366 days; evaluation
  stores per-day records alongside each candidate and records the position
  details it used; a search can be reported stale; per-day records are
  retrievable on their own endpoint; the sky view draws the candidates that
  qualify on the shown date, with a documented fallback.
- `target-resolution`: the filter endpoint returns per-day metrics per
  candidate instead of only a matched flag, accepts up to 366 windows under
  a combined candidates-times-windows cap, and computes solar-system
  positions by interpolation so the long grids stay inside the time budget.

## Impact

- **Astro service** (`astrobackend/server.py`, `schemas.py`): the filter
  endpoint gains the per-day reduction, boundary interpolation, per-day
  chunking and the interpolated stacked ephemeris path; caps change.
  No catalog code is touched, so resolution behaviour is unchanged.
- **Go server** (`backend/db.go`, `api.go`): `TargetObject` gains a JSON
  per-day column; `TargetSearch` gains the evaluated coordinates and
  window; a new per-search days endpoint; the day-range validation bound
  changes. AutoMigrate adds the columns, and rows without them read as
  having no per-day data.
- **Frontend** (`obs-ui/src/searches.jsx`, `obs.jsx`, `App.jsx`): the
  evaluate flow carries per-day results through save; a new calendar panel
  and its metric choice; the sky view filters by the shown date; the
  searches dialog shows the range and staleness.
- **Compute budget**: worst permitted evaluation measured at about 15
  seconds of astronomy time, against a 60-second worker timeout, with peak
  memory bounded by one day's samples rather than the whole range.
- **No new dependencies.** The interpolation is written against numpy,
  which is already present; scipy is deliberately not introduced.
