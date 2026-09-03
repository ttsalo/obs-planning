## Context

See proposal.md - Why. Relevant current state:

- `TargetSearch` (backend/db.go) has `Name`, `SearchStr`, `UserID` and a
  many-to-many `TargetObjects` through `search_results`; `TargetObject` has
  `Name`, `SSObj`, `RA`, `Dec`. Only `InitTestData` writes them and only
  `GET /api/searches` (with `Preload("TargetObjects")`) reads them.
- The session cookie names the selected search by name
  (`Session.Search`, default `"Planets"`), exactly as it names the
  position; `ObsStage` resolves it with `searchQ.data.find(...)` and would
  throw on a missing search today.
- The browser talks to the astro backend directly (CORS), never through
  the Go server. `ObsStage` renders one `Target` + one `TargetPath` per
  object; each `Target` is its own `/api/get-obj` request every minute and
  each `TargetPath` its own `/api/get-obj-timeseries` per 30-minute bin.
  The astro backend only knows the bodies in `OBJ_RADII_KM`; everything is
  computed with `get_body`.
- The astro backend runs 2 gunicorn workers with `--timeout 60` under a
  1792 MiB memory ceiling; `_sun_alt_series` is `lru_cache`d per
  (lat, lon, start). Tests run offline; CI installs `requirements.txt` and
  runs `fetch_data.py` first.
- The positions change (archived `editable-observation-positions`) set the
  patterns this change copies: `Validate()` on the model, `jwtUser` /
  ownership-scoped lookups returning 404, pre-checked 409 for duplicate
  names, a partial unique index on `(user_id, name)`, a dialog sharing the
  `["positions"]` query key with the sky view, rename-moves-selection, and
  the missing-selection fallback effect in `ObsStage`.
- User decisions from planning: catalog data comes from SIMBAD via
  `astroquery` at search time; large searches draw markers for every
  result and a path only on hover/tap; day ranges are sampled every night
  at 30-minute steps and capped at 31 days.

## Goals / Non-Goals

**Goals:**
- Search definitions that validate the same way on the Go server and in
  the form, stored with every candidate and its match flag so criteria can
  be changed later without the catalog and re-evaluation is explicit.
- An astro-side evaluation that is at most two requests per Evaluate
  click (resolve only when the set changed, then filter), bounded in
  candidates, windows and time, and testable without network.
- Canvas rendering whose astro request count is independent of the
  match count.
- Offline `make check` and CI.

**Non-Goals:**
- A free-form query language for criteria; the four set kinds are the
  whole vocabulary.
- Automatic re-evaluation of saved searches (on position change, on a new
  night, on schedule). Results are what the user last evaluated.
- Time-zone awareness beyond the browser's local zone, which is what the
  existing date/time pickers already use.
- Observing-list features such as selecting a subset of results, ordering,
  notes, or per-object visibility spans in the results table.
- Changing the session cookie format.

## Decisions

### D1: Structured definition, stored as typed columns
The criteria vocabulary is `set_kind` in {`planets`, `messier`,
`double_stars`, `names`} plus `max_magnitude` (nullable float) and `names`
(a JSON array in a text column). Alternative: a free-text
`search_str` parsed on the astro side. Rejected: it can't be validated on
the Go server, can't be edited in a form without a parser on both ends,
and every criterion the issue lists fits the enumerated shape. Typed
columns follow `Position`; only `names` is JSON because a list needs it
and a child table would be overkill.

`TargetSearch` columns after the change: `Name`, `UserID` (composite
partial unique index `idx_searches_user_name` like positions), `SetKind`,
`MaxMagnitude *float64`, `Names string` (JSON, `""` for non-name sets),
`StartTime`, `EndTime` (`"HH:MM"`), `StartDate`, `EndDate` (`""` or
`"YYYY-MM-DD"`), `Visibility`, `MaxBrightness`, `EvaluatedAt *time.Time`,
`EvaluatedPosition string`. `SearchStr` is removed from the model; the
Postgres column stays behind unused (AutoMigrate never drops).

