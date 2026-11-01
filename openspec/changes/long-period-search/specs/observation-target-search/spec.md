# Spec Delta

## MODIFIED Requirements

### Requirement: Search definition
A search SHALL consist of a name, a target set, an observing time window,
an optional day range, a visibility criterion and a maximum sky brightness.
The target set MUST be one of: `planets` (the Sun-system bodies the sky
view already knows: Mercury, Venus, Moon, Mars, Jupiter, Saturn, Uranus,
Neptune), one of the well-known object lists — `messier` (the 110
Messier objects), `caldwell` (the 109 Caldwell objects), `herschel400`
(the 400 objects of the Herschel 400 observing program), `melotte` (the
245 Melotte clusters) or `collinder` (the 471 Collinder clusters) — each
optionally limited to those at or brighter than a maximum visual
magnitude, `category` (the objects
of one astronomical object category, identified by a catalog object-type
code, at or brighter than a maximum visual magnitude, which MUST be
given), or `names` (a non-empty list of object names, each non-empty
after trimming). A `category` set MUST carry exactly one object-type
code, which MUST be non-empty and consist only of characters a catalog
object-type code may contain, so that it can never be mistaken for
anything but a code; every other set kind MUST be stored without one. The
time window is a start and an end wall-clock time in `HH:MM`; when the end
is not later than the start the window runs past midnight into the next
day. The day range, when given, is a start and an end calendar date with
the end not before the start and spanning at most 366 days. The visibility
criterion MUST be one of `window` (inside the observation window of the
position the search is evaluated for), `horizon` (altitude above 0
degrees) or `none`. The maximum brightness MUST be one of `N` (night),
`AT` (astronomical twilight), `NT` (nautical twilight), `CT` (civil
twilight) or `D` (day, no brightness limit). The name MUST be non-empty
after trimming and unique among a single user's searches. Searches belong
to exactly one user and are never visible to other users.

#### Scenario: Valid definition accepted
- **WHEN** a search is submitted with name "Bright doubles", set
  `category` with the double-or-multiple-star object-type code and maximum
  magnitude 5, window 22:00-02:00, no day range, visibility `window` and
  brightness `NT`
- **THEN** the search is stored with exactly those values

#### Scenario: Category without a magnitude rejected
- **WHEN** a search is submitted with set `category` and no maximum
  magnitude
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Category without a code rejected
- **WHEN** a search is submitted with set `category` and an empty
  object-type code
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Malformed object-type code rejected
- **WHEN** a search is submitted with set `category` and an object-type
  code containing a quote, a space or a parenthesis
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Object-type code ignored for other sets
- **WHEN** a search is submitted with set `planets` and an object-type
  code
- **THEN** the search is stored without an object-type code

#### Scenario: Empty name list rejected
- **WHEN** a search is submitted with set `names` and no names, or only
  blank names
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Day range too long rejected
- **WHEN** a search is submitted with a day range of 400 days
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Unknown enumeration value rejected
- **WHEN** a search is submitted with visibility `sometimes` or brightness
  `dusk` or set `comets`
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: Withdrawn double-star set kind rejected
- **WHEN** a search is submitted with set `double_stars`
- **THEN** the request is rejected as invalid input and nothing is stored

#### Scenario: A search stored under the withdrawn set kind still renders
- **WHEN** a search saved before this change names the `double_stars` set
- **THEN** it is still listed, can still be selected, and the sky view
  still draws its stored matches; only saving it again requires choosing a
  set the definition allows

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
object type, a matched flag saying whether it satisfied the search's
criteria at the last evaluation, and its per-day observability records for
the days of the evaluated range on which it qualified. The search SHALL
also record when it was evaluated, the name of the position it was
evaluated for, and the coordinates and observation window that evaluation
used. Candidates
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

#### Scenario: Per-day records replaced with the candidates
- **WHEN** a search evaluated over a 30-day range is updated with
  candidates carrying per-day records for a different 60-day range
- **THEN** the previous per-day records are gone and only the new ones
  remain

#### Scenario: Evaluation details stored
- **WHEN** a search is saved after being evaluated for a position at
  latitude 60.17 and longitude 24.94 with a given observation window
