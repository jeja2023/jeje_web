// 验证码工具 / Captcha Utility
package utils

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
)

type CaptchaStore struct {
	mu   sync.Mutex
	ttl  time.Duration
	data map[string]captchaEntry
}

type captchaEntry struct {
	Answer    string
	ExpiresAt time.Time
}

func NewCaptchaStore(ttl time.Duration) *CaptchaStore {
	if ttl <= 0 {
		return nil
	}
	return &CaptchaStore{
		ttl:  ttl,
		data: make(map[string]captchaEntry),
	}
}

func (s *CaptchaStore) Create() (string, string, time.Duration) {
	a := randInt(1, 9)
	b := randInt(1, 9)
	answer := fmt.Sprintf("%d", a+b)
	id := RandomID(12)
	question := fmt.Sprintf("请计算 %d + %d", a, b)

	now := time.Now()
	expires := now.Add(s.ttl)

	s.mu.Lock()
	s.cleanupLocked(now)
	s.data[id] = captchaEntry{Answer: answer, ExpiresAt: expires}
	s.mu.Unlock()

	return id, question, s.ttl
}

func (s *CaptchaStore) Verify(id string, answer string) bool {
	id = strings.TrimSpace(id)
	answer = strings.TrimSpace(answer)
	if id == "" || answer == "" {
		return false
	}

	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.data[id]
	if !ok {
		return false
	}
	if entry.ExpiresAt.Before(now) {
		delete(s.data, id)
		return false
	}
	if entry.Answer != answer {
		return false
	}
	delete(s.data, id)
	return true
}

func (s *CaptchaStore) cleanupLocked(now time.Time) {
	for id, entry := range s.data {
		if entry.ExpiresAt.Before(now) {
			delete(s.data, id)
		}
	}
}

func randInt(min int, max int) int {
	if min >= max {
		return min
	}
	span := max - min + 1
	n, err := rand.Int(rand.Reader, big.NewInt(int64(span)))
	if err != nil {
		return min
	}
	return min + int(n.Int64())
}

func RandomID(length int) string {
	const letters = "abcdefghijklmnopqrstuvwxyz0123456789"
	if length <= 0 {
		length = 12
	}
	b := make([]byte, length)
	for i := range b {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(letters))))
		if err != nil {
			b[i] = letters[0]
			continue
		}
		b[i] = letters[idx.Int64()]
	}
	return string(b)
}
