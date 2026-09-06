package main

import (
    "context"
    "errors"
    "fmt"
    "net/http"
    "strconv"
    "strings"
    "time"
    "github.com/golang-jwt/jwt/v5"
    "github.com/labstack/echo/v4"
    "gorm.io/gorm"
)

type Handler struct {
    DB *gorm.DB
    UsernameFromJWT func (echo.Context) string
}

/* Helpers that look things up on behalf of a handler write their own
error response and return errResponded so the handler knows to stop.
c.JSON's own return value can't serve as that signal: it is nil
whenever the write succeeded, which is exactly when the handler must
not carry on. A handler turns the marker back into a nil return with
handled(), since the response is already committed. */
var errResponded = errors.New("response already written")

func respond(c echo.Context, status int, body any) error {
    if err := c.JSON(status, body); err != nil {
	return err
    }
    return errResponded
}

func handled(resp error) error {
    if errors.Is(resp, errResponded) {
	return nil
    }
    return resp
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
    r.POST("/searches", h.createSearch)
    r.PUT("/searches/:id", h.updateSearch)
    r.DELETE("/searches/:id", h.deleteSearch)

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
	return db_user, respond(c, http.StatusInternalServerError, err.Error())
    }
    return db_user, nil
}

// Return stored positions for the current user. Expected number per user
// is so small that filtering can be done on the client side.
func (h *Handler) positions(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return handled(resp)
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
	return handled(resp)
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
	return pos, respond(c, http.StatusBadRequest, "Invalid position id")
    }

    pos, err = gorm.G[Position](h.DB).Where(
	"id = ? AND user_id = ?", id, userID).First(ctx)
    if err != nil {
	return pos, respond(c, http.StatusNotFound, "Position not found")
    }
    return pos, nil
}

// Replace the editable fields of one of the current user's positions.
func (h *Handler) updatePosition(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return handled(resp)
    }

    pos, resp := h.ownPosition(c, db_user.ID)
    if resp != nil {
	return handled(resp)
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
	return handled(resp)
    }

    pos, resp := h.ownPosition(c, db_user.ID)
    if resp != nil {
	return handled(resp)
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

// Return stored searches for the current user with their candidates.
// Expected number per user is so small that filtering can be done on
// the client side.
func (h *Handler) searches(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return handled(resp)
    }
    searches, err := gorm.G[TargetSearch](h.DB).Where(
	"user_id = ?", db_user.ID).Preload("TargetObjects", nil).Find(ctx)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    } else {
	return c.JSON(http.StatusOK, searches)
    }
}

// One submitted candidate of a search.
type TargetObjectInput struct {
    Name string `json:"name"`
    SSObj bool `json:"ss_obj"`
    RA float64 `json:"ra"`
    Dec float64 `json:"dec"`
    Magnitude *float64 `json:"magnitude"`
    ObjectType string `json:"object_type"`
    Matched bool `json:"matched"`
}

// The editable fields of a search plus its candidates. Like
// PositionInput, bodies bind into this rather than the model so the
// row's ID, owner and bookkeeping fields come from the path and the JWT.
type SearchInput struct {
    Name string `json:"name"`
    SetKind string `json:"set_kind"`
    MaxMagnitude *float64 `json:"max_magnitude"`
    Names Names `json:"names"`
    StartTime string `json:"start_time"`
    EndTime string `json:"end_time"`
    StartDate string `json:"start_date"`
    EndDate string `json:"end_date"`
    Visibility string `json:"visibility"`
    MaxBrightness string `json:"max_brightness"`
    EvaluatedAt *time.Time `json:"evaluated_at"`
    EvaluatedPosition string `json:"evaluated_position"`
    Candidates []TargetObjectInput `json:"candidates"`
}

// The definition columns an update writes, after the name. Explicit so
// zero values and nulls (a cleared magnitude, an emptied day range) are
// written too.
var searchInputColumns = []any{"set_kind", "max_magnitude", "names",
    "start_time", "end_time", "start_date", "end_date", "visibility",
    "max_brightness", "evaluated_at", "evaluated_position"}

// Copy the editable fields onto a search row, trimming the name and
// the name list, and dropping the list for sets that don't use one.
func (in *SearchInput) applyTo(s *TargetSearch) {
    s.Name = strings.TrimSpace(in.Name)
    s.SetKind = in.SetKind
    s.MaxMagnitude = in.MaxMagnitude
    s.Names = Names{}
    if in.SetKind == "names" {
	for _, n := range in.Names {
	    s.Names = append(s.Names, strings.TrimSpace(n))
	}
    }
    s.StartTime = in.StartTime
    s.EndTime = in.EndTime
    s.StartDate = in.StartDate
    s.EndDate = in.EndDate
    s.Visibility = in.Visibility
    s.MaxBrightness = in.MaxBrightness
    s.EvaluatedAt = in.EvaluatedAt
    s.EvaluatedPosition = in.EvaluatedPosition
}

// The submitted candidates as rows for the given search, validated.
func (in *SearchInput) candidateRows(searchID uint) ([]TargetObject, error) {
    rows := []TargetObject{}
    for _, c := range in.Candidates {
	obj := TargetObject{TargetSearchID: searchID,
	    Name: strings.TrimSpace(c.Name), SSObj: c.SSObj,
	    RA: c.RA, Dec: c.Dec, Magnitude: c.Magnitude,
	    ObjectType: c.ObjectType, Matched: c.Matched}
	if err := obj.Validate(); err != nil {
	    return nil, err
	}
	rows = append(rows, obj)
    }
    return rows, nil
}

