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
    "gorm.io/gorm"
)

func floatPtr(f float64) *float64 { return &f }

// Valid baseline the TestTargetSearchValidate cases mutate one field of.
func validSearch() TargetSearch {
    return TargetSearch{Name: "Bright doubles", UserID: 1,
	SetKind: "double_stars", MaxMagnitude: floatPtr(5),
	StartTime: "22:00", EndTime: "02:00",
	Visibility: "window", MaxBrightness: "NT"}
}

func TestTargetSearchValidate(t *testing.T) {
    cases := []struct {
	name string
	mod func(*TargetSearch)
	valid bool
    }{
	{"valid", func(s *TargetSearch) {}, true},
	{"planets", func(s *TargetSearch) {
	    s.SetKind = "planets"; s.MaxMagnitude = nil }, true},
	{"messier without magnitude", func(s *TargetSearch) {
	    s.SetKind = "messier"; s.MaxMagnitude = nil }, true},
	{"messier with magnitude", func(s *TargetSearch) {
	    s.SetKind = "messier" }, true},
	{"names", func(s *TargetSearch) {
	    s.SetKind = "names"; s.Names = Names{"Vega", "M31"} }, true},
	{"day range", func(s *TargetSearch) {
	    s.StartDate = "2026-09-01"; s.EndDate = "2026-10-01" }, true},
	{"single day range", func(s *TargetSearch) {
	    s.StartDate = "2026-09-01"; s.EndDate = "2026-09-01" }, true},
	{"window not crossing midnight", func(s *TargetSearch) {
	    s.StartTime = "20:00"; s.EndTime = "23:30" }, true},
	{"no brightness limit", func(s *TargetSearch) {
	    s.MaxBrightness = "D"; s.Visibility = "none" }, true},
	{"empty name", func(s *TargetSearch) { s.Name = "" }, false},
	{"blank name", func(s *TargetSearch) { s.Name = " \t" }, false},
	{"unknown set", func(s *TargetSearch) { s.SetKind = "comets" }, false},
	{"double stars without magnitude", func(s *TargetSearch) {
	    s.MaxMagnitude = nil }, false},
	{"absurd magnitude", func(s *TargetSearch) {
	    s.MaxMagnitude = floatPtr(99) }, false},
	{"names without names", func(s *TargetSearch) {
	    s.SetKind = "names" }, false},
	{"names with a blank name", func(s *TargetSearch) {
	    s.SetKind = "names"; s.Names = Names{"Vega", "  "} }, false},
	{"bad start time", func(s *TargetSearch) { s.StartTime = "25:00" }, false},
	{"bad end time", func(s *TargetSearch) { s.EndTime = "2am" }, false},
	{"start date only", func(s *TargetSearch) {
	    s.StartDate = "2026-09-01" }, false},
	{"bad start date", func(s *TargetSearch) {
	    s.StartDate = "01.09.2026"; s.EndDate = "2026-09-02" }, false},
	{"inverted day range", func(s *TargetSearch) {
	    s.StartDate = "2026-09-10"; s.EndDate = "2026-09-01" }, false},
	{"day range too long", func(s *TargetSearch) {
	    s.StartDate = "2026-09-01"; s.EndDate = "2026-10-11" }, false},
	{"unknown visibility", func(s *TargetSearch) {
	    s.Visibility = "sometimes" }, false},
	{"unknown brightness", func(s *TargetSearch) {
	    s.MaxBrightness = "dusk" }, false},
    }

    for _, tc := range cases {
	t.Run(tc.name, func(t *testing.T) {
	    s := validSearch()
	    tc.mod(&s)
	    err := s.Validate()
	    if tc.valid {
		assert.Nil(t, err)
	    } else {
		assert.NotNil(t, err)
	    }
	})
    }
}

func TestTargetObjectValidate(t *testing.T) {
    cases := []struct {
	name string
	obj TargetObject
	valid bool
    }{
	{"fixed", TargetObject{Name: "M31", RA: 10.68, Dec: 41.27}, true},
	{"solar system ignores coords",
	    TargetObject{Name: "Mars", SSObj: true, RA: 500, Dec: 100}, true},
	{"empty name", TargetObject{Name: " ", RA: 10, Dec: 10}, false},
	{"ra too high", TargetObject{Name: "X", RA: 361, Dec: 10}, false},
	{"ra negative", TargetObject{Name: "X", RA: -1, Dec: 10}, false},
	{"dec too high", TargetObject{Name: "X", RA: 10, Dec: 100}, false},
	{"dec too low", TargetObject{Name: "X", RA: 10, Dec: -91}, false},
    }
    for _, tc := range cases {
	t.Run(tc.name, func(t *testing.T) {
	    err := tc.obj.Validate()
	    if tc.valid {
		assert.Nil(t, err)
	    } else {
		assert.NotNil(t, err)
	    }
	})
    }
}

