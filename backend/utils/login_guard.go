// Login Guard
package utils

import (
	"sync"
	"time"
)

type LoginGuard struct {
	mu           sync.Mutex
	maxAttempts  int
	lockDuration time.Duration
	attempts     map[string]int
	lockedUntil  map[string]time.Time
	lastSeen     map[string]time.Time
	lastCleanup  time.Time
}

func NewLoginGuard(maxAttempts int, lockDuration time.Duration) *LoginGuard {
	return &LoginGuard{
		maxAttempts:  maxAttempts,
		lockDuration: lockDuration,
		attempts:     make(map[string]int),
		lockedUntil:  make(map[string]time.Time),
		lastSeen:     make(map[string]time.Time),
	}
}

func (g *LoginGuard) Allow(key string) (bool, time.Duration) {
	if g == nil || g.maxAttempts <= 0 || g.lockDuration <= 0 {
		return true, 0
	}
	if key == "" {
		return true, 0
	}
	now := time.Now()

	g.mu.Lock()
	defer g.mu.Unlock()

	g.lastSeen[key] = now
	if g.lastCleanup.IsZero() || now.Sub(g.lastCleanup) > g.lockDuration {
		for k, t := range g.lastSeen {
			if now.Sub(t) > g.lockDuration {
				delete(g.lastSeen, k)
				delete(g.attempts, k)
				delete(g.lockedUntil, k)
			}
		}
		g.lastCleanup = now
	}

	until, ok := g.lockedUntil[key]
	if !ok {
		return true, 0
	}
	if until.Before(now) {
		delete(g.lockedUntil, key)
		delete(g.attempts, key)
		return true, 0
	}
	return false, until.Sub(now)
}

func (g *LoginGuard) Fail(key string) {
	if g == nil || g.maxAttempts <= 0 || g.lockDuration <= 0 {
		return
	}
	if key == "" {
		return
	}

	now := time.Now()

	g.mu.Lock()
	defer g.mu.Unlock()

	g.lastSeen[key] = now
	if g.lastCleanup.IsZero() || now.Sub(g.lastCleanup) > g.lockDuration {
		for k, t := range g.lastSeen {
			if now.Sub(t) > g.lockDuration {
				delete(g.lastSeen, k)
				delete(g.attempts, k)
				delete(g.lockedUntil, k)
			}
		}
		g.lastCleanup = now
	}

	count := g.attempts[key] + 1
	if count >= g.maxAttempts {
		g.lockedUntil[key] = time.Now().Add(g.lockDuration)
		g.attempts[key] = 0
		return
	}
	g.attempts[key] = count
}

func (g *LoginGuard) Success(key string) {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.attempts, key)
	delete(g.lockedUntil, key)
	delete(g.lastSeen, key)
}
