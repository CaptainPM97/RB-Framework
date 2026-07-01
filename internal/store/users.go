package store

import (
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var ErrUserExists = errors.New("user already exists")
var ErrUserNotFound = errors.New("user not found")

type User struct {
	PasswordHash string   `json:"passwordHash"`
	Role         string   `json:"role"`
	Permissions  []string `json:"permissions"`
	CreatedAt    string   `json:"createdAt"`
}

// UserStore persists data/users.json. Unlike the original PHP
// ensure_users_file(), no default admin account is ever seeded — a fresh
// install starts with zero users, and the first-run setup flow
// (handlers/setup.go) is responsible for creating the first admin.
type UserStore struct {
	guard *fileGuard
}

func NewUserStore(path string) *UserStore {
	return &UserStore{guard: newFileGuard(path)}
}

func (s *UserStore) Load() (map[string]User, error) {
	users := map[string]User{}
	if err := s.guard.read(&users); err != nil {
		return nil, err
	}
	if users == nil {
		users = map[string]User{}
	}
	return users, nil
}

func (s *UserStore) save(users map[string]User) error {
	return s.guard.write(users)
}

func (s *UserStore) IsEmpty() (bool, error) {
	users, err := s.Load()
	if err != nil {
		return false, err
	}
	return len(users) == 0, nil
}

func (s *UserStore) Find(username string) (*User, bool, error) {
	users, err := s.Load()
	if err != nil {
		return nil, false, err
	}
	u, ok := users[username]
	if !ok {
		return nil, false, nil
	}
	return &u, true, nil
}

func (s *UserStore) Create(username, password, role string) error {
	if role != "admin" {
		role = "user"
	}
	users, err := s.Load()
	if err != nil {
		return err
	}
	if _, exists := users[username]; exists {
		return ErrUserExists
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	users[username] = User{
		PasswordHash: string(hash),
		Role:         role,
		Permissions:  []string{},
		CreatedAt:    time.Now().Format(time.RFC3339),
	}
	return s.save(users)
}

func (s *UserStore) UpdateRole(username, role string) error {
	users, err := s.Load()
	if err != nil {
		return err
	}
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	if role != "admin" {
		role = "user"
	}
	u.Role = role
	users[username] = u
	return s.save(users)
}

func (s *UserStore) UpdatePassword(username, password string) error {
	users, err := s.Load()
	if err != nil {
		return err
	}
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	u.PasswordHash = string(hash)
	users[username] = u
	return s.save(users)
}

func (s *UserStore) UpdatePermissions(username string, perms []string) error {
	users, err := s.Load()
	if err != nil {
		return err
	}
	u, ok := users[username]
	if !ok {
		return ErrUserNotFound
	}
	u.Permissions = perms
	users[username] = u
	return s.save(users)
}

func (s *UserStore) Delete(username string) error {
	users, err := s.Load()
	if err != nil {
		return err
	}
	if _, ok := users[username]; !ok {
		return ErrUserNotFound
	}
	delete(users, username)
	return s.save(users)
}

func (s *UserStore) CountAdmins(users map[string]User) int {
	count := 0
	for _, u := range users {
		if u.Role == "admin" {
			count++
		}
	}
	return count
}
