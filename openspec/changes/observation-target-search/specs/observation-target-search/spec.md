## Purpose

Per-user saved target searches: a named definition of which objects to
observe, when, and under what visibility and sky-brightness conditions,
evaluated into a stored list of matching objects that the user can select
into the session and see on the sky view.

## ADDED Requirements

### Requirement: Search definition
A search SHALL consist of a name, a target set, an observing time window,
an optional day range, a visibility criterion and a maximum sky brightness.
The target set MUST be one of: `planets` (the Sun-system bodies the sky
view already knows: Mercury, Venus, Moon, Mars, Jupiter, Saturn, Uranus,
Neptune), `messier` (the 110 Messier objects, optionally limited to those
at or brighter than a maximum visual magnitude), `double_stars` (double or
multiple stars at or brighter than a maximum visual magnitude, which MUST
be given), or `names` (a non-empty list of object names, each non-empty
after trimming). The time window is a start and an end wall-clock time in
`HH:MM`; when the end is not later than the start the window runs past
midnight into the next day. The day range, when given, is a start and an
end calendar date with the end not before the start and spanning at most
31 days. The visibility criterion MUST be one of `window` (inside the
observation window of the position the search is evaluated for),
`horizon` (altitude above 0 degrees) or `none`. The maximum brightness MUST
be one of `N` (night), `AT` (astronomical twilight), `NT` (nautical
twilight), `CT` (civil twilight) or `D` (day, no brightness limit). The
name MUST be non-empty after trimming and unique among a single user's
searches. Searches belong to exactly one user and are never visible to
other users.

#### Scenario: Valid definition accepted
- **WHEN** a search is submitted with name "Bright doubles", set
  `double_stars` with maximum magnitude 5, window 22:00-02:00, no day
  range, visibility `window` and brightness `NT`
- **THEN** the search is stored with exactly those values

#### Scenario: Double stars without a magnitude rejected
- **WHEN** a search is submitted with set `double_stars` and no maximum
  magnitude
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Empty name list rejected
- **WHEN** a search is submitted with set `names` and no names, or only
  blank names
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Day range too long rejected
- **WHEN** a search is submitted with a day range of 40 days
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Unknown enumeration value rejected
- **WHEN** a search is submitted with visibility `sometimes` or brightness
  `dusk` or set `comets`
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Duplicate name for the same user rejected
- **WHEN** a user who already has a search named "Planets" submits another
  search named "Planets"
- **THEN** the request is rejected as a conflict and nothing is stored

#### Scenario: Same name allowed for different users
- **WHEN** two different users each create a search named "Winter"
- **THEN** both are stored and each user sees only their own

### Requirement: Search candidates are stored with the search
A stored search SHALL carry every object its target set resolved to when
it was last evaluated, before any visibility or brightness criteria were
applied. Each candidate has a name, a flag saying whether it is a
solar-system body, for other objects the right ascension and declination
in degrees (RA 0 to 360, Dec -90 to 90), an optional visual magnitude and
object type, and a matched flag saying whether it satisfied the search's
criteria at the last evaluation. The search SHALL also record when it was
evaluated and the name of the position it was evaluated for. Candidates
are submitted together with the definition on create and update and
replace the previous candidates as a whole; a search MAY be stored with
zero candidates, and MAY be stored with candidates none of which are
matched.

#### Scenario: Candidates replaced on update
- **WHEN** a search whose candidates are Mars and Jupiter is updated with
  candidates Saturn only
- **THEN** listing the search shows Saturn as its only candidate

#### Scenario: Unmatched candidates kept
- **WHEN** a search is submitted with 110 Messier candidates of which 40
  are flagged matched
- **THEN** listing the search returns all 110 candidates with their flags
  intact

#### Scenario: Invalid candidate coordinates rejected
- **WHEN** a search is submitted with a non-solar-system candidate whose
  declination is 100
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Empty candidate list accepted
- **WHEN** a search is submitted whose set resolved to no objects
- **THEN** the search is stored with an empty candidate list

### Requirement: Listing searches
The system SHALL return the authenticated user's searches, each with its
identifier, name, definition, evaluation record and candidates, and MUST
NOT include searches belonging to other users.

#### Scenario: List own searches
- **WHEN** an authenticated user requests their searches
- **THEN** every search they own is returned with its id, name, set,
  magnitude limit, names, time window, day range, visibility, brightness,
  evaluation time and position, and candidates with their matched flags,
  and no other user's searches appear

### Requirement: Creating searches
An authenticated user SHALL be able to create a new search. On success the
created search, including its assigned identifier and candidates, is
returned.

