package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"virtual-tour/db"
	"virtual-tour/internal/database"
)

func call(handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, path, strings.NewReader(body)))
	return recorder
}

func TestInvalidInput(t *testing.T) {
	handler := New(nil, func(context.Context) error { return nil })
	for _, body := range []string{
		`null`, `[]`, `{}`, `{"name":" "}`, `{"name":42}`,
		`{"name":"ok","unknown":true}`, `{"name":"ok"} {}`,
		`{"name":"` + strings.Repeat("a", 121) + `"}`,
		`{"name":"ok","description":"` + strings.Repeat("a", 5001) + `"}`,
	} {
		t.Run(body[:min(len(body), 30)], func(t *testing.T) {
			result := call(handler, "POST", "/api/v1/projects", body)
			if result.Code != 400 {
				t.Fatalf("got %d: %s", result.Code, result.Body.String())
			}
		})
	}
	for _, method := range []string{"GET", "PATCH", "DELETE"} {
		if result := call(handler, method, "/api/v1/projects/not-a-uuid", `{}`); result.Code != 400 {
			t.Fatalf("%s: %d", method, result.Code)
		}
	}
}

func TestHealth(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
	}{{nil, 200}, {errors.New("offline"), 503}} {
		result := call(New(nil, func(context.Context) error { return test.err }), "GET", "/health", "")
		if result.Code != test.status {
			t.Fatalf("got %d, want %d", result.Code, test.status)
		}
	}
}

func TestProjectPersistence(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run the PostgreSQL integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
	handler := New(database.New(pool), pool.Ping)
	created := call(handler, "POST", "/api/v1/projects", `{"name":"  POC integration test  ","description":"Original"}`)
	if created.Code != 201 {
		t.Fatalf("create: %d %s", created.Code, created.Body.String())
	}
	var project database.Project
	if err := json.Unmarshal(created.Body.Bytes(), &project); err != nil {
		t.Fatal(err)
	}
	if project.Name != "POC integration test" || !project.ID.Valid {
		t.Fatalf("invalid project: %+v", project)
	}
	defer database.New(pool).DeleteProject(context.Background(), project.ID)
	path := "/api/v1/projects/" + project.ID.String()
	renamed := call(handler, "PATCH", path, `{"name":"Renamed house"}`)
	if renamed.Code != 200 {
		t.Fatalf("rename: %d %s", renamed.Code, renamed.Body.String())
	}
	var updated database.Project
	if err := json.Unmarshal(renamed.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Description != "Original" || updated.Name != "Renamed house" {
		t.Fatalf("partial update lost fields: %+v", updated)
	}

	// A fresh pool and handler simulate an API restart without using process memory.
	fresh, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	restarted := New(database.New(fresh), fresh.Ping)
	loaded := call(restarted, "GET", path, "")
	if loaded.Code != 200 {
		t.Fatalf("reload: %d %s", loaded.Code, loaded.Body.String())
	}
	if err := json.Unmarshal(loaded.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Name != "Renamed house" || updated.Description != "Original" {
		t.Fatalf("persistence: %+v", updated)
	}
	listed := call(restarted, "GET", "/api/v1/projects", "")
	if listed.Code != 200 || !strings.Contains(listed.Body.String(), project.ID.String()) {
		t.Fatalf("list: %s", listed.Body.String())
	}
	if result := call(restarted, "DELETE", path, ""); result.Code != 204 {
		t.Fatalf("delete: %d", result.Code)
	}
	for _, method := range []string{"GET", "PATCH", "DELETE"} {
		if result := call(restarted, method, path, `{"name":"Gone"}`); result.Code != 404 {
			t.Fatalf("%s deleted project: %d", method, result.Code)
		}
	}
}
