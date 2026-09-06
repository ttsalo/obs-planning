package main

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "net/http/httptest"
    "strings"
    "testing"
    "github.com/labstack/echo/v4"
    "github.com/stretchr/testify/assert"
    "github.com/glebarez/sqlite"
    "gorm.io/gorm"
)

var (
    sqlite_db, _ = gorm.Open(sqlite.Open(":memory:?_pragma=foreign_keys(1)"),
	&gorm.Config{})
    err = MigrateDB(sqlite_db)
    e = echo.New()
    _ = InitTestData(e, sqlite_db)
    u = "testuser"
    h = Handler{DB: sqlite_db,
	UsernameFromJWT: testUsernameFromJWT}
)

func testUsernameFromJWT(c echo.Context) string {
    return u
}

// A second user owning a position of their own, so the tests can check
// that one user's positions stay invisible and untouchable to another.
const otherUsername = "otheruser"

var otherUserPosition Position

// init runs after the package-level fixture above, so the schema exists
// and testuser's rows are already seeded by the time this adds to them.
func init() {
    ctx := context.Background()
    other := User{Username: otherUsername, Password: "hunter2"}
    if err := gorm.G[User](sqlite_db).Create(ctx, &other); err != nil {
	panic(err)
    }
    otherUserPosition = Position{Name: "Home", UserID: other.ID,
	Lat: 51.48, Lon: -0.01, MinAz: 0, MaxAz: 360, MinAlt: 0, MaxAlt: 90}
    if err := gorm.G[Position](sqlite_db).Create(
	ctx, &otherUserPosition); err != nil {
	panic(err)
    }
}

// Act as the other user for the rest of the test. Tests never run in
// parallel here, so swapping the package-level username is enough.
func asOtherUser(t *testing.T) {
    u = otherUsername
    t.Cleanup(func() { u = "testuser" })
}

var healthPassJSON = `{"status":"pass","error":""}`

func TestHealth(t *testing.T) {
    e := echo.New()
    req := httptest.NewRequest(http.MethodGet, "/health", nil)
    rec := httptest.NewRecorder()
    c := e.NewContext(req, rec)
    
    err := health(c)
    if err != nil {
	t.Fatal(err)
    }

    assert.Equal(t, http.StatusOK, rec.Code)
    assert.Equal(t, healthPassJSON + "\n", rec.Body.String())
}

func testConfig(t *testing.T, expected string) {
    e := echo.New()
    req := httptest.NewRequest(http.MethodGet, "/config", nil)
    rec := httptest.NewRecorder()
    c := e.NewContext(req, rec)

    err := config(c)
    if err != nil {
	t.Fatal(err)
    }

    assert.Equal(t, http.StatusOK, rec.Code)
    assert.Equal(t, expected + "\n", rec.Body.String())
}

func TestConfig(t *testing.T) {
    t.Setenv("OBS_ASTRO_URL", "https://obs-astro-xyz.a.run.app")
    testConfig(t, `{"astro_url":"https://obs-astro-xyz.a.run.app"}`)
}

func TestConfigUnset(t *testing.T) {
    t.Setenv("OBS_ASTRO_URL", "")
    testConfig(t, `{"astro_url":""}`)
}

func testLogin(t *testing.T, body string, status int) {
    e := echo.New()
    req := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader(
	body))
    req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
    rec := httptest.NewRecorder()
    c := e.NewContext(req, rec)
    
    err := h.login(c)
    if err != nil {
	t.Fatal(err)
    }

    assert.Equal(t, status, rec.Code)
}

func TestLoginFail(t *testing.T) {
    testLogin(t, `{"username":"testuser","password":"foobar"}`,
	http.StatusUnauthorized)
}

func TestLoginSuccess(t *testing.T) {
    testLogin(t, `{"username":"testuser","password":"aero123"}`,
	http.StatusOK)
}

