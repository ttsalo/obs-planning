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
    Active bool
}

type TargetSearch struct {
    gorm.Model
    Name string
    UserID int
    User User
    TargetObjects []TargetObject `gorm:"many2many:search_results;"`
}

type TargetObject struct {
    gorm.Model
    Name string
    RA float64
    Dec float64
    TargetSearches []TargetSearch `gorm:"many2many:search_results;"`
}

// Migrate to the latest models using GORM's automigrate. Called after
// the database connection has been successfully opened but before reporting
// the success further.
func MigrateDB(DB *gorm.DB) error {
    DB.AutoMigrate(&User{})
    DB.AutoMigrate(&TargetSearch{})
    DB.AutoMigrate(&TargetObject{})
    return nil
}

// Initialize the database contents, if necessary. Currently creates
// a hardcoded test user account.
func InitDB(e *echo.Echo, DB *gorm.DB) error {
    ctx := context.Background()

    user, err := gorm.G[User](DB).Where("username = ?", "testuser").First(ctx)

    if err == nil {
	e.Logger.Info("Testuser: ", user)
	return nil
    } else {
	testuser := User{Username: "testuser", Password: "aero123",
	    Active: true}
	err := gorm.G[User](DB).Create(ctx, &testuser)
	if err != nil {
	    e.Logger.Error("Failed to create testuser: ", err.Error())
	    return err
	} else {
	    e.Logger.Info("Created testuser: ", testuser)
	    return nil
	}
    }
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