Validation lives in `func (s *TargetSearch) Validate() error` plus a
`func (o *TargetObject) Validate() error` for each submitted candidate, both
in `db.go`. The magnitude is required for `double_stars` and optional for
`messier`; the day range is validated by parsing the dates and checking
`end.Sub(start) <= 30*24h` (31 calendar days inclusive).

### D2: Candidates owned by the search (has-many), flagged, replaced as a unit
The stored rows are the *whole* candidate list the set resolved to, not
the filtered subset. `TargetObject` gains `TargetSearchID uint` (indexed),
`Magnitude *float64`, `ObjectType string` and `Matched bool`; the
`many2many` tag goes away. Create/update write the definition and
candidates in one transaction: update the row, delete `target_objects
WHERE target_search_id = ?`, insert the new list. Alternative: keep the
join table and `Association().Replace`. Rejected: it leaves orphan
`target_objects` rows on every re-evaluation and the join adds nothing
since candidates are never shared between searches.

Storing every candidate with a flag, rather than only the matches, is
what lets a saved search be reopened and given new criteria or a new time
period without a catalog round trip (proposal - What Changes). The
alternative of re-filtering in the sky view at display time was rejected:
it would re-run the astro filter on every date-picker change and make the
saved search's content depend on when it is viewed; instead the criteria
are applied in the dialog and the flags saved, so what the sky view draws
is exactly what the search says it contains. Up to 2000 rows per search
is trivial for Postgres.

Migration for the seeded data lives in `InitTestData`: after finding the
"Planets" search, if its `SetKind` is empty set the `planets` definition
(`none`/`D`, 22:00-02:00 defaults), and if it has no has-many candidates
create the eight bodies with `TargetSearchID` set and `Matched` true.
This is idempotent and runs on every start like the rest of the seeding,
so both the Aiven database and a fresh local one converge. The old
`search_results` table is left alone.

### D3: REST shape and status codes (mirrors positions)
- `POST /api/searches` → 201 + the search with `ID` and `TargetObjects`.
- `PUT /api/searches/:id` → 200 + the updated search. Full replacement of
  the definition, evaluation record and candidates.
- `DELETE /api/searches/:id` → 204. No last-search rule: the sky view
  renders the Sun without a search (D8), so unlike positions nothing
  needs one to exist.
- `GET /api/searches` → the same rows, candidates preloaded (`Preload` on
  the has-many). Field names in JSON: `set_kind`, `max_magnitude`, `names`
  (decoded to an array on output via a custom `MarshalJSON`/`UnmarshalJSON`
  on a `Names` type so the API speaks arrays while the column is text),
  `start_time`, `end_time`, `start_date`, `end_date`, `visibility`,
  `max_brightness`, `evaluated_at`, `evaluated_position`, `TargetObjects`
  (each with `name`, `ss_obj`, `ra`, `dec`, `magnitude`, `object_type`,
  `matched`).
- Bodies bind into a `SearchInput` struct (definition + `candidates`
  `[]TargetObjectInput` including `matched`), never into the model, so
  ids, owners and bookkeeping fields can't be set from the body.
- 400 validation, 404 missing-or-foreign (one ownership-scoped query),
  409 duplicate name.

### D4: Astro resolve endpoint and SIMBAD access
Resolution and filtering are two endpoints, because the dialog needs to
run them independently: resolution only when the set changes, filtering
whenever the criteria do, and filtering must keep working when SIMBAD is
down. `POST /api/resolve-targets`, body:
```
{ "set": {"kind": "...", "max_magnitude": 6.0, "names": ["..."]} }
```
Response `{"candidates": [...], "count": n, "unresolved": [...]}` with
each candidate `{name, ss_obj, ra, dec, magnitude, object_type}`
(`ra`/`dec`/`magnitude`/`object_type` null for solar-system bodies). A
marshmallow schema validates the kind, magnitude and names, so the 400s
are produced the same way the existing endpoints produce theirs.