- **THEN** the stored search records those coordinates and that window
  alongside the position's name

#### Scenario: Candidate stored without per-day records
- **WHEN** a candidate is submitted with no per-day records because it
  qualified on no day of the range
- **THEN** the candidate is stored, not matched, and with no per-day records

### Requirement: Listing searches
The system SHALL return the authenticated user's searches, each with its
identifier, name, definition, evaluation record and candidates, and MUST
NOT include searches belonging to other users. The evaluation record
includes the coordinates and observation window the evaluation used. The
listing MUST NOT include candidates' per-day observability records, so that
its size does not grow with the length of a search's day range.

#### Scenario: List own searches
- **WHEN** an authenticated user requests their searches
- **THEN** every search they own is returned with its id, name, set,
  magnitude limit, names, time window, day range, visibility, brightness,
  evaluation time, position and the coordinates and window the evaluation
  used, and candidates with their matched flags but without their per-day
  records, and no other user's searches appear

#### Scenario: Listing size independent of the range
- **WHEN** a user whose search has 110 candidates evaluated over a 180-day
  range requests their searches
- **THEN** the response carries the 110 candidates and no per-day records

### Requirement: Searches dialog
The searches dialog SHALL list all of the user's searches with their name,
a summary of the set, the number of matched candidates out of the total,
the day range they were evaluated over and when they were evaluated,
indicate which one is selected, mark a search whose stored evaluation no
longer matches its position as stale, and offer add, edit and delete
actions.
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

#### Scenario: Range shown in the list
- **WHEN** a search was evaluated over the range 1 November to 29 April
- **THEN** the list shows that range alongside its evaluation time

#### Scenario: Stale search marked
- **WHEN** the coordinates of the position a search was evaluated for have
  been edited since the evaluation
- **THEN** the list marks that search as stale

### Requirement: Evaluate before save
The add and edit forms SHALL require an explicit evaluation step before
the search can be saved. Evaluation has two parts. Resolution turns the
target set into candidates through the catalog; it runs when the form has
no candidates yet or when the target set (kind, object-type code,
magnitude limit or names) has changed since the candidates were obtained,
and otherwise the candidates already held by the form (loaded from the
saved search or from the previous resolution) are reused without any
catalog access. Filtering then applies the criteria to the candidates for
the currently selected position (its coordinates and observation window)
over the windows the definition describes, one window per day of the day
range, where a definition without a day range means the single night that
begins on the date the application is currently showing. Filtering SHALL
produce a per-day observability record for each candidate and each day of
the range on which it qualified. The form then shows every candidate with
its match status, how many matched out of how many candidates, and any
names that could not be resolved. Save MUST be unavailable until an evaluation has
completed for the current definition, and changing any part of the
definition after evaluating MUST clear the match status and make Save
unavailable again; changing the target set MUST additionally discard the
candidates. Evaluation failures (an unreachable catalog, criteria that
match too many objects, invalid input) SHALL be shown in the form without
closing it.

#### Scenario: Evaluate then save
- **WHEN** the user fills in a definition, evaluates it, and saves
- **THEN** the stored search's candidates are exactly the objects the
  resolution returned, the matched flags and per-day records are exactly
  what the filtering produced, and its evaluation record names the selected
  position and the coordinates and observation window used

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
  `category` set
- **THEN** the candidates and matches are cleared and the next evaluation
  goes back to the catalog

#### Scenario: Category changed after evaluation
- **WHEN** the user evaluates a `category` set of globular clusters, then
  picks open clusters instead
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

#### Scenario: Long range evaluated in one step
- **WHEN** the user evaluates a definition whose day range spans 180 days
- **THEN** the filtering covers all 180 days and the form can be saved with
  the per-day records of every candidate

#### Scenario: Re-applying criteria over a range needs no catalog
- **WHEN** the user opens a saved `messier` search, widens its day range
  and evaluates while the catalog service cannot be reached
- **THEN** the stored candidates are filtered over the new range, the
  per-day records are produced and the search can be saved

#### Scenario: Evaluation too large
- **WHEN** the user evaluates a definition whose candidate count times day
  count exceeds the permitted maximum