// A database seeded before searches had definitions has a "Planets"
// row with no set kind and no per-search candidates; the seeding must
// fill both in, once.
func TestInitTestDataBackfill(t *testing.T) {
    ctx := context.Background()
    legacy := User{Username: "legacyuser", Password: "x"}
    if err := gorm.G[User](sqlite_db).Create(ctx, &legacy); err != nil {
	t.Fatal(err)
    }
    old := TargetSearch{Name: "Planets", UserID: legacy.ID}
    if err := gorm.G[TargetSearch](sqlite_db).Create(ctx, &old); err != nil {
	t.Fatal(err)
    }

    for round := 0; round < 2; round++ {
	if err := seedPlanetsSearch(e, sqlite_db, legacy.ID); err != nil {
	    t.Fatal(err)
	}
	searches, _ := gorm.G[TargetSearch](sqlite_db).Where(
	    "user_id = ?", legacy.ID).Preload("TargetObjects", nil).Find(ctx)
	assert.Equal(t, 1, len(searches))
	assert.Equal(t, old.ID, searches[0].ID)
	assert.Equal(t, "planets", searches[0].SetKind)
	assert.Equal(t, "none", searches[0].Visibility)
	assert.Equal(t, "D", searches[0].MaxBrightness)
	assert.NotNil(t, searches[0].EvaluatedAt)
	assert.Equal(t, 8, len(searches[0].TargetObjects))
	for _, obj := range searches[0].TargetObjects {
	    assert.True(t, obj.SSObj)
	    assert.True(t, obj.Matched)
	}
    }
}

// Call one of the search handlers directly with the given body and,
// for the :id routes, path parameter.
func searchRequest(t *testing.T, method string, body string, id string,
	handler func(echo.Context) error) *httptest.ResponseRecorder {
    e := echo.New()
    req := httptest.NewRequest(method, "/searches", strings.NewReader(body))
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

func listSearches(t *testing.T) []TargetSearch {
    rec := searchRequest(t, http.MethodGet, "", "", h.searches)
    assert.Equal(t, http.StatusOK, rec.Code)
    var searches []TargetSearch
    if err := json.Unmarshal(rec.Body.Bytes(), &searches); err != nil {
	t.Fatal(err)
    }
    return searches
}

func searchNames(t *testing.T) []string {
    names := []string{}
    for _, s := range listSearches(t) {
	names = append(names, s.Name)
    }
    return names
}

func findSearch(t *testing.T, id uint) *TargetSearch {
    for _, s := range listSearches(t) {
	if s.ID == id {
	    return &s
	}
    }
    return nil
}

// Rows in target_objects for a search, deleted ones included, straight
// from the table.
func candidateRowCount(searchID uint) int64 {
    count, _ := gorm.G[TargetObject](sqlite_db.Unscoped()).Where(
	"target_search_id = ?", searchID).Count(context.Background(), "*")
    return count
}

// Drop a search a test created, and its candidates, so the shared
// in-memory DB is left as found.
func dropSearch(id uint) {
    ctx := context.Background()
    gorm.G[TargetObject](sqlite_db.Unscoped()).Where(
	"target_search_id = ?", id).Delete(ctx)
    gorm.G[TargetSearch](sqlite_db.Unscoped()).Where("id = ?", id).Delete(ctx)
}

const doublesCandidatesJSON = `[` +
    `{"name":"Mizar","ss_obj":false,"ra":200.98,"dec":54.93,` +
    `"magnitude":2.2,"object_type":"Double star","matched":true},` +
    `{"name":"Albireo","ss_obj":false,"ra":292.68,"dec":27.96,` +
    `"magnitude":3.1,"object_type":"Double star","matched":false}]`

const doublesJSON = `{"name":"Bright doubles","set_kind":"double_stars",` +
    `"max_magnitude":5,"start_time":"22:00","end_time":"02:00",` +
    `"visibility":"window","max_brightness":"NT",` +
    `"evaluated_at":"2026-09-03T20:00:00Z","evaluated_position":"Helsinki",` +
    `"candidates":` + doublesCandidatesJSON + `}`

// The same definition with a different name and candidate list.
func searchJSON(name string, candidates string) string {
    return `{"name":"` + name + `","set_kind":"double_stars",` +
	`"max_magnitude":5,"start_time":"22:00","end_time":"02:00",` +
	`"visibility":"window","max_brightness":"NT",` +
	`"evaluated_position":"Helsinki","candidates":` + candidates + `}`
}

func createSearch(t *testing.T, body string) TargetSearch {
    rec := searchRequest(t, http.MethodPost, body, "", h.createSearch)
    assert.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
    var created TargetSearch
    if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
	t.Fatal(err)
    }
    return created
}