func TestPositions(t *testing.T) {
    e := echo.New()
    req := httptest.NewRequest(http.MethodGet, "/positions",
	strings.NewReader(""))
    rec := httptest.NewRecorder()
    c := e.NewContext(req, rec)
    
    err := h.positions(c)
    if err != nil { t.Fatal(err) }

    var positions []Position
    assert.Equal(t, http.StatusOK, rec.Code)
    err = json.Unmarshal(rec.Body.Bytes(), &positions)
    assert.Equal(t, nil, err)
    assert.Equal(t, "Helsinki", positions[0].Name)
    // The other user's position must not leak into this listing.
    for _, p := range positions {
	assert.NotEqual(t, otherUserPosition.ID, p.ID)
    }
}

func TestSearches(t *testing.T) {
    e := echo.New()
    req := httptest.NewRequest(http.MethodGet, "/searches",
	strings.NewReader(""))
    rec := httptest.NewRecorder()
    c := e.NewContext(req, rec)
    
    err := h.searches(c)
    if err != nil { t.Fatal(err) }

    var searches []TargetSearch
    assert.Equal(t, http.StatusOK, rec.Code)
    err = json.Unmarshal(rec.Body.Bytes(), &searches)
    assert.Equal(t, nil, err)
    assert.Equal(t, "Planets", searches[0].Name)
    assert.Equal(t, 8, len(searches[0].TargetObjects))
    assert.Equal(t, "Mercury", searches[0].TargetObjects[0].Name)
}

// Valid baseline the TestPositionValidate cases mutate one field of.
func validPosition() Position {
    return Position{Name: "Kuusamo", UserID: 1, Lat: 65.96, Lon: 29.19,
	MinAz: 0, MaxAz: 360, MinAlt: 0, MaxAlt: 90}
}

func TestPositionValidate(t *testing.T) {
    cases := []struct {
	name string
	mod func(*Position)
	valid bool
    }{
	{"valid", func(p *Position) {}, true},
	{"window subset", func(p *Position) {
	    p.MinAz = 90; p.MaxAz = 270; p.MinAlt = 10; p.MaxAlt = 45}, true},
	{"negative min alt", func(p *Position) { p.MinAlt = -90 }, true},
	{"equal az limits", func(p *Position) { p.MinAz = 180; p.MaxAz = 180 },
	    true},
	{"empty name", func(p *Position) { p.Name = "" }, false},
	{"blank name", func(p *Position) { p.Name = "  \t " }, false},
	{"lat too high", func(p *Position) { p.Lat = 95 }, false},
	{"lat too low", func(p *Position) { p.Lat = -90.5 }, false},
	{"lon too high", func(p *Position) { p.Lon = 181 }, false},
	{"lon too low", func(p *Position) { p.Lon = -200 }, false},
	{"min az negative", func(p *Position) { p.MinAz = -1 }, false},
	{"max az too high", func(p *Position) { p.MaxAz = 361 }, false},
	{"min alt too low", func(p *Position) { p.MinAlt = -91 }, false},
	{"max alt too high", func(p *Position) { p.MaxAlt = 91 }, false},
	// Azimuth is circular: a maximum below the minimum wraps through
	// north rather than being an error.
	{"wrapping az window", func(p *Position) {
	    p.MinAz = 270; p.MaxAz = 90 }, true},
	{"inverted alt window", func(p *Position) {
	    p.MinAlt = 40; p.MaxAlt = 20 }, false},
    }

    for _, tc := range cases {
	t.Run(tc.name, func(t *testing.T) {
	    p := validPosition()
	    tc.mod(&p)
	    err := p.Validate()
	    if tc.valid {
		assert.Nil(t, err)
	    } else {
		assert.NotNil(t, err)
	    }
	})
    }
}

// Call one of the position handlers directly with the given body and,
// for the :id routes, path parameter.
func positionRequest(t *testing.T, method string, body string, id string,
	handler func(echo.Context) error) *httptest.ResponseRecorder {
    e := echo.New()
    req := httptest.NewRequest(method, "/positions", strings.NewReader(body))
    req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
    rec := httptest.NewRecorder()
    c := e.NewContext(req, rec)
    if id != "" {
	c.SetParamNames("id")
	c.SetParamValues(id)
    }
    if err := handler(c); err != nil {
	t.Fatal(err)
    }
    return rec
}

