package main

import (
    "context"
    "net/http"
    "github.com/labstack/echo/v4"
    "gorm.io/gorm"
)

type Handler struct {
    DB *gorm.DB
}

// Register API endpoints that require a database. This is separate
// so that we can get the basic endpoints up even without a database.
func RegisterDBEndpoints(e *echo.Echo, DB *gorm.DB) error {
    err := InitDB(e, DB)
    if err != nil {
	return err
    }

    h := Handler{DB: DB}
	
    e.POST("/login", h.login)

    return nil
}

type LoginData struct {
    Username string `json:"username"`
    Password string `json:"password"`
}

func (h *Handler) login(c echo.Context) error {
    var login_data LoginData
    c.Bind(&login_data)

    ctx := context.Background()
    user, err := gorm.G[User](h.DB).Where("username = ? AND password = ?",
	login_data.Username, login_data.Password).First(ctx)

    if err != nil {
	return c.JSON(http.StatusForbidden, "Invalid login credentials")
    } else {
	return c.JSON(http.StatusOK, user)
    }
}

