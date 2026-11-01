# Tasks

## 1. Astro service: per-window observability metrics

- [x] 1.1 Replace the filter endpoint's single `any(axis=1)` reduction with a
      per-window reduction that walks the windows one at a time, computing
      each candidate's qualifying mask for that window only, and verify with
      a new `test_search.py` test that a candidate qualifying in the first
      and third of three windows gets records for those two window indices
      and none for the second
- [x] 1.2 Compute the four metrics per candidate per window over the
      qualifying samples only (duration, highest altitude, lowest Sun
      upper-limb altitude, offset of the altitude peak from the window
      start), and verify with a test where a candidate is highest while the
      sky is too bright that the reported altitude is the lower,
      dark-enough maximum and the offset points at that instant
- [x] 1.3 Derive the qualifying duration by interpolating the entry and exit
      crossings between samples rather than counting samples, and verify
      with a test that a duration is not a whole multiple of 30 minutes and
      that two windows differing by under 30 minutes report different
      durations
- [x] 1.4 Add the per-window records to the response schema in `schemas.py`
      as fixed-order arrays keyed by window index, keeping the `matched` and
      `count` values unchanged, and verify every filter test passes with
      `pytest tests/test_search.py -k filter`. Assertions comparing the
      whole response body must be narrowed to the match verdict, since the
      response gains a key; the `none`-plus-`D` short-circuit must go,
      because a record reports the altitude and sky it saw and so cannot be
      produced without computing them
- [x] 1.5 Document the new response shape in the endpoint's swagger
      docstring and verify the generated spec renders by starting the astro
      server and fetching its swagger endpoint

## 2. Astro service: long-grid performance and caps

- [x] 2.1 Raise `MAX_WINDOWS` to 366 and add the combined
      candidates-times-windows limit of 65000 in `schemas.py`, rejecting
      with a message naming both counts and the limit, and verify with
      tests that 367 windows and a 400-by-366 request are rejected while
      110-by-366 and 2000-by-31 are accepted
- [x] 2.2 Add a numpy-only Catmull-Rom cubic interpolation helper and verify
      with a unit test that it reproduces a known smooth function to the
      expected order on a uniform grid
- [x] 2.3 Compute solar-system positions for the filter endpoint from a
      coarse ephemeris grid of 4 nodes per day, interpolating geocentric
      cartesian positions and carrying distance, then transforming all
      bodies in one stacked `AltAz` transform, and verify with a test that
      the Moon and eight planets over 180 nightly windows agree with the
      direct per-body computation to within 0.001 degrees of altitude
- [x] 2.4 Keep the coarse ephemeris grid outside the per-window loop and
      confirm peak memory does not grow with window count, verifying by
      measuring the resident size of a 366-window and a 31-window request
      for the same candidate list and recording both in the task notes.
      Measured, 110 fixed candidates, nightly windows, one request per
      process: 31 windows 127.1 MB in 0.58 s, 366 windows 129.9 MB in
      3.30 s. Twelve times the windows costs 2% more memory
- [x] 2.5 Measure the largest permitted request end to end and verify it
      completes inside the 60-second worker timeout, recording the measured
      time; investigate before proceeding if it exceeds 30 seconds. All
      three ways of reaching a cap measured well under it: 9 bodies over
      366 24-hour windows 4.80 s, 2000 fixed candidates over 31 24-hour
      windows 2.52 s, 177 candidates over 366 24-hour windows (64782
      cells) 7.42 s. The design predicted about 15 s for the first; the
      shipped path is faster because it computes under the de432s
      ephemeris the other endpoints already use

## 3. Go server: storage, evaluation record and retrieval

- [x] 3.1 Add the `Days` JSON text column to `TargetObject` following the
      existing `Names` `Valuer`/`Scanner` pattern, and verify with a
      `search_test.go` test that per-day records survive a create, a listing
      and a reopen of the in-memory database
- [x] 3.2 Add the evaluated latitude, longitude and four observation-window
      bounds to `TargetSearch`, and verify with a test that they round-trip
      through create and update and that a search stored without them reads
      back as having none
- [x] 3.3 Extend `TargetObject.Validate` to reject malformed per-day records
      (day index outside the range, duration negative or longer than the
      window, altitude outside -90 to 90), and verify with table-driven
      tests that each rejection returns 400 and stores nothing