// The current user's positions as the GET endpoint returns them.
func listPositions(t *testing.T) []Position {
    rec := positionRequest(t, http.MethodGet, "", "", h.positions)
    assert.Equal(t, http.StatusOK, rec.Code)
    var positions []Position
    if err := json.Unmarshal(rec.Body.Bytes(), &positions); err != nil {
	t.Fatal(err)
    }
    return positions
}

func positionNames(t *testing.T) []string {
    names := []string{}
    for _, p := range listPositions(t) {
	names = append(names, p.Name)
    }
    return names
}

// Drop a position a test created, bypassing the delete endpoint (which
// refuses the last one) so the shared in-memory DB is left as found.
func dropPosition(id uint) {
    gorm.G[Position](sqlite_db).Where("id = ?", id).Delete(context.Background())
}

const kuusamoJSON = `{"name":"Kuusamo","lat":65.96,"lon":29.19,` +
      `"min_az":0,"max_az":360,"min_alt":0,"max_alt":90}`

// Create a position through the endpoint and return it, failing the
// test if the creation didn't succeed.
func createPosition(t *testing.T, body string) Position {
    rec := positionRequest(t, http.MethodPost, body, "", h.createPosition)
    assert.Equal(t, http.StatusCreated, rec.Code)
    var created Position
    if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
	t.Fatal(err)
    }
    return created
}

func TestCreatePosition(t *testing.T) {
    created := createPosition(t, kuusamoJSON)
    defer dropPosition(created.ID)

    assert.NotEqual(t, uint(0), created.ID)
    assert.Equal(t, "Kuusamo", created.Name)
    assert.Equal(t, 65.96, created.Lat)
    assert.Equal(t, 29.19, created.Lon)
    assert.Equal(t, float64(360), created.MaxAz)
    assert.Equal(t, float64(90), created.MaxAlt)
    assert.Contains(t, positionNames(t), "Kuusamo")
}

// A window from 125 through north to 45 is stored as given, not
// rejected or normalised.
func TestCreatePositionWrappingAzimuth(t *testing.T) {
    created := createPosition(t,
	`{"name":"Wrapping","lat":60,"lon":25,"min_az":125,"max_az":45,`+
	`"min_alt":0,"max_alt":90}`)
    defer dropPosition(created.ID)

    assert.Equal(t, float64(125), created.MinAz)
    assert.Equal(t, float64(45), created.MaxAz)
    for _, p := range listPositions(t) {
	if p.ID == created.ID {
	    assert.Equal(t, float64(125), p.MinAz)
	    assert.Equal(t, float64(45), p.MaxAz)
	}
    }
}

func TestCreatePositionInvalid(t *testing.T) {
    cases := map[string]string{
	"empty name": `{"name":"","lat":60,"lon":25,"max_az":360,"max_alt":90}`,
	"blank name": `{"name":"   ","lat":60,"lon":25,"max_az":360,"max_alt":90}`,
	"lat out of range":
	    `{"name":"Bad","lat":95,"lon":25,"max_az":360,"max_alt":90}`,
	"lon out of range":
	    `{"name":"Bad","lat":60,"lon":200,"max_az":360,"max_alt":90}`,
	"inverted alt window":
	    `{"name":"Bad","lat":60,"lon":25,"max_az":360,` +
	    `"min_alt":40,"max_alt":20}`,
    }

    for name, body := range cases {
	t.Run(name, func(t *testing.T) {
	    rec := positionRequest(t, http.MethodPost, body, "",
		h.createPosition)
	    assert.Equal(t, http.StatusBadRequest, rec.Code)
	    assert.NotContains(t, positionNames(t), "Bad")
	})
    }
}

