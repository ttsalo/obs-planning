package main

import (
    "net/http"
    "net/http/httptest"
    "testing"
    "github.com/labstack/echo/v4"
    "github.com/stretchr/testify/assert"
)

var healthPassJSON = `{"status":"pass","error":""}`

func TestHealth(t *testing.T) {
    e := echo.New()
    req := httptest.NewRequest(http.MethodGet, "/", nil)
    rec := httptest.NewRecorder()
    c := e.NewContext(req, rec)
    c.SetPath("/health")
    
    err := health(c)
    if err != nil {
	t.Fatal(err)
    }

    assert.Equal(t, http.StatusOK, rec.Code)
    assert.Equal(t, healthPassJSON + "\n", rec.Body.String())
}
