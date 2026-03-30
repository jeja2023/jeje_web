// API 处理器 / API Handlers
package api

import (
	"bytes"
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"jeje_web/config"
	"jeje_web/models"
	"jeje_web/utils"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jmoiron/sqlx"
	"github.com/microcosm-cc/bluemonday"
	"golang.org/x/crypto/bcrypt"
)

type App struct {
	DB           *sqlx.DB
	Cfg          config.Config
	Limiter      *utils.RateLimiter
	MessageGuard *utils.MessageGuard
	Captcha      *utils.CaptchaStore
	LoginGuard   *utils.LoginGuard
}

func parsePagination(c *gin.Context, defaultLimit, maxLimit int) (int, int, int) {
	page := parsePositiveInt(c.Query("page"), 1)
	limit := parsePositiveInt(c.Query("limit"), defaultLimit)
	if limit > maxLimit {
		limit = maxLimit
	}
	if limit < 1 {
		limit = defaultLimit
	}
	offset := (page - 1) * limit
	return page, limit, offset
}

func parsePositiveInt(value string, def int) int {
	value = strings.TrimSpace(value)
	if value == "" {
		return def
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return def
	}
	return parsed
}

func (a *App) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

func (a *App) AdminStats(c *gin.Context) {
	var stats struct {
		TotalProjects   int `json:"total_projects"`
		TotalMessages   int `json:"total_messages"`
		PendingMessages int `json:"pending_messages"`
		TodayMessages   int `json:"today_messages"`
		TotalViews      int `json:"total_views"`
	}

	// Compute today range to keep indexes usable
	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	nextDayStart := todayStart.AddDate(0, 0, 1)

	// Define tasks and run concurrently
	type task struct {
		target *int
		query  string
		args   []any
	}
	tasks := []task{
		{&stats.TotalProjects, "SELECT COUNT(*) FROM projects", nil},
		{&stats.TotalMessages, "SELECT COUNT(*) FROM messages", nil},
		{&stats.PendingMessages, "SELECT COUNT(*) FROM messages WHERE status = 0", nil},
		{&stats.TodayMessages, "SELECT COUNT(*) FROM messages WHERE created_at >= ? AND created_at < ?", []any{todayStart, nextDayStart}},
		{&stats.TotalViews, "SELECT IFNULL(SUM(view_count),0) FROM projects", nil},
	}

	errChan := make(chan error, len(tasks))
	for _, t := range tasks {
		go func(t task) {
			errChan <- a.DB.Get(t.target, t.query, t.args...)
		}(t)
	}

	for i := 0; i < len(tasks); i++ {
		if err := <-errChan; err != nil {
			log.Printf("failed to get stats: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "获取数据统计失败"})
			return
		}
	}

	c.JSON(http.StatusOK, stats)
}

func (a *App) GetCaptcha(c *gin.Context) {
	if a.Captcha == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "验证码服务不可用"})
		return
	}
	id, question, ttl := a.Captcha.Create()
	c.JSON(http.StatusOK, gin.H{"id": id, "question": question, "expires_in": int(ttl.Seconds())})
}

