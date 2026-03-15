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
	"path/filepath"
	"strconv"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Printf("未找到 .env 文件，将使用系统环境变量或默认值")
	}
	cfg := config.LoadConfig()

	db, err := database.OpenDB(cfg)
	if err != nil {
		log.Fatalf("数据库连接失败: %v", err)
	}
	defer db.Close()

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

	if len(cfg.TrustedProxies) > 0 {
		if err := router.SetTrustedProxies(cfg.TrustedProxies); err != nil {
			log.Printf("信任代理设置失败: %v", err)
		}
	}

	corsConfig := cors.DefaultConfig()
	if len(cfg.CORSOrigins) == 0 {
		corsConfig.AllowAllOrigins = true
	} else {
		corsConfig.AllowOrigins = cfg.CORSOrigins
	}
	corsConfig.AllowHeaders = []string{"Origin", "Content-Type", "Accept"}
	corsConfig.AllowMethods = []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	corsConfig.AllowCredentials = true
	router.Use(cors.New(corsConfig))

	// API 处理器
	apiGroup := router.Group("/api") // 重命名变量避免冲突

	apiGroup.GET("/health", app.Health)
	apiGroup.GET("/captcha", app.GetCaptcha)
	apiGroup.GET("/projects", app.ListProjects)
	apiGroup.GET("/projects/:id", app.GetProject)
	apiGroup.GET("/messages", app.ListMessages)
	apiGroup.POST("/messages", app.RateLimitMiddleware(), app.CreateMessage)

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
	adminGroup.POST("/uploads", app.AdminUploadImage)

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
	log.Printf("接口服务监听于 %s", addr)
	if err := router.Run(addr); err != nil {
		log.Fatalf("服务器启动失败: %v", err)
	}
}