#### Scenario: Create a search
- **WHEN** an authenticated user submits a valid new search with
  candidates
- **THEN** the search is stored as belonging to that user and returned with
  a non-zero identifier, and it appears with its candidates in the user's
  subsequent listing

### Requirement: Editing searches
An authenticated user SHALL be able to update the name, definition,
evaluation record and candidates of a search they own, subject to the same
validation and uniqueness rules as creation. A search that does not exist
or belongs to another user MUST be reported as not found, without
revealing whether it exists.

#### Scenario: Edit own search
- **WHEN** an authenticated user updates their search with new valid
  values and candidates
- **THEN** the stored search reflects the new values and candidates and
  the updated search is returned

#### Scenario: Edit another user's search
- **WHEN** an authenticated user attempts to update a search owned by a
  different user
- **THEN** the request is rejected as not found and the search is unchanged

#### Scenario: Rename to an existing name
- **WHEN** a user renames a search to the name of another search they
  already own
- **THEN** the request is rejected as a conflict and the search is unchanged

### Requirement: Deleting searches
An authenticated user SHALL be able to delete a search they own, including
their last one, and its candidates are removed with it. A search that
does not exist or belongs to another user MUST be reported as not found.

#### Scenario: Delete a search
- **WHEN** a user deletes one of their searches
- **THEN** the search and its candidates no longer appear in their listing

#### Scenario: Delete another user's search
- **WHEN** an authenticated user attempts to delete a search owned by a
  different user
- **THEN** the request is rejected as not found and the search remains

### Requirement: Seeded default search
The demo data seeding SHALL provide the test user with a search named
"Planets" whose set is `planets`, whose visibility is `none` and brightness
`D`, and whose candidates are the eight solar-system bodies, all matched.
On a database seeded before search definitions existed, the seeding MUST
fill in that definition and those candidates for the existing "Planets"
search without creating a duplicate.

#### Scenario: Fresh database
- **WHEN** the server starts against an empty database
- **THEN** the test user has exactly one search, "Planets", with the eight
  bodies as matched candidates

#### Scenario: Previously seeded database
- **WHEN** the server starts against a database whose "Planets" search has
  no definition and no per-search candidates
- **THEN** after startup that search has the `planets` definition and the
  eight bodies as matched candidates, and the user still has exactly one
  search

### Requirement: Selected search is shown in the top bar
The application header SHALL display the name of the currently selected
search next to the position indicator, and activating it SHALL open the
searches dialog.

#### Scenario: Header shows selected search
- **WHEN** the session's selected search is "Planets"
- **THEN** the header shows "Planets" as the current search

#### Scenario: Open the searches dialog
- **WHEN** the user activates the search indicator in the header
- **THEN** the searches dialog opens

### Requirement: Searches dialog
The searches dialog SHALL list all of the user's searches with their name,
a summary of the set, the number of matched candidates out of the total
and when they were evaluated, indicate which one is selected, and offer
add, edit and delete actions.
Selecting a search SHALL persist the choice in the session so it survives
a page reload. The add and edit forms SHALL cover the whole definition,
default new searches to window 22:00-02:00, no day range, visibility
`window` and brightness `NT`, and show the server's validation or conflict
message to the user without closing the form.

#### Scenario: Select a search
- **WHEN** the user selects a different search in the dialog
- **THEN** the header indicator changes to that search's name, the sky view
  shows that search's matched candidates, and after a page reload the same
  search is still selected

#### Scenario: Edit a search
- **WHEN** the user edits an existing search, re-evaluates it and confirms
- **THEN** the list shows the updated values and match count, and if the
  edited search is the selected one the sky view shows the new matches

#### Scenario: Rename the selected search
- **WHEN** the user renames the currently selected search
- **THEN** the renamed search stays selected and the header shows the new
  name

#### Scenario: Delete a search after confirmation
- **WHEN** the user deletes a search and confirms the deletion prompt
- **THEN** the search disappears from the list

#### Scenario: Server rejects the form
- **WHEN** the user submits a name that duplicates another of their
  searches
- **THEN** the form stays open and shows the rejection message