func (a *App) ListProjects(c *gin.Context) {
	projects := []models.Project{}
	q := strings.TrimSpace(c.Query("q"))
	tag := strings.TrimSpace(c.Query("tag"))
	page, limit, offset := parsePagination(c, 12, 100)

	where := []string{"is_public = 1"}
	args := []any{}
	if q != "" {
		like := "%" + q + "%"
		where = append(where, "(name LIKE ? OR summary LIKE ? OR tags LIKE ?)")
		args = append(args, like, like, like)
	}
	if tag != "" {
		where = append(where, "',' || tags || ',' LIKE '%,' || ? || ',%'")
		args = append(args, tag)
	}
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int
	countQuery := "SELECT COUNT(*) FROM projects " + whereSQL
	if err := a.DB.Get(&total, countQuery, args...); err != nil {
		log.Printf("加载项目统计失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目列表失败"})
		return
	}

	query := `SELECT id, name, summary, cover_url, video_url, external_url, sort_order, is_public, view_count, tags, created_at, updated_at
		FROM projects ` + whereSQL + ` ORDER BY sort_order DESC, id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), limit, offset)
	if err := a.DB.Select(&projects, query, queryArgs...); err != nil {
		log.Printf("加载项目列表失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": projects, "total": total, "page": page, "limit": limit})
}

func (a *App) ListProjectTags(c *gin.Context) {
	rawTags := []string{}
	if err := a.DB.Select(&rawTags, "SELECT tags FROM projects WHERE is_public = 1 AND tags IS NOT NULL AND tags <> ''"); err != nil {
		log.Printf("加载项目标签失败: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目标签失败"})
		return
	}

	tagSet := make(map[string]bool)
	tags := []string{}
	for _, raw := range rawTags {
		for _, tag := range splitTags(raw) {
			key := strings.ToLower(tag)
			if tagSet[key] {
				continue
			}
			tagSet[key] = true
			tags = append(tags, tag)
		}
	}

	sort.Slice(tags, func(i, j int) bool {
		return strings.ToLower(tags[i]) < strings.ToLower(tags[j])
	})

	c.JSON(http.StatusOK, gin.H{"data": tags, "total": len(tags)})
}

func (a *App) GetProject(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}
	if _, err := a.DB.Exec("UPDATE projects SET view_count = view_count + 1 WHERE id = ? AND is_public = 1", id); err != nil {
		log.Printf("failed to update view_count: %v", err)
	}
	var project models.Project
	query := `SELECT id, name, summary, cover_url, video_url, content_html, external_url, sort_order, is_public, view_count, tags, created_at, updated_at
		FROM projects WHERE id = ? AND is_public = 1`
	if err := a.DB.Get(&project, query, id); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "未找到"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目详情失败"})
		return
	}
	c.JSON(http.StatusOK, project)
}

func (a *App) ListMessages(c *gin.Context) {
	messages := []models.Message{}
	page, limit, offset := parsePagination(c, 10, 50)
	projectIDStr := strings.TrimSpace(c.Query("project_id"))

	where := []string{"status = 1"}
	args := []any{}

	if projectIDStr != "" {
		pid, err := strconv.ParseInt(projectIDStr, 10, 64)
		if err == nil {
			where = append(where, "project_id = ?")
			args = append(args, pid)
		}
	} else {
		where = append(where, "project_id IS NULL")
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int
	if err := a.DB.Get(&total, "SELECT COUNT(*) FROM messages "+whereSQL, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载留言失败"})
		return
	}

	query := `SELECT id, project_id, nickname, contact, content, status, created_at
		FROM messages ` + whereSQL + ` ORDER BY created_at DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), limit, offset)
	if err := a.DB.Select(&messages, query, queryArgs...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载留言失败"})
		return
	}
	attachReplies(a.DB, messages)
	c.JSON(http.StatusOK, gin.H{"data": messages, "total": total, "page": page, "limit": limit})
}