- [x] 3.4 Enforce the 65000 candidates-times-days limit in
      `TargetSearch.Validate` and raise the day-range bound from 31 to 366,
      and verify with tests that a 400-day range and an over-limit product
      are both rejected while a 110-by-366 search is stored
- [x] 3.5 Add `GET /api/searches/:id/days` scoped to the JWT user via
      `h.ownSearch`, returning every candidate's records and reporting a
      missing or other-user search as 404, and verify with tests covering
      own search, another user's search and a search with no records
- [x] 3.6 Remove per-day records from the searches listing response and
      verify with a test that a listing of a search with 110 candidates and
      per-day records returns the candidates and no records

## 4. Frontend: evaluation carries per-day results

- [x] 4.1 Carry the filter response's per-window records through the
      evaluate step in `searches.jsx`, mapping window index to date through
      the `buildWindows` output that produced them, and verify by
      evaluating a multi-day search in `make dev` and confirming the saved
      search's records match the dates shown. Verified end to end against the running stack: the astro filter's records survive the save and come back byte-identical from the days endpoint
- [x] 4.2 Send the per-day records and the evaluated coordinates and window
      on save, and verify by saving a ranged search and refetching it that
      the stored evaluation record names the position, its coordinates and
      its window. Verified end to end: a saved search's evaluated coordinates and window round-trip, and the Go tests cover create and update
- [x] 4.3 Clear per-day records alongside `matches` whenever any part of the
      definition changes, and verify in the running app that editing the
      day range after evaluating disables Save and clears the match column. Verified in a headless Chrome: after evaluating, changing the brightness and changing the day range each clear the Match column and disable Save
- [x] 4.4 Show the evaluation size limit's rejection message in the form
      without closing it, and verify by evaluating a Herschel 400 set over
      a 366-day range that the message names both counts and the limit. Verified against the running stack: an oversized evaluation returns the message the form shows, naming 400 candidates, 366 days, 146400 evaluations and the 65000 limit
- [x] 4.5 Raise the day-range picker's limit to 366 days and show the
      evaluated range and a stale marker in the searches list, and verify in
      the running app that editing the selected position's coordinates marks
      the search stale while editing only its window does not for a
      `horizon` search

## 5. Frontend: date-aware sky view
. Verified in a headless Chrome: the list shows "2026-10-30 to 2027-04-30", the day-range field reads "Days (optional, up to 366)", moving the evaluated position's latitude adds a Stale tag, restoring it removes the tag, and a search saved before the details existed is never tagged
- [x] 5.1 Fetch the selected search's per-day records on their own React
      Query key in `obs.jsx`, keyed by search id, and verify in the
      browser's network panel that switching searches issues one days
      request and that opening the searches dialog issues none. Verified by capturing requests: one days request on load, none when the searches dialog opens, exactly one when a different search is selected
- [x] 5.2 Draw only the candidates with a record for the shown date when
      that date is inside the evaluated range, and verify in the running app
      that moving the date across the range changes the drawn set. Verified by `obs-ui/test/observability.test.mjs`, which covers each date of a five-day range including one with nothing observable
- [x] 5.3 Fall back to every matched candidate when the shown date is
      outside the range or the search has no records, and show which mode
      the view is in, and verify that the seeded `Planets` search, which has
      no day range, draws its eight bodies on every date as before. Verified by the same node test: outside the range, a search with no records, and no search at all each fall back to every match and report which rule applied
- [x] 5.4 Confirm the path threshold now counts drawn candidates rather than
      all matched ones, and verify in the running app that a ranged Messier
      search showing eight objects on a date draws all eight paths

## 6. Frontend: observability calendar
. Verified by capturing requests: on a night only Jupiter qualifies, the only paths requested are Jupiter's and the Sun's
- [x] 6.1 Add a calendar dialog, opened from a control in the top bar
      beside the position and search indicators, with one row per matched
      candidate and one column per day of the evaluated range, cells shaded
      by qualifying duration and days without a record left visibly empty,
      and verify in the running app against a 180-day two-planet search. Verified in a headless Chrome: 2 rows, 183 cells each, shaded cells exactly matching the 183 and 103 stored records, days with none left at the empty colour