### Requirement: Evaluate before save
The add and edit forms SHALL require an explicit evaluation step before
the search can be saved. Evaluation has two parts. Resolution turns the
target set into candidates through the catalog; it runs when the form has
no candidates yet or when the target set (kind, magnitude limit or names)
has changed since the candidates were obtained, and otherwise the
candidates already held by the form (loaded from the saved search or from
the previous resolution) are reused without any catalog access. Filtering
then applies the criteria to the candidates for the currently selected
position (its coordinates and observation window) over the windows the
definition describes, where a definition without a day range means the
single night that begins on the date the application is currently
showing. The form then shows every candidate with its match status, how
many matched out of how many candidates, and any names that could not be
resolved. Save MUST be unavailable until an evaluation has completed for
the current definition, and changing any part of the definition after
evaluating MUST clear the match status and make Save unavailable again;
changing the target set MUST additionally discard the candidates.
Evaluation failures (an unreachable catalog, criteria that match too many
objects, invalid input) SHALL be shown in the form without closing it.

#### Scenario: Evaluate then save
- **WHEN** the user fills in a definition, evaluates it, and saves
- **THEN** the stored search's candidates are exactly the objects the
  resolution returned, the matched flags are exactly what the filtering
  showed, and its evaluation record names the selected position

#### Scenario: Save without evaluation
- **WHEN** the user fills in a definition and has not evaluated it
- **THEN** the Save action is unavailable

#### Scenario: Criteria changed after evaluation
- **WHEN** the user evaluates, then changes the maximum brightness
- **THEN** the match status is cleared, the candidates remain listed and
  Save is unavailable until the user evaluates again

#### Scenario: Re-applying criteria needs no catalog
- **WHEN** the user opens a saved `messier` search, changes its time
  window and evaluates while the catalog service cannot be reached
- **THEN** the stored candidates are filtered with the new window, the
  matches are shown and the search can be saved

#### Scenario: Target set changed after evaluation
- **WHEN** the user evaluates, then changes the maximum magnitude of a
  `double_stars` set
- **THEN** the candidates and matches are cleared and the next evaluation
  goes back to the catalog

#### Scenario: Unresolved names shown
- **WHEN** the user evaluates a `names` set containing "Vega" and
  "Notastar"
- **THEN** Vega is listed as a candidate and "Notastar" is listed as
  unresolved, and the user can still save the search with Vega

#### Scenario: Catalog unavailable
- **WHEN** the user evaluates a new `messier` set while the catalog
  service cannot be reached
- **THEN** the form shows an error saying the catalog was unavailable and
  keeps the entered definition

### Requirement: Sky view renders the selected search's matches
The sky view SHALL draw a marker for every matched candidate of the
selected search at its current position as seen from the selected
position, refreshed on the same cadence as today's planet markers, using
the existing artistic markers for solar-system bodies and a marker
distinguished by object type for other objects. Unmatched candidates
MUST NOT be drawn. Hovering or tapping a marker SHALL show a tooltip with
its name and, for non-solar-system objects, its object type and
magnitude. When the search has at most 10 matched candidates, a 24-hour
path SHALL be drawn for every one of them as today; when it has more, a
path SHALL be drawn only for the one whose marker is hovered or tapped.
The Sun's marker and path are drawn regardless of the search. Updating
the selected search's candidates or match flags MUST cause the view to
show the new matches without a page reload.

#### Scenario: Small search draws all paths
- **WHEN** the selected search is the eight-planet "Planets" search
- **THEN** every planet has a marker and a path, as before this change

#### Scenario: Large search draws paths on demand
- **WHEN** the selected search has 60 matched Messier objects and the user
  hovers M31
- **THEN** all 60 markers are shown, only M31's path is drawn, and the path
  disappears when the hover ends

#### Scenario: Unmatched candidates hidden
- **WHEN** the selected search has 110 Messier candidates of which 40 are
  matched
- **THEN** exactly 40 markers are drawn

#### Scenario: Fixed-object tooltip
- **WHEN** the user hovers a double-star marker
- **THEN** the tooltip shows its name, "Double star" type and magnitude

#### Scenario: Request volume bounded
- **WHEN** the selected search has 100 matched candidates
- **THEN** each marker refresh issues a bounded number of requests to the
  astronomy service rather than one per object

### Requirement: Missing selected search falls back
If the session's selected search does not match any of the user's
searches, the application SHALL select the user's first search, persist
that selection in the session, and render its matches. If the user has no
searches, the sky view SHALL render only the Sun and the header SHALL
indicate that no search is selected.

#### Scenario: Selected search was deleted
- **WHEN** the session names a search the user no longer has and the user
  has at least one other search
- **THEN** the first remaining search becomes selected and the sky view
  shows its matches

#### Scenario: No searches at all
- **WHEN** the user has deleted all of their searches
- **THEN** the sky view shows only the Sun and its path and the header
  reads "(no search)"