Resolution is a separate module `astrobackend/catalog.py` with one
function per kind returning a list of candidate dicts, and a thin
`_simbad_*` layer that is the only code touching `astroquery`:
- `messier`: `Simbad.query_objects(["M 1", ..., "M 110"])` with votable
  fields `V` and `otype` added, one request. Chosen over an ADQL search on
  `ident.id LIKE 'M %'` because the identifier pattern also matches
  Minkowski planetary nebulae and the list is fixed anyway. Magnitude
  filtering is done on the returned table; objects with no `V` are kept
  when no limit is given and dropped when one is.
- `double_stars`: `Simbad.query_tap` with an ADQL query joining `basic`,
  `allfluxes` and `otypes` (`otypes.otype = '**'` so subtypes count),
  `WHERE V <= :mag`, `SELECT TOP 2001` so the 2000-candidate cap can be
  detected without paging.
- `names`: split the list into built-in bodies (case-insensitive match
  against `OBJ_RADII_KM` plus "sun") and the rest; the rest goes to one
  `Simbad.query_objects` call; rows SIMBAD returns empty are the
  `unresolved` list (astroquery reports them via the `script_number`
  column / missing rows, handled in the seam so callers see names).
- `planets`: the eight bodies, no network.
`Simbad.TIMEOUT` is set to 30 s and `Simbad.ROW_LIMIT` to the cap, so a
hung catalog fails inside gunicorn's 60 s budget; `requests` exceptions
and astroquery's blank-result errors become a `CatalogUnavailable`
exception mapped to 502 with `{"error": "catalog", "message": ...}`.
Resolved tables are `lru_cache`d per (kind, magnitude) and per names
tuple for the process lifetime, which the `--max-requests 100` recycling
bounds. The `astroquery` dependency goes into `requirements.in` and is
pinned by `pip-compile`; the SIMBAD interface used is the TAP-based one
(`query_objects`, `query_tap`, `add_votable_fields("V", "otype")`), which
is what current astroquery releases ship.

### D5: Astro filter endpoint - sampled windows, vectorized
`POST /api/filter-targets`, body:
```
{ "candidates": [{"name": "...", "ss_obj": false, "ra": .., "dec": ..}, ...],
  "lat": .., "lon": ..,
  "obs_window": {"min_az":..,"max_az":..,"min_alt":..,"max_alt":..},
  "windows": [{"start": "<ISO UTC>", "end": "<ISO UTC>"}, ...],
  "visibility": "window|horizon|none",
  "max_brightness": "N|AT|NT|CT|D" }
```
Response `{"matched": [true, false, ...], "count": n}`, one flag per
candidate in request order, so the frontend can zip them back onto the
candidate objects it already holds (with their magnitude and type, which
the filter neither needs nor returns). The schema validates the enums,
candidate count (≤ 2000), window count (≤ 31), window length (≤ 24 h) and
order. The endpoint never imports or calls `catalog.py`.

For each window build `Time` samples `start + k*1800 s` for `k` in
`0..floor((end-start)/1800)`, plus `end` itself if not already on the
grid. Concatenate all windows' samples into one `Time` array `T`
(≤ 31 × 49 = 1519 samples for full-day windows, ~9 per night for
22:00-02:00). Then:
- Fixed candidates: one `SkyCoord(ra[:, None], dec[:, None])` transformed
  to `AltAz(obstime=T[None, :], location=loc)`, giving `(n_obj, n_t)`
  altitude/azimuth arrays. Worst case 2000 × 1519 ≈ 3 M points, a few
  hundred MB peak inside astropy, which fits under the 1792 MiB ceiling
  with one such request per worker; the marshmallow caps are what keep it
  there.
- Solar-system candidates: `get_body` per body over `T` (≤ 9 bodies),
  same as the timeseries endpoint.
- Sun upper-limb altitude over `T` computed once per request via the
  existing `_compute_altaz("sun", ...)` + `_apparent_radius_deg`, not the
  `lru_cache`d `_sun_alt_series` (its key is a fixed grid).
