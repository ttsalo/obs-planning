## 1. Backend: data model and validation

- [x] 1.1 Add a composite unique index on `(user_id, name)` to `Position` in `backend/db.go` via GORM `uniqueIndex` tags; verify `go test` still passes (SQLite AutoMigrate creates the index) and `InitTestData` still seeds Helsinki idempotently.
- [x] 1.2 Add `func (p *Position) Validate() error` in `backend/db.go` covering non-empty trimmed name, lat -90..90, lon -180..180, az 0..360, alt -90..90 and min<=max for both axes; verify with a table-driven `TestPositionValidate` in `backend/server_test.go`.

## 2. Backend: positions CRUD endpoints

- [x] 2.1 Add a helper in `backend/api.go` that resolves the JWT user row (shared by the existing `positions`/`searches` handlers and the new ones) so the user lookup is not duplicated four times; verify existing `TestPositions` and `TestSearches` still pass.
- [x] 2.2 Implement `POST /api/positions` (`h.createPosition`): bind body, force `UserID` from the JWT user, `Validate()` → 400, duplicate-name pre-check → 409, create → 201 with the row; register in `RegisterDBEndpoints`. Verify with `TestCreatePosition` (201 + non-zero ID, appears in GET) and `TestCreatePositionInvalid` (400) and `TestCreatePositionDuplicate` (409).
- [x] 2.3 Implement `PUT /api/positions/:id` (`h.updatePosition`): load with `WHERE id = ? AND user_id = ?` → 404 if missing, copy only the seven editable fields, `Validate()` → 400, duplicate-name pre-check excluding own id → 409, save → 200. Verify with `TestUpdatePosition`, `TestUpdatePositionForeign` (second user in fixture, 404), `TestUpdatePositionRenameConflict` (409).
- [x] 2.4 Implement `DELETE /api/positions/:id` (`h.deletePosition`): ownership-scoped load → 404, count user's positions and refuse the last one → 409, delete → 204. Verify with `TestDeletePosition` (create second, delete it, 204, gone from GET) and `TestDeleteLastPosition` (409) and `TestDeletePositionForeign` (404).
- [x] 2.5 Add a second user to the test fixture in `backend/server_test.go` and make `testUsernameFromJWT` switchable (e.g. via the package-level `u`) so the foreign-position tests can act as that user; verify `cd backend && go test -v` passes with all new and existing tests green and each test cleans up rows it created.

## 3. Frontend: positions dialog

- [x] 3.1 Create `obs-ui/src/positions.jsx` exporting `PositionsDialog({open, onClose, session, setSession})` with `useQuery(["positions"])`, an antd `Modal`, and a list of positions showing name, lat, lon and a marker for the selected one; verify `npm run build` succeeds and the dialog opens from a temporary button.
- [x] 3.2 Add selection: clicking a row (or its Select button) calls `updateSession` with the full session object and the new `position` name; verify the header indicator changes and the selection survives a page reload.
- [x] 3.3 Add the add/edit `Form` (name, lat, lon, min_az, max_az, min_alt, max_alt with `InputNumber` ranges matching the server), defaults for new positions (0/360/0/90), and create/update `useMutation`s that invalidate `["positions"]` on success and display 400/409 response text inside the form without closing it; verify by adding a position, editing it, and submitting a duplicate name (message shown, form stays open).
- [x] 3.4 On successful edit, if the old name equals `session.position`, call `updateSession` with the new name; verify renaming the selected position keeps it selected and the header updates.
- [x] 3.5 Add delete with antd `Popconfirm`, a delete `useMutation` invalidating `["positions"]`, and the button disabled when only one position exists; verify deleting a non-selected position removes it from the list and the last position's delete button is disabled.

## 4. Frontend: header and sky view integration

- [x] 4.1 In `obs-ui/src/App.jsx` remove `SetDialog` and the Lat/Lon/Target `Space.Compact` blocks and the now-unused imports; render a clickable "Position: <session.position>" element (ellipsis-capped) that opens `PositionsDialog`; verify the header shows the name, no lat/lon/target, and clicking opens the dialog.
- [x] 4.2 In `obs-ui/src/obs.jsx` add `pos.ID`, `pos.lat`, `pos.lon` to the `useTargetPathData` and `useTargetPosition` query keys; verify by switching between two positions with very different longitudes that the Sun and planet paths visibly move and the network tab shows new astro requests, while the per-minute tick still does not refetch paths.
- [x] 4.3 In `ObsStage` add the missing-position fallback: when `session.position` matches nothing and positions exist, `updateSession` to the first position (guarded against re-firing while in flight) and render nothing for that frame; when no positions exist render only `CoordGrid`. Verify by deleting the selected position via the dialog (view switches to the first remaining one) and by setting the cookie's position to a bogus name (recovers to the first position).
- [x] 4.4 Confirm `TargetPath` clipping uses the selected position's window: edit the selected position to `max_alt` 45 and verify non-Sun paths stop at 45° without a page reload.

## 5. Verification, docs and version

- [x] 5.1 Run `make check` (UI build, `go test -v`, pytest) and verify all three suites pass.
- [x] 5.2 Run `make runserver` against an existing local Postgres volume and verify startup logs show AutoMigrate adding the unique index without error, then walk through every scenario in `specs/observation-positions/spec.md` as a manual checklist.
- [x] 5.3 Bump `VERSION` to 0.11.0, add a matching `### 0.11.0` entry to the README Versions section describing the positions dialog and the new endpoints, and update the CLAUDE.md "Auth and session" / "Frontend structure" notes to mention `positions.jsx` and the CRUD endpoints; verify the three files agree on the version and the described behavior.
