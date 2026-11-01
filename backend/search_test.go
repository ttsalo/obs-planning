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
	SetKind: "category", OType: "**", MaxMagnitude: floatPtr(5),
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
	    s.SetKind = "planets"; s.MaxMagnitude = nil; s.OType = "" }, true},
	{"messier without magnitude", func(s *TargetSearch) {
	    s.SetKind = "messier"; s.MaxMagnitude = nil; s.OType = "" }, true},
	{"messier with magnitude", func(s *TargetSearch) {
	    s.SetKind = "messier"; s.OType = "" }, true},
	{"caldwell without magnitude", func(s *TargetSearch) {
	    s.SetKind = "caldwell"; s.MaxMagnitude = nil; s.OType = "" }, true},
	{"herschel 400 with magnitude", func(s *TargetSearch) {
	    s.SetKind = "herschel400"; s.OType = "" }, true},
	{"melotte", func(s *TargetSearch) {
	    s.SetKind = "melotte"; s.MaxMagnitude = nil; s.OType = "" }, true},
	{"collinder", func(s *TargetSearch) {
	    s.SetKind = "collinder"; s.MaxMagnitude = nil; s.OType = "" }, true},
	{"caldwell with an object type", func(s *TargetSearch) {
	    s.SetKind = "caldwell"; s.OType = "GlC" }, false},
	{"names", func(s *TargetSearch) {
	    s.SetKind = "names"; s.OType = ""
	    s.Names = Names{"Vega", "M31"} }, true},
	{"cluster category", func(s *TargetSearch) {
	    s.OType = "GlC"; s.MaxMagnitude = floatPtr(9) }, true},
	{"category code with a digit", func(s *TargetSearch) {
	    s.OType = "Sy1" }, true},
	{"category code with a candidate suffix", func(s *TargetSearch) {
	    s.OType = "GlC?" }, true},
	{"lowercase category code", func(s *TargetSearch) {
	    s.OType = "s*r" }, true},
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
	{"withdrawn double stars set", func(s *TargetSearch) {
	    s.SetKind = "double_stars"; s.OType = "" }, false},
	{"category without magnitude", func(s *TargetSearch) {
	    s.MaxMagnitude = nil }, false},
	{"category without an object type", func(s *TargetSearch) {
	    s.OType = "" }, false},
	{"category code with a quote", func(s *TargetSearch) {
	    s.OType = "*' OR '1'='1" }, false},
	{"category code with a space", func(s *TargetSearch) {
	    s.OType = "Gl C" }, false},
	{"category code too long", func(s *TargetSearch) {
	    s.OType = "TOOLONGCODE" }, false},
	{"object type on a non-category set", func(s *TargetSearch) {
	    s.SetKind = "planets"; s.MaxMagnitude = nil }, false},
	{"absurd magnitude", func(s *TargetSearch) {
	    s.MaxMagnitude = floatPtr(99) }, false},
	{"names without names", func(s *TargetSearch) {
	    s.SetKind = "names"; s.OType = "" }, false},
	{"names with a blank name", func(s *TargetSearch) {
	    s.SetKind = "names"; s.OType = ""
	    s.Names = Names{"Vega", "  "} }, false},
	{"bad start time", func(s *TargetSearch) { s.StartTime = "25:00" }, false},
	{"bad end time", func(s *TargetSearch) { s.EndTime = "2am" }, false},
	{"start date only", func(s *TargetSearch) {
	    s.StartDate = "2026-09-01" }, false},
	{"bad start date", func(s *TargetSearch) {
	    s.StartDate = "01.09.2026"; s.EndDate = "2026-09-02" }, false},
	{"inverted day range", func(s *TargetSearch) {
	    s.StartDate = "2026-09-10"; s.EndDate = "2026-09-01" }, false},
	{"day range of a full year", func(s *TargetSearch) {
	    s.StartDate = "2026-09-01"; s.EndDate = "2027-09-01" }, true},
	{"day range too long", func(s *TargetSearch) {
	    s.StartDate = "2026-09-01"; s.EndDate = "2027-10-11" }, false},
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

/* Rows in target_objects for a search, deleted ones included, straight
from the table.

The classic API, not gorm.G: gorm.G starts a new session whose fresh
statement drops the Unscoped flag, so gorm.G[T](db.Unscoped()) counts
only the live rows. This helper exists to see the soft-deleted ones,
so using gorm.G here would quietly defeat the very test it serves. */
func candidateRowCount(searchID uint) int64 {
    var count int64
    sqlite_db.Unscoped().Model(&TargetObject{}).Where(
	"target_search_id = ?", searchID).Count(&count)
    return count
}

