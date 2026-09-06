## Why

The sky view can only ever show the seeded "Planets" search: `TargetSearch`
and `TargetObject` exist in the database and `GET /api/searches` serves
them, but nothing creates, edits, evaluates or selects a search, and the
astro backend only knows the Sun, Moon and planets. Users want to pick a
group of targets (a predefined set such as the planets or the Messier
objects, a catalog criterion such as double stars brighter than a given
magnitude, or a plain list of names), narrow it to what is actually
observable during their observing hours, save the result under a name for
later re-use and re-evaluation, and see the result on the sky canvas
(Linear OBS-14).

## What Changes

- A saved search gets a full definition instead of the unused `search_str`:
  a target set (`planets`, `messier`, `double_stars` with a maximum
  magnitude, or `names` with a user-supplied list), an observing time window
  as wall-clock start/end times (for example 22:00-02:00), an optional
  range of days (at most 31), a minimum visibility criterion (inside the
  selected position's observation window, above the horizon, or none) and a
  maximum sky brightness (night, astronomical, nautical or civil twilight,
  or day). The stored results are *every* object the set resolved to,
  before any visibility or brightness criteria are applied, with the
  coordinates, magnitude and object type needed to draw and describe them;
  each carries a flag saying whether it satisfied the criteria at some
  sampled instant in the windows when the search was last evaluated. The
  search also records when and for which position it was evaluated.
  Keeping the whole candidate list means a saved search can be reopened
  later and given new criteria or a new time period without going back to
  the catalog.
- The astro backend gains two search endpoints. A resolve endpoint turns a
  set into candidate objects (solar-system bodies from the built-in list,
  Messier objects, double stars and named objects from SIMBAD via
  `astroquery`); unresolvable names are reported back rather than silently
  dropped, and criteria that would return an unreasonable number of
  candidates are rejected with a message asking for a tighter limit. A
  filter endpoint takes a candidate list, samples the requested windows at
  30-minute steps for the given position and reports which candidates meet
  the visibility and brightness criteria at any sample. The filter never
  touches the catalog, so re-applying criteria works while SIMBAD is down.
- The astro backend also gains a batched sky-position endpoint (one
  request for all of a search's matched objects, solar-system and fixed objects
  alike) and accepts fixed RA/Dec targets on the timeseries endpoint, so
  the canvas can show a hundred-object search without a hundred requests a
  minute.
- Searches become writable on the Go backend: create, update and delete,
  scoped to the JWT user, with server-side validation of the definition and
  the submitted candidates, and a per-user unique name so the session can keep
  selecting the search by name.
- A searches dialog, opened from a new "Search: <name>" indicator in the
  header next to the position indicator: lists the user's searches, selects
  one into the session, and adds/edits/deletes them. The add/edit form
  covers the whole definition and has an explicit Evaluate step: it
  resolves the set through the catalog when the candidates are missing or
  the set has changed, then applies the criteria for the currently selected
  position, and shows every candidate with its match status (and any
  unresolved names) before the user confirms with Save. Editing only the
  criteria or time period of a saved search re-applies them to the stored
  candidates without a catalog lookup; changing the set discards the
  candidates. Changing anything after evaluating makes Save unavailable
  until the next evaluation, so a saved search always matches what it says
  it contains.
- The sky view renders the selected search's matched results: a marker for
  every matched object (planets keep their current look, fixed objects get
  a marker by object type), a tooltip with name, type and magnitude, and
  24-hour paths for every matched object when there are 10 or fewer but
  only for the hovered/tapped one in larger searches, so a Messier-sized
  search stays readable. If the session names a search the user no longer
  has, the first remaining search is selected; with no searches only the
  Sun is drawn.
- Observation windows may wrap through north: a position's maximum
  azimuth below its minimum (say 125 to 45) is accepted and means
  "azimuth above the minimum or below the maximum". Found while testing
  the search filter, which needs such windows for a horizon that is open
  to the north; the same rule is applied in the sky view's clipping, the
  tooltips' rise/set logic and the astro filter.
- `InitTestData` seeds the existing "Planets" search as a `planets` set with
  no filtering (all eight bodies matched) and backfills its definition and
  candidates on databases seeded before this change.
- **BREAKING** (API-internal): `search_str` is dropped from the search model
  and the `/api/searches` response; the search-to-object link changes from
  the `search_results` many-to-many join to a per-search ownership so a
  search's candidates are replaced as a unit. The old join table is left in
  place but unused. Nothing outside this repository reads either.
- Bump `VERSION` to 0.12.0 and add the matching README Versions entry.

## Capabilities

### New Capabilities
- `observation-target-search`: per-user saved target searches - the
  definition model and its validation, the CRUD API, the
  evaluate-then-save workflow and searches dialog, search selection
  persisted in the session, and the sky view rendering the selected
  search's matched candidates.
- `target-resolution`: the astronomy service's contract for searches -
  resolving a target set to candidate objects (solar-system list and
  SIMBAD), filtering a supplied candidate list by sampled observing
  windows against the visibility and brightness criteria, batched sky
  positions for a list of solar-system and fixed objects, and 24-hour
  paths for fixed objects.

### Modified Capabilities
- `observation-positions`: the observation window's azimuth limits may
  be given in either order - a maximum below the minimum wraps through
  north - instead of the minimum having to be at most the maximum; the
  sky view's path clipping honours such a window. The altitude rule is
  unchanged.

## Impact

- `backend/db.go`: `TargetSearch` gains the definition fields, an
  evaluation record and a per-user unique index on name; `TargetObject`
  gains magnitude, object type and a matched flag and becomes owned by one
  search.
  `InitTestData` backfills the seeded search. `backend/api.go`: new
  `POST /api/searches`, `PUT /api/searches/:id`, `DELETE /api/searches/:id`;
  `GET /api/searches` returns the new fields. `backend/server_test.go`:
  tests for validation, CRUD, cross-user isolation and candidate replacement.
- `astrobackend/server.py`, `schemas.py`: new `POST /api/resolve-targets`,
  `POST /api/filter-targets` and `POST /api/get-objs`;
  `POST /api/get-obj-timeseries` accepts
  optional `ra`/`dec`. New dependency `astroquery` (pinned via
  `requirements.in` / `pip-compile`), and a SIMBAD access layer that
  tests replace with canned tables so `make check` and CI stay offline.
  The astro containers need outbound HTTPS to SIMBAD at search time (VPC
  NAT egress on AWS, default egress on Cloud Run - nothing to configure).
- `obs-ui/src/searches.jsx` (new dialog), `App.jsx` (header indicator),
  `obs.jsx` (batched marker rendering, per-search path policy, fixed-object
  markers and tooltips, missing-search fallback), `transitions.jsx`
  (unchanged classification reused for fixed objects). No new frontend
  dependencies: `antd` already has the pickers, radio groups and lists.
- `README.md`, `VERSION`, `CLAUDE.md` (database model, frontend structure,
  astro endpoints and the SIMBAD network dependency).
- Assumptions recorded for review: the criteria language is the fixed set
  of kinds above rather than a free-form query; times are interpreted in
  the browser's local time zone, matching the existing date/time pickers;
  a search without a day range is evaluated for the single night beginning
  on the date the app is currently showing; the small-search threshold for
  always-on paths is 10 matched objects, which keeps the seeded 8-planet
  search looking as it does today; the criteria are applied in the dialog
  and the match flags saved with the search, so the sky view draws the
  stored matches rather than re-filtering on every date change.
