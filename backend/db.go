package main

import (
    "context"
    "database/sql/driver"
    "encoding/json"
    "errors"
    "fmt"
    "log"
    "math"
    "os"
    "regexp"
    "strings"
    "time"
    "github.com/labstack/echo/v4"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

// User account record.
type User struct {
    gorm.Model
    Username  string `json:"username"`
    Password string `json:"password"`
}

// Observation position record. Specifies a lat-lon position and
// an observation window (which part of sky is visible from that
// position). Names are unique per user: the session identifies the
// selected position by name, so the name has to resolve to one row.
type Position struct {
    gorm.Model
    Name string `json:"name" gorm:"uniqueIndex:idx_positions_user_name,where:deleted_at IS NULL"`
    UserID uint `json:"user_id" gorm:"uniqueIndex:idx_positions_user_name,where:deleted_at IS NULL"`
    User User
    Lat float64 `json:"lat"`
    Lon float64 `json:"lon"`
    MinAz float64 `json:"min_az"`
    MaxAz float64 `json:"max_az"`
    MinAlt float64 `json:"min_alt"`
    MaxAlt float64 `json:"max_alt"`
}

// Check that the position's name and coordinates make sense. Used by
// both the create and the update endpoint so the rules can't drift
// apart, and the returned message is what the positions dialog shows
// the user, so keep it readable. The azimuth limits may be given in
// either order: a maximum below the minimum means the window wraps
// through north (125 -> 45 is south-east round to north-east), which
// the frontend's checkObsWindow and the astro filter both understand.
func (p *Position) Validate() error {
    if strings.TrimSpace(p.Name) == "" {
	return errors.New("Name must not be empty")
    }
    if p.Lat < -90 || p.Lat > 90 {
	return errors.New("Latitude must be between -90 and 90")
    }
    if p.Lon < -180 || p.Lon > 180 {
	return errors.New("Longitude must be between -180 and 180")
    }
    if p.MinAz < 0 || p.MinAz > 360 || p.MaxAz < 0 || p.MaxAz > 360 {
	return errors.New("Azimuth limits must be between 0 and 360")
    }
    if p.MinAlt < -90 || p.MinAlt > 90 || p.MaxAlt < -90 || p.MaxAlt > 90 {
	return errors.New("Altitude limits must be between -90 and 90")
    }
    if p.MinAlt > p.MaxAlt {
	return errors.New("Minimum altitude must not exceed maximum altitude")
    }
    return nil
}

// A list of object names, stored as a JSON array in a text column so
// the API can speak arrays while the row stays a single column on both
// Postgres and SQLite.
type Names []string

func (n Names) Value() (driver.Value, error) {
    if n == nil {
	n = Names{}
    }
    b, err := json.Marshal(n)
    return string(b), err
}

func (n *Names) Scan(value any) error {
    var text string
    switch v := value.(type) {
    case nil:
	*n = Names{}
	return nil
    case string:
	text = v
    case []byte:
	text = string(v)
    default:
	return fmt.Errorf("Names: cannot scan %T", value)
    }
    if strings.TrimSpace(text) == "" {
	*n = Names{}
	return nil
    }
    return json.Unmarshal([]byte(text), n)
}

/* One day's observability record for a candidate, as a fixed-order
array: the day's index into the search's day range, the hours the
candidate qualified, the highest altitude it reached while qualifying,
the darkest Sun upper-limb altitude it reached while qualifying, and
the minutes from that day's window start to its altitude peak.

An array rather than an object roughly halves what is stored and sent,
which is what makes the cell limit affordable. The extremes are over
qualifying samples only, so the altitude is the highest reached while
the sky was dark enough rather than an independent maximum. */
type DayRecord [5]float64

const (
    DayIndex = 0
    DayHours = 1
    DayMaxAlt = 2
    DayDarkSun = 3
    DayPeakMinutes = 4
)

// A candidate's per-day records, stored as a JSON array in a text
// column for the same reason Names is: arrays on the API, one column
// on both Postgres and SQLite.
type Days []DayRecord

func (d Days) Value() (driver.Value, error) {
    if d == nil {
	d = Days{}
    }
    b, err := json.Marshal(d)
    return string(b), err
}

func (d *Days) Scan(value any) error {
    var text string
    switch v := value.(type) {
    case nil:
	*d = Days{}
	return nil
    case string:
	text = v
    case []byte:
	text = string(v)
    default:
	return fmt.Errorf("Days: cannot scan %T", value)
    }
    if strings.TrimSpace(text) == "" {
	*d = Days{}
	return nil
    }
    return json.Unmarshal([]byte(text), d)
}

// The vocabulary of a search definition. A target set is one of the
// kinds - messier, caldwell, herschel400, melotte and collinder are the
// well-known object lists the astro backend keeps (astrobackend/lists.py)
// and behave alike: an optional magnitude limit, nothing else; the
// visibility and brightness criteria are what the stored candidates
// were filtered by.
var (
    setKinds = []string{"planets", "messier", "caldwell", "herschel400",
	"melotte", "collinder", "category", "names"}
    visibilities = []string{"window", "horizon", "none"}
    brightnesses = []string{"N", "AT", "NT", "CT", "D"}
)

/* What an object-type code may be made of. The astro backend
interpolates the code into an ADQL string literal, so this pattern -
which admits every SIMBAD otype ('**', 'V*', 'GlC', 's*r') and no
quote, space or comment marker - is what keeps that query safe. The
check is repeated there; here it stops the column ever holding
something that isn't code-shaped. */
var otypePattern = regexp.MustCompile(`^[A-Za-z0-9*?_+-]{1,8}$`)

// The solar-system bodies the "planets" set stands for, in the order
// the sky view has always listed them.
var planetNames = []string{"Mercury", "Venus", "Moon", "Mars", "Jupiter",
    "Saturn", "Uranus", "Neptune"}

func oneOf(value string, allowed []string) bool {
    for _, a := range allowed {
	if value == a {
	    return true
	}
    }
    return false
}

/* Stored search. The definition says which target set to resolve (kind,
magnitude limit, names), over which observing hours and days, and the
visibility and brightness criteria; the TargetObjects are every
candidate the set resolved to when the search was last evaluated, each
flagged with whether it satisfied the criteria then. Keeping all of the
candidates, not just the matches, is what lets the user reopen a search
and apply new criteria without going back to the catalog. Names are
unique per user for the same reason as positions: the session names the
selected search. */
type TargetSearch struct {
    gorm.Model
    Name string `json:"name" gorm:"uniqueIndex:idx_searches_user_name,where:deleted_at IS NULL"`
    UserID uint `json:"user_id" gorm:"uniqueIndex:idx_searches_user_name,where:deleted_at IS NULL"`
    User User `json:"-"`
    SetKind string `json:"set_kind"`
    MaxMagnitude *float64 `json:"max_magnitude"`
    // Named explicitly: GORM would derive "o_type" from the field,
    // which neither the JSON nor searchInputColumns spells that way.
    OType string `json:"otype" gorm:"column:otype"`
    Names Names `json:"names" gorm:"type:text"`
    StartTime string `json:"start_time"`
    EndTime string `json:"end_time"`
    StartDate string `json:"start_date"`
    EndDate string `json:"end_date"`
    Visibility string `json:"visibility"`
    MaxBrightness string `json:"max_brightness"`
    EvaluatedAt *time.Time `json:"evaluated_at"`
    EvaluatedPosition string `json:"evaluated_position"`
    /* What the evaluation actually used, not just the position's name,
    so a search whose position has since been edited can be told apart
    from one that is still current. The window only matters when
    visibility is "window"; the other criteria never consulted it. */
    EvaluatedLat float64 `json:"evaluated_lat"`
    EvaluatedLon float64 `json:"evaluated_lon"`
    EvaluatedMinAz float64 `json:"evaluated_min_az"`
    EvaluatedMaxAz float64 `json:"evaluated_max_az"`
    EvaluatedMinAlt float64 `json:"evaluated_min_alt"`
    EvaluatedMaxAlt float64 `json:"evaluated_max_alt"`
    TargetObjects []TargetObject
}

// One candidate of a search. RA and Dec are not used for solar system
// objects (SSObj == true), which the astro backend computes by name.
// Magnitude and ObjectType come from the catalog when it has them.
type TargetObject struct {
    gorm.Model
    TargetSearchID uint `json:"target_search_id" gorm:"index"`
    Name string `json:"name"`
    SSObj bool `json:"ss_obj"`
    RA float64 `json:"ra"`
    Dec float64 `json:"dec"`
    Magnitude *float64 `json:"magnitude"`
    ObjectType string `json:"object_type"`
    Matched bool `json:"matched"`
    /* Per-day records, deliberately absent from this struct's JSON:
    a search listing is shared by the header, the dialog and the sky
    view, and a full year of a list's records would add about a
    megabyte to every refetch. They are served by their own endpoint
    instead. */
    Days Days `json:"-" gorm:"type:text"`
}

// Check that a search definition makes sense: enum values, a magnitude
// where the set needs one, names where the set is a name list, HH:MM
// times, and an optional day range of at most 31 days. The message is
// shown in the searches dialog, so keep it readable.
func (s *TargetSearch) Validate() error {
    if strings.TrimSpace(s.Name) == "" {
	return errors.New("Name must not be empty")
    }
    if !oneOf(s.SetKind, setKinds) {
	return fmt.Errorf("Unknown target set %q", s.SetKind)
    }
    if s.MaxMagnitude != nil && (*s.MaxMagnitude < -30 || *s.MaxMagnitude > 30) {
	return errors.New("Maximum magnitude must be between -30 and 30")
    }
    if s.SetKind == "category" {
	if s.MaxMagnitude == nil {
	    return errors.New("A category needs a maximum magnitude")
	}
	if s.OType == "" {
	    return errors.New("A category needs an object type")
	}
	if !otypePattern.MatchString(s.OType) {
	    return fmt.Errorf("Not an object type code: %q", s.OType)
	}
    } else if s.OType != "" {
	return errors.New("Only a category has an object type")
    }
    if s.SetKind == "names" {
	if len(s.Names) == 0 {
	    return errors.New("A name list needs at least one name")
	}
	for _, n := range s.Names {
	    if strings.TrimSpace(n) == "" {
		return errors.New("Names must not be empty")
	    }
	}
    }
    if _, err := time.Parse("15:04", s.StartTime); err != nil {
	return errors.New("Start time must be HH:MM")
    }
    if _, err := time.Parse("15:04", s.EndTime); err != nil {
	return errors.New("End time must be HH:MM")
    }
    if (s.StartDate == "") != (s.EndDate == "") {
	return errors.New("A day range needs both a start and an end date")
    }
    if s.StartDate != "" {
	start, err := time.Parse("2006-01-02", s.StartDate)
	if err != nil {
	    return errors.New("Start date must be YYYY-MM-DD")
	}
	end, err := time.Parse("2006-01-02", s.EndDate)
	if err != nil {
	    return errors.New("End date must be YYYY-MM-DD")
	}
	if end.Before(start) {
	    return errors.New("End date must not be before the start date")
	}
	if end.Sub(start) > 365 * 24 * time.Hour {
	    return errors.New("A day range can span at most 366 days")
	}
    }
    if !oneOf(s.Visibility, visibilities) {
	return fmt.Errorf("Unknown visibility criterion %q", s.Visibility)
    }
    if !oneOf(s.MaxBrightness, brightnesses) {
	return fmt.Errorf("Unknown brightness limit %q", s.MaxBrightness)
    }
    return nil
}

// Check a submitted candidate: a name, and for fixed objects
// coordinates in range.
/* Candidates times days: the real size limit on an evaluation, since
it bounds both what one request computes and what is stored per
search. Must match schemas.MAX_CELLS in the astro backend. 65000
covers a full object list over a year (Messier is 110 x 366 = 40260)
and keeps the largest set-and-range combination that was legal before
per-day records existed (2000 x 31 = 62000). */
const MaxSearchCells = 65000

// Days in the search's day range; a definition without one is a
// single day, the night the application was showing when it was
// evaluated.
func (s *TargetSearch) DayCount() int {
    if s.StartDate == "" {
	return 1
    }
    start, errStart := time.Parse("2006-01-02", s.StartDate)
    end, errEnd := time.Parse("2006-01-02", s.EndDate)
    if errStart != nil || errEnd != nil {
	return 1
    }
    days := int(end.Sub(start).Hours() / 24) + 1
    if days < 1 {
	return 1
    }
    return days
}

// Length of one day's observing window in hours. An end that is not
// after the start runs into the next day, as the definition says.
func (s *TargetSearch) WindowHours() float64 {
    start, errStart := time.Parse("15:04", s.StartTime)
    end, errEnd := time.Parse("15:04", s.EndTime)
    if errStart != nil || errEnd != nil {
	return 24
    }
    span := end.Sub(start)
    if span <= 0 {
	span += 24 * time.Hour
    }
    return span.Hours()
}

// Reject a search whose candidate count times day count would exceed
// what one evaluation may produce. Separate from Validate because only
// the caller knows how many candidates came with the body.
func (s *TargetSearch) ValidateSize(candidates int) error {
    days := s.DayCount()
    if cells := candidates * days; cells > MaxSearchCells {
	return fmt.Errorf(
	    "%d candidates over %d days is %d evaluations, more than the "+
	    "%d that can be stored at once; use fewer objects or a "+
	    "shorter range", candidates, days, cells, MaxSearchCells)
    }
    return nil
}

/* Check a candidate's per-day records against the search they belong
to. The bounds are sanity checks on a client-supplied payload, not
precision checks, so they carry a little slack: a Sun upper-limb
altitude can exceed 90 degrees by the Sun's apparent radius where it
passes through the zenith. */
func (o *TargetObject) ValidateDays(dayCount int, windowHours float64) error {
    for _, d := range o.Days {
	index := d[DayIndex]
	if index != math.Trunc(index) || index < 0 || int(index) >= dayCount {
	    return fmt.Errorf(
		"Day %v of %s is outside the search's %d day range",
		index, o.Name, dayCount)
	}
	if d[DayHours] < 0 || d[DayHours] > windowHours+1e-6 {
	    return fmt.Errorf(
		"Qualifying hours %v of %s must be between 0 and the "+
		"window's %v hours", d[DayHours], o.Name, windowHours)
	}
	if d[DayMaxAlt] < -90.001 || d[DayMaxAlt] > 90.001 {
	    return fmt.Errorf("Peak altitude %v of %s must be between "+
		"-90 and 90", d[DayMaxAlt], o.Name)
	}
	if d[DayDarkSun] < -91 || d[DayDarkSun] > 91 {
	    return fmt.Errorf("Sun altitude %v of %s must be between "+
		"-90 and 90", d[DayDarkSun], o.Name)
	}
	if d[DayPeakMinutes] < 0 || d[DayPeakMinutes] > windowHours*60+1e-6 {
	    return fmt.Errorf("Peak offset %v of %s must fall inside the "+
		"day's window", d[DayPeakMinutes], o.Name)
	}
    }
    return nil
}

func (o *TargetObject) Validate() error {
    if strings.TrimSpace(o.Name) == "" {
	return errors.New("Candidate name must not be empty")
    }
    if o.SSObj {
	return nil
    }
    if o.RA < 0 || o.RA > 360 {
	return fmt.Errorf("Right ascension of %s must be between 0 and 360",
	    o.Name)
    }
    if o.Dec < -90 || o.Dec > 90 {
	return fmt.Errorf("Declination of %s must be between -90 and 90",
	    o.Name)
    }
    return nil
}

// Migrate to the latest models using GORM's automigrate. Called after
// the database connection has been successfully opened but before reporting
// the success further.
func MigrateDB(DB *gorm.DB) error {
    DB.AutoMigrate(&User{})
    DB.AutoMigrate(&Position{})
    DB.AutoMigrate(&TargetSearch{})
    DB.AutoMigrate(&TargetObject{})
    PurgeDeletedCandidates(DB)
    return nil
}

/* Delete candidate rows that were left behind soft-deleted.

A TargetObject is never meant to be soft-deleted: replaceCandidates is
the only code that removes one, and it replaces a search's candidates
as a unit. A row with deleted_at set is therefore unreachable garbage.
They accumulated because gorm.G dropped the Unscoped flag that delete
asked for (OBS-21), so every re-evaluation abandoned the previous
candidates;
with per-day records attached each abandoned row also carries its whole
grid. Idempotent and cheap once the backlog is gone, which is why it
can sit in the startup path. */
func PurgeDeletedCandidates(DB *gorm.DB) (int64, error) {
    result := DB.Unscoped().Where(
	"deleted_at IS NOT NULL").Delete(&TargetObject{})
    if result.Error != nil {
	log.Printf("purging soft-deleted candidates failed: %v", result.Error)
	return 0, result.Error
    }
    if result.RowsAffected > 0 {
	log.Printf("purged %d soft-deleted candidate rows", result.RowsAffected)
    }
    return result.RowsAffected, nil
}

// Initialize a test user and some test data. In production use this
// could be converted to create some sample data at new account creation.
func InitTestData(e *echo.Echo, DB *gorm.DB) error {
    ctx := context.Background()

    testuser, err := gorm.G[User](DB).Where(
	"username = ?",	"testuser").First(ctx)

    if err == nil {
	e.Logger.Info("Testuser: ", testuser)
    } else {
	new_testuser := User{Username: "testuser", Password: "aero123"}
	err := gorm.G[User](DB).Create(ctx, &new_testuser)
	if err != nil {
	    e.Logger.Error("Failed to create testuser: ", err.Error())
	    return err
	}
    }

    // Read back the testuser in case it was just created
    testuser, err = gorm.G[User](DB).Where(
	"username = ?",	"testuser").First(ctx)
    
    pos, err := gorm.G[Position](DB).Where(
	"user_id = ?", testuser.ID).First(ctx)
    if err == nil {
	e.Logger.Info("Position: ", pos)
    } else {
	new_pos := Position{Name: "Helsinki", UserID: testuser.ID,
	    Lat: 60.17, Lon: 24.94, MinAz: 0, MaxAz: 360,
	    MinAlt: 0, MaxAlt: 90}
	err := gorm.G[Position](DB).Create(ctx, &new_pos)
	if err != nil {
	    e.Logger.Error("Failed to create position: ", err.Error())
	    return err
	}
    }

    return seedPlanetsSearch(e, DB, testuser.ID)
}

/* The definition the seeded "Planets" search has: every planet, no
filtering, evaluated for the seeded position. */
func planetsSearchDefinition(userID uint) TargetSearch {
    now := time.Now()
    return TargetSearch{Name: "Planets", UserID: userID, SetKind: "planets",
	Names: Names{}, StartTime: "22:00", EndTime: "02:00",
	Visibility: "none", MaxBrightness: "D", EvaluatedAt: &now,
	EvaluatedPosition: "Helsinki"}
}

/* Seed the test user's "Planets" search, or bring an existing one up to
date. Databases seeded before searches had definitions have a "Planets"
row with an empty set kind and its objects only in the old
search_results join table; fill in the definition and create the
per-search candidates for it so the sky view keeps showing the planets.
Idempotent: a row with a definition and candidates is left alone. */
func seedPlanetsSearch(e *echo.Echo, DB *gorm.DB, userID uint) error {
    ctx := context.Background()

    search, err := gorm.G[TargetSearch](DB).Where(
	"user_id = ?", userID).First(ctx)
    if err != nil {
	search = planetsSearchDefinition(userID)
	if err := gorm.G[TargetSearch](DB).Create(ctx, &search); err != nil {
	    e.Logger.Error("Failed to create search: ", err.Error())
	    return err
	}
    } else if search.SetKind == "" {
	def := planetsSearchDefinition(userID)
	def.Name = search.Name
	_, err := gorm.G[TargetSearch](DB).Where("id = ?", search.ID).Select(
	    "set_kind", "names", "start_time", "end_time", "visibility",
	    "max_brightness", "evaluated_at", "evaluated_position").Updates(
	    ctx, def)
	if err != nil {
	    e.Logger.Error("Failed to backfill search: ", err.Error())
	    return err
	}
	e.Logger.Info("Backfilled the definition of search: ", search.Name)
    } else {
	e.Logger.Info("TargetSearch: ", search)
    }

    count, err := gorm.G[TargetObject](DB).Where(
	"target_search_id = ?", search.ID).Count(ctx, "*")
    if err != nil {
	return err
    }
    if count > 0 {
	return nil
    }
    for _, p := range planetNames {
	new_obj := TargetObject{TargetSearchID: search.ID, Name: p,
	    SSObj: true, Matched: true}
	if err := gorm.G[TargetObject](DB).Create(ctx, &new_obj); err != nil {
	    e.Logger.Error("Failed to create candidate: ", err.Error())
	    return err
	}
    }
    return nil
}

// Set here and exported because the server main and health need to
// access this
var DB_err error

// Connect to the database using parameters from the environment
// variables. This should run in a separate goroutine to avoid blocking
// the server start. Returns the GORM database handle through the
// given channel, or nil when unsuccessful.
func ConnectDB(db_chan chan<- *gorm.DB) {
    var DB *gorm.DB

    sslmode := os.Getenv("OBS_DB_SSLMODE")
    if sslmode == "" {
	sslmode = "disable"
    }
    dsn := fmt.Sprintf("host=%v user=%v password=%v dbname=%v port=%v sslmode=%v",
	os.Getenv("OBS_DB_HOST"), os.Getenv("OBS_DB_USER"),
	os.Getenv("OBS_DB_PASSWORD"), os.Getenv("OBS_DB_NAME"),
	os.Getenv("OBS_DB_PORT"), sslmode)
    DB, DB_err = gorm.Open(postgres.Open(dsn), &gorm.Config{})

    if DB_err == nil {
	MigrateDB(DB)
	db_chan <- DB
    } else {
	db_chan <- nil
    }
}

