// 留言保护 / Message Guard
package utils

import (
	"sync"
	"time"
)

type MessageGuard struct {
	mu       sync.Mutex
	cooldown time.Duration
	lastSeen map[string]time.Time
}

func NewMessageGuard(cooldown time.Duration) *MessageGuard {
	return &MessageGuard{
		cooldown: cooldown,
		lastSeen: make(map[string]time.Time),
	}
}

func (g *MessageGuard) Allow(key string) bool {
	if g == nil || g.cooldown <= 0 {
		return true
	}
	if key == "" {
		return true
	}
	now := time.Now()

	g.mu.Lock()
	defer g.mu.Unlock()

	last, ok := g.lastSeen[key]
	if ok && now.Sub(last) < g.cooldown {
		return false
	}
	g.lastSeen[key] = now
	return true
}