// Rows for a search that are present but soft-deleted; should always
// be zero, since a candidate is only ever hard-deleted.
func softDeletedCandidateCount(searchID uint) int64 {
    var count int64
    sqlite_db.Unscoped().Model(&TargetObject{}).Where(
	"target_search_id = ? AND deleted_at IS NOT NULL", searchID).Count(&count)
    return count
}

// Drop a search a test created, and its candidates, so the shared
// in-memory DB is left as found.
func dropSearch(id uint) {
    sqlite_db.Unscoped().Where("target_search_id = ?", id).Delete(&TargetObject{})
    sqlite_db.Unscoped().Where("id = ?", id).Delete(&TargetSearch{})
}

const doublesCandidatesJSON = `[` +
    `{"name":"Mizar","ss_obj":false,"ra":200.98,"dec":54.93,` +
    `"magnitude":2.2,"object_type":"Double star","matched":true},` +
    `{"name":"Albireo","ss_obj":false,"ra":292.68,"dec":27.96,` +
    `"magnitude":3.1,"object_type":"Double star","matched":false}]`

const doublesJSON = `{"name":"Bright doubles","set_kind":"category",` +
    `"otype":"**",` +
    `"max_magnitude":5,"start_time":"22:00","end_time":"02:00",` +
    `"visibility":"window","max_brightness":"NT",` +
    `"evaluated_at":"2026-09-03T20:00:00Z","evaluated_position":"Helsinki",` +
    `"candidates":` + doublesCandidatesJSON + `}`

// The same definition with a different name and candidate list.
func searchJSON(name string, candidates string) string {
    return `{"name":"` + name + `","set_kind":"category","otype":"**",` +
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
    assert.Equal(t, "category", created.SetKind)
    assert.Equal(t, "**", created.OType)
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

// The object-type code round-trips for a category set, and is dropped
// for every other set rather than rejecting the request.
func TestCreateSearchCategoryOType(t *testing.T) {
    created := createSearch(t, `{"name":"Globulars","set_kind":"category",` +
	`"otype":" GlC ","max_magnitude":9,"start_time":"22:00",` +
	`"end_time":"02:00","visibility":"window","max_brightness":"NT",` +
	`"candidates":[]}`)
    defer dropSearch(created.ID)

    assert.Equal(t, "GlC", created.OType)
    assert.Equal(t, "GlC", findSearch(t, created.ID).OType)

    // A code sent with a set that has no categories is ignored, not an
    // error: the sky view and the listing never read it for such a set.
    other := createSearch(t, `{"name":"Planets with a code",` +
	`"set_kind":"planets","otype":"GlC","start_time":"22:00",` +
	`"end_time":"02:00","visibility":"none","max_brightness":"D",` +
	`"candidates":[]}`)
    defer dropSearch(other.ID)

    assert.Equal(t, "", other.OType)
    assert.Equal(t, "", findSearch(t, other.ID).OType)
}

// Switching a saved category search to another set clears its code.
func TestUpdateSearchClearsOType(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)
    assert.Equal(t, "**", created.OType)

    rec := searchRequest(t, http.MethodPut,
	`{"name":"Bright doubles","set_kind":"planets","start_time":"22:00",` +
	    `"end_time":"02:00","visibility":"none","max_brightness":"D",` +
	    `"candidates":[]}`,
	fmt.Sprint(created.ID), h.updateSearch)
    assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
    assert.Equal(t, "", findSearch(t, created.ID).OType)
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
	"withdrawn double stars set": base(
	    `"set_kind":"double_stars","max_magnitude":5`, `[]`),
	"category without magnitude": base(
	    `"set_kind":"category","otype":"**"`, `[]`),
	"category without an object type": base(
	    `"set_kind":"category","max_magnitude":5`, `[]`),
	"category with a quoted object type": base(
	    `"set_kind":"category","max_magnitude":5,"otype":"*' OR '1'='1"`,
	    `[]`),
	"category with an over-long object type": base(
	    `"set_kind":"category","max_magnitude":5,"otype":"TOOLONGCODE"`,
	    `[]`),
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
	    `"start_date":"2026-09-01","end_date":"2027-10-11",` +
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

// --- per-day observability records ------------------------------------

type daysResponse struct {
    StartDate string `json:"start_date"`
    EndDate string `json:"end_date"`
    DayCount int `json:"day_count"`
    WindowHours float64 `json:"window_hours"`
    Objects []ObjectDays `json:"objects"`
}

func getSearchDays(t *testing.T, id uint) daysResponse {
    rec := searchRequest(t, http.MethodGet, "", fmt.Sprint(id), h.searchDays)
    assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
    var out daysResponse
    if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
	t.Fatal(err)
    }
    return out
}

