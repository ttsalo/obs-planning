package main

import (
    "context"
    "encoding/json"
    "encoding/base64"
    "fmt"
    "net/http"
    "os"
    "time"
    "github.com/labstack/echo/v4"
    "gorm.io/driver/postgres"
    "gorm.io/gorm"
)

var db_err error

type Session struct {
    LAT float64 `json:"lat"`
    LON float64 `json:"lon"`
    TARGET string `json:"target"`
}

/* Decode the session cookie and return the contents to the frontend,
or create a new cookie. The cookie is opaque to the frontend, so
this is how the frontend accesses the contents. */
func getSession(c echo.Context) error {
    cookie, err := c.Cookie("obs-session")
    if err != nil || cookie.Valid() != nil {
	new_cookie := new(http.Cookie)
	new_cookie.Name = "obs-session"
	cookie_data := make(map[string]any)
	cookie_data["lat"] = 0.0
	cookie_data["lon"] = 0.0
	b, _ := json.Marshal(cookie_data)
	new_cookie.Value = base64.URLEncoding.EncodeToString(b)
	c.SetCookie(new_cookie)
	return c.JSON(http.StatusOK, cookie_data)
    }

    b, err := base64.URLEncoding.DecodeString(cookie.Value)
    if err != nil {
	return c.JSON(http.StatusBadRequest, "Failed to decode Base64")
    }

    var cookie_data map[string]any
    if err := json.Unmarshal(b, &cookie_data); err != nil {
	return c.JSON(http.StatusBadRequest, "Failed to unmarshal JSON")
    }

    return c.JSON(http.StatusOK, cookie_data)
}

func updateSession(c echo.Context) error {
    cookie, err := c.Cookie("obs-session")
    if err != nil || cookie.Valid() != nil {
	return c.JSON(http.StatusBadRequest, "No valid cookie found")
    }
    
    b, err := base64.URLEncoding.DecodeString(cookie.Value)
    if err != nil {
	return c.JSON(http.StatusBadRequest, "Failed to decode Base64")
    }

    var cookie_data map[string]any
    if err := json.Unmarshal(b, &cookie_data); err != nil {
	return c.JSON(http.StatusBadRequest, "Failed to unmarshal JSON")
    }

    var updated_data Session
    c.Bind(&updated_data)
    cookie_data["lat"] = updated_data.LAT
    cookie_data["lon"] = updated_data.LON
    cookie_data["target"] = updated_data.TARGET

    b, _ = json.Marshal(cookie_data)
    cookie.Value = base64.URLEncoding.EncodeToString(b)
    c.SetCookie(cookie)
    return c.JSON(http.StatusOK, cookie_data)
}

type HealthReply struct {
    Status string `json:"status"`
    Error string `json:"error"`
}

func health(c echo.Context) error {
    var r *HealthReply
    if db_err != nil {
	r = &HealthReply{
	    Status: "fail",
	    Error: fmt.Sprintf("%v", db_err)}
    } else {
	r = &HealthReply{Status: "pass"}
    }
    return c.JSON(http.StatusOK, r)
}

type User struct {
    gorm.Model
    Username  string
    Password string
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

func initDB(db_chan chan<- *gorm.DB) {
    var DB *gorm.DB
    
    dsn := fmt.Sprintf("host=%v user=%v password=%v dbname=%v port=%v",
	os.Getenv("OBS_DB_HOST"), os.Getenv("OBS_DB_USER"),
	os.Getenv("OBS_DB_PASSWORD"), os.Getenv("OBS_DB_NAME"),
	os.Getenv("OBS_DB_PORT"))
    DB, db_err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
    
    if db_err == nil {
	DB.AutoMigrate(&User{})
	DB.AutoMigrate(&TargetSearch{})
	DB.AutoMigrate(&TargetObject{})
	db_chan <- DB
    } else {
	db_chan <- nil
    }
}

func registerDBEndpoints(e *echo.Echo, DB *gorm.DB) {
    e.Logger.Info("Registering DB endpoints")
    
    ctx := context.Background()

    user, err := gorm.G[User](DB).Where("username = ?", "testuser").First(ctx)

    if err == nil {
	e.Logger.Info("Testuser: ", user)
    } else {
	testuser := User{Username: "testuser", Password: "password",
	    Active: true}
	err := gorm.G[User](DB).Create(ctx, &testuser)
	if err != nil {
	    e.Logger.Error("Failed to create testuser: ", err.Error())
	} else {
	    e.Logger.Info("Created testuser: ", testuser)
	}
    }
}

func main() {
    var DB *gorm.DB
    
    e := echo.New()
    e.Debug = true

    e.GET("/health", health)
    e.GET("/get-session", getSession)
    e.POST("/update-session", updateSession)
    e.Static("/", "static")
    
    envp := os.Getenv("OBS_SERVER_PORT")

    // Run echo server in a separate goroutine so that we can perform
    // other actions in the main thread
    go func() {
	if envp != "" {
	    e.Logger.Fatal(e.Start(":" + envp))
	} else {
	    e.Logger.Fatal(e.Start(":80"))
	}
    }()

    // Connect to database in a separate goroutine so that delay (or
    // failure) in connecting to db doesn't prevent non-db endpoints
    // from going up (/health for example)
    db_chan := make(chan *gorm.DB)
    go initDB(db_chan)

    ticker := time.NewTicker(60 * time.Second)

    for {
	select {
	case t := <-ticker.C:
	    e.Logger.Info("Tick ", t)
	case DB = <-db_chan:
	    if DB != nil {
		registerDBEndpoints(e, DB)
	    } else {
		e.Logger.Error("Failed to connect to DB ", db_err)
	    }
	}
    }
}
