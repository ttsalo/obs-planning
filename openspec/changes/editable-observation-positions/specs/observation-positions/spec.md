## Purpose

Per-user observation positions: named geographic locations with an alt/az
observation window that the user can create, edit, delete and select, and
which the sky view renders its targets and paths from.

## ADDED Requirements

### Requirement: Position data model
A position SHALL consist of a name, a latitude in degrees (-90 to 90), a
longitude in degrees (-180 to 180), and an observation window given as
minimum and maximum azimuth (0 to 360) and minimum and maximum altitude (-90
to 90), where each minimum MUST NOT exceed its maximum. The name MUST be
non-empty and MUST be unique among a single user's positions. Positions
belong to exactly one user and are never visible to other users.

#### Scenario: Valid position accepted
- **WHEN** a position is submitted with name "Kuusamo", lat 65.96, lon 29.19,
  az 0..360 and alt 0..90
- **THEN** the position is stored with exactly those values

#### Scenario: Out-of-range coordinate rejected
- **WHEN** a position is submitted with latitude 95
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Inverted window rejected
- **WHEN** a position is submitted with min_alt 40 and max_alt 20
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Empty name rejected
- **WHEN** a position is submitted with an empty or whitespace-only name
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Duplicate name for the same user rejected
- **WHEN** a user who already has a position named "Helsinki" submits another
  position named "Helsinki"
- **THEN** the request is rejected as a conflict and nothing is stored

#### Scenario: Same name allowed for different users
- **WHEN** two different users each create a position named "Home"
- **THEN** both are stored and each user sees only their own

### Requirement: Listing positions
The system SHALL return the authenticated user's positions, each with its
identifier, name, coordinates and observation window, and MUST NOT include
positions belonging to other users.

#### Scenario: List own positions
- **WHEN** an authenticated user requests their positions
- **THEN** every position they own is returned with id, name, lat, lon,
  min_az, max_az, min_alt, max_alt, and no other user's positions appear

### Requirement: Creating positions
An authenticated user SHALL be able to create a new position. On success the
created position, including its assigned identifier, is returned.

#### Scenario: Create a position
- **WHEN** an authenticated user submits a valid new position
- **THEN** the position is stored as belonging to that user and returned with
  a non-zero identifier, and it appears in the user's subsequent listing

### Requirement: Editing positions
An authenticated user SHALL be able to update the name, coordinates and
observation window of a position they own. Updates are subject to the same
validation and uniqueness rules as creation. A position that does not exist
or belongs to another user MUST be reported as not found, without revealing
whether it exists.

#### Scenario: Edit own position
- **WHEN** an authenticated user updates their position with new valid values
- **THEN** the stored position reflects the new values and the updated
  position is returned

#### Scenario: Edit another user's position
- **WHEN** an authenticated user attempts to update a position owned by a
  different user
- **THEN** the request is rejected as not found and the position is unchanged

#### Scenario: Rename to an existing name
- **WHEN** a user renames a position to the name of another position they
  already own
- **THEN** the request is rejected as a conflict and the position is unchanged

### Requirement: Deleting positions
An authenticated user SHALL be able to delete a position they own, except
that the user's last remaining position MUST NOT be deletable. A position
that does not exist or belongs to another user MUST be reported as not found.

#### Scenario: Delete one of several positions
- **WHEN** a user who owns two or more positions deletes one of them
- **THEN** the position no longer appears in their listing

#### Scenario: Delete the last position
- **WHEN** a user who owns exactly one position attempts to delete it
- **THEN** the request is rejected as a conflict and the position remains

#### Scenario: Delete another user's position
- **WHEN** an authenticated user attempts to delete a position owned by a
  different user
- **THEN** the request is rejected as not found and the position remains

### Requirement: Selected position is shown in the top bar
The application header SHALL display the name of the currently selected
position in place of the previous latitude, longitude and target read-outs,
and activating it SHALL open the positions dialog.

#### Scenario: Header shows selected position
- **WHEN** the session's selected position is "Helsinki"
- **THEN** the header shows "Helsinki" as the current position and no
  latitude, longitude or target values

#### Scenario: Open the positions dialog
- **WHEN** the user activates the position indicator in the header
- **THEN** the positions dialog opens

### Requirement: Positions dialog
The positions dialog SHALL list all of the user's positions with their name,
latitude and longitude, indicate which one is selected, and offer add, edit
and delete actions. Selecting a position SHALL persist the choice in the
session so it survives a page reload. The add and edit forms SHALL cover
name, latitude, longitude and the min/max azimuth and altitude window,
default the window to the full sky (az 0..360, alt 0..90) for new positions,
and show the server's validation or conflict message to the user without
closing the form.

#### Scenario: Select a position
- **WHEN** the user selects a different position in the dialog
- **THEN** the header indicator changes to that position's name, the sky view
  re-renders from that position, and after a page reload the same position is
  still selected

#### Scenario: Add a position
- **WHEN** the user fills in the add form with valid values and confirms
- **THEN** the new position appears in the list

#### Scenario: Edit a position
- **WHEN** the user edits an existing position's values and confirms
- **THEN** the list shows the updated values, and if the edited position is
  the selected one the sky view re-renders from the new coordinates

#### Scenario: Delete a position after confirmation
- **WHEN** the user deletes a position and confirms the deletion prompt
- **THEN** the position disappears from the list

#### Scenario: Delete is unavailable for the only position
- **WHEN** the user has exactly one position
- **THEN** its delete action is disabled

#### Scenario: Server rejects the form
- **WHEN** the user submits a name that duplicates another of their positions
- **THEN** the form stays open and shows the rejection message

### Requirement: Sky view follows the selected position
The sky view SHALL compute target markers and 24-hour paths for the selected
position's latitude and longitude and clip paths to that position's
observation window. Changing the selected position, or the coordinates of
the selected position, SHALL cause the markers and paths to be recomputed
rather than served from data computed for a different position.

#### Scenario: Switching position recomputes the view
- **WHEN** the selected position changes from Helsinki to a position on the
  other side of the globe
- **THEN** the markers and paths shown correspond to the new coordinates

#### Scenario: Observation window clips paths
- **WHEN** the selected position has max_alt 45
- **THEN** non-Sun target paths are not drawn above 45 degrees altitude

### Requirement: Missing selected position falls back
If the session's selected position does not match any of the user's
positions, the application SHALL select the user's first position, persist
that selection in the session, and render from it.

#### Scenario: Selected position was deleted
- **WHEN** the session names a position the user no longer has and the user
  has at least one other position
- **THEN** the first remaining position becomes selected, the header shows
  its name and the sky view renders from it

#### Scenario: Fresh session for a user without the default position
- **WHEN** a new session defaults to "Helsinki" but the user owns no position
  by that name
- **THEN** the user's first position becomes selected