Masks: `vis` from the criterion using the same strict inequalities as
`checkObsWindow` in `transitions.jsx`, `dark` from the brightness
thresholds shared with `altToBrightness` (−18/−12/−6/0). A candidate is
matched if `(vis & dark).any(axis=1)`. With no windows or `none`+`D` the
astro computation is skipped and every flag is true. The frontend builds
the `windows` list (D7) so the astro side never deals with wall-clock
times or zones.

### D6: Batched positions and fixed-object paths
- `POST /api/get-objs`: `{lat, lon, time, targets: [{name, ss_obj, ra,
  dec}]}` → `{results: [{name, alt, az, radius?, illumination?, waxing?,
  bright_limb_angle?}]}`. Fixed targets go through one vectorized
  `SkyCoord` transform; solar-system targets reuse `_compute_body` and
  `_moon_phase` per body so the values are bit-identical to
  `/api/get-obj`. Order preserved, ≤ 2000 targets.
- `/api/get-obj-timeseries` gains optional `ra`/`dec` fields; when both
  are present the target string is a label and the series comes from a
  fixed `SkyCoord`, with `sun_alt` from the cached `_sun_alt_series` as
  for planets. `/api/get-obj` is kept unchanged for the Sun and as the
  documented single-object endpoint.
Alternative: have the Go server aggregate. Rejected: the Go server does
not proxy astro calls anywhere, and would just add a hop.

### D7: Searches dialog and the evaluate-then-save flow
New `obs-ui/src/searches.jsx` exporting `SearchesDialog({open, onClose,
session, setSession})`, modelled on `PositionsDialog`:
- `useQuery(["searches"])` shared with `ObsStage`; create/update/delete
  `useMutation`s invalidate `["searches"]`; rename of the selected search
  calls `updateSession` with the new name; delete via `Popconfirm`.
- The form (antd `Form`, keyed on `editing`) has: name, `set_kind`
  radio group, `max_magnitude` `InputNumber` (shown for `messier` and
  `double_stars`, required for the latter), `names` `TextArea` (one per
  line or comma separated, split and trimmed on evaluate), start/end
  `TimePicker` (`HH:mm`), an optional `DatePicker.RangePicker` for the
  day range, `visibility` and `max_brightness` radio groups.
- Form state: `{candidates: null | {set, list, unresolved}, matches:
  null | {flags, count, position}}`. `candidates` is seeded from the
  saved search's `TargetObjects` (with `set` = the saved set fields) when
  editing, `null` when adding. An `onValuesChange` handler compares the
  new set fields (kind, magnitude, names) with `candidates.set`: if they
  differ, `candidates` becomes `null`; in every case `matches` becomes
  `null`. Save is `disabled={matches == null}`.
- Evaluate runs up to two requests in sequence. If `candidates == null`
  it posts the set to `${astroBase}/api/resolve-targets` and stores the
  returned list, unresolved names and the set it was resolved for. Then it
  posts the candidates (name, ss_obj, ra, dec only), the selected
  position's coordinates and window, the criteria and `windows` to
  `${astroBase}/api/filter-targets` and stores the flags. `windows` is
  built as follows: the base dates are the day range, or the single date
  the app shows (`stageSize.get("date") ?? today`, passed in as a prop)
  when there is none; for each date make `start = date + start_time`,
  `end = date + end_time`, adding one day to `end` when it is not after
  `start`, both as local `Date`s serialised with `toISOString()`. Errors
  (400/502 bodies, timeouts) from either request show in an `Alert` inside
  the form; a failed resolution leaves `candidates` null, a failed filter
  leaves `matches` null, so Save stays disabled.
- Save posts `{...definition, evaluated_at: now, evaluated_position:
  pos.name, candidates: list.map((c, i) => ({...c, matched: flags[i]}))}`
  to the Go server. The list shown between Evaluate and Save is a
  read-only antd `Table` of every candidate (name, type, magnitude,
  matched as a check/cross tag, matched rows first) headed "N of M match",
  with the unresolved names in a warning `Alert`. Before a filter has run
  the table shows the candidates without the matched column.
- The list view shows name, a one-line set summary ("Double stars ≤ 5.0",
  "12 names"), `N of M match`, and `evaluated_at` formatted, with the
  same Select/Edit/Delete actions as positions.
