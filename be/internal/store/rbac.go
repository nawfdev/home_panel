// Package store: role-based access control (RBAC), multi-user management, and TOTP 2FA.
package store

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrRoleLocked    = errors.New("role is locked")
	ErrRoleInUse     = errors.New("role is assigned to at least one user")
	ErrLastAdmin     = errors.New("cannot remove the last admin")
	ErrUsernameTaken = errors.New("username already taken")
)

func (s *Store) ListUsers() []User {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]User, len(s.d.Users))
	copy(out, s.d.Users)
	return out
}

// CreateUser inserts a new family account. Password must already be hashed.
func (s *Store) CreateUser(username, hashedPassword, role string) (User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.d.Users {
		if u.Username == username {
			return User{}, ErrUsernameTaken
		}
	}
	u := User{
		ID:        len(s.d.Users) + 1,
		Username:  username,
		Password:  hashedPassword,
		Role:      role,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	s.d.Users = append(s.d.Users, u)
	return u, s.save()
}

func (s *Store) UpdateUserRole(id int, role string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == id {
			s.d.Users[i].Role = role
			return s.save()
		}
	}
	return ErrNotFound
}

// DeleteUser refuses to remove the last remaining admin account, so the
// panel can never be locked out of user management.
func (s *Store) DeleteUser(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	admins := 0
	for _, u := range s.d.Users {
		if u.Role == "admin" {
			admins++
		}
	}
	for i := range s.d.Users {
		if s.d.Users[i].ID == id {
			if s.d.Users[i].Role == "admin" && admins <= 1 {
				return ErrLastAdmin
			}
			s.d.Users = append(s.d.Users[:i], s.d.Users[i+1:]...)
			return s.save()
		}
	}
	return ErrNotFound
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// IssueUserToken generates a fresh bearer token for native clients (Android),
// replacing any previously issued token for that user (single active mobile
// token per account — logging in on a new device rotates the old one out).
func (s *Store) IssueUserToken(id int) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := hex.EncodeToString(raw)

	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == id {
			s.d.Users[i].TokenHash = hashToken(token)
			return token, s.save()
		}
	}
	return "", ErrNotFound
}

func (s *Store) GetUserByToken(token string) (User, bool) {
	want := hashToken(token)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.d.Users {
		if u.TokenHash != "" && u.TokenHash == want {
			return u, true
		}
	}
	return User{}, false
}

func (s *Store) ClearUserToken(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == id {
			s.d.Users[i].TokenHash = ""
			return s.save()
		}
	}
	return nil
}

func (s *Store) SetUserTOTP(id int, secret string, recoveryCodes []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == id {
			s.d.Users[i].TOTPSecret = secret
			s.d.Users[i].RecoveryCodes = append([]string(nil), recoveryCodes...)
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *Store) ConsumeRecoveryCode(id int, codeHash string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID != id {
			continue
		}
		for j, candidate := range s.d.Users[i].RecoveryCodes {
			if candidate == codeHash {
				s.d.Users[i].RecoveryCodes = append(s.d.Users[i].RecoveryCodes[:j], s.d.Users[i].RecoveryCodes[j+1:]...)
				_ = s.save()
				return true
			}
		}
	}
	return false
}

// Passkeys methods
func (s *Store) AddUserPasskey(userID int, p Passkey) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == userID {
			s.d.Users[i].Passkeys = append(s.d.Users[i].Passkeys, p)
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *Store) DeleteUserPasskey(userID int, passkeyID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Users {
		if s.d.Users[i].ID == userID {
			var updated []Passkey
			for _, pk := range s.d.Users[i].Passkeys {
				if pk.ID != passkeyID {
					updated = append(updated, pk)
				}
			}
			s.d.Users[i].Passkeys = updated
			return s.save()
		}
	}
	return ErrNotFound
}

func (s *Store) ListUserPasskeys(userID int) []Passkey {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.d.Users {
		if u.ID == userID {
			out := make([]Passkey, len(u.Passkeys))
			copy(out, u.Passkeys)
			return out
		}
	}
	return []Passkey{}
}

func (s *Store) GetUserByPasskeyCredID(credID string) (User, Passkey, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, u := range s.d.Users {
		for _, pk := range u.Passkeys {
			if pk.CredID == credID {
				return u, pk, true
			}
		}
	}
	return User{}, Passkey{}, false
}

func (s *Store) ListRoles() []Role {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Role, len(s.d.Roles))
	copy(out, s.d.Roles)
	return out
}

func (s *Store) GetRole(id string) (Role, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.d.Roles {
		if r.ID == id {
			return r, true
		}
	}
	return Role{}, false
}

func (s *Store) CreateRole(id, label string, features []string) (Role, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.d.Roles {
		if r.ID == id {
			return Role{}, ErrUsernameTaken
		}
	}
	r := Role{ID: id, Label: label, Features: features, Locked: false}
	s.d.Roles = append(s.d.Roles, r)
	return r, s.save()
}

func (s *Store) UpdateRoleFeatures(id string, features []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.d.Roles {
		if s.d.Roles[i].ID == id {
			if s.d.Roles[i].Locked {
				return ErrRoleLocked
			}
			s.d.Roles[i].Features = features
			return s.save()
		}
	}
	return ErrNotFound
}

// DeleteRole refuses to remove a locked role or one still assigned to a user.
func (s *Store) DeleteRole(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, u := range s.d.Users {
		if u.Role == id {
			return ErrRoleInUse
		}
	}
	for i := range s.d.Roles {
		if s.d.Roles[i].ID == id {
			if s.d.Roles[i].Locked {
				return ErrRoleLocked
			}
			s.d.Roles = append(s.d.Roles[:i], s.d.Roles[i+1:]...)
			return s.save()
		}
	}
	return ErrNotFound
}

// ResolveFeatures returns the feature keys granted to a role. "admin" is a
// hardcoded superuser regardless of its stored row (see the Role doc
// comment), and an unknown/deleted role fails closed to no features.
func (s *Store) ResolveFeatures(role string) []string {
	if role == "admin" {
		return FeatureKeys
	}
	r, ok := s.GetRole(role)
	if !ok {
		return nil
	}
	return r.Features
}

// HashPassword is a small shared helper so handlers don't import bcrypt
// directly for user-management flows.
func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), 10)
	return string(h), err
}