// A three-day search whose first candidate has records on days 0 and 2.
func searchWithDaysJSON(name string) string {
    return `{"name":"` + name + `","set_kind":"planets",` +
	`"start_time":"22:00","end_time":"02:00",` +
	`"start_date":"2026-11-01","end_date":"2026-11-03",` +
	`"visibility":"window","max_brightness":"NT",` +
	`"evaluated_position":"Helsinki",` +
	`"evaluated_lat":60.17,"evaluated_lon":24.94,` +
	`"evaluated_min_az":0,"evaluated_max_az":360,` +
	`"evaluated_min_alt":10,"evaluated_max_alt":90,` +
	`"candidates":[` +
	`{"name":"Jupiter","ss_obj":true,"matched":true,` +
	`"days":[[0,3.5,45.2,-22.1,120],[2,1.25,30,-18.5,60]]},` +
	`{"name":"Saturn","ss_obj":true,"matched":false,"days":[]}]}`
}

func TestSearchDaysRoundTrip(t *testing.T) {
    created := createSearch(t, searchWithDaysJSON("Ranged"))
    defer dropSearch(created.ID)

    got := getSearchDays(t, created.ID)
    assert.Equal(t, "2026-11-01", got.StartDate)
    assert.Equal(t, "2026-11-03", got.EndDate)
    assert.Equal(t, 3, got.DayCount)
    assert.Equal(t, 4.0, got.WindowHours)

    // Only the candidate that has records appears, named and identified.
    if len(got.Objects) != 1 {
	t.Fatalf("expected one object with records, got %d", len(got.Objects))
    }
    assert.Equal(t, "Jupiter", got.Objects[0].Name)
    assert.NotEqual(t, uint(0), got.Objects[0].ID)
    assert.Equal(t, Days{{0, 3.5, 45.2, -22.1, 120}, {2, 1.25, 30, -18.5, 60}},
	got.Objects[0].Days)

    // The records scan back out of the column, not just out of a cache.
    var stored []TargetObject
    if err := sqlite_db.Where("target_search_id = ?", created.ID).Order(
	    "name").Find(&stored).Error; err != nil {
	t.Fatal(err)
    }
    assert.Equal(t, 2, len(stored))
    assert.Equal(t, 2, len(stored[0].Days))     // Jupiter
    assert.Equal(t, 45.2, stored[0].Days[0][DayMaxAlt])
    assert.Equal(t, Days{}, stored[1].Days)     // Saturn
}

// The listing is shared by the header, the dialog and the sky view, so
// it must not grow by a search's whole grid.
func TestSearchListingOmitsDays(t *testing.T) {
    created := createSearch(t, searchWithDaysJSON("Ranged"))
    defer dropSearch(created.ID)

    rec := searchRequest(t, http.MethodGet, "", "", h.searches)
    assert.Equal(t, http.StatusOK, rec.Code)
    assert.NotContains(t, rec.Body.String(), "45.2")
    assert.NotContains(t, rec.Body.String(), `"days"`)

    // The candidates themselves are still there with their flags.
    stored := findSearch(t, created.ID)
    if stored == nil {
	t.Fatal("created search missing from the listing")
    }
    assert.Equal(t, 2, len(stored.TargetObjects))
    assert.True(t, stored.TargetObjects[0].Matched)
}

func TestSearchDaysEmpty(t *testing.T) {
    created := createSearch(t, searchJSON("Plain", "[]"))
    defer dropSearch(created.ID)

    got := getSearchDays(t, created.ID)
    assert.Equal(t, 0, len(got.Objects))
    // No day range: there is no range to place a record in.
    assert.Equal(t, "", got.StartDate)
    assert.Equal(t, 1, got.DayCount)
}

