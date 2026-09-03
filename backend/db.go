package main

import (
    "context"
    "database/sql/driver"
    "encoding/json"
    "errors"
    "fmt"
    "os"
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

// The vocabulary of a search definition. A target set is one of the
// kinds; the visibility and brightness criteria are what the stored
// candidates were filtered by.
var (
    setKinds = []string{"planets", "messier", "double_stars", "names"}
    visibilities = []string{"window", "horizon", "none"}
    brightnesses = []string{"N", "AT", "NT", "CT", "D"}
)

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
    Names Names `json:"names" gorm:"type:text"`
    StartTime string `json:"start_time"`
    EndTime string `json:"end_time"`
    StartDate string `json:"start_date"`
    EndDate string `json:"end_date"`
    Visibility string `json:"visibility"`
    MaxBrightness string `json:"max_brightness"`
    EvaluatedAt *time.Time `json:"evaluated_at"`
    EvaluatedPosition string `json:"evaluated_position"`
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
    if s.SetKind == "double_stars" && s.MaxMagnitude == nil {
	return errors.New("Double stars need a maximum magnitude")
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
	if end.Sub(start) > 30 * 24 * time.Hour {
	    return errors.New("A day range can span at most 31 days")
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
    return nil
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

