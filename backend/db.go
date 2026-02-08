package main

import (
    "context"
    "fmt"
    "os"
    "github.com/labstack/echo/v4"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

type User struct {
    gorm.Model
    Username  string `json:"username"`
    Password string `json:"password"`
}

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
    Active bool `json:"active"`
}

type TargetSearch struct {
    gorm.Model
    Name string `json:"name"`
    UserID uint `json:"user_id"`
    User User
    TargetObjects []TargetObject `gorm:"many2many:search_results;"`
}

type TargetObject struct {
    gorm.Model
    Name string `json:"name"`
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

// Initialize the database contents, if necessary. Currently creates
// a hardcoded test user account and one observation position for that user.
func InitDB(e *echo.Echo, DB *gorm.DB) error {
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
	    MinAlt: 0, MaxAlt: 90, Active: true}
	err := gorm.G[Position](DB).Create(ctx, &new_pos)
	if err != nil {
	    e.Logger.Error("Failed to create position: ", err.Error())
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