func TestSearchDaysForeign(t *testing.T) {
    asOtherUser(t)
    theirs := createSearch(t, searchWithDaysJSON("Theirs"))
    defer dropSearch(theirs.ID)
    u = "testuser"

    rec := searchRequest(t, http.MethodGet, "", fmt.Sprint(theirs.ID),
	h.searchDays)
    assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestSearchDaysMissing(t *testing.T) {
    rec := searchRequest(t, http.MethodGet, "", "999999", h.searchDays)
    assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestSearchEvaluatedDetails(t *testing.T) {
    created := createSearch(t, searchWithDaysJSON("Ranged"))
    defer dropSearch(created.ID)

    assert.Equal(t, "Helsinki", created.EvaluatedPosition)
    assert.Equal(t, 60.17, created.EvaluatedLat)
    assert.Equal(t, 24.94, created.EvaluatedLon)
    assert.Equal(t, 10.0, created.EvaluatedMinAlt)
    assert.Equal(t, 360.0, created.EvaluatedMaxAz)

    // An update rewrites them, so re-evaluating for a moved position
    // does not leave the old coordinates behind.
    body := `{"name":"Ranged","set_kind":"planets",` +
	`"start_time":"22:00","end_time":"02:00",` +
	`"visibility":"window","max_brightness":"NT",` +
	`"evaluated_position":"Oulu",` +
	`"evaluated_lat":65.01,"evaluated_lon":25.47,` +
	`"evaluated_min_az":10,"evaluated_max_az":350,` +
	`"evaluated_min_alt":5,"evaluated_max_alt":85,` +
	`"candidates":[]}`
    rec := searchRequest(t, http.MethodPut, body, fmt.Sprint(created.ID),
	h.updateSearch)
    assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
    stored := findSearch(t, created.ID)
    assert.Equal(t, "Oulu", stored.EvaluatedPosition)
    assert.Equal(t, 65.01, stored.EvaluatedLat)
    assert.Equal(t, 5.0, stored.EvaluatedMinAlt)
}

// A search saved before the evaluation details existed reads back with
// none, which is what keeps it from being reported stale.
func TestSearchEvaluatedDetailsAbsent(t *testing.T) {
    created := createSearch(t, searchJSON("Plain", "[]"))
    defer dropSearch(created.ID)

    assert.Equal(t, 0.0, created.EvaluatedLat)
    assert.Equal(t, 0.0, created.EvaluatedLon)
    assert.Equal(t, 0.0, created.EvaluatedMaxAlt)
}

func TestTargetObjectValidateDays(t *testing.T) {
    // Three days of a four-hour window: day index 0..2, at most four
    // hours, peak at most 240 minutes in.
    cases := []struct {
	name string
	days Days
	valid bool
    }{
	{"no records", Days{}, true},
	{"first and last day", Days{{0, 4, 45, -20, 0}, {2, 4, 45, -20, 240}}, true},
	{"sun limb above the zenith", Days{{0, 1, 45, 90.27, 0}}, true},
	{"day index past the range", Days{{3, 1, 45, -20, 0}}, false},
	{"negative day index", Days{{-1, 1, 45, -20, 0}}, false},
	{"fractional day index", Days{{0.5, 1, 45, -20, 0}}, false},
	{"negative hours", Days{{0, -1, 45, -20, 0}}, false},
	{"hours longer than the window", Days{{0, 4.5, 45, -20, 0}}, false},
	{"altitude too high", Days{{0, 1, 91, -20, 0}}, false},
	{"altitude too low", Days{{0, 1, -91, -20, 0}}, false},
	{"peak beyond the window", Days{{0, 1, 45, -20, 241}}, false},
    }
    for _, tc := range cases {
	t.Run(tc.name, func(t *testing.T) {
	    obj := TargetObject{Name: "Jupiter", SSObj: true, Days: tc.days}
	    err := obj.ValidateDays(3, 4.0)
	    if tc.valid {
		assert.Nil(t, err)
	    } else {
		assert.NotNil(t, err)
	    }
	})
    }
}

// A malformed record is rejected by the endpoint, not just the model.
func TestCreateSearchBadDays(t *testing.T) {
    body := `{"name":"Bad","set_kind":"planets",` +
	`"start_time":"22:00","end_time":"02:00",` +
	`"start_date":"2026-11-01","end_date":"2026-11-03",` +
	`"visibility":"window","max_brightness":"NT","candidates":[` +
	`{"name":"Jupiter","ss_obj":true,"matched":true,` +
	`"days":[[7,3.5,45.2,-22.1,120]]}]}`
    rec := searchRequest(t, http.MethodPost, body, "", h.createSearch)
    assert.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
    assert.NotContains(t, searchNames(t), "Bad")
}

// Candidates times days is the real size limit.
func manyCandidatesJSON(n int) string {
    var b strings.Builder
    for i := 0; i < n; i++ {
	if i > 0 {
	    b.WriteString(",")
	}
	fmt.Fprintf(&b, `{"name":"S%d","ra":%d,"dec":0}`, i, i%360)
    }
    return b.String()
}

func rangedSearchJSON(name string, end string, candidates string) string {
    return `{"name":"` + name + `","set_kind":"messier",` +
	`"start_time":"22:00","end_time":"02:00",` +
	`"start_date":"2026-11-01","end_date":"` + end + `",` +
	`"visibility":"window","max_brightness":"NT","candidates":[` +
	candidates + `]}`
}

func TestCreateSearchCellLimit(t *testing.T) {
    // An object list over a full year fits: 110 x 366 = 40260.
    ok := createSearch(t, rangedSearchJSON("Year", "2027-11-01",
	manyCandidatesJSON(110)))
    defer dropSearch(ok.ID)
    assert.Equal(t, 366, ok.DayCount())

    // A larger list over the same year does not: 200 x 366 = 73200.
    rec := searchRequest(t, http.MethodPost, rangedSearchJSON("Bad",
	"2027-11-01", manyCandidatesJSON(200)), "", h.createSearch)
    assert.Equal(t, http.StatusBadRequest, rec.Code)
    assert.Contains(t, rec.Body.String(), "73200")
    assert.Contains(t, rec.Body.String(), fmt.Sprint(MaxSearchCells))
    assert.NotContains(t, searchNames(t), "Bad")
}

// --- candidates are hard-deleted --------------------------------------

/* A re-evaluation must not leave its old candidate rows behind.

These assertions name the defect directly: candidateRowCount catches it
too, but only since its own gorm.G call was fixed. Both the helper and
the code under test dropped the Unscoped flag the same way, so the
check at the end of TestUpdateSearchReplacesCandidates sat green
through the whole period the rows were accumulating (OBS-21). */
func TestUpdateSearchLeavesNothingSoftDeleted(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)
    assert.Equal(t, int64(2), candidateRowCount(created.ID))
    assert.Equal(t, int64(0), softDeletedCandidateCount(created.ID))

    rec := searchRequest(t, http.MethodPut, searchJSON("Bright doubles",
	`[{"name":"Mizar","ra":200.98,"dec":54.93,"matched":true}]`),
	fmt.Sprint(created.ID), h.updateSearch)
    assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

    assert.Equal(t, int64(1), candidateRowCount(created.ID))
    assert.Equal(t, int64(0), softDeletedCandidateCount(created.ID))
}

// Deleting a search takes its candidates with it, rows and all; the
// search itself stays soft-deleted as before.
func TestDeleteSearchLeavesNothingSoftDeleted(t *testing.T) {
    created := createSearch(t, doublesJSON)
    rec := searchRequest(t, http.MethodDelete, "", fmt.Sprint(created.ID),
	h.deleteSearch)
    assert.Equal(t, http.StatusNoContent, rec.Code)
    assert.Equal(t, int64(0), candidateRowCount(created.ID))
    assert.Equal(t, int64(0), softDeletedCandidateCount(created.ID))
}

// The startup purge clears rows abandoned before the fix.
func TestPurgeDeletedCandidates(t *testing.T) {
    created := createSearch(t, doublesJSON)
    defer dropSearch(created.ID)

    // Soft-delete one the way the old code did, so there is something
    // to purge.
    assert.Nil(t, sqlite_db.Where("target_search_id = ? AND name = ?",
	created.ID, "Albireo").Delete(&TargetObject{}).Error)
    assert.Equal(t, int64(2), candidateRowCount(created.ID))
    assert.Equal(t, int64(1), softDeletedCandidateCount(created.ID))

    purged, err := PurgeDeletedCandidates(sqlite_db)
    assert.Nil(t, err)
    assert.True(t, purged >= 1, "expected at least the one row purged")
    assert.Equal(t, int64(1), candidateRowCount(created.ID))
    assert.Equal(t, int64(0), softDeletedCandidateCount(created.ID))

    // Idempotent: nothing left to find on a second run.
    again, err := PurgeDeletedCandidates(sqlite_db)
    assert.Nil(t, err)
    assert.Equal(t, int64(0), again)
}
