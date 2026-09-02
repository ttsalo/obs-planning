## Context

See proposal.md - Why. Relevant current state:

- `Position` (backend/db.go) already has every field we need. `GET
  /api/positions` (backend/api.go) already filters by the JWT user via
  `h.UsernameFromJWT` and the tests exercise it through the in-memory
  SQLite harness in `backend/server_test.go`.
- The session cookie stores the selected position as a *name* string
  (`Session.Position`), defaulting to `"Helsinki"` in
  `makeNewSessionCookie`. `ObsStage` (obs-ui/src/obs.jsx) resolves it with
  `posQ.data.find(i => i.name == session.position)` and passes the resulting
  `pos` object to every `Target`/`TargetPath`.
- The astro fetch hooks key their React Query cache on
  `['targetPathData', target, <30-min bin>]` and `['targetData', target,
  renderTS]` - the position is *not* part of the key, so today a position
  change would silently reuse data computed for the old coordinates.
- The top bar's `SetDialog` in App.jsx writes `lat`/`lon`/`target` into the
  session; the Go `Session` struct has no such fields, so they are dropped on
  the round trip and nothing consumes them.
- Frontend stack is React 19 + antd 5 + TanStack Query 5 + axios; no new
  dependencies are wanted.

## Goals / Non-Goals

**Goals:**
- Complete CRUD for positions with the ownership and validation rules in the
  spec, testable through the existing Go test harness.
- Position selection that is persisted through the existing session
  mechanism and self-heals when the named position disappears.
- Correct cache invalidation so the sky view never shows another position's
  data.

