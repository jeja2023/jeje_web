// 后端主入口 / Backend Main Entry
package main

import (
	"log"
	"strings"

	"jeje_web/api"
	"jeje_web/config"
	"jeje_web/database"
	"jeje_web/utils"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
	"context"
	"net/http"
)

func isWeakJWTSecret(secret string) bool {
	secret = strings.TrimSpace(strings.ToLower(secret))
	if secret == "" {
		return true
	}
	weak := map[string]bool{
		"change-me": true,
		"changeme": true,
		"please-change-this": true,
		"secret": true,
		"password": true,
	}
	return weak[secret]
}

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("未找到 .env 文件，将使用系统环境变量或默认值")
	}
	cfg := config.LoadConfig()

	// 如果 JWT_SECRET 为空或默认值，则每次启动生成随机密钥，确保重启后旧会话失效
	if isWeakJWTSecret(cfg.JWTSecret) {
		cfg.JWTSecret = utils.RandomID(32)
		log.Println("管理员会话密钥已自动随机生成（应用重启将强制注销所有登录）")
	}

	db, err := database.OpenDB(cfg)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer db.Close()
	if err := database.EnsureSchema(db); err != nil {
		log.Fatalf("?????????: %v", err)
	}

	if cfg.AdminBootstrap {
		if err := database.BootstrapAdmin(db, cfg); err != nil {
			log.Printf("管理员初始化失败: %v", err)
		}
	}

	app := &api.App{
		DB:           db,
		Cfg:          cfg,
		Limiter:      utils.NewRateLimiter(cfg.RateLimitWindow, cfg.RateLimitMax),
		MessageGuard: utils.NewMessageGuard(cfg.MessageCooldown),
		Captcha:      utils.NewCaptchaStore(cfg.CaptchaTTL),
		LoginGuard:   utils.NewLoginGuard(cfg.LoginMaxAttempts, cfg.LoginLockDuration),
	}

	// 启动孤立图片自动清理任务（每 24 小时执行一次）
	utils.StartImageCleanupTask(db, cfg.UploadDir, 24*time.Hour)

	router := gin.New()
	
	// 自定义中文日志格式 / Custom Chinese Log Format
	router.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		return "[" + param.TimeStamp.Format("2006/01/02 15:04:05") + "] " +
			" 状态: " + strconv.Itoa(param.StatusCode) +
			" | 耗时: " + param.Latency.String() +
			" | 客户端: " + param.ClientIP +
			" | 方法: " + param.Method +
			" | 路径: " + param.Path +
			" | 错误: " + param.ErrorMessage + "\n"
	}))
	
	router.Use(gin.Recovery())

	// 静态资源强缓存中间件 / Static assets cache middleware
	router.Use(func(c *gin.Context) {
		path := c.Request.URL.Path
		// 为全局资源和静态文件设置长缓存
		if strings.HasPrefix(path, "/globals/") || 
		   strings.HasSuffix(path, ".js") || 
		   strings.HasSuffix(path, ".css") || 
		   strings.HasSuffix(path, ".woff2") ||
		   strings.HasPrefix(path, "/uploads/") {
			c.Header("Cache-Control", "public, max-age=86400") // 24小时缓存
		}
		c.Next()
	})

	if len(cfg.TrustedProxies) > 0 {
		if err := router.SetTrustedProxies(cfg.TrustedProxies); err != nil {
			log.Printf("信任代理设置失败: %v", err)
		}
	}

	corsConfig := cors.DefaultConfig()
	if len(cfg.CORSOrigins) == 0 {
		corsConfig.AllowAllOrigins = true
		corsConfig.AllowCredentials = false
	} else {
		corsConfig.AllowOrigins = cfg.CORSOrigins
		corsConfig.AllowCredentials = true
	}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	router.Use(cors.New(corsConfig))

	// API 处理器
	apiGroup := router.Group("/api") // 重命名变量避免冲突

	apiGroup.GET("/health", app.Health)
	apiGroup.GET("/captcha", app.GetCaptcha)
	apiGroup.GET("/projects", app.ListProjects)
	apiGroup.GET("/projects/tags", app.ListProjectTags)
	apiGroup.GET("/projects/:id", app.GetProject)
	apiGroup.GET("/messages", app.ListMessages)
	apiGroup.POST("/messages", app.RateLimitMiddleware(), app.CreateMessage)
	apiGroup.GET("/admin/session", app.AdminSession)

	adminGroup := apiGroup.Group("/admin")
	adminGroup.POST("/login", app.AdminLogin)
	adminGroup.POST("/logout", app.AdminLogout)
	adminGroup.Use(app.AdminAuthMiddleware())
	adminGroup.GET("/stats", app.AdminStats)
	adminGroup.GET("/messages", app.AdminListMessages)
	adminGroup.PATCH("/messages/:id", app.AdminUpdateMessage)
	adminGroup.DELETE("/messages/:id", app.AdminDeleteMessage)
	adminGroup.POST("/messages/:id/replies", app.AdminCreateReply)
	adminGroup.GET("/projects", app.AdminListProjects)
	adminGroup.POST("/projects", app.AdminCreateProject)
	adminGroup.PUT("/projects/:id", app.AdminUpdateProject)
	adminGroup.DELETE("/projects/:id", app.AdminDeleteProject)
	adminGroup.POST("/uploads", app.AdminUpload)

	// 1. 托管上传文件
	router.Static("/uploads", cfg.UploadDir)

	// 2. 托管全局资源 (不带目录前缀访问)
	router.Static("/globals", filepath.Join(cfg.FrontendDir, "globals"))

	// 3. 路由重写逻辑：支持简洁 URL
	router.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// 如果请求的是 API，但未匹配到，则返回 404
		if strings.HasPrefix(path, "/api") {
			c.JSON(404, gin.H{"error": "未找到请求的资源"})
			return
		}

		// 根路径跳转到首页
		if path == "/" {
			c.File(filepath.Join(cfg.FrontendDir, "home", "home.html"))
			return
		}

		// 映射快捷路径
		shortcuts := map[string]string{
			"/home":     "home/home.html",
			"/messages": "messages/messages.html",
			"/admin":    "admin/admin.html",
			"/project":  "project/project.html",
		}

		if relPath, ok := shortcuts[path]; ok {
			c.File(filepath.Join(cfg.FrontendDir, relPath))
			return
		}

		// 兜底：尝试在各个子目录下寻找文件
		subDirs := []string{"home", "messages", "admin", "project", "globals"}
		cleanPath := strings.TrimPrefix(path, "/")

		for _, dir := range subDirs {
			// 尝试原始路径
			fpath := filepath.Join(cfg.FrontendDir, dir, cleanPath)
			if info, err := os.Stat(fpath); err == nil && !info.IsDir() {
				c.File(fpath)
				return
			}
			// 尝试添加 .html 后缀
			if !strings.HasSuffix(cleanPath, ".html") {
				fpathHtml := fpath + ".html"
				if info, err := os.Stat(fpathHtml); err == nil && !info.IsDir() {
					c.File(fpathHtml)
					return
				}
			}
		}

		// 如果还是没找到，默认返回首页 (SPA 支持)
		c.File(filepath.Join(cfg.FrontendDir, "home", "home.html"))
	})

	addr := strings.TrimSpace(cfg.Addr)
	if addr == "" {
		addr = ":8080"
	}

	srv := &http.Server{
		Addr:    addr,
		Handler: router,
	}

	// 在 Goroutine 中启动服务器，避免阻塞优雅停机逻辑
	go func() {
		log.Printf("接口服务监听于 %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务器启动失败: %v", err)
		}
	}()

	// 等待中断信号以优雅地关闭服务器
	quit := make(chan os.Signal, 1)
	// kill (无参数) 默认发送 syscall.SIGTERM
	// kill -2 是 syscall.SIGINT
	// kill -9 是 syscall.SIGKILL，但不能被捕获
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务器...")

	// 设定 5 秒超时时间
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("服务器强制关闭: ", err)
	}

	log.Println("服务器已安全退出")
}