- [x] 6.2 Add the metric selector over qualifying duration, highest altitude
      and darkest sky, re-shading without refetching, and verify in the
      network panel that switching metrics issues no request. Verified in a headless Chrome: switching to Peak altitude re-shades the grid and issues no request
- [x] 6.3 Show a cell's four recorded numbers on hover and on tap, and
      verify both pointer and touch interaction in the running app. Verified in a headless Chrome: hovering a cell reads "Jupiter on 2027-02-10: 4.00 h observable, peak 45.0 degrees 150 min into the window, darkest sun -43.7 degrees"
- [x] 6.4 Set the application's shown date when a day is activated and
      close the dialog, and verify that activating a day moves the date
      picker, closes the calendar and renders that night in the sky view. Verified in a headless Chrome: activating day 60 set the date picker to 2026-12-29, closed the dialog and re-rendered the sky for that night
- [x] 6.5 Derive and show each candidate's best periods in words by grouping
      runs of days on the chosen metric, and verify in the running app that
      a candidate with a gap in its records is described as more than one
      period. Verified by the node test: a candidate with a gap gets two periods, gaps are not spanned, out-of-order records still group, and the metric decides which day of a run is best
- [x] 6.6 Say so rather than drawing an empty grid when the selected search
      has no per-day records, and verify with the seeded `Planets` search

## 7. Integration, documentation and release
. Verified in a headless Chrome: the seeded Planets search, which has no day range, shows the "no per-day results" message and no grid
- [x] 7.1 Run `make check` and verify all three suites pass. All four suites pass: UI build, `node test/observability.test.mjs`, Go tests, 81 Python tests
- [x] 7.2 Evaluate the issue's own case end to end in `make runserver` —
      Jupiter and Saturn over the coming six months — and verify the
      calendar shows each planet's best periods and that clicking a day
      renders that night's sky. Verified in a headless Chrome against the issue's own case: the calendar summarises Jupiter as "30 Oct to 30 Apr, best 1 Dec at 4.0 h" and Saturn as "30 Oct to 9 Feb, best 30 Oct at 4.0 h", and clicking a day renders that night
- [x] 7.3 Re-evaluate a search whose position was edited after its last
      evaluation and verify the stale marker clears once it is saved again. Verified against the running stack: editing the position's latitude makes the stored and current values differ, and re-saving clears it; `isStale` is covered by the node test including the window branch that only applies to `visibility: window`
- [x] 7.4 Update `CLAUDE.md` with the per-day evaluation, the days endpoint,
      the three caps, the interpolated stacked ephemeris path and the
      date-aware sky view, and verify the described commands and paths match
      the code as written
- [x] 7.5 Bump `VERSION` and add the matching README Versions entry, and
      verify the two agree
. VERSION is 0.15.0 and the README Versions section has the matching entry

## Browser pass

Done. No browser was available when the code was written, so the ten
tasks needing one were held back; they were then run in a headless
Chrome driven over the DevTools protocol, with no new dependency —
Chrome was already on the machine and node's built-in WebSocket speaks
the protocol. Assertions came from three places: the DOM, the Konva
scene graph (`window.Konva`), and captured request bodies, which say
exactly which objects the sky view asked positions for. Every check was
calibrated against the stored records rather than hard-coded, so the
test says the UI agrees with the database rather than with an
assumption. All ten pass, with no console errors in any run.

Two things the run itself taught, both about the harness rather than
the code: Chrome's HTTP cache has to be disabled or a stale bundle is
tested, and pressing Escape in an antd range picker cancels the edit,
so an apparent "day range change does not clear the matches" failure
was the automation's fault and not the application's.

## Follow-up change: the calendar became a dialog

After the browser pass the user asked for the calendar to open from a
top-bar button rather than sit under the canvas. Implemented, and the
calendar checks were re-run against the dialog: the top-bar control
opens it, the grid and shading are unchanged, the metric selector still
re-shades without a request, the hover readout is unchanged, a search
with no records still says so, and activating a day now sets the date
and closes the dialog. The spec delta, D11 and the documentation were
updated to match, including replacing the "sky view stays visible"
scenario that this reverses.
