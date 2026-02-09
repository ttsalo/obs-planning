package main

import (
    "context"
    "fmt"
    "os"
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
// position)
type Position struct {
    gorm.Model
    Name string `json:"name"`
    UserID uint `json:"user_id"`
    User User
    Lat float64 `json:"lat"`
    Lon float64 `json:"lon"`
    MinAz float64 `json:"min_az"`
    MaxAz float64 `json:"max_az"`
    MinAlt float64 `json:"min_alt"`
    MaxAlt float64 `json:"max_alt"`
}

// Stored search object. Workflow is that user specifies a search string
// in the frontend, performs the search in the astrobackend, reviews
// results, optionally selects a subset, then the search and the results
// are stored into this and the TargetObject table when the search dialog
// is closed. After that the frontend reads back the results for rendering
// the target positions and paths in the sky.
type TargetSearch struct {
    gorm.Model
    Name string `json:"name"`
    SearchStr string `json:"search_str"`
    UserID uint `json:"user_id"`
    User User
    TargetObjects []TargetObject `gorm:"many2many:search_results;"`
}

// Single search result object. RA and Dec are not used for solar system
// objects (SSObj == true)
type TargetObject struct {
    gorm.Model
    Name string `json:"name"`
    SSObj bool `json:"ss_obj"`
    RA float64 `json:"ra"`
    Dec float64 `json:"dec"`
    TargetSearches []TargetSearch `gorm:"many2many:search_results;"`
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

    search, err := gorm.G[TargetSearch](DB).Where(
	"user_id = ?", testuser.ID).First(ctx)
    if err == nil {
	e.Logger.Info("TargetSearch: ", search)
	return nil
    }

    new_search := TargetSearch{Name: "Planets", SearchStr: "",
	UserID: testuser.ID}
    err = gorm.G[TargetSearch](DB).Create(ctx, &new_search)
    if err != nil {
	e.Logger.Error("Failed to create search: ", err.Error())
	return err
    }
    search, _ = gorm.G[TargetSearch](DB).Where(
	"user_id = ?", testuser.ID).First(ctx)
    
    for _, p := range [...]string {"Mercury", "Venus", "Moon", "Mars",
	"Jupiter", "Saturn", "Uranus", "Neptune"} {
	    new_obj := TargetObject{Name: p, SSObj: true, TargetSearches: []TargetSearch{search}}
	    err = gorm.G[TargetObject](DB).Create(ctx, &new_obj)	    
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
    
    dsn := fmt.Sprintf("host=%v user=%v password=%v dbname=%v port=%v",
	os.Getenv("OBS_DB_HOST"), os.Getenv("OBS_DB_USER"),
	os.Getenv("OBS_DB_PASSWORD"), os.Getenv("OBS_DB_NAME"),
	os.Getenv("OBS_DB_PORT"))
    DB, DB_err = gorm.Open(postgres.Open(dsn), &gorm.Config{})

    if DB_err == nil {
	MigrateDB(DB)
	db_chan <- DB
    } else {
	db_chan <- nil
    }
}

