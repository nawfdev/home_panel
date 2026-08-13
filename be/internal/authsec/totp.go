// Package authsec implements RFC 6238 TOTP without external dependencies.
package authsec

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func NewSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

func URI(username, secret string) string {
	label := url.PathEscape("Nestcore:" + username)
	values := url.Values{"secret": {secret}, "issuer": {"Nestcore"}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
	return "otpauth://totp/" + label + "?" + values.Encode()
}

func Validate(secret, code string, now time.Time) bool {
	code = strings.TrimSpace(strings.ReplaceAll(code, " ", ""))
	if len(code) != 6 {
		return false
	}
	for offset := int64(-1); offset <= 1; offset++ {
		if generate(secret, now.Unix()/30+offset) == code {
			return true
		}
	}
	return false
}

func generate(secret string, counter int64) string {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return ""
	}
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(buf[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	binaryCode := (uint32(sum[offset])&0x7f)<<24 | uint32(sum[offset+1])<<16 | uint32(sum[offset+2])<<8 | uint32(sum[offset+3])
	return fmt.Sprintf("%06d", binaryCode%1000000)
}

func RecoveryCodes(count int) ([]string, []string, error) {
	plain := make([]string, 0, count)
	hashed := make([]string, 0, count)
	for range count {
		buf := make([]byte, 5)
		if _, err := rand.Read(buf); err != nil {
			return nil, nil, err
		}
		code := strings.ToUpper(hex.EncodeToString(buf[:2]) + "-" + hex.EncodeToString(buf[2:]))
		plain = append(plain, code)
		hashed = append(hashed, HashRecoveryCode(code))
	}
	return plain, hashed, nil
}

func HashRecoveryCode(code string) string {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	sum := sha256.Sum256([]byte(normalized))
	return hex.EncodeToString(sum[:])
}

func IsRecoveryCode(code string) bool {
	normalized := strings.ReplaceAll(strings.TrimSpace(code), "-", "")
	_, err := strconv.ParseUint(normalized, 16, 64)
	return err == nil && len(normalized) == 10
}
