package auth

import "crypto/subtle"

// CSRFVerify mirrors csrf_verify(): constant-time comparison against the
// token stored in the session. Only the three classic HTML form posts
// (login, admin, impersonate) are guarded by this — the JSON API
// endpoints rely on the session cookie's SameSite=Lax alone, exactly as
// in the PHP original.
func CSRFVerify(session *SessionData, token string) bool {
	if session == nil || token == "" || session.CSRFToken == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(session.CSRFToken), []byte(token)) == 1
}