func TestCreatePositionDuplicate(t *testing.T) {
    rec := positionRequest(t, http.MethodPost,
	`{"name":"Helsinki","lat":10,"lon":10,"max_az":360,"max_alt":90}`,
	"", h.createPosition)
    assert.Equal(t, http.StatusConflict, rec.Code)

    // The original is untouched and no second Helsinki was stored.
    positions := listPositions(t)
    helsinkis := 0
    for _, p := range positions {
	if p.Name == "Helsinki" {
	    helsinkis++
	    assert.Equal(t, 60.17, p.Lat)
	}
    }
    assert.Equal(t, 1, helsinkis)
}

// The uniqueness rule is per user, so the other user having a position
// named "Home" must not stop testuser from creating one too.
func TestCreatePositionOtherUsersName(t *testing.T) {
    created := createPosition(t,
	`{"name":"Home","lat":60,"lon":25,"max_az":360,"max_alt":90}`)
    defer dropPosition(created.ID)

    assert.NotEqual(t, otherUserPosition.ID, created.ID)
    assert.Contains(t, positionNames(t), "Home")

    asOtherUser(t)
    assert.Equal(t, []string{"Home"}, positionNames(t))
}

func TestUpdatePosition(t *testing.T) {
    created := createPosition(t, kuusamoJSON)
    defer dropPosition(created.ID)

    rec := positionRequest(t, http.MethodPut,
	`{"name":"Sodankyla","lat":67.42,"lon":26.59,"min_az":90,`+
	`"max_az":270,"min_alt":0,"max_alt":45}`,
	fmt.Sprint(created.ID), h.updatePosition)
    assert.Equal(t, http.StatusOK, rec.Code)

    var updated Position
    err := json.Unmarshal(rec.Body.Bytes(), &updated)
    assert.Equal(t, nil, err)
    assert.Equal(t, created.ID, updated.ID)
    assert.Equal(t, "Sodankyla", updated.Name)

    // Read it back so we're checking what was stored, not just the reply.
    var stored *Position
    for i, p := range listPositions(t) {
	if p.ID == created.ID {
	    stored = &listPositions(t)[i]
	}
    }
    if stored == nil {
	t.Fatal("updated position missing from the listing")
    }
    assert.Equal(t, "Sodankyla", stored.Name)
    assert.Equal(t, 67.42, stored.Lat)
    assert.Equal(t, 26.59, stored.Lon)
    assert.Equal(t, float64(90), stored.MinAz)
    assert.Equal(t, float64(270), stored.MaxAz)
    assert.Equal(t, float64(45), stored.MaxAlt)
    assert.NotContains(t, positionNames(t), "Kuusamo")
}

// A zero in the body must be written, not silently skipped as GORM's
// struct updates would do.
func TestUpdatePositionToZero(t *testing.T) {
    created := createPosition(t,
	`{"name":"Windowed","lat":60,"lon":25,"min_az":90,"max_az":270,`+
	`"min_alt":30,"max_alt":80}`)
    defer dropPosition(created.ID)

    rec := positionRequest(t, http.MethodPut,
	`{"name":"Windowed","lat":0,"lon":0,"min_az":0,"max_az":360,`+
	`"min_alt":0,"max_alt":90}`,
	fmt.Sprint(created.ID), h.updatePosition)
    assert.Equal(t, http.StatusOK, rec.Code)

    for _, p := range listPositions(t) {
	if p.ID == created.ID {
	    assert.Equal(t, float64(0), p.Lat)
	    assert.Equal(t, float64(0), p.Lon)
	    assert.Equal(t, float64(0), p.MinAz)
	    assert.Equal(t, float64(0), p.MinAlt)
	    assert.Equal(t, float64(90), p.MaxAlt)
	}
    }
}

func TestUpdatePositionInvalid(t *testing.T) {
    created := createPosition(t, kuusamoJSON)
    defer dropPosition(created.ID)

    rec := positionRequest(t, http.MethodPut,
	`{"name":"Kuusamo","lat":60,"lon":25,"max_az":360,`+
	`"min_alt":40,"max_alt":20}`,
	fmt.Sprint(created.ID), h.updatePosition)
    assert.Equal(t, http.StatusBadRequest, rec.Code)

    for _, p := range listPositions(t) {
	if p.ID == created.ID {
	    assert.Equal(t, 65.96, p.Lat)
	}
    }
}