func (a *App) CreateMessage(c *gin.Context) {
	var payload struct {
		ProjectID     *int64 `json:"project_id"`
		Nickname      string `json:"nickname"`
		Contact       string `json:"contact"`
		Content       string `json:"content"`
		CaptchaID     string `json:"captcha_id"`
		CaptchaAnswer string `json:"captcha_answer"`
		Website       string `json:"website"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}
	payload.Nickname = sanitizeText(payload.Nickname)
	payload.Contact = sanitizeText(payload.Contact)
	payload.Content = sanitizeText(payload.Content)
	payload.CaptchaID = strings.TrimSpace(payload.CaptchaID)
	payload.CaptchaAnswer = strings.TrimSpace(payload.CaptchaAnswer)
	payload.Website = strings.TrimSpace(payload.Website)

	if payload.Website != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求"})
		return
	}
	if a.Captcha != nil && !a.Captcha.Verify(payload.CaptchaID, payload.CaptchaAnswer) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "验证码错误"})
		return
	}

	if payload.Nickname == "" || len([]rune(payload.Nickname)) > a.Cfg.NicknameMaxLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "昵称无效"})
		return
	}
	if payload.Content == "" || len([]rune(payload.Content)) > a.Cfg.MessageMaxLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "内容无效"})
		return
	}

	ip := c.ClientIP()
	ua := c.Request.UserAgent()
	_, err := a.DB.Exec(`INSERT INTO messages (project_id, nickname, contact, content, status, ip, ua)
		VALUES (?, ?, ?, ?, 0, ?, ?)`, payload.ProjectID, payload.Nickname, payload.Contact, payload.Content, ip, ua)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存留言失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "提交成功"})
}

func (a *App) AdminLogin(c *gin.Context) {
	var payload struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求参数"})
		return
	}

	payload.Username = strings.TrimSpace(payload.Username)
	if payload.Username == "" || payload.Password == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	loginKey := strings.ToLower(payload.Username) + "|" + c.ClientIP()
	if a.LoginGuard != nil {
		if ok, wait := a.LoginGuard.Allow(loginKey); !ok {
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "登录尝试过多", "retry_after_seconds": int(wait.Seconds())})
			return
		}
	}

	var admin models.Admin
	if err := a.DB.Get(&admin, "SELECT id, username, password_hash FROM admins WHERE username = ?", payload.Username); err != nil {
		if a.LoginGuard != nil {
			a.LoginGuard.Fail(loginKey)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(payload.Password)); err != nil {
		if a.LoginGuard != nil {
			a.LoginGuard.Fail(loginKey)
		}
		c.JSON(http.StatusUnauthorized, gin.H{"error": "用户名或密码错误"})
		return
	}

	if a.LoginGuard != nil {
		a.LoginGuard.Success(loginKey)
	}

	exp := time.Now().Add(2 * time.Hour)
	claims := jwt.MapClaims{
		"sub": admin.ID,
		"exp": exp.Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(a.Cfg.JWTSecret))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建会话失败"})
		return
	}

	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("session", signed, int(2*time.Hour.Seconds()), "/", "", a.Cfg.CookieSecure, true)
	c.JSON(http.StatusOK, gin.H{
		"message":       "登录成功",
		"token":         signed,
		"upload_max_mb": a.Cfg.UploadMaxMB,
	})
}

func (a *App) AdminSession(c *gin.Context) {
	tokenStr, err := c.Cookie("session")
	if err != nil || tokenStr == "" {
		authHeader := c.GetHeader("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	if tokenStr == "" {
		c.JSON(http.StatusOK, gin.H{
			"logged_in":     false,
			"upload_max_mb": a.Cfg.UploadMaxMB,
		})
		return
	}

	token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("invalid signing method")
		}
		return []byte(a.Cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		c.JSON(http.StatusOK, gin.H{
			"logged_in":     false,
			"upload_max_mb": a.Cfg.UploadMaxMB,
		})
		return
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		c.JSON(http.StatusOK, gin.H{
			"logged_in":     false,
			"upload_max_mb": a.Cfg.UploadMaxMB,
		})
		return
	}

	if exp, ok := claims["exp"].(float64); ok {
		if time.Unix(int64(exp), 0).Before(time.Now()) {
			c.JSON(http.StatusOK, gin.H{
				"logged_in":     false,
				"upload_max_mb": a.Cfg.UploadMaxMB,
			})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"logged_in":     true,
		"upload_max_mb": a.Cfg.UploadMaxMB,
	})
}
func (a *App) AdminLogout(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("session", "", -1, "/", "", a.Cfg.CookieSecure, true)
	c.JSON(http.StatusOK, gin.H{"message": "已退出登录"})
}

func (a *App) AdminUpdatePassword(c *gin.Context) {
	var payload struct {
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required,min=6"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数不规范，新密码至少 6 位"})
		return
	}

	adminID, exists := c.Get("admin_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未授权访问"})
		return
	}

	var storedHash string
	if err := a.DB.Get(&storedHash, "SELECT password_hash FROM admins WHERE id = ?", adminID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "系统异常"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(payload.OldPassword)); err != nil {
		c.JSON(http.StatusForbidden, gin.H{"error": "原密码校验失败"})
		return
	}

	newHash, err := bcrypt.GenerateFromPassword([]byte(payload.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	if _, err := a.DB.Exec("UPDATE admins SET password_hash = ? WHERE id = ?", string(newHash), adminID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "数据库更新失败"})
		return
	}

	log.Printf("管理员 [ID: %v] 已成功更新密码", adminID)
	c.JSON(http.StatusOK, gin.H{"message": "密码修改成功，请妥善保管"})
}

func (a *App) AdminListMessages(c *gin.Context) {
	messages := []models.Message{}
	page, limit, offset := parsePagination(c, 20, 100)
	statusParam := strings.TrimSpace(c.Query("status"))
	q := strings.TrimSpace(c.Query("q"))

	where := []string{}
	args := []any{}
	if statusParam != "" {
		status, err := strconv.Atoi(statusParam)
		if err != nil || status < 0 || status > 2 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的状态值"})
			return
		}
		where = append(where, "status = ?")
		args = append(args, status)
	}
	if q != "" {
		like := "%" + q + "%"
		where = append(where, "(nickname LIKE ? OR content LIKE ? OR contact LIKE ?)")
		args = append(args, like, like, like)
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	var total int
	countSQL := "SELECT COUNT(*) FROM messages " + whereSQL
	if err := a.DB.Get(&total, countSQL, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载留言失败"})
		return
	}

	query := `SELECT m.id, m.project_id, m.nickname, m.contact, m.content, m.status, m.created_at, m.ip, m.ua, IFNULL(p.name, '') AS project_name
		FROM messages m
		LEFT JOIN projects p ON m.project_id = p.id
		` + whereSQL + ` ORDER BY m.created_at DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), limit, offset)
	if err := a.DB.Select(&messages, query, queryArgs...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载留言失败"})
		return
	}
	attachReplies(a.DB, messages)
	c.JSON(http.StatusOK, gin.H{"data": messages, "total": total, "page": page, "limit": limit})
}

