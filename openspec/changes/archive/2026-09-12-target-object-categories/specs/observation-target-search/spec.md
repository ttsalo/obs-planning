## ADDED Requirements

### Requirement: Choosing an object category
When the target set is an object category, the add and edit forms SHALL
let the user choose the category from a curated list of astronomical
object categories rather than typing a catalog code. The list SHALL be
grouped by kind of object, SHALL be filterable by typing part of a
category's name, and SHALL be available without contacting the catalog
service, so a category can be chosen while the catalog is unreachable.
Exactly one category SHALL be chosen per search; a user who wants two
categories makes two searches. The category a saved search names SHALL be
shown by its readable name wherever the search's set is summarised.

#### Scenario: Choose a category from the list
- **WHEN** the user selects the object-category set and opens the category
  list
- **THEN** the categories are shown grouped by kind of object, with at
  least stars, double and multiple stars, variable stars, clusters,
  nebulae and interstellar matter, and galaxies and beyond represented

#### Scenario: Filter the list
- **WHEN** the user types "glob" into the category field
- **THEN** the list narrows to the matching categories, including globular
  clusters

#### Scenario: Category list needs no catalog
- **WHEN** the user opens the category list while the catalog service
  cannot be reached
- **THEN** the full list is shown and a category can be chosen; only the
  evaluation that follows reports the catalog failure

#### Scenario: Category named in the summary
- **WHEN** a saved search uses the globular-cluster category with maximum
  magnitude 9
- **THEN** the searches list summarises its set as the readable category
  name and the magnitude limit, not as a catalog code

## MODIFIED Requirements

### Requirement: Search definition
A search SHALL consist of a name, a target set, an observing time window,
an optional day range, a visibility criterion and a maximum sky brightness.
The target set MUST be one of: `planets` (the Sun-system bodies the sky
view already knows: Mercury, Venus, Moon, Mars, Jupiter, Saturn, Uranus,
Neptune), `messier` (the 110 Messier objects, optionally limited to those
at or brighter than a maximum visual magnitude), `category` (the objects
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
the end not before the start and spanning at most 31 days. The visibility
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
- **WHEN** a search is submitted with a day range of 40 days
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
over the windows the definition describes, where a definition without a
day range means the single night that begins on the date the application
is currently showing. The form then shows every candidate with its match
status, how many matched out of how many candidates, and any names that
could not be resolved. Save MUST be unavailable until an evaluation has
completed for the current definition, and changing any part of the
definition after evaluating MUST clear the match status and make Save
unavailable again; changing the target set MUST additionally discard the
candidates. Evaluation failures (an unreachable catalog, criteria that
match too many objects, invalid input) SHALL be shown in the form without
closing it.

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
