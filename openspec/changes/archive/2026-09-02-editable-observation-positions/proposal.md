## Why

Observation positions (lat/lon plus the visible alt/az window) are already
modelled per user in the database and served read-only by `GET /api/positions`,
but the user has no way to create, edit, delete or switch between them: the
session always points at the seeded "Helsinki" position and the top bar's
"Set" dialog edits `lat`/`lon`/`target` session fields that nothing reads.
Finishing this loop is the prerequisite for the app being useful anywhere other
than the demo location (Linear OBS-13).

## What Changes

- Add write endpoints for positions on the Go backend: create, update and
  delete, all scoped to the JWT user, with server-side validation of the
  coordinates and observation window and a per-user unique-name rule.
- Replace the top bar's `Lat:` / `Lon:` / `Target:` read-outs and the "Set"
  dialog with a single indicator showing the currently selected position by
  name, which opens a positions dialog.
- New positions dialog: lists the user's positions, lets the user select one
  (persisted via the existing session mechanism), and add / edit / delete
  positions through an inline form covering name, lat, lon and the
  min/max az/alt observation window.
- The sky view follows the selected position: the target markers and paths
  re-fetch when the selected position (or its coordinates) changes, and the
  observation-window clipping uses the selected position's limits.
- Self-healing selection: if the session names a position the user no longer
  has (deleted, renamed, or the hard-coded "Helsinki" default for a user
  without one), the UI falls back to the user's first position and updates
  the session.
- **BREAKING** (frontend-internal only): the unused `lat`, `lon` and `target`
  session fields written by the old "Set" dialog are dropped from the UI. The
  server-side `Session` struct never had them, so no cookie format changes.
- Bump `VERSION` to 0.11.0 and add the matching README Versions entry.

## Capabilities

### New Capabilities
- `observation-positions`: per-user observation positions - the CRUD API, the
  top-bar indicator and positions dialog, position selection persisted in the
  session, and the sky view rendering from the selected position.

### Modified Capabilities

(none - there are no existing specs under `openspec/specs/`)

## Impact

- `backend/api.go`: new `POST /api/positions`, `PUT /api/positions/:id`,
  `DELETE /api/positions/:id` handlers registered in `RegisterDBEndpoints`;
  `backend/db.go` gains a per-user unique index on position name (GORM
  AutoMigrate picks it up on next startup, on both local Postgres and Aiven).
- `backend/server_test.go`: new tests for create/update/delete, validation
  errors, and cross-user isolation, using the existing in-memory SQLite +
  `testUsernameFromJWT` harness.
- `obs-ui/src/App.jsx`: top bar and dialog replaced; new
  `obs-ui/src/positions.jsx` component for the dialog and its React Query
  mutations.
- `obs-ui/src/obs.jsx`: query keys for `/api/get-obj` and
  `/api/get-obj-timeseries` gain the position identity so switching position
  re-fetches; fallback when the session position is missing.
- No astrobackend, CDK, Cloud Run or dependency changes. `antd`, `axios` and
  `@tanstack/react-query` already provide everything the dialog needs.
- Assumptions recorded for review: the session keeps identifying the position
  by name (cookie format unchanged), names are unique per user, and the last
  remaining position cannot be deleted so the sky view always has a location.