func (a *App) AdminUpdateMessage(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}
	var payload struct {
		Status int `json:"status"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的参数"})
		return
	}
	if payload.Status < 0 || payload.Status > 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的状态"})
		return
	}

	res, err := a.DB.Exec("UPDATE messages SET status = ? WHERE id = ?", payload.Status, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "资源未找到"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

func (a *App) AdminDeleteMessage(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}
	res, err := a.DB.Exec("DELETE FROM messages WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "资源未找到"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

func (a *App) AdminCreateReply(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}
	var payload struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的参数"})
		return
	}
	payload.Content = sanitizeText(payload.Content)
	if payload.Content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "内容不能为空"})
		return
	}

	_, err = a.DB.Exec("INSERT INTO replies (message_id, content) VALUES (?, ?)", id, payload.Content)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "回复失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "已回复"})
}

func (a *App) AdminUpload(c *gin.Context) {
	maxBytes := int64(a.Cfg.UploadMaxMB) * 1024 * 1024
	if maxBytes <= 0 {
		maxBytes = 5 * 1024 * 1024
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
	if err := c.Request.ParseMultipartForm(32 << 20); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "解析文件上传失败"})
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未提供文件"})
		return
	}
	defer file.Close()
	if header != nil && header.Size > maxBytes {
		c.JSON(http.StatusBadRequest, gin.H{"error": "文件过大"})
		return
	}
	buf := make([]byte, 512)
	n, _ := file.Read(buf)
	contentType := http.DetectContentType(buf[:n])
	allowed := map[string]string{
		"image/jpeg":      ".jpg",
		"image/png":       ".png",
		"image/gif":       ".gif",
		"image/webp":      ".webp",
		"image/avif":      ".avif",
		"image/svg+xml":   ".svg",
		"video/mp4":       ".mp4",
		"video/webm":      ".webm",
		"video/ogg":       ".ogg",
		"video/quicktime": ".mov",
		"video/x-msvideo": ".avi",
		"video/x-matroska": ".mkv",
		"video/x-m4v":     ".m4v",
	}
	ext, ok := allowed[contentType]
	if !ok {
		// 备选方案：尝试从文件名后缀判断
		ext = strings.ToLower(filepath.Ext(header.Filename))
		supported := map[string]bool{
			".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".avif": true, ".svg": true,
			".mp4": true, ".webm": true, ".ogg": true, ".mov": true, ".avi": true, ".mkv": true, ".m4v": true,
		}
		if !supported[ext] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "该文件格式不支持"})
			return
		}
		if ext == ".jpeg" {
			ext = ".jpg"
		}
	}
	var reader io.Reader = file
	if seeker, ok := file.(io.Seeker); ok {
		if _, err := seeker.Seek(0, io.SeekStart); err != nil {
			reader = io.MultiReader(bytes.NewReader(buf[:n]), file)
		}
	} else {
		reader = io.MultiReader(bytes.NewReader(buf[:n]), file)
	}
	name := fmt.Sprintf("%s_%s%s", time.Now().Format("20060102_150405"), utils.RandomID(8), ext)
	dir := strings.TrimSpace(a.Cfg.UploadDir)
	if dir == "" {
		dir = "../storage/uploads"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	targetPath := filepath.Join(dir, name)
	out, err := os.Create(targetPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	defer out.Close()
	if _, err := io.Copy(out, reader); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存失败"})
		return
	}
	base := strings.TrimRight(strings.TrimSpace(a.Cfg.UploadBaseURL), "/")
	if base == "" {
		base = "/uploads"
	}
	url := fmt.Sprintf("%s/%s", base, name)
	c.JSON(http.StatusCreated, gin.H{"url": url})
}

func (a *App) AdminListUploads(c *gin.Context) {
	dir := strings.TrimSpace(a.Cfg.UploadDir)
	if dir == "" {
		dir = "../storage/uploads"
	}
	
	files, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusOK, gin.H{"data": []any{}, "total": 0})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "无法读取上传目录"})
		return
	}

	type fileInfo struct {
		Name      string    `json:"name"`
		URL       string    `json:"url"`
		Size      int64     `json:"size"`
		CreatedAt time.Time `json:"created_at"`
	}

	data := []fileInfo{}
	base := strings.TrimRight(strings.TrimSpace(a.Cfg.UploadBaseURL), "/")
	if base == "" {
		base = "/uploads"
	}

	for _, f := range files {
		if f.IsDir() {
			continue
		}
		info, err := f.Info()
		if err != nil {
			continue
		}
		
		data = append(data, fileInfo{
			Name:      f.Name(),
			URL:       fmt.Sprintf("%s/%s", base, f.Name()),
			Size:      info.Size(),
			CreatedAt: info.ModTime(),
		})
	}

	// 按时间排序
	sort.Slice(data, func(i, j int) bool {
		return data[i].CreatedAt.After(data[j].CreatedAt)
	})

	c.JSON(http.StatusOK, gin.H{"data": data, "total": len(data)})
}

func (a *App) AdminListProjects(c *gin.Context) {
	projects := []models.Project{}
	page, limit, offset := parsePagination(c, 20, 100)
	q := strings.TrimSpace(c.Query("q"))
	tag := strings.TrimSpace(c.Query("tag"))
	publicParam := strings.TrimSpace(c.Query("is_public"))

	where := []string{}
	args := []any{}
	if publicParam != "" {
		if publicParam != "0" && publicParam != "1" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "无效的公开状态"})
			return
		}
		where = append(where, "is_public = ?")
		args = append(args, publicParam)
	}
	if q != "" {
		like := "%" + q + "%"
		where = append(where, "(name LIKE ? OR summary LIKE ? OR tags LIKE ?)")
		args = append(args, like, like, like)
	}
	if tag != "" {
		where = append(where, "',' || tags || ',' LIKE '%,' || ? || ',%'")
		args = append(args, tag)
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}

	var total int
	countQuery := "SELECT COUNT(*) FROM projects " + whereSQL
	if err := a.DB.Get(&total, countQuery, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目列表失败"})
		return
	}

	query := `SELECT id, name, summary, cover_url, video_url, content_html, external_url, sort_order, is_public, view_count, tags, created_at, updated_at
		FROM projects ` + whereSQL + ` ORDER BY sort_order DESC, id DESC LIMIT ? OFFSET ?`
	queryArgs := append(append([]any{}, args...), limit, offset)
	if err := a.DB.Select(&projects, query, queryArgs...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": projects, "total": total, "page": page, "limit": limit})
}

func (a *App) AdminCreateProject(c *gin.Context) {
	var payload models.Project
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的参数"})
		return
	}
	payload.Name = sanitizeText(payload.Name)
	payload.Summary = sanitizeText(payload.Summary)
	payload.CoverURL = strings.TrimSpace(payload.CoverURL)
	payload.VideoURL = strings.TrimSpace(payload.VideoURL)
	payload.ExternalURL = strings.TrimSpace(payload.ExternalURL)
	payload.Tags = sanitizeText(payload.Tags)
	payload.ContentHTML = sanitizeHTML(payload.ContentHTML)
	payload.Tags = normalizeTags(payload.Tags)

	if payload.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称必填"})
		return
	}
	if !isSafeURL(payload.CoverURL, true) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "封面图链接无效"})
		return
	}
	if !isSafeURL(payload.VideoURL, true) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "视频链接无效"})
		return
	}
	if payload.ExternalURL != "" && !isSafeURL(payload.ExternalURL, false) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "外链无效"})
		return
	}

	res, err := a.DB.Exec(`INSERT INTO projects (name, summary, cover_url, video_url, content_html, external_url, sort_order, is_public, tags)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, payload.Name, payload.Summary, payload.CoverURL, payload.VideoURL, payload.ContentHTML,
		payload.ExternalURL, payload.SortOrder, payload.IsPublic, payload.Tags)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	id, _ := res.LastInsertId()
	c.JSON(http.StatusCreated, gin.H{"id": id})
}

