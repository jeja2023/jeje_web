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
	lastCleanup time.Time
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

	if r.lastCleanup.IsZero() || now.Sub(r.lastCleanup) > r.window {
		for key, entries := range r.hits {
			filtered := entries[:0]
			for _, t := range entries {
				if t.After(cutoff) {
					filtered = append(filtered, t)
				}
			}
			if len(filtered) == 0 {
				delete(r.hits, key)
			} else {
				r.hits[key] = filtered
			}
		}
		r.lastCleanup = now
	}

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