- **THEN** the form stays open and shows a message naming the candidate
  count, the day count and the limit

### Requirement: Sky view renders the selected search's matches
The sky view SHALL draw a marker for every candidate of the
selected search that qualifies on the date the application is showing, at
its current position as seen from the selected position, refreshed on the same cadence as today's planet markers, using
the existing artistic markers for solar-system bodies and a category
icon for other objects. Every object category the searches dialog
offers SHALL have an icon of its own, drawn in the sky view's simplified
line-graphics style — a black outline with a colored infill — and no
two offered categories SHALL share the same icon. The categories of one
group in the dialog's picker (stars; double and multiple stars; variable
stars; clusters; nebulae and interstellar matter; galaxies and beyond)
SHALL share a base shape, and each category's icon SHALL be a variation
of its group's base shape by size, infill color, an added graphical
marker, or one to three letters set beside the shape. An object whose
type is not an offered category SHALL draw with the base shape of the
group its type belongs to when the type names one, and with a plain dot
otherwise; a type marked as a candidate ("(candidate)") draws as the
type it is a candidate of. An object MUST NOT be left undrawn for want
of an icon. An icon's footprint MUST stay within the area today's
markers occupy, so hovering, tapping and clicking a marker behave as
before. A candidate that does not qualify on
the shown date MUST NOT be drawn. When the shown date lies outside the
search's evaluated day range, or the search has no per-day records at all,
every matched candidate SHALL be drawn instead, and the view SHALL indicate
that it is showing the search's matches for any day rather than for the
shown date. Hovering or tapping a
marker SHALL show a tooltip with its name and, for non-solar-system
objects, its object type and magnitude. When at most 10 candidates are drawn, a
24-hour path SHALL be drawn for every one of them as today; when more are
drawn, a path SHALL be drawn only for the one whose marker is hovered or
tapped. The Sun's marker and path are drawn
regardless of the search. Updating the selected search's candidates,
match flags or per-day records, or changing the date the application is
showing, MUST cause the view to show the new set of objects without a page
reload.

#### Scenario: Small search draws all paths
- **WHEN** the selected search is the eight-planet "Planets" search
- **THEN** every planet has a marker and a path, as before this change

#### Scenario: Large search draws paths on demand
- **WHEN** the selected search has 60 matched Messier objects, the shown
  date lies outside its evaluated day range, and the user hovers M31
- **THEN** all 60 markers are shown, only M31's path is drawn, and the path
  disappears when the hover ends

#### Scenario: Unmatched candidates hidden
- **WHEN** the selected search has no day range and 110 Messier candidates
  of which 40 are matched
- **THEN** exactly 40 markers are drawn

#### Scenario: Fixed-object tooltip
- **WHEN** the user hovers a double-star marker
- **THEN** the tooltip shows its name, "Double star" type and magnitude

#### Scenario: Request volume bounded
- **WHEN** the selected search has 100 matched candidates
- **THEN** each marker refresh issues a bounded number of requests to the
  astronomy service rather than one per object

#### Scenario: Every offered category has a distinct icon
- **WHEN** one object of each of the categories the searches dialog
  offers is drawn
- **THEN** every one of them has an icon and no two of the icons are the
  same

#### Scenario: One group, one base shape
- **WHEN** a globular cluster, an open cluster and an asterism are drawn
- **THEN** all three are recognisably variations of the clusters' base
  shape, and none of them shares its base shape with a galaxy or a
  nebula

#### Scenario: Subtypes of one search told apart
- **WHEN** a double-star search's matches include an eclipsing binary, a
  spectroscopic binary and a cataclysmic variable star
- **THEN** the three draw with three different icons, each a variation of
  the double-and-multiple-star base shape

#### Scenario: Messier objects typed from the catalog
- **WHEN** the selected search is a Messier set whose matches include M13
  (a globular cluster) and M57 (a planetary nebula)
- **THEN** M13 draws with the globular-cluster icon and M57 with the
  planetary-nebula icon, without the search having named a category

#### Scenario: Type outside the offered list falls back to its group
- **WHEN** a candidate's type is "Low-mass X-ray binary", which the
  dialog does not offer
- **THEN** it draws with the double-and-multiple-star base shape

