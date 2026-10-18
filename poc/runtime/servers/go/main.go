// Same API in idiomatic Go (net/http + encoding/json), standard library only.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
)

type User struct{ ID, Name, Email, PasswordHash, Role string }
type UserOut struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}
type Body struct {
	Name  *string  `json:"name"`
	Email *string  `json:"email"`
	Age   *float64 `json:"age"`
}
type CreatedOut struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Age   int    `json:"age"`
}
type Session struct {
	ID    string
	Perms map[string]bool
}

var users = map[string]User{}
var sessions = map[string]Session{
	"t-read":  {"u-read", map[string]bool{"users:read": true}},
	"t-admin": {"u-admin", map[string]bool{"users:read": true, "users:write": true}},
}
var emailRe = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, _ := json.Marshal(v)
	h := w.Header()
	h.Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(b)
}
func fail(w http.ResponseWriter, status int, msg string) { writeJSON(w, status, map[string]string{"error": msg}) }

func authorize(w http.ResponseWriter, r *http.Request, perm string) bool {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		fail(w, 401, "unauthorized")
		return false
	}
	s, ok := sessions[h[7:]]
	if !ok {
		fail(w, 401, "unauthorized")
		return false
	}
	if !s.Perms[perm] {
		fail(w, 403, "forbidden")
		return false
	}
	return true
}

func validID(id string) bool {
	if len(id) < 1 || len(id) > 10 {
		return false
	}
	for i := 0; i < len(id); i++ {
		if id[i] < '0' || id[i] > '9' {
			return false
		}
	}
	return true
}

func main() {
	for i := 1; i <= 1000; i++ {
		id := fmt.Sprint(i)
		users[id] = User{id, "User " + id, "user" + id + "@example.com", "$argon2id$secret", "member"}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /users/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !authorize(w, r, "users:read") {
			return
		}
		id := r.PathValue("id")
		if !validID(id) {
			fail(w, 400, "invalid id")
			return
		}
		u, ok := users[id]
		if !ok {
			fail(w, 404, "User not found")
			return
		}
		writeJSON(w, 200, UserOut{u.ID, u.Name, u.Email})
	})
	mux.HandleFunc("POST /users", func(w http.ResponseWriter, r *http.Request) {
		if !authorize(w, r, "users:write") {
			return
		}
		ct := strings.ToLower(r.Header.Get("Content-Type"))
		if ct != "application/json" && !strings.HasPrefix(ct, "application/json;") {
			fail(w, 415, "expected application/json")
			return
		}
		var b Body
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&b); err != nil {
			fail(w, 400, "invalid json")
			return
		}
		switch {
		case b.Name == nil || len(*b.Name) < 1 || len(*b.Name) > 100:
			fail(w, 400, "invalid name")
		case b.Email == nil || len(*b.Email) > 200 || !emailRe.MatchString(*b.Email):
			fail(w, 400, "invalid email")
		case b.Age == nil || *b.Age != float64(int(*b.Age)) || *b.Age < 0 || *b.Age > 150:
			fail(w, 400, "invalid age")
		default:
			writeJSON(w, 201, CreatedOut{"1001", *b.Name, *b.Email, int(*b.Age)})
		}
	})
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	http.ListenAndServe(":"+port, mux)
}
