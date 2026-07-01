// Package auth ports includes/auth.php: cookie-based sessions, RBAC
// permission checks and admin impersonation.
package auth

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"sync"
	"time"
)

const sessionCookieName = "resourcebay_session"
const sessionLifetime = 24 * time.Hour

type SessionUser struct {
	Username    string   `json:"username"`
	Role        string   `json:"role"`
	Permissions []string `json:"permissions"`
}

type SessionData struct {
	User        SessionUser
	Impersonate *SessionUser
	ExpiresAt   time.Time
	CSRFToken   string
}

func (d *SessionData) LoggedIn() bool {
	return d != nil && d.User.Username != ""
}

// CurrentUser mirrors current_user(): returns the impersonated user while
// impersonation is active, otherwise the real logged-in user.
func (d *SessionData) CurrentUser() *SessionUser {
	if d == nil {
		return nil
	}
	if d.Impersonate != nil {
		return d.Impersonate
	}
	if d.User.Username == "" {
		return nil
	}
	return &d.User
}

// RealUser mirrors real_user(): always the actual logged-in account,
// regardless of impersonation.
func (d *SessionData) RealUser() *SessionUser {
	if d == nil || d.User.Username == "" {
		return nil
	}
	return &d.User
}

func (d *SessionData) IsImpersonating() bool {
	return d != nil && d.Impersonate != nil
}

func (d *SessionData) StartImpersonation(username string, target SessionUser) {
	d.Impersonate = &SessionUser{Username: username, Role: target.Role, Permissions: target.Permissions}
}

func (d *SessionData) StopImpersonation() {
	d.Impersonate = nil
}

type SessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*SessionData
}

func NewSessionStore() *SessionStore {
	return &SessionStore{sessions: map[string]*SessionData{}}
}

func randomID() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}

func (s *SessionStore) setCookie(w http.ResponseWriter, r *http.Request, id string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
		MaxAge:   int(sessionLifetime.Seconds()),
	})
}

// Ensure returns the current session, creating an anonymous one (no user,
// just a CSRF token) if none exists yet — mirrors PHP's lazy session_start().
func (s *SessionStore) Ensure(w http.ResponseWriter, r *http.Request) (string, *SessionData) {
	if c, err := r.Cookie(sessionCookieName); err == nil {
		s.mu.RLock()
		data, ok := s.sessions[c.Value]
		s.mu.RUnlock()
		if ok && time.Now().Before(data.ExpiresAt) {
			return c.Value, data
		}
	}
	id := randomID()
	data := &SessionData{ExpiresAt: time.Now().Add(sessionLifetime), CSRFToken: randomID()}
	s.mu.Lock()
	s.sessions[id] = data
	s.mu.Unlock()
	s.setCookie(w, r, id)
	return id, data
}

// Get reads the session without creating one (safe for non-mutating checks).
func (s *SessionStore) Get(r *http.Request) *SessionData {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil
	}
	s.mu.RLock()
	data, ok := s.sessions[c.Value]
	s.mu.RUnlock()
	if !ok || time.Now().After(data.ExpiresAt) {
		return nil
	}
	return data
}

// Login mirrors login_user(): rotates the session ID (session_regenerate_id)
// and sets the authenticated user, refreshing the 24h expiry.
func (s *SessionStore) Login(w http.ResponseWriter, r *http.Request, user SessionUser) *SessionData {
	id, data := s.Ensure(w, r)
	s.mu.Lock()
	delete(s.sessions, id)
	newID := randomID()
	data.User = user
	data.Impersonate = nil
	data.ExpiresAt = time.Now().Add(sessionLifetime)
	s.sessions[newID] = data
	s.mu.Unlock()
	s.setCookie(w, r, newID)
	return data
}

func (s *SessionStore) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookieName); err == nil {
		s.mu.Lock()
		delete(s.sessions, c.Value)
		s.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
}

// NewLocalSession builds a synthetic always-admin session for desktop/local
// mode, where there is no login screen at all.
func NewLocalSession() *SessionData {
	return &SessionData{
		User:      SessionUser{Username: "Lokal", Role: "admin", Permissions: []string{}},
		ExpiresAt: time.Now().Add(100 * 365 * 24 * time.Hour),
		CSRFToken: randomID(),
	}
}