#### Scenario: Unknown type still drawn
- **WHEN** a candidate's type is an object-type code the frontend does not
  know, or is empty
- **THEN** it draws as a plain dot and its tooltip still names the type

#### Scenario: Candidate types draw as their base type
- **WHEN** a candidate's type is "Galaxy (candidate)"
- **THEN** it draws with the galaxy icon

#### Scenario: Only the shown date's qualifiers are drawn
- **WHEN** the selected search was evaluated over a 180-day range, the
  shown date is inside it, and 12 of its 60 matched candidates have a
  per-day record for that date
- **THEN** exactly those 12 are drawn, and each of them gets a path because
  at most 10 are not drawn only when more than 10 qualify

#### Scenario: Changing the date changes the objects
- **WHEN** the user moves the shown date to the next day of the evaluated
  range, on which a different set of candidates qualifies
- **THEN** the view draws that day's qualifying candidates without a page
  reload

#### Scenario: A night with nothing observable
- **WHEN** the shown date is inside the evaluated range and no candidate
  has a per-day record for it
- **THEN** no search objects are drawn, and the Sun's marker and path are
  still drawn

#### Scenario: Date outside the evaluated range falls back
- **WHEN** the shown date lies outside the selected search's evaluated day
  range
- **THEN** every matched candidate is drawn and the view indicates that it
  is showing matches for any day rather than for the shown date

#### Scenario: Search saved before per-day evaluation
- **WHEN** the selected search has candidates and matched flags but no
  per-day records
- **THEN** every matched candidate is drawn whatever the shown date, as
  before this change

#### Scenario: Paths follow the drawn count
- **WHEN** a search with 60 matched candidates has 8 qualifying on the
  shown date
- **THEN** all 8 are drawn and each of them gets a path

## ADDED Requirements

### Requirement: Evaluation size limit
The number of candidates multiplied by the number of days in a search's day
range MUST NOT exceed 65000. An evaluation or a save that would exceed it
MUST be rejected as invalid input, with a message naming the candidate
count, the day count and the limit.

#### Scenario: A list over a full year is accepted
- **WHEN** a 110-candidate Messier search is evaluated over a 366-day range,
  which is 40260 candidate-days
- **THEN** the evaluation is accepted

#### Scenario: Today's largest search stays accepted
- **WHEN** a 2000-candidate search is evaluated over a 31-day range, which
  is 62000 candidate-days
- **THEN** the evaluation is accepted

#### Scenario: A large list over a full year is rejected
- **WHEN** a 400-candidate Herschel 400 search is evaluated over a 366-day
  range, which is 146400 candidate-days
- **THEN** the request is rejected as invalid input and the message names
  400, 366 and the limit

#### Scenario: Save rejected independently of evaluation
- **WHEN** a search is submitted for storage with candidates and a day
  range whose product exceeds the limit
- **THEN** the request is rejected as invalid input and nothing is stored

### Requirement: Stale evaluation
A search's stored evaluation SHALL be reported as stale when the position it
was evaluated for still exists but the coordinates it was evaluated with
differ from that position's current coordinates, or, when the search's
visibility is `window`, the observation window it was evaluated with differs
from the position's current window. A search stored without evaluation
coordinates MUST NOT be reported as stale.

#### Scenario: Coordinates edited after evaluation
- **WHEN** the latitude of the position a search was evaluated for is
  changed after the evaluation
- **THEN** the search is reported as stale

#### Scenario: Window edited and the search uses it
- **WHEN** the observation window of the position a search with visibility
  `window` was evaluated for is changed after the evaluation
- **THEN** the search is reported as stale

#### Scenario: Window edited but the search ignores it
- **WHEN** the observation window of the position a search with visibility
  `horizon` was evaluated for is changed, and its coordinates are unchanged
- **THEN** the search is not reported as stale, because the evaluation never
  consulted the window

#### Scenario: Nothing to compare against
- **WHEN** a search saved before evaluation coordinates were recorded is
  listed
- **THEN** it is not reported as stale

#### Scenario: Freshly evaluated search
- **WHEN** a search is evaluated and saved for the currently selected
  position, which is then left unchanged
- **THEN** it is not reported as stale