func TestUpdatePositionForeign(t *testing.T) {
    rec := positionRequest(t, http.MethodPut,
	`{"name":"Stolen","lat":0,"lon":0,"max_az":360,"max_alt":90}`,
	fmt.Sprint(otherUserPosition.ID), h.updatePosition)
    assert.Equal(t, http.StatusNotFound, rec.Code)

    asOtherUser(t)
    assert.Equal(t, []string{"Home"}, positionNames(t))
}

func TestUpdatePositionMissing(t *testing.T) {
    rec := positionRequest(t, http.MethodPut,
	`{"name":"Nowhere","lat":0,"lon":0,"max_az":360,"max_alt":90}`,
	"999999", h.updatePosition)
    assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestUpdatePositionRenameConflict(t *testing.T) {
    created := createPosition(t, kuusamoJSON)
    defer dropPosition(created.ID)

    rec := positionRequest(t, http.MethodPut,
	`{"name":"Helsinki","lat":65.96,"lon":29.19,"max_az":360,`+
	`"max_alt":90}`, fmt.Sprint(created.ID), h.updatePosition)
    assert.Equal(t, http.StatusConflict, rec.Code)
    assert.Contains(t, positionNames(t), "Kuusamo")
}

// Keeping its own name is not a conflict with itself.
func TestUpdatePositionKeepingName(t *testing.T) {
    created := createPosition(t, kuusamoJSON)
    defer dropPosition(created.ID)

    rec := positionRequest(t, http.MethodPut,
	`{"name":"Kuusamo","lat":66,"lon":29,"max_az":360,"max_alt":90}`,
	fmt.Sprint(created.ID), h.updatePosition)
    assert.Equal(t, http.StatusOK, rec.Code)
}

func TestDeletePosition(t *testing.T) {
    created := createPosition(t, kuusamoJSON)
    assert.Contains(t, positionNames(t), "Kuusamo")

    rec := positionRequest(t, http.MethodDelete, "", fmt.Sprint(created.ID),
	h.deletePosition)
    assert.Equal(t, http.StatusNoContent, rec.Code)
    assert.NotContains(t, positionNames(t), "Kuusamo")
    assert.Contains(t, positionNames(t), "Helsinki")
}

// A name is free again once the position using it has been deleted.
func TestDeletePositionFreesName(t *testing.T) {
    created := createPosition(t, kuusamoJSON)
    positionRequest(t, http.MethodDelete, "", fmt.Sprint(created.ID),
	h.deletePosition)

    recreated := createPosition(t, kuusamoJSON)
    defer dropPosition(recreated.ID)
    assert.NotEqual(t, created.ID, recreated.ID)
    assert.Contains(t, positionNames(t), "Kuusamo")
}

func TestDeleteLastPosition(t *testing.T) {
    positions := listPositions(t)
    if len(positions) != 1 {
	t.Fatalf("expected testuser to have exactly one position, got %v",
	    len(positions))
    }

    rec := positionRequest(t, http.MethodDelete, "",
	fmt.Sprint(positions[0].ID), h.deletePosition)
    assert.Equal(t, http.StatusConflict, rec.Code)
    assert.Equal(t, []string{"Helsinki"}, positionNames(t))
}

func TestDeletePositionForeign(t *testing.T) {
    // testuser needs a second position of their own, so that a 404 here
    // can't be the last-position rule in disguise.
    created := createPosition(t, kuusamoJSON)
    defer dropPosition(created.ID)

    rec := positionRequest(t, http.MethodDelete, "",
	fmt.Sprint(otherUserPosition.ID), h.deletePosition)
    assert.Equal(t, http.StatusNotFound, rec.Code)

    asOtherUser(t)
    assert.Equal(t, []string{"Home"}, positionNames(t))
}

func TestDeletePositionMissing(t *testing.T) {
    rec := positionRequest(t, http.MethodDelete, "", "999999",
	h.deletePosition)
    assert.Equal(t, http.StatusNotFound, rec.Code)
}
