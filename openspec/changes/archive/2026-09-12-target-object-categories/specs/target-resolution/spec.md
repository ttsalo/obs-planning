## MODIFIED Requirements

### Requirement: Resolving a target set to candidates
The astronomy service SHALL resolve a target set, as a request of its
own that applies no observing criteria, to a list of candidate objects,
each with a name, a solar-system flag, and for fixed objects RA and Dec in
degrees plus, when the catalog provides them, a visual magnitude and an
object type. The response SHALL include the candidates, their count and
the unresolved names. `planets` resolves to the eight built-in
bodies without any catalog access. `messier` resolves to the Messier
objects M1 to M110 from the SIMBAD catalog, limited to those at or
brighter than the maximum magnitude when one is given. `category`
resolves to SIMBAD objects of the requested object type, including that
type's subtypes in SIMBAD's type hierarchy, at or brighter than the given
maximum magnitude; the service SHALL accept any object type SIMBAD
defines rather than a fixed selection of them, and a syntactically valid
type SIMBAD does not define resolves to no candidates rather than to an
error. A `category` set without an object type, without a maximum
magnitude, or with an object type containing anything but the characters
a SIMBAD object-type code is made of MUST be rejected as invalid input.
Each candidate of a `category` set SHALL be typed by its own catalogued
object type, which may be a subtype of the requested one, rather than by
the requested type. `names` resolves each name case-insensitively against
the built-in bodies (Sun included) first and against SIMBAD otherwise;
names SIMBAD does not know are returned in an `unresolved` list rather
than failing the request. A set that yields more than 2000 candidates MUST
be rejected as invalid input with a message asking for a tighter limit,
and a catalog that cannot be reached or does not answer within the
request's time budget MUST be reported as a bad-gateway error with a
readable message.

#### Scenario: Planets need no catalog
- **WHEN** a `planets` set is resolved while SIMBAD is unreachable
- **THEN** the eight bodies are returned as candidates and no error occurs

#### Scenario: Messier with a magnitude limit
- **WHEN** a `messier` set is resolved with maximum magnitude 6
- **THEN** every candidate is a Messier object with magnitude at most 6 and
  none of the fainter ones appear

#### Scenario: A category other than double stars
- **WHEN** a `category` set of globular clusters with maximum magnitude 9
  is resolved
- **THEN** the candidates are the globular clusters at or brighter than
  magnitude 9, each with RA, Dec, magnitude and a readable object type

#### Scenario: Subtypes included and typed individually
- **WHEN** a `category` set of double or multiple stars is resolved and the
  catalog holds an eclipsing binary among them
- **THEN** the eclipsing binary is a candidate and its object type says
  eclipsing binary rather than the requested double-or-multiple-star type

#### Scenario: Category without an object type rejected
- **WHEN** a `category` set is resolved with no object type, or with a
  maximum magnitude missing
- **THEN** the request is rejected as invalid input and no catalog request
  is made

#### Scenario: Malformed object type rejected before the catalog
- **WHEN** a `category` set is resolved whose object type contains a quote
  or a space
- **THEN** the request is rejected as invalid input and no catalog request
  is made

#### Scenario: Unknown object type resolves to nothing
- **WHEN** a `category` set is resolved whose object type is well-formed
  but not one SIMBAD defines
- **THEN** the response is a successful one with no candidates and a count
  of zero

#### Scenario: Mixed name list
- **WHEN** a `names` set of "mars", "Vega" and "Notastar" is resolved
- **THEN** the candidates are Mars (solar-system) and Vega (with RA, Dec,
  magnitude and type) and the unresolved list is exactly "Notastar"

#### Scenario: Too many candidates
- **WHEN** a `category` set is resolved with a maximum magnitude that
  matches more than 2000 objects
- **THEN** the request is rejected as invalid input with a message naming
  the category and asking for a lower magnitude limit

#### Scenario: Catalog unreachable
- **WHEN** a `messier` set is resolved and SIMBAD does not respond
- **THEN** the request fails with a bad-gateway status and a message naming
  the catalog, and the service remains healthy for other requests
