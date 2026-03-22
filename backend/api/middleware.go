// 中间件 / Middleware
package api

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func (a *App) RateLimitMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !a.Limiter.Allow(ip) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "请求过于频繁"})
			c.Abort()
			return
		}
		if a.MessageGuard != nil && !a.MessageGuard.Allow(ip) {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "请稍后再试"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func (a *App) AdminAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenStr, err := c.Cookie("session")
		if err != nil || tokenStr == "" {
			// 如果 Cookie 不存在，则尝试从 Authorization 头获取 (Bearer <token>)
			authHeader := c.GetHeader("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			}
		}

		if tokenStr == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
			c.Abort()
			return
		}

		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("无效的签名方法")
			}
			return []byte(a.Cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "会话无效"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "会话数据无效"})
			c.Abort()
			return
		}

		if exp, ok := claims["exp"].(float64); ok {
			if time.Unix(int64(exp), 0).Before(time.Now()) {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "登录已过期"})
				c.Abort()
				return
			}
		}

		c.Set("admin_id", claims["sub"])
		c.Next()
	}
}