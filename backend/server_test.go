package main

import (
    "encoding/json"
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