func TestCreateSearch(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)

    assert.NotEqual(t, uint(0), created.ID)
    assert.Equal(t, "Bright doubles", created.Name)
    assert.Equal(t, "double_stars", created.SetKind)
    assert.Equal(t, 5.0, *created.MaxMagnitude)
    assert.Equal(t, "22:00", created.StartTime)
    assert.Equal(t, "window", created.Visibility)
    assert.Equal(t, "Helsinki", created.EvaluatedPosition)
    assert.NotNil(t, created.EvaluatedAt)
    assert.Equal(t, Names{}, created.Names)

    // Matched and unmatched candidates both come back with their flags.
    stored := findSearch(t, created.ID)
    if stored == nil {
	t.Fatal("created search missing from the listing")
    }
    assert.Equal(t, 2, len(stored.TargetObjects))
    assert.Equal(t, "Mizar", stored.TargetObjects[0].Name)
    assert.True(t, stored.TargetObjects[0].Matched)
    assert.Equal(t, 2.2, *stored.TargetObjects[0].Magnitude)
    assert.Equal(t, "Double star", stored.TargetObjects[0].ObjectType)
    assert.Equal(t, "Albireo", stored.TargetObjects[1].Name)
    assert.False(t, stored.TargetObjects[1].Matched)
    assert.Equal(t, 292.68, stored.TargetObjects[1].RA)
}

// A name list round-trips as an array, trimmed.
func TestCreateSearchNames(t *testing.T) {
    created := createSearch(t, `{"name":"Some stars","set_kind":"names",` +
	`"names":[" Vega","M31 "],"start_time":"22:00","end_time":"02:00",` +
	`"visibility":"none","max_brightness":"D","candidates":[]}`)
    defer dropSearch(created.ID)

    assert.Equal(t, Names{"Vega", "M31"}, created.Names)
    assert.Nil(t, created.MaxMagnitude)
    assert.Equal(t, 0, len(created.TargetObjects))
    stored := findSearch(t, created.ID)
    assert.Equal(t, Names{"Vega", "M31"}, stored.Names)
}

func TestCreateSearchInvalid(t *testing.T) {
    base := func(def string, candidates string) string {
	return `{"name":"Bad",` + def + `,"start_time":"22:00",` +
	    `"end_time":"02:00","visibility":"window",` +
	    `"max_brightness":"NT","candidates":` + candidates + `}`
    }
    cases := map[string]string{
	"unknown set": base(`"set_kind":"comets"`, `[]`),
	"double stars without magnitude": base(`"set_kind":"double_stars"`, `[]`),
	"empty name list": base(`"set_kind":"names","names":[]`, `[]`),
	"blank names": base(`"set_kind":"names","names":["  "]`, `[]`),
	"unknown visibility": `{"name":"Bad","set_kind":"planets",` +
	    `"start_time":"22:00","end_time":"02:00",` +
	    `"visibility":"sometimes","max_brightness":"NT","candidates":[]}`,
	"unknown brightness": `{"name":"Bad","set_kind":"planets",` +
	    `"start_time":"22:00","end_time":"02:00",` +
	    `"visibility":"window","max_brightness":"dusk","candidates":[]}`,
	"bad time": `{"name":"Bad","set_kind":"planets",` +
	    `"start_time":"22","end_time":"02:00",` +
	    `"visibility":"window","max_brightness":"NT","candidates":[]}`,
	"day range too long": `{"name":"Bad","set_kind":"planets",` +
	    `"start_time":"22:00","end_time":"02:00",` +
	    `"start_date":"2026-09-01","end_date":"2026-10-11",` +
	    `"visibility":"window","max_brightness":"NT","candidates":[]}`,
	"bad candidate dec": base(`"set_kind":"messier"`,
	    `[{"name":"M31","ra":10.68,"dec":100}]`),
	"blank candidate name": base(`"set_kind":"messier"`,
	    `[{"name":" ","ra":10.68,"dec":41.27}]`),
	"empty search name": `{"name":" ","set_kind":"planets",` +
	    `"start_time":"22:00","end_time":"02:00",` +
	    `"visibility":"window","max_brightness":"NT","candidates":[]}`,
    }

    for name, body := range cases {
	t.Run(name, func(t *testing.T) {
	    rec := searchRequest(t, http.MethodPost, body, "", h.createSearch)
	    assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
	    assert.NotContains(t, searchNames(t), "Bad")
	})
    }
}