func (a *App) AdminUpdateProject(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}
	var payload models.Project
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的参数"})
		return
	}
	payload.Name = sanitizeText(payload.Name)
	payload.Summary = sanitizeText(payload.Summary)
	payload.CoverURL = strings.TrimSpace(payload.CoverURL)
	payload.VideoURL = strings.TrimSpace(payload.VideoURL)
	payload.ExternalURL = strings.TrimSpace(payload.ExternalURL)
	payload.Tags = sanitizeText(payload.Tags)
	payload.ContentHTML = sanitizeHTML(payload.ContentHTML)
	payload.Tags = normalizeTags(payload.Tags)

	if payload.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称必填"})
		return
	}
	if !isSafeURL(payload.CoverURL, true) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "封面图链接无效"})
		return
	}
	if !isSafeURL(payload.VideoURL, true) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "视频链接无效"})
		return
	}
	if payload.ExternalURL != "" && !isSafeURL(payload.ExternalURL, false) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "外链无效"})
		return
	}

	res, err := a.DB.Exec(`UPDATE projects SET name=?, summary=?, cover_url=?, video_url=?, content_html=?, external_url=?, sort_order=?, is_public=?, tags=?
		WHERE id = ?`, payload.Name, payload.Summary, payload.CoverURL, payload.VideoURL, payload.ContentHTML,
		payload.ExternalURL, payload.SortOrder, payload.IsPublic, payload.Tags, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "更新失败"})
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "资源未找到"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "更新成功"})
}

