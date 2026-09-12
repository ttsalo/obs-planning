## MODIFIED Requirements

### Requirement: Position data model
A position SHALL consist of a name, a latitude in degrees (-90 to 90), a
longitude in degrees (-180 to 180), and an observation window given as
minimum and maximum azimuth (0 to 360) and minimum and maximum altitude
(-90 to 90). The minimum altitude MUST NOT exceed the maximum altitude.
The azimuth limits MAY be given in either order: a maximum azimuth below
the minimum means the window wraps through north, covering azimuths
greater than the minimum or less than the maximum (125 to 45 is
south-east round through north to north-east); equal azimuth limits
form an empty window. The name MUST be non-empty and MUST be unique among
a single user's positions. Positions belong to exactly one user and are
never visible to other users.

#### Scenario: Valid position accepted
- **WHEN** a position is submitted with name "Kuusamo", lat 65.96, lon 29.19,
  az 0..360 and alt 0..90
- **THEN** the position is stored with exactly those values

#### Scenario: Wrapping azimuth window accepted
- **WHEN** a position is submitted with min_az 125 and max_az 45
- **THEN** the position is stored with min_az 125 and max_az 45, unchanged

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

### Requirement: Sky view follows the selected position
The sky view SHALL compute target markers and 24-hour paths for the selected
position's latitude and longitude and clip paths to that position's
observation window, honouring an azimuth window that wraps through north.
Changing the selected position, or the coordinates of the selected
position, SHALL cause the markers and paths to be recomputed rather than
served from data computed for a different position.

#### Scenario: Switching position recomputes the view
- **WHEN** the selected position changes from Helsinki to a position on the
  other side of the globe
- **THEN** the markers and paths shown correspond to the new coordinates

#### Scenario: Observation window clips paths
- **WHEN** the selected position has max_alt 45
- **THEN** non-Sun target paths are not drawn above 45 degrees altitude

#### Scenario: Wrapping window clips paths
- **WHEN** the selected position has min_az 125 and max_az 45
- **THEN** non-Sun path points at azimuth 90 are not drawn, while path
  points at azimuth 20 and at azimuth 200 are