func TestCreateSearchDuplicate(t *testing.T) {
    rec := searchRequest(t, http.MethodPost, searchJSON("Planets", "[]"), "",
	h.createSearch)
    assert.Equal(t, http.StatusConflict, rec.Code)

    planets := 0
    for _, s := range listSearches(t) {
	if s.Name == "Planets" {
	    planets++
	    assert.Equal(t, "planets", s.SetKind)
	    assert.Equal(t, 8, len(s.TargetObjects))
	}
    }
    assert.Equal(t, 1, planets)
}

// The uniqueness rule is per user.
func TestCreateSearchOtherUsersName(t *testing.T) {
    created := createSearch(t, searchJSON("Winter", "[]"))
    defer dropSearch(created.ID)

    asOtherUser(t)
    theirs := createSearch(t, searchJSON("Winter", "[]"))
    defer dropSearch(theirs.ID)
    assert.NotEqual(t, created.ID, theirs.ID)
    assert.Equal(t, []string{"Winter"}, searchNames(t))
}

func TestUpdateSearchReplacesCandidates(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)
    assert.Equal(t, int64(2), candidateRowCount(created.ID))

    rec := searchRequest(t, http.MethodPut,
	`{"name":"Bright doubles","set_kind":"names","names":["Saturn"],` +
	`"start_time":"21:00","end_time":"23:00",` +
	`"start_date":"2026-09-01","end_date":"2026-09-03",` +
	`"visibility":"horizon","max_brightness":"CT",` +
	`"evaluated_position":"Kuusamo","candidates":` +
	`[{"name":"Saturn","ss_obj":true,"matched":true}]}`,
	fmt.Sprint(created.ID), h.updateSearch)
    assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

    var updated TargetSearch
    assert.Nil(t, json.Unmarshal(rec.Body.Bytes(), &updated))
    assert.Equal(t, created.ID, updated.ID)
    assert.Equal(t, 1, len(updated.TargetObjects))

    stored := findSearch(t, created.ID)
    assert.Equal(t, "names", stored.SetKind)
    assert.Nil(t, stored.MaxMagnitude)
    assert.Equal(t, Names{"Saturn"}, stored.Names)
    assert.Equal(t, "21:00", stored.StartTime)
    assert.Equal(t, "2026-09-03", stored.EndDate)
    assert.Equal(t, "horizon", stored.Visibility)
    assert.Equal(t, "CT", stored.MaxBrightness)
    assert.Equal(t, "Kuusamo", stored.EvaluatedPosition)
    assert.Equal(t, 1, len(stored.TargetObjects))
    assert.Equal(t, "Saturn", stored.TargetObjects[0].Name)
    assert.True(t, stored.TargetObjects[0].SSObj)
    // The old rows are gone from the table, not just soft-deleted.
    assert.Equal(t, int64(1), candidateRowCount(created.ID))
}

// Resubmitting the same candidates with different flags stores the
// new flags: this is what re-applying criteria to a saved search does.
func TestUpdateSearchReflags(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)

    reflagged := strings.Replace(strings.Replace(doublesCandidatesJSON,
	`"matched":true`, `"matched":X`, 1), `"matched":false`,
	`"matched":true`, 1)
    reflagged = strings.Replace(reflagged, `"matched":X`, `"matched":false`, 1)
    rec := searchRequest(t, http.MethodPut,
	searchJSON("Bright doubles", reflagged),
	fmt.Sprint(created.ID), h.updateSearch)
    assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

    stored := findSearch(t, created.ID)
    assert.Equal(t, 2, len(stored.TargetObjects))
    assert.Equal(t, "Mizar", stored.TargetObjects[0].Name)
    assert.False(t, stored.TargetObjects[0].Matched)
    assert.Equal(t, "Albireo", stored.TargetObjects[1].Name)
    assert.True(t, stored.TargetObjects[1].Matched)
    assert.Equal(t, int64(2), candidateRowCount(created.ID))
}

