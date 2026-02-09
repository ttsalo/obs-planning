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
    UsernameFromJWT func (echo.Context) string
}

// Register API endpoints that require a database. This is separate
// so that we can get the basic endpoints up even without a database.
// r is the restricted (API) part of the url namespace.
func RegisterDBEndpoints(e *echo.Echo, r *echo.Group, DB *gorm.DB) error {
    h := Handler{DB: DB, UsernameFromJWT: UsernameFromJWT}

    e.POST("/login", h.login)
    r.GET("/positions", h.positions)
    r.GET("/searches", h.searches)

    return nil
}

type LoginData struct {
    Username string `json:"username"`
    Password string `json:"password"`
}

// Login, basic username and password, returns {"token": <JWT>} if
// successful. JWT claims is just the username. Other endpoints do a
// super simple permission checking by getting the username from the
// JWT and filtering DB objects using it.
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

// Return stored positions for the current user. Expected number per user
// is so small that filtering can be done on the client side.
func (h *Handler) positions(c echo.Context) error {
    ctx := context.Background()
    username := h.UsernameFromJWT(c)
    db_user, err := gorm.G[User](h.DB).Where(
	"username = ?", username).First(ctx)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    positions, err := gorm.G[Position](h.DB).Select("ID", "name", "lat", "lon",
	"min_az", "max_az", "min_alt", "max_alt").Where(
	"user_id = ?", db_user.ID).Find(ctx)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    } else {
	return c.JSON(http.StatusOK, positions)
    }
}

// Return stored searches for the current user. Expected number per user
// is so small that filtering can be done on the client side.
func (h *Handler) searches(c echo.Context) error {
    ctx := context.Background()
    username := h.UsernameFromJWT(c)
    db_user, err := gorm.G[User](h.DB).Where(
	"username = ?", username).First(ctx)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    searches, err := gorm.G[TargetSearch](h.DB).Select("ID", "name",
	"search_str").Where("user_id = ?", db_user.ID).Preload(
	    "TargetObjects", nil).Find(ctx)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    } else {
	return c.JSON(http.StatusOK, searches)
    }
}
