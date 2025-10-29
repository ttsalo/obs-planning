package main

import (
    "encoding/json"
    "encoding/base64"
    "fmt"
    "net/http"
    "github.com/labstack/echo/v4"
)

func getSession(c echo.Context) error {
    cookie, err := c.Cookie("obs-session")
    if err != nil || cookie.Valid() != nil {
	fmt.Println("Creating new cookie")
	new_cookie := new(http.Cookie)
	new_cookie.Name = "obs-session"
	cookie_data := make(map[string]any)
	cookie_data["testing"] = "Foobar"
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

func main() {
    e := echo.New()
    e.Debug = true
    e.GET("/get-session", getSession)
    e.Static("/", "static")
    e.Logger.Fatal(e.Start(":80"))
}