func TestUpdateSearchInvalid(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)

    rec := searchRequest(t, http.MethodPut,
	searchJSON("Bright doubles", `[{"name":"X","ra":10,"dec":95}]`),
	fmt.Sprint(created.ID), h.updateSearch)
    assert.Equal(t, http.StatusBadRequest, rec.Code)

    stored := findSearch(t, created.ID)
    assert.Equal(t, 2, len(stored.TargetObjects))
    assert.Equal(t, "Mizar", stored.TargetObjects[0].Name)
}

func TestUpdateSearchForeign(t *testing.T) {
    asOtherUser(t)
    theirs := createSearch(t, searchJSON("Theirs", "[]"))
    defer dropSearch(theirs.ID)
    u = "testuser"

    rec := searchRequest(t, http.MethodPut, searchJSON("Stolen", "[]"),
	fmt.Sprint(theirs.ID), h.updateSearch)
    assert.Equal(t, http.StatusNotFound, rec.Code)

    asOtherUser(t)
    assert.Equal(t, []string{"Theirs"}, searchNames(t))
}

func TestUpdateSearchMissing(t *testing.T) {
    rec := searchRequest(t, http.MethodPut, searchJSON("Nowhere", "[]"),
	"999999", h.updateSearch)
    assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestUpdateSearchRenameConflict(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)

    rec := searchRequest(t, http.MethodPut, searchJSON("Planets", "[]"),
	fmt.Sprint(created.ID), h.updateSearch)
    assert.Equal(t, http.StatusConflict, rec.Code)
    assert.Contains(t, searchNames(t), "Bright doubles")
    assert.Equal(t, int64(2), candidateRowCount(created.ID))
}

// Keeping its own name is not a conflict with itself.
func TestUpdateSearchKeepingName(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)

    rec := searchRequest(t, http.MethodPut, doublesJSON,
	fmt.Sprint(created.ID), h.updateSearch)
    assert.Equal(t, http.StatusOK, rec.Code)
}

func TestDeleteSearch(t *testing.T) {
    created := createSearch(t, doublesJSON)
    assert.Contains(t, searchNames(t), "Bright doubles")

    rec := searchRequest(t, http.MethodDelete, "", fmt.Sprint(created.ID),
	h.deleteSearch)
    assert.Equal(t, http.StatusNoContent, rec.Code)
    assert.NotContains(t, searchNames(t), "Bright doubles")
    assert.Equal(t, int64(0), candidateRowCount(created.ID))
    dropSearch(created.ID)
}

// Unlike positions, the last search can be deleted.
func TestDeleteLastSearch(t *testing.T) {
    asOtherUser(t)
    assert.Equal(t, 0, len(listSearches(t)))
    created := createSearch(t, searchJSON("Only one", "[]"))
    assert.Equal(t, 1, len(listSearches(t)))

    rec := searchRequest(t, http.MethodDelete, "", fmt.Sprint(created.ID),
	h.deleteSearch)
    assert.Equal(t, http.StatusNoContent, rec.Code)
    assert.Equal(t, 0, len(listSearches(t)))
    dropSearch(created.ID)
}

func TestDeleteSearchForeign(t *testing.T) {
    asOtherUser(t)
    theirs := createSearch(t, searchJSON("Theirs", "[]"))
    defer dropSearch(theirs.ID)
    u = "testuser"

    rec := searchRequest(t, http.MethodDelete, "", fmt.Sprint(theirs.ID),
	h.deleteSearch)
    assert.Equal(t, http.StatusNotFound, rec.Code)

    asOtherUser(t)
    assert.Equal(t, []string{"Theirs"}, searchNames(t))
}

func TestDeleteSearchMissing(t *testing.T) {
    rec := searchRequest(t, http.MethodDelete, "", "999999", h.deleteSearch)
    assert.Equal(t, http.StatusNotFound, rec.Code)
}
