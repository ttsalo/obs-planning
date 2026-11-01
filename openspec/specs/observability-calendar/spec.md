# observability-calendar Specification

## Purpose

Per-day observability results for a target search: what is recorded about
each candidate on each day of the search's range, and how those results are
presented so an observer can see when over weeks or months each target is
best placed and pick a night to plan for.

## Requirements

### Requirement: Per-day observability record
For each candidate and each day of a search's evaluated range, the system
SHALL record how long the candidate qualified, the highest altitude it
reached while qualifying, the darkest sky it reached while qualifying, and
when that altitude peak occurred. A candidate qualifies at an instant when
it satisfies both the search's visibility criterion and its maximum sky
brightness. A day on which a candidate never qualifies SHALL have no
record.

#### Scenario: Four numbers per qualifying day
- **WHEN** a search with visibility `window` and brightness `NT` is
  evaluated over a 30-day range and Jupiter qualifies on one of those days
- **THEN** that day's record for Jupiter gives the qualifying duration, the
  highest altitude reached while qualifying, the darkest sky reached while
  qualifying, and the time of the altitude peak

#### Scenario: A day with no qualifying time has no record
- **WHEN** a candidate is below the position's minimum altitude throughout
  every sampled instant of one day's window
- **THEN** that day has no record for that candidate, and the candidate's
  records for the other days are unaffected

#### Scenario: The altitude peak is a qualifying instant
- **WHEN** a candidate reaches its greatest altitude of the day while the
  sky is brighter than the search's brightness limit, and a lower maximum
  while the sky is dark enough
- **THEN** the day's recorded highest altitude is the lower one, reached
  while qualifying, and the recorded peak time is that instant

#### Scenario: No brightness limit
- **WHEN** a search's maximum brightness is `D`, which sets no limit, and a
  candidate is visible only in daylight on one day
- **THEN** that day has a record whose darkest sky is the daylight value and
  whose qualifying duration covers the daylight visibility

#### Scenario: A candidate matches when it has at least one record
- **WHEN** a search is evaluated over a 90-day range and a candidate has
  records on 12 of those days
- **THEN** the candidate is reported as matched, and a candidate with no
  records on any day is reported as not matched

### Requirement: Qualifying duration is not quantised by the sampling interval
The qualifying duration SHALL be computed by interpolating the instants at
which a candidate enters and leaves qualification, not by counting sampled
instants, so that days whose qualifying durations differ by less than the
sampling interval are distinguishable.

#### Scenario: Durations differ by less than the sampling interval
- **WHEN** a candidate qualifies on two consecutive days for durations that
  differ by a few minutes, shorter than the interval between sampled
  instants
- **THEN** the two days have different recorded durations

#### Scenario: Duration is not a multiple of the sampling interval
- **WHEN** a candidate rises above the position's minimum altitude partway
  between two sampled instants
- **THEN** the recorded duration reflects the interpolated crossing instant
  rather than the nearer sample

### Requirement: Retrieving a search's per-day results
An authenticated user SHALL be able to retrieve the per-day records of a
search they own, for every candidate at once. A search that does not exist
or belongs to another user MUST be reported as not found. The searches
listing MUST NOT carry per-day records, so that its size does not grow with
the length of a search's range.

#### Scenario: Retrieve own results
- **WHEN** an authenticated user requests the per-day results of their
  evaluated search
- **THEN** the records of every candidate that has any are returned, each
  identifying the candidate and the day it belongs to

#### Scenario: Another user's results
- **WHEN** an authenticated user requests the per-day results of a search
  owned by a different user
- **THEN** the request is rejected as not found

#### Scenario: Listing stays lean
- **WHEN** a user whose search has 110 candidates over a 180-day range
  requests their searches
- **THEN** the listing returns the definitions, evaluation records and
  candidates with their matched flags, and no per-day records

#### Scenario: A search with no per-day results
- **WHEN** the per-day results of a search saved before per-day evaluation
  existed are requested
- **THEN** the request succeeds and reports that the search has no per-day
  records, rather than failing

### Requirement: Observability calendar
The application SHALL offer a calendar view of the selected search's
per-day results, with one row per matched candidate and one cell per day of
the evaluated range, each cell shaded according to the chosen metric and
leaving days without a record visibly empty. Pointing at a cell SHALL show
that day's recorded numbers.

#### Scenario: Grid covers the range
- **WHEN** the selected search was evaluated over a 180-day range and has
  12 matched candidates
- **THEN** the calendar shows 12 rows and 180 columns, with the cells of
  days a candidate has no record for distinguishable from its shaded ones

#### Scenario: Cell readout
- **WHEN** the user points at the cell for one candidate on one day
- **THEN** that day's qualifying duration, highest altitude, darkest sky and
  peak time are shown

#### Scenario: Search without per-day results
- **WHEN** the selected search has no per-day records
- **THEN** the calendar says so instead of showing an empty grid

### Requirement: Opening the calendar
The calendar SHALL open as a dialog from a control in the application's top
bar, alongside the position and search indicators, and SHALL stay closed
until that control is activated.

#### Scenario: Opened from the top bar
- **WHEN** the user activates the calendar control in the top bar
- **THEN** the calendar opens as a dialog showing the selected search's
  per-day results

#### Scenario: Closed until asked for
- **WHEN** the application is loaded and the calendar control has not been
  activated
- **THEN** no calendar is shown

### Requirement: Choosing the calendar metric
The calendar SHALL let the user choose which of the recorded metrics the
cell shading represents, offering qualifying duration, highest altitude and
darkest sky, and SHALL re-shade the grid on the choice without re-evaluating
the search or contacting the astronomy service.

#### Scenario: Switch metric
- **WHEN** the user switches the calendar's metric from qualifying duration
  to highest altitude
- **THEN** the shading changes to represent highest altitude, and no
  evaluation or astronomy request is made

### Requirement: A calendar day selects that night
Activating a day in the calendar SHALL set the date the application is
showing to that day and SHALL close the calendar, so that the sky view
renders that night with nothing standing in front of it.

#### Scenario: Click through to a night
- **WHEN** the user activates the cell for 8 November in a search evaluated
  over a range containing it
- **THEN** the application's shown date becomes 8 November, the calendar
  closes, and the sky view renders the candidates that qualify that night

#### Scenario: Reopening after choosing a day
- **WHEN** the user activates a day and then opens the calendar again
- **THEN** the same search's results are shown and the application is still
  showing the chosen date

### Requirement: Best periods summarised in words
For each matched candidate the application SHALL summarise, in words, the
periods over which it is best observed, derived from the per-day records by
grouping consecutive days and naming each period's extent and its best day.

#### Scenario: Summary names a period and its peak
- **WHEN** a candidate's records are strongest over a run of days in the
  middle of the evaluated range
- **THEN** the summary names that period's first and last day and the day on
  which the candidate is best

#### Scenario: Candidate with scattered days
- **WHEN** a candidate has records on days that do not form a single run
- **THEN** the summary names more than one period rather than spanning the
  gaps
