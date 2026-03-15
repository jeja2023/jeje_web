// 频率限制 / Rate Limiter
package utils

import (
	"sync"
	"time"
)

type RateLimiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	hits   map[string][]time.Time
}

func NewRateLimiter(window time.Duration, max int) *RateLimiter {
	return &RateLimiter{
		window: window,
		max:    max,
		hits:   make(map[string][]time.Time),
	}
}

func (r *RateLimiter) Allow(key string) bool {
	if r.max <= 0 {
		return true
	}
	now := time.Now()
	cutoff := now.Add(-r.window)

	r.mu.Lock()
	defer r.mu.Unlock()

	entries := r.hits[key]
	filtered := entries[:0]
	for _, t := range entries {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}
	if len(filtered) >= r.max {
		r.hits[key] = filtered
		return false
	}
	filtered = append(filtered, now)
	r.hits[key] = filtered
	return true
}