**Non-Goals:**
- Searches/targets management (the old dialog's `target` field). The session
  keeps `search = "Planets"`; a searches dialog is a separate change.
- Changing the session cookie format or moving session state into the DB.
- Map-based or geocoded position entry; numeric lat/lon fields are enough.
- Rendering a partial sky for a restricted observation window (the stage
  stays full-sky; the window only clips paths, as today).

## Decisions

### D1: Session keeps identifying the position by name
Alternative: store the position ID in the session. Rejected because it would
change the cookie payload and `makeNewSessionCookie`'s default, and the
frontend already resolves by name. Consequences handled instead:
- Names are made unique per user (composite unique index
  `idx_positions_user_name` on `(user_id, name)`, declared via GORM tags so
  AutoMigrate creates it). The Go handler additionally pre-checks for a
  duplicate and returns 409 so the message is deterministic across
  Postgres/SQLite instead of relying on driver error parsing.
- Renaming the selected position: the dialog's edit mutation compares the
  old name to `session.position` and, if they match, calls `updateSession`
  with the new name after the PUT succeeds.
- Deleting/renaming out from under the session: covered by the fallback in
  D5, so the server never needs to know which position is selected.

### D2: REST shape and status codes
- `POST /api/positions` → 201 + created position (with `ID`).
- `PUT /api/positions/:id` → 200 + updated position. Full replacement of the
  editable fields (name, lat, lon, min_az, max_az, min_alt, max_alt); `ID`,
  `UserID` from the path/JWT are authoritative and any values in the body are
  ignored.
- `DELETE /api/positions/:id` → 204.
- 400 for validation failures (range, min>max, empty name, non-numeric id),
  404 when the id does not exist *or* belongs to another user (single query
  `WHERE id = ? AND user_id = ?` so the two cases are indistinguishable), 409
  for duplicate name and for deleting the last position.
- Validation lives in one `func (p *Position) Validate() error` used by both
  create and update, so the rules cannot drift.
- Alternative considered: PATCH with partial updates. Rejected - the form
  always has all fields, and full PUT keeps validation trivial.

### D3: Last position is not deletable (server-enforced)
The sky view is unrenderable without a position and the session default
assumes one exists. Enforcing it server-side (count positions for the user
inside the delete handler; 409 if it is 1) means the UI's disabled delete
button is a convenience, not the only guard. Alternative: allow zero
positions and render an empty stage with a "create a position" prompt.
Rejected for scope; can be revisited if account creation ever starts users
with zero positions.

### D4: Dialog component and data flow
New `obs-ui/src/positions.jsx` exporting `PositionsDialog({open, onClose,
session, setSession})`. It owns:
- `useQuery(["positions"])` - same key `ObsStage` uses, so both share one
  cache entry and one refetch.
- Three `useMutation`s (create/update/delete) whose `onSuccess` calls
  `queryClient.invalidateQueries({queryKey: ["positions"]})`; the dialog
  list and the sky view update from the same refetch.
- Local UI state: `editing` = `null | "new" | <position id>`. One antd
  `Form` renders for both add and edit, seeded from the position being
  edited or from defaults `{min_az: 0, max_az: 360, min_alt: 0, max_alt:
  90}`. Server 400/409 messages are surfaced with `form.setFields` /
  an antd `Alert` inside the form rather than closing it.
- Selection: an antd `List`/`Table` row click (or a "Select" button) calls
  `updateSession(session, setSession, {...session, position: name})`.
  `updateSession` posts the *whole* session because `updateSession` on the
  server overwrites all three fields from the body; the current
  `SetDialog` gets this wrong and would blank `username`/`search`.
- Delete uses antd `Popconfirm`; the button is `disabled` when
  `positions.length <= 1`.
`App.jsx` keeps only `isModalOpen` state and renders `PositionsDialog`,
replacing the `SetDialog` and the Lat/Lon/Target `Space.Compact` blocks with
one clickable "Position: <name>" element. The wrapping `ConfigProvider` with
`colorText: 'black'` from the old dialog is kept so modal text is legible
against the dark header theme.

### D5: Fallback when the selected position is missing
In `ObsStage`, after both queries resolve: if `find` returns `undefined` and
`posQ.data.length > 0`, call `updateSession(... position: posQ.data[0].name)`
from a `useEffect` keyed on `[session?.position, posQ.data]` and render
nothing for that frame. Doing it in the frontend (rather than having
`getSession` consult the DB) keeps the session endpoints DB-free, which
matters because they are registered before the DB is up (see CLAUDE.md
startup ordering). The effect guards against firing while an update is
already in flight so it cannot loop. If the user has zero positions (should
not happen given D3, but a fresh DB user could) it renders the empty
`CoordGrid` and the header shows "(no position)".

### D6: Position identity in astro query keys
Add `pos.ID` *and* `pos.lat, pos.lon` to both `useTargetPathData` and
`useTargetPosition` keys. ID alone is not enough because editing the
selected position's coordinates keeps the ID; lat/lon alone would be
enough for correctness but the ID keeps distinct same-coordinate positions
from sharing entries, which is harmless either way. The 30-minute binning of
`renderTS` is unchanged so the per-minute tick still does not refetch paths.
Because the astro requests only use lat/lon (the window is applied
client-side in `TargetPath`), editing only the window needs no refetch - the
new `pos` prop re-renders the clipping.

### D7: Test strategy
Go: extend `server_test.go` with table-style tests hitting the handlers
directly, as `TestPositions` does. Routes with `:id` need
`c.SetParamNames("id"); c.SetParamValues(...)` on the test context. Add a
second user to the SQLite fixture to prove the 404-for-foreign-position
rule; the create/rename-conflict tests exercise the 409 path; a delete test
creates a second position first, deletes it, then asserts the last-position
409. Because `sqlite_db` is a package-level singleton shared across tests,
each test cleans up the rows it created.
Frontend: no test runner exists (`npm run build` is the check), so the
dialog is verified manually via `make runserver`; the spec scenarios are the
manual checklist.

## Risks / Trade-offs

- [Unique index migration fails if existing data already has duplicate names
  per user] → Only `InitTestData` has ever inserted positions and it inserts
  one per user, so no live DB can have duplicates. Note it in the README
  version entry anyway.
- [`AutoMigrate` on Postgres does not add a unique index declared via
  `uniqueIndex` tag to an existing table] → GORM does create missing indexes
  on AutoMigrate; verify on the local Postgres (`make runserver` against a
  pre-existing volume) before the Cloud Run deploy.
- [Race between the fallback `updateSession` and a user click in the
  dialog] → The fallback only fires when the current name resolves to
  nothing; a user click always sets a name that exists. Worst case is one
  extra `/api/update-session` round trip.
- [`PUT` body with `ID`/`UserID` set to someone else's values] → Handler
  copies only the seven editable fields onto the row loaded with the
  ownership-scoped query; body ids are never trusted.
- [Header width: long position names] → Cap with antd `Typography.Text
  ellipsis` and a `maxWidth`; full name visible in the dialog.

## Migration Plan

1. Deploy backend + UI together as usual (`make build`; the Go image embeds
   the UI). AutoMigrate adds the unique index on first start.
2. No cookie migration: existing cookies keep `position: "Helsinki"`, which
   still resolves for the seeded user; for anyone else D5 self-heals.
3. Rollback: redeploy the previous image. The extra index is harmless to the
   old code; positions created by the new UI remain and are listed by the old
   `GET /api/positions`.