// Does the user already have a search by this name? See
// positionNameTaken for why this is pre-checked.
func (h *Handler) searchNameTaken(ctx context.Context, userID uint,
	name string, excludeID uint) (bool, error) {
    count, err := gorm.G[TargetSearch](h.DB).Where(
	"user_id = ? AND name = ? AND id <> ?", userID, name,
	excludeID).Count(ctx, "*")
    return count > 0, err
}

// Look up one of the current user's searches by the :id path parameter,
// scoped by user like ownPosition so a foreign search is a 404.
func (h *Handler) ownSearch(c echo.Context, userID uint) (TargetSearch, error) {
    ctx := context.Background()
    var search TargetSearch

    id, err := strconv.ParseUint(c.Param("id"), 10, 64)
    if err != nil {
	return search, respond(c, http.StatusBadRequest, "Invalid search id")
    }

    search, err = gorm.G[TargetSearch](h.DB).Where(
	"id = ? AND user_id = ?", id, userID).First(ctx)
    if err != nil {
	return search, respond(c, http.StatusNotFound, "Search not found")
    }
    return search, nil
}

// A search with its candidates, as the listing returns it.
func (h *Handler) loadSearch(ctx context.Context, id uint) (TargetSearch, error) {
    return gorm.G[TargetSearch](h.DB).Where("id = ?", id).Preload(
	"TargetObjects", nil).First(ctx)
}

// Bind and validate a search body, returning either the validated
// search and candidate rows or the JSON error response to return.
func (h *Handler) bindSearch(c echo.Context, search *TargetSearch,
	userID uint) ([]TargetObject, error) {
    ctx := context.Background()
    var in SearchInput
    if err := c.Bind(&in); err != nil {
	return nil, respond(c, http.StatusBadRequest, "Failed to parse the search")
    }
    in.applyTo(search)
    if err := search.Validate(); err != nil {
	return nil, respond(c, http.StatusBadRequest, err.Error())
    }
    rows, err := in.candidateRows(search.ID)
    if err != nil {
	return nil, respond(c, http.StatusBadRequest, err.Error())
    }

    taken, err := h.searchNameTaken(ctx, userID, search.Name, search.ID)
    if err != nil {
	return nil, respond(c, http.StatusInternalServerError, err.Error())
    }
    if taken {
	return nil, respond(c, http.StatusConflict, fmt.Sprintf(
	    "A search named %q already exists", search.Name))
    }
    return rows, nil
}

/* Replace a search's candidates. Hard-deleted rather than soft-deleted:
every re-evaluation replaces up to 2000 rows, and nothing wants the old
ones back. */
func replaceCandidates(ctx context.Context, tx *gorm.DB, searchID uint,
	rows []TargetObject) error {
    if _, err := gorm.G[TargetObject](tx.Unscoped()).Where(
	"target_search_id = ?", searchID).Delete(ctx); err != nil {
	return err
    }
    for i := range rows {
	rows[i].TargetSearchID = searchID
    }
    if len(rows) == 0 {
	return nil
    }
    return gorm.G[TargetObject](tx).CreateInBatches(ctx, &rows, 200)
}

// Create a new search owned by the current user, with its candidates,
// returning it with the assigned ID.
func (h *Handler) createSearch(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return handled(resp)
    }

    search := TargetSearch{UserID: db_user.ID}
    rows, resp := h.bindSearch(c, &search, db_user.ID)
    if resp != nil {
	return handled(resp)
    }

    err := h.DB.Transaction(func(tx *gorm.DB) error {
	if err := gorm.G[TargetSearch](tx).Create(ctx, &search); err != nil {
	    return err
	}
	return replaceCandidates(ctx, tx, search.ID, rows)
    })
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }

    created, err := h.loadSearch(ctx, search.ID)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    return c.JSON(http.StatusCreated, created)
}

// Replace the definition, evaluation record and candidates of one of
// the current user's searches.
func (h *Handler) updateSearch(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return handled(resp)
    }

    search, resp := h.ownSearch(c, db_user.ID)
    if resp != nil {
	return handled(resp)
    }
    rows, resp := h.bindSearch(c, &search, db_user.ID)
    if resp != nil {
	return handled(resp)
    }

    err := h.DB.Transaction(func(tx *gorm.DB) error {
	_, err := gorm.G[TargetSearch](tx).Where(
	    "id = ? AND user_id = ?", search.ID, db_user.ID).Select(
	    "name", searchInputColumns...).Updates(ctx, search)
	if err != nil {
	    return err
	}
	return replaceCandidates(ctx, tx, search.ID, rows)
    })
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }

    updated, err := h.loadSearch(ctx, search.ID)
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    return c.JSON(http.StatusOK, updated)
}

/* Delete one of the current user's searches and its candidates. Unlike
positions there is no last-one rule: the sky view draws the Sun without
a search. */
func (h *Handler) deleteSearch(c echo.Context) error {
    ctx := context.Background()
    db_user, resp := h.jwtUser(c)
    if resp != nil {
	return handled(resp)
    }

    search, resp := h.ownSearch(c, db_user.ID)
    if resp != nil {
	return handled(resp)
    }

    err := h.DB.Transaction(func(tx *gorm.DB) error {
	if err := replaceCandidates(ctx, tx, search.ID, nil); err != nil {
	    return err
	}
	_, err := gorm.G[TargetSearch](tx).Where(
	    "id = ? AND user_id = ?", search.ID, db_user.ID).Delete(ctx)
	return err
    })
    if err != nil {
	return c.JSON(http.StatusInternalServerError, err.Error())
    }
    return c.NoContent(http.StatusNoContent)
}