func (a *App) AdminDeleteProject(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}
	res, err := a.DB.Exec("DELETE FROM projects WHERE id = ?", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "资源未找到"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

func attachReplies(db *sqlx.DB, messages []models.Message) {
	if len(messages) == 0 {
		return
	}
	ids := make([]interface{}, 0, len(messages))
	index := make(map[int64]int, len(messages))
	for i, msg := range messages {
		ids = append(ids, msg.ID)
		index[msg.ID] = i
	}
	query, args, err := sqlx.In("SELECT id, message_id, content, created_at FROM replies WHERE message_id IN (?) ORDER BY created_at ASC", ids)
	if err != nil {
		return
	}
	query = db.Rebind(query)
	replies := []models.Reply{}
	if err := db.Select(&replies, query, args...); err != nil {
		return
	}
	for _, reply := range replies {
		if idx, ok := index[reply.MessageID]; ok {
			messages[idx].Replies = append(messages[idx].Replies, reply)
		}
	}
}

var (
	htmlPolicy = func() *bluemonday.Policy {
		policy := bluemonday.UGCPolicy()
		policy.AllowImages()
		policy.AllowAttrs("loading", "alt", "title").OnElements("img")
		policy.AllowAttrs("target", "rel").OnElements("a")
		return policy
	}()
	textPolicy = bluemonday.StrictPolicy()
)

func sanitizeText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return strings.TrimSpace(textPolicy.Sanitize(value))
}

