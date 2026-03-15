// API 处理器 / API Handlers
package api

import (
	"bytes"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"jeje_web/config"
	"jeje_web/models"
	"jeje_web/utils"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jmoiron/sqlx"
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

func (a *App) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "正常"})
}

func (a *App) AdminStats(c *gin.Context) {
	var stats struct {
		TotalProjects int `json:"total_projects"`
		TotalMessages int `json:"total_messages"`
		PendingMessages int `json:"pending_messages"`
		TodayMessages int `json:"today_messages"`
	}

	err := a.DB.Get(&stats.TotalProjects, "SELECT COUNT(*) FROM projects")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取项目统计失败"})
		return
	}

	err = a.DB.Get(&stats.TotalMessages, "SELECT COUNT(*) FROM messages")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取留言统计失败"})
		return
	}

	err = a.DB.Get(&stats.PendingMessages, "SELECT COUNT(*) FROM messages WHERE status = 0")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取待审核留言失败"})
		return
	}

	today := time.Now().Format("2006-01-02")
	err = a.DB.Get(&stats.TodayMessages, "SELECT COUNT(*) FROM messages WHERE DATE(created_at) = ?", today)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取今日留言失败"})
		return
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
	query := `SELECT id, name, summary, cover_url, external_url, sort_order, is_public, created_at, updated_at
		FROM projects WHERE is_public = 1 ORDER BY sort_order DESC, id DESC`
	if err := a.DB.Select(&projects, query); err != nil {
		fmt.Printf("加载项目列表失败: %v\n", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": projects})
}

func (a *App) GetProject(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的 ID"})
		return
	}
	var project models.Project
	query := `SELECT id, name, summary, cover_url, content_html, external_url, sort_order, is_public, created_at, updated_at
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
	query := `SELECT id, nickname, contact, content, status, created_at
		FROM messages WHERE status = 1 ORDER BY created_at DESC`
	if err := a.DB.Select(&messages, query); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载留言失败"})
		return
	}
	attachReplies(a.DB, messages)
	c.JSON(http.StatusOK, gin.H{"data": messages})
}

func (a *App) CreateMessage(c *gin.Context) {
	var payload struct {
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
	payload.Nickname = strings.TrimSpace(payload.Nickname)
	payload.Contact = strings.TrimSpace(payload.Contact)
	payload.Content = strings.TrimSpace(payload.Content)
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
	_, err := a.DB.Exec(`INSERT INTO messages (nickname, contact, content, status, ip, ua)
		VALUES (?, ?, ?, 0, ?, ?)`, payload.Nickname, payload.Contact, payload.Content, ip, ua)
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

	exp := time.Now().Add(12 * time.Hour)
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
	c.SetCookie("session", signed, int(12*time.Hour.Seconds()), "/", "", a.Cfg.CookieSecure, true)
	c.JSON(http.StatusOK, gin.H{"message": "登录成功"})
}

func (a *App) AdminLogout(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("session", "", -1, "/", "", a.Cfg.CookieSecure, true)
	c.JSON(http.StatusOK, gin.H{"message": "已退出登录"})
}

func (a *App) AdminListMessages(c *gin.Context) {
	messages := []models.Message{}
	query := `SELECT id, nickname, contact, content, status, created_at, ip, ua
		FROM messages ORDER BY created_at DESC`
	if err := a.DB.Select(&messages, query); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载留言失败"})
		return
	}
	attachReplies(a.DB, messages)
	c.JSON(http.StatusOK, gin.H{"data": messages})
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
	payload.Content = strings.TrimSpace(payload.Content)
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

func (a *App) AdminUploadImage(c *gin.Context) {
	maxBytes := int64(a.Cfg.UploadMaxMB) * 1024 * 1024
	if maxBytes <= 0 {
		maxBytes = 5 * 1024 * 1024
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
	if err := c.Request.ParseMultipartForm(maxBytes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "上传失败"})
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
		"image/jpeg": ".jpg",
		"image/png": ".png",
		"image/gif": ".gif",
		"image/webp": ".webp",
	}
	ext, ok := allowed[contentType]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该文件格式不支持"})
		return
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

func (a *App) AdminListProjects(c *gin.Context) {
	projects := []models.Project{}
	query := `SELECT id, name, summary, cover_url, content_html, external_url, sort_order, is_public, created_at, updated_at
		FROM projects ORDER BY sort_order DESC, id DESC`
	if err := a.DB.Select(&projects, query); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载项目列表失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": projects})
}

func (a *App) AdminCreateProject(c *gin.Context) {
	var payload models.Project
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的参数"})
		return
	}
	payload.Name = strings.TrimSpace(payload.Name)
	payload.Summary = strings.TrimSpace(payload.Summary)
	payload.CoverURL = strings.TrimSpace(payload.CoverURL)
	payload.ExternalURL = strings.TrimSpace(payload.ExternalURL)
	payload.ContentHTML = strings.TrimSpace(payload.ContentHTML)

	if payload.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称必填"})
		return
	}

	res, err := a.DB.Exec(`INSERT INTO projects (name, summary, cover_url, content_html, external_url, sort_order, is_public)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, payload.Name, payload.Summary, payload.CoverURL, payload.ContentHTML,
		payload.ExternalURL, payload.SortOrder, payload.IsPublic)
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
	payload.Name = strings.TrimSpace(payload.Name)
	payload.Summary = strings.TrimSpace(payload.Summary)
	payload.CoverURL = strings.TrimSpace(payload.CoverURL)
	payload.ExternalURL = strings.TrimSpace(payload.ExternalURL)
	payload.ContentHTML = strings.TrimSpace(payload.ContentHTML)

	if payload.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "名称必填"})
		return
	}

	res, err := a.DB.Exec(`UPDATE projects SET name=?, summary=?, cover_url=?, content_html=?, external_url=?, sort_order=?, is_public=?
		WHERE id = ?`, payload.Name, payload.Summary, payload.CoverURL, payload.ContentHTML,
		payload.ExternalURL, payload.SortOrder, payload.IsPublic, id)
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