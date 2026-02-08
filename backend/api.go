package main

import (
    "context"
    "net/http"
    "github.com/golang-jwt/jwt/v5"
    "github.com/labstack/echo/v4"
    "gorm.io/gorm"
)

type Handler struct {
    DB *gorm.DB
}

// Register API endpoints that require a database. This is separate
// so that we can get the basic endpoints up even without a database.
func RegisterDBEndpoints(e *echo.Echo, r *echo.Group, DB *gorm.DB) error {
    err := InitDB(e, DB)
    if err != nil {
	return err
    }

    h := Handler{DB: DB}

    e.POST("/login", h.login)

    pos_group := r.Group("/positions")
    pos_group.GET("/", h.positions)

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
	return c.JSON(http.StatusUnauthorized, "Invalid login credentials")
    } else {
	claims := jwt.MapClaims{"username": user.Username}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	// Generate encoded token and send it as response.
	t, err := token.SignedString([]byte("secret"))
	if err != nil {
	    return c.JSON(http.StatusInternalServerError,
		"Failed to generate JWT token")
	} else {
	    return c.JSON(http.StatusOK, map[string]any{"token": t})
	}
    }
}

func (h *Handler) positions(c echo.Context) error {
    ctx := context.Background()
    //params := c.QueryParams()
    baseQ := gorm.G[Position](h.DB)
    //positions, err := gorm.G[Position](h.DB).Where(&params).Find(ctx)
    positions, err := baseQ.Find(ctx)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    } else {
	return c.JSON(http.StatusOK, positions)
    }
}
