// 配置管理 / Configuration Management
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv            string
	Addr              string
	DBHost            string
	DBPort            string
	DBUser            string
	DBPassword        string
	DBName            string
	DBMaxOpenConns    int
	DBMaxIdleConns    int
	DBConnMaxLifetime time.Duration
	JWTSecret         string
	CookieSecure      bool
	AdminBootstrap    bool
	AdminUser         string
	AdminPass         string
	CORSOrigins       []string
	TrustedProxies    []string
	RateLimitWindow   time.Duration
	RateLimitMax      int
	MessageMaxLength  int
	NicknameMaxLength int
	MessageCooldown   time.Duration
	CaptchaTTL        time.Duration
	LoginMaxAttempts  int
	LoginLockDuration time.Duration
	UploadDir         string
	UploadBaseURL     string
	UploadMaxMB       int
	FrontendDir       string
}

func LoadConfig() Config {
	cfg := Config{}
	cfg.AppEnv = getEnv("APP_ENV", "dev")
	cfg.Addr = getEnv("APP_ADDR", ":8080")
	cfg.DBHost = getEnv("DB_HOST", "mysql")
	cfg.DBPort = getEnv("DB_PORT", "3306")
	cfg.DBUser = getEnv("DB_USER", "jeje")
	cfg.DBPassword = getEnv("DB_PASSWORD", "jeje123")
	cfg.DBName = getEnv("DB_NAME", "jeje_web")
	cfg.DBMaxOpenConns = getEnvInt("DB_MAX_OPEN_CONNS", 20)
	cfg.DBMaxIdleConns = getEnvInt("DB_MAX_IDLE_CONNS", 5)
	cfg.DBConnMaxLifetime = time.Duration(getEnvInt("DB_CONN_MAX_LIFETIME_MINUTES", 30)) * time.Minute
	cfg.JWTSecret = getEnv("JWT_SECRET", "change-me")
	cfg.CookieSecure = getEnvBool("COOKIE_SECURE", cfg.AppEnv == "prod")
	cfg.AdminBootstrap = getEnvBool("ADMIN_BOOTSTRAP", true)
	cfg.AdminUser = getEnv("ADMIN_USER", "admin")
	cfg.AdminPass = getEnv("ADMIN_PASS", "admin123")
	cfg.CORSOrigins = splitCSV(getEnv("CORS_ORIGINS", ""))
	cfg.TrustedProxies = splitCSV(getEnv("TRUSTED_PROXIES", ""))
	cfg.RateLimitWindow = time.Duration(getEnvInt("RATE_LIMIT_WINDOW_SECONDS", 60)) * time.Second
	cfg.RateLimitMax = getEnvInt("RATE_LIMIT_MAX", 5)
	cfg.MessageMaxLength = getEnvInt("MESSAGE_MAX_LEN", 1000)
	cfg.NicknameMaxLength = getEnvInt("NICKNAME_MAX_LEN", 50)
	cfg.MessageCooldown = time.Duration(getEnvInt("MESSAGE_COOLDOWN_SECONDS", 10)) * time.Second
	cfg.CaptchaTTL = time.Duration(getEnvInt("CAPTCHA_TTL_SECONDS", 300)) * time.Second
	cfg.LoginMaxAttempts = getEnvInt("LOGIN_MAX_ATTEMPTS", 5)
	cfg.LoginLockDuration = time.Duration(getEnvInt("LOGIN_LOCK_MINUTES", 15)) * time.Minute
	cfg.UploadDir = getEnv("UPLOAD_DIR", "../storage/uploads")
	cfg.UploadBaseURL = getEnv("UPLOAD_BASE_URL", "/uploads")
	cfg.UploadMaxMB = getEnvInt("UPLOAD_MAX_MB", 5)
	cfg.FrontendDir = getEnv("FRONTEND_DIR", "../frontend")
	return cfg
}

func getEnv(key, def string) string {
	val := strings.TrimSpace(os.Getenv(key))
	if val == "" {
		return def
	}
	return val
}

func getEnvInt(key string, def int) int {
	val := strings.TrimSpace(os.Getenv(key))
	if val == "" {
		return def
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return def
	}
	return parsed
}

func getEnvBool(key string, def bool) bool {
	val := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if val == "" {
		return def
	}
	return val == "1" || val == "true" || val == "yes" || val == "on"
}

func splitCSV(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}