`App.jsx` gets a second header button "Search: <name>" (ellipsis-capped
like the position one) and a second `isSearchesOpen` state, and passes the
currently shown date down to the dialog.

### D8: Rendering matches on the canvas
`ObsStage` derives `targets = search.TargetObjects.filter(t => t.matched)`
(empty when there is no search); unmatched candidates never reach the
canvas or the batch request. Then:
- Markers: one `useQuery(['targetsBatch', pos.ID, pos.lat, pos.lon,
  renderTS, targetsKey])` where `targetsKey` is the joined names, posting
  the whole list to `/api/get-objs`. A `ResultMarkers` component renders
  each entry: `ObsObject` for solar-system bodies (unchanged look, moon
  phase from the batch fields), and for fixed objects a small marker by
  `object_type` (four-point star for stars including doubles, hollow
  circle for nebulae/galaxies/clusters, generic dot otherwise; radius ~4
  px in scene units). The per-target `Target` component stays for the
  Sun. The hover state gains `{type: 'target', target, ...}` reuse: the
  tooltip's alt/az now come from the batch entry, and the type/magnitude
  lines are appended for fixed objects.
- Paths: `pathTargets = targets.length <= 10 ? targets : targets.filter(t
  => hovered?.target === t.name)`; each gets a `TargetPath` whose
  `useTargetPathData` posts `ra`/`dec` for fixed objects. The threshold is
  a module constant. React Query keeps a hovered path's series cached
  (default 5-minute GC) so hovering back and forth doesn't refetch.
- `HoveredTooltip` for fixed objects needs the series for "next
  transition" lines; it uses the same `useTargetPathData` hook, which for a
  large search is the one request the hover triggers anyway.
- Fallback: a `useEffect` mirroring the position one - if
  `session.search` matches nothing and searches exist, `updateSession` to
  the first name; if none exist render the grid and the Sun only. The
  header label shows "(no search)" in that case.
- The batch query is `enabled` only when `targets.length > 0`.

### D10: Azimuth windows wrap through north
`min_az > max_az` is a window that wraps through 0°/360°: inside means
`az > min_az || az < max_az`; `min_az <= max_az` keeps the existing
`min_az < az < max_az`, and equal limits stay an empty window (an
existing valid case) rather than becoming a full circle. Strict
inequalities on both ends, as for altitude. The rule lives in exactly
one predicate per side - `azInWindow` in `transitions.jsx` (used by
`checkObsWindow`, hence by path clipping and the rise/set tooltip
lines) and `_az_in_window` in `server.py` (the filter endpoint) - and
the Go server only drops its `MinAz > MaxAz` validation; nothing
normalises the stored values. Alternative: keep min ≤ max and add a
separate "wraps" flag. Rejected: the inverted pair already says it, and
the form needs no extra control. `ObsWindowSchema` gains the 0..360 /
-90..90 ranges and the altitude ordering check the Go side has, so a
direct astro call can't slip past them.

### D9: Test strategy
- Go: `server_test.go` gains table-driven `TestTargetSearchValidate`, and
  handler tests for create (201, candidates and flags present in GET),
  invalid (400 for each enum, missing magnitude, long day range, bad
  candidate Dec), duplicate name (409), update replacing candidates (old
  rows gone from `target_objects`, unmatched rows kept with `matched`
  false), foreign update/delete (404 with the second fixture user), delete
  (204 and candidates gone), and an `InitTestData` test that seeds an
  old-style "Planets" search (no `SetKind`, no has-many candidates) into
  the SQLite fixture and asserts the backfill without duplication.
- Python: `tests/test_search.py` monkeypatches the `_simbad_*` functions
  in `catalog.py` with canned astropy `Table`s (a handful of Messier rows,
  a few doubles, a names response with a missing row) so resolution is
  exercised offline: planets need no catalog; magnitude filtering;
  unresolved names; 400 on 2001 candidates; 502 when the seam raises. The
  filter endpoint is tested with literal candidate lists and never
  touches the seam (a test asserts that with the seam raising, filtering
  still answers): the spec's scenarios (mid-window rise at a known
  lat/date, midsummer at lat 60 with `NT`, three-night match, 32 windows
  rejected, `none`+`D` shortcut, flag order preserved). `test_api.py`
  gains `get-objs` (mixed batch, order, equality with `get-obj` for
  Jupiter) and the fixed-object timeseries. One `@pytest.mark.network`
  test hits real SIMBAD for M31 and is deselected by default in
  `pytest.ini`.
