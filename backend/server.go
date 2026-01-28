package main

import (
    "encoding/json"
    "encoding/base64"
    "fmt"
    "net/http"
    "os"
    "time"
    "github.com/labstack/echo/v4"
    "gorm.io/gorm"
)

var DB_err error

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
    if DB_err != nil {
	r = &HealthReply{
	    Status: "fail",
	    Error: fmt.Sprintf("%v", DB_err)}
    } else {
	r = &HealthReply{Status: "pass"}
    }
    return c.JSON(http.StatusOK, r)
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
    go ConnectDB(db_chan)

    ticker := time.NewTicker(60 * time.Second)

    for {
	select {
	case t := <-ticker.C:
	    e.Logger.Info("Tick ", t)
	case DB = <-db_chan:
	    if DB != nil {
		RegisterDBEndpoints(e, DB)
	    } else {
		e.Logger.Error("Failed to connect to DB: ", DB_err)
	    }
	}
    }
}
