package main

//import "fmt"

import (
//    "net/http"
    
    "github.com/labstack/echo/v4"
)

func main() {
    e := echo.New()
    e.Static("/", "static")
    e.Logger.Fatal(e.Start(":80"))
}