- Frontend: no test runner; the spec scenarios are the manual checklist
  via `make runserver` (which needs outbound network from the astro
  container for anything but `planets`).

## Risks / Trade-offs

- [SIMBAD is a shared public service: outages, throttling, or schema
  changes break resolution] → Resolution is explicit and rare (one request
  per set change, cached per process); failures are a clear 502 in the
  form and never affect rendering of already-saved searches, which carry
  their own coordinates, nor re-filtering them with new criteria, which
  uses the stored candidates. The `_simbad_*` seam keeps schema changes
  to one file and the network test catches them.
- [Stored candidates go stale relative to the catalog] → Acceptable:
  catalog coordinates and magnitudes for these objects are effectively
  static, and changing the set (or any part of it) forces a fresh
  resolution. No refresh action is offered.
- [astroquery import cost on `--preload`] → It imports lazily inside
  `catalog.py` functions rather than at module load, so cold-start time and
  the per-worker RSS documented in CLAUDE.md are unchanged until the first
  search.
- [A 2000 × 1519 evaluation could take tens of seconds] → Astropy's
  vectorized AltAz transform handles ~3 M points in a few seconds; the
  window and candidate caps make this the worst case, and the frontend's
  120 s axios timeout already exceeds gunicorn's 60 s. If it proves too
  slow, subsample times for large candidate sets (open question below).
- [Many fixed markers every minute] → One batch request per minute
  regardless of count; the vectorized transform for 2000 objects at one
  instant is milliseconds.
- [Names in the session: renaming or deleting a search out from under the
  cookie] → Same handling as positions (rename moves selection; fallback
  to the first search; "(no search)" when none).
- [Has-many migration on the Aiven database] → AutoMigrate adds the
  nullable columns and the index; `InitTestData` backfills the only
  pre-existing search. Rollback to the previous image keeps working: the
  old code still preloads through `search_results`, which is untouched.
- [Browser-local time zone differs from the position's zone] → Same
  convention as the existing pickers; the saved `evaluated_at` and the
  wall-clock fields let the user see what was meant. Documented in the
  README entry.
- [Object type strings from SIMBAD are codes (`**`, `G`, `OpC`)] →
  `catalog.py` maps the common codes to readable labels ("Double star",
  "Galaxy", "Open cluster", …) and falls back to the raw code.

## Migration Plan

1. `pip-compile` to pin `astroquery`; rebuild the astro image (`make
   build`) so the Docker layer with requirements changes; CI installs it
   the same way.
2. Deploy backend + UI + astro together as usual. AutoMigrate adds the
   new columns and indexes; `InitTestData` backfills "Planets" on first
   start. No cookie migration: `search: "Planets"` still resolves.
3. Confirm outbound HTTPS from the astro tasks (AWS: NAT egress already
   used for Aiven by the Go task; Cloud Run: default). Nothing to change
   in `obs_ecs` or the `gcp-*` targets.
4. Rollback: redeploy the previous images. The old astro image lacks the
   new endpoints, so the old UI (bundled with the old Go image) is what
   must be rolled back with it; the extra columns and per-search rows are
   ignored by the old code.

## Open Questions

- ~~Whether large fixed-object evaluations need time subsampling~~
  Resolved by task 3.6: 2000 fixed candidates × 31 full-day windows
  (1519 samples, 3 M transforms) took 1.3 s wall and 405 MiB peak RSS in
  the Flask test client on the dev machine, so the 30-minute step stays
  and no subsampling is needed.
- Which SIMBAD object-type codes deserve their own marker shape beyond
  star / extended / other. Cosmetic; can be refined after the first use.
