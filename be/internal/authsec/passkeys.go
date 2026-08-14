package authsec

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

type PasskeyChallenge struct {
	Challenge string `json:"challenge"`
	UserID    int    `json:"userId,omitempty"`
	Username  string `json:"username,omitempty"`
	ExpiresAt int64  `json:"expiresAt"`
}

var (
	challengesMu sync.Mutex
	challenges   = map[string]PasskeyChallenge{}
)

func GenerateChallenge(userID int, username string) (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	challenge := base64.RawURLEncoding.EncodeToString(buf)

	challengesMu.Lock()
	defer challengesMu.Unlock()

	// Prune expired
	now := time.Now().UnixMilli()
	for k, v := range challenges {
		if now > v.ExpiresAt {
			delete(challenges, k)
		}
	}

	challenges[challenge] = PasskeyChallenge{
		Challenge: challenge,
		UserID:    userID,
		Username:  username,
		ExpiresAt: now + (5 * 60 * 1000), // 5 minutes validity
	}

	return challenge, nil
}

func ConsumeChallenge(challenge string) (PasskeyChallenge, bool) {
	challengesMu.Lock()
	defer challengesMu.Unlock()

	c, ok := challenges[challenge]
	if !ok || time.Now().UnixMilli() > c.ExpiresAt {
		delete(challenges, challenge)
		return PasskeyChallenge{}, false
	}
	delete(challenges, challenge)
	return c, true
}

type RegistrationResponse struct {
	ID       string `json:"id"`
	RawID    string `json:"rawId"`
	Type     string `json:"type"`
	Response struct {
		ClientDataJSON    string `json:"clientDataJSON"`
		AttestationObject string `json:"attestationObject"`
	} `json:"response"`
}

type ClientData struct {
	Type        string `json:"type"`
	Challenge   string `json:"challenge"`
	Origin      string `json:"origin"`
	CrossOrigin bool   `json:"crossOrigin,omitempty"`
}

func VerifyRegistration(rawJSON string, expectedUserID int) (credID string, pubKey string, err error) {
	var resp RegistrationResponse
	if err := json.Unmarshal([]byte(rawJSON), &resp); err != nil {
		return "", "", fmt.Errorf("invalid registration JSON: %w", err)
	}

	clientBytes, err := base64.RawURLEncoding.DecodeString(resp.Response.ClientDataJSON)
	if err != nil {
		clientBytes, err = base64.StdEncoding.DecodeString(resp.Response.ClientDataJSON)
		if err != nil {
			return "", "", fmt.Errorf("decode clientDataJSON: %w", err)
		}
	}

	var clientData ClientData
	if err := json.Unmarshal(clientBytes, &clientData); err != nil {
		return "", "", fmt.Errorf("parse clientData: %w", err)
	}

	if clientData.Type != "webauthn.create" {
		return "", "", fmt.Errorf("invalid ceremony type: %s", clientData.Type)
	}

	chal, valid := ConsumeChallenge(clientData.Challenge)
	if !valid || (expectedUserID > 0 && chal.UserID != expectedUserID) {
		return "", "", errors.New("challenge expired or invalid")
	}

	credID = resp.ID
	if credID == "" {
		credID = resp.RawID
	}

	hash := sha256.Sum256([]byte(resp.Response.AttestationObject + resp.ID))
	pubKey = hex.EncodeToString(hash[:])

	return credID, pubKey, nil
}

type AuthenticationResponse struct {
	ID       string `json:"id"`
	RawID    string `json:"rawId"`
	Type     string `json:"type"`
	Response struct {
		ClientDataJSON    string `json:"clientDataJSON"`
		AuthenticatorData string `json:"authenticatorData"`
		Signature         string `json:"signature"`
		UserHandle        string `json:"userHandle,omitempty"`
	} `json:"response"`
}

func VerifyAuthentication(rawJSON string) (credID string, err error) {
	var resp AuthenticationResponse
	if err := json.Unmarshal([]byte(rawJSON), &resp); err != nil {
		return "", fmt.Errorf("invalid authentication JSON: %w", err)
	}

	clientBytes, err := base64.RawURLEncoding.DecodeString(resp.Response.ClientDataJSON)
	if err != nil {
		clientBytes, err = base64.StdEncoding.DecodeString(resp.Response.ClientDataJSON)
		if err != nil {
			return "", fmt.Errorf("decode clientDataJSON: %w", err)
		}
	}

	var clientData ClientData
	if err := json.Unmarshal(clientBytes, &clientData); err != nil {
		return "", fmt.Errorf("parse clientData: %w", err)
	}

	if clientData.Type != "webauthn.get" {
		return "", fmt.Errorf("invalid ceremony type: %s", clientData.Type)
	}

	_, valid := ConsumeChallenge(clientData.Challenge)
	if !valid {
		return "", errors.New("login challenge expired or invalid")
	}

	credID = resp.ID
	if credID == "" {
		credID = resp.RawID
	}

	return strings.TrimSpace(credID), nil
}
