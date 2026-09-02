package main

import (
    "context"
    "fmt"
    "net/http"
    "strconv"
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
    r.POST("/positions", h.createPosition)
    r.PUT("/positions/:id", h.updatePosition)
    r.DELETE("/positions/:id", h.deletePosition)
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

// Resolve the DB user row for the JWT's username. Every /api endpoint
// scopes its query by this, so the lookup lives in one place; the
// returned error is already a JSON response ready to be returned.
func (h *Handler) jwtUser(c echo.Context) (User, error) {
    ctx := context.Background()
    username := h.UsernameFromJWT(c)
    db_user, err := gorm.G[User](h.DB).Where(
	"username = ?", username).First(ctx)
    if err != nil {
	return db_user, c.JSON(http.StatusInternalServerError, err.Error())
    }
    return db_user, nil
}

// Return stored positions for the current user. Expected number per user
// is so small that filtering can be done on the client side.
func (h *Handler) positions(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return resp
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

// The editable fields of a position. Requests bind into this rather
// than straight into Position so a body can't set the row's ID, its
// owner or the GORM bookkeeping fields; those come from the path and
// the JWT.
type PositionInput struct {
    Name string `json:"name"`
    Lat float64 `json:"lat"`
    Lon float64 `json:"lon"`
    MinAz float64 `json:"min_az"`
    MaxAz float64 `json:"max_az"`
    MinAlt float64 `json:"min_alt"`
    MaxAlt float64 `json:"max_alt"`
}

// The editable columns after the name, as the variadic tail of a
// Select. Naming the columns explicitly is what makes the update write
// the ones that happen to be zero too; GORM's struct Updates skips
// zero values on its own.
var positionInputColumns = []any{"lat", "lon", "min_az", "max_az",
    "min_alt", "max_alt"}

// Copy the editable fields onto a position row.
func (in *PositionInput) applyTo(p *Position) {
    p.Name = in.Name
    p.Lat = in.Lat
    p.Lon = in.Lon
    p.MinAz = in.MinAz
    p.MaxAz = in.MaxAz
    p.MinAlt = in.MinAlt
    p.MaxAlt = in.MaxAlt
}

/* Does the user already have a position by this name? The unique index
on (user_id, name) is the real guarantee, but pre-checking here means
the user gets the same 409 and the same message on both Postgres and
SQLite instead of a driver-specific constraint error. excludeID is the
row being updated (0 when creating), which must not conflict with
itself. */
func (h *Handler) positionNameTaken(ctx context.Context, userID uint,
	name string, excludeID uint) (bool, error) {
    count, err := gorm.G[Position](h.DB).Where(
	"user_id = ? AND name = ? AND id <> ?", userID, name,
	excludeID).Count(ctx, "*")
    return count > 0, err
}

// Create a new position owned by the current user, returning it with
// the assigned ID.
func (h *Handler) createPosition(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return resp
    }

    var in PositionInput
    if err := c.Bind(&in); err != nil {
	return c.JSON(http.StatusBadRequest, "Failed to parse the position")
    }

    pos := Position{UserID: db_user.ID}
    in.applyTo(&pos)
    if err := pos.Validate(); err != nil {
	return c.JSON(http.StatusBadRequest, err.Error())
    }

    taken, err := h.positionNameTaken(ctx, db_user.ID, pos.Name, 0)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    if taken {
	return c.JSON(http.StatusConflict, fmt.Sprintf(
	    "A position named %q already exists", pos.Name))
    }

    if err := gorm.G[Position](h.DB).Create(ctx, &pos); err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    return c.JSON(http.StatusCreated, pos)
}

/* Look up one of the current user's positions by the :id path
parameter. Scoping the query by user as well as by id makes another
user's position indistinguishable from one that doesn't exist, so
neither the 404 nor its timing reveals that the row is there. */
func (h *Handler) ownPosition(c echo.Context, userID uint) (Position, error) {
    ctx := context.Background()
    var pos Position

    id, err := strconv.ParseUint(c.Param("id"), 10, 64)
    if err != nil {
	return pos, c.JSON(http.StatusBadRequest, "Invalid position id")
    }

    pos, err = gorm.G[Position](h.DB).Where(
	"id = ? AND user_id = ?", id, userID).First(ctx)
    if err != nil {
	return pos, c.JSON(http.StatusNotFound, "Position not found")
    }
    return pos, nil
}

// Replace the editable fields of one of the current user's positions.
func (h *Handler) updatePosition(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return resp
    }

    pos, resp := h.ownPosition(c, db_user.ID)
    if resp != nil {
	return resp
    }

    var in PositionInput
    if err := c.Bind(&in); err != nil {
	return c.JSON(http.StatusBadRequest, "Failed to parse the position")
    }
    in.applyTo(&pos)
    if err := pos.Validate(); err != nil {
	return c.JSON(http.StatusBadRequest, err.Error())
    }

    taken, err := h.positionNameTaken(ctx, db_user.ID, pos.Name, pos.ID)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    if taken {
	return c.JSON(http.StatusConflict, fmt.Sprintf(
	    "A position named %q already exists", pos.Name))
    }

    _, err = gorm.G[Position](h.DB).Where(
	"id = ? AND user_id = ?", pos.ID, db_user.ID).Select(
	"name", positionInputColumns...).Updates(ctx, pos)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    return c.JSON(http.StatusOK, pos)
}

/* Delete one of the current user's positions. The last one is refused:
the sky view has nowhere to render from without a position, and the
session's default assumes one exists. The dialog disables its delete
button for the same reason, but the rule is enforced here so that is a
convenience rather than the only guard. */
func (h *Handler) deletePosition(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return resp
    }

    pos, resp := h.ownPosition(c, db_user.ID)
    if resp != nil {
	return resp
    }

    count, err := gorm.G[Position](h.DB).Where(
	"user_id = ?", db_user.ID).Count(ctx, "*")
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    if count <= 1 {
	return c.JSON(http.StatusConflict,
	    "The last position can't be deleted")
    }

    _, err = gorm.G[Position](h.DB).Where(
	"id = ? AND user_id = ?", pos.ID, db_user.ID).Delete(ctx)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    return c.NoContent(http.StatusNoContent)
}

// Return stored searches for the current user. Expected number per user
// is so small that filtering can be done on the client side.
func (h *Handler) searches(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return resp
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