func sanitizeHTML(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	return strings.TrimSpace(htmlPolicy.Sanitize(value))
}

func isSafeURL(raw string, allowEmpty bool) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return allowEmpty
	}

	// 支持多行/逗号分隔的多个 URL
	replacer := strings.NewReplacer("\n", ",", "\r", ",", " ", ",")
	raw = replacer.Replace(raw)
	parts := strings.Split(raw, ",")

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		
		if strings.HasPrefix(part, "//") {
			return false
		}
		
		parsed, err := url.Parse(part)
		if err != nil {
			return false
		}
		
		if parsed.IsAbs() {
			scheme := strings.ToLower(parsed.Scheme)
			if scheme != "http" && scheme != "https" {
				return false
			}
		} else {
			if !strings.HasPrefix(part, "/") {
				return false
			}
		}
	}
	
	return true
}

func normalizeTags(raw string) string {
	tags := parseTags(raw, 12)
	if len(tags) == 0 {
		return ""
	}
	return strings.Join(tags, ",")
}

func splitTags(raw string) []string {
	return parseTags(raw, 0)
}

func parseTags(raw string, limit int) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	replacer := strings.NewReplacer("，", ",", "、", ",", ";", ",", "；", ",", "|", ",", "\n", ",", "\t", ",")
	raw = replacer.Replace(raw)
	parts := strings.Split(raw, ",")
	seen := make(map[string]bool)
	tags := make([]string, 0, len(parts))
	for _, part := range parts {
		tag := strings.TrimSpace(part)
		if tag == "" {
			continue
		}
		if len([]rune(tag)) > 20 {
			tag = string([]rune(tag)[:20])
		}
		key := strings.ToLower(tag)
		if seen[key] {
			continue
		}
		seen[key] = true
		tags = append(tags, tag)
		if limit > 0 && len(tags) >= limit {
			break
		}
	}
	return tags
}

func (a *App) GetRSSFeed(c *gin.Context) {
	projects := []models.Project{}
	query := `SELECT id, name, summary, created_at FROM projects WHERE is_public = 1 ORDER BY created_at DESC LIMIT 20`
	if err := a.DB.Select(&projects, query); err != nil {
		c.String(http.StatusInternalServerError, "Failed to load feed")
		return
	}

	var rssContent strings.Builder
	rssContent.WriteString(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>JEJE Web</title>
  <link>http://localhost:8080/</link>
  <description>产品作品档案与博客展示</description>
  <language>zh-cn</language>
`)

	for _, p := range projects {
		link := fmt.Sprintf("http://localhost:8080/project?id=%d", p.ID)
		rssContent.WriteString(fmt.Sprintf(`  <item>
    <title><![CDATA[%s]]></title>
    <link>%s</link>
    <guid>%s</guid>
    <description><![CDATA[%s]]></description>
    <pubDate>%s</pubDate>
  </item>
`, p.Name, link, link, p.Summary, p.CreatedAt.Format(time.RFC1123Z)))
	}

	rssContent.WriteString(`</channel>
</rss>`)

	c.Data(http.StatusOK, "application/rss+xml; charset=utf-8", []byte(rssContent.String()))
}

func (a *App) ListSettings(c *gin.Context) {
	settings := []models.Setting{}
	if err := a.DB.Select(&settings, "SELECT k, v, updated_at FROM settings"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载配置失败"})
		return
	}
	res := make(map[string]string)
	for _, s := range settings {
		res[s.K] = s.V
	}
	c.JSON(http.StatusOK, res)
}

func (a *App) AdminUpdateSettings(c *gin.Context) {
	var payload map[string]string
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的参数"})
		return
	}

	for k, v := range payload {
		// 校验键名是否合法 (icp_beian, gongan_beian, gongan_url 等)
		_, err := a.DB.Exec(`INSERT INTO settings (k, v, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
			ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = CURRENT_TIMESTAMP`, k, v)
		if err != nil {
			log.Printf("更新配置 [%s] 失败: %v", k, err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "部分配置保存失败"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "配置更新成功"})
}

