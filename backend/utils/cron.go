// 定时器工具 / Cron Utilities
package utils

import (
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

type projectAssetRefs struct {
	CoverURL    string `db:"cover_url"`
	VideoURL    string `db:"video_url"`
	ContentHTML string `db:"content_html"`
}

var assetAttrPattern = regexp.MustCompile(`(?i)(?:src|href)\s*=\s*["']([^"'#]+)["']`)
var mdAssetPattern = regexp.MustCompile(`\]\(\s*([^)]+)\s*\)`)

// StartImageCleanupTask 启动定时清理孤立图片的任务
func StartImageCleanupTask(db *sqlx.DB, uploadDir string, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for range ticker.C {
			cleanOrphanedImages(db, uploadDir)
		}
	}()
	log.Printf("已启动孤立图片清理任务，间隔: %v", interval)
}

func cleanOrphanedImages(db *sqlx.DB, uploadDir string) {
	log.Println("正在扫描并清理孤立图片...")

	// 1. 获取本地所有图片文件
	entries, err := os.ReadDir(uploadDir)
	if err != nil {
		log.Printf("清理任务：读取目录失败 %v", err)
		return
	}

	// 2. 获取数据库中正在引用的资源
	var refs []projectAssetRefs
	if err := db.Select(&refs, "SELECT cover_url, video_url, content_html FROM projects"); err != nil {
		log.Printf("清理任务：获取资源引用失败 %v", err)
		return
	}

	// 提取文件名存入 Map 方便查找，并拼接所有文本以备最终的全文本安全校验
	usedFiles := make(map[string]bool)
	var allContentBuilder strings.Builder
	for _, ref := range refs {
		allContentBuilder.WriteString(ref.CoverURL)
		allContentBuilder.WriteString("\n")
		allContentBuilder.WriteString(ref.VideoURL)
		allContentBuilder.WriteString("\n")
		allContentBuilder.WriteString(ref.ContentHTML)
		allContentBuilder.WriteString("\n")

		addUsedFile(usedFiles, ref.CoverURL)
		addUsedFile(usedFiles, ref.VideoURL)
		for _, assetURL := range extractAssetURLs(ref.ContentHTML) {
			addUsedFile(usedFiles, assetURL)
		}
	}
	allContent := allContentBuilder.String()

	// 3. 遍历并清理
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		filename := entry.Name()

		// 忽略隐藏文件或特殊文件
		if strings.HasPrefix(filename, ".") {
			continue
		}

		// 如果文件没有被准确提取引用，且全文也不包含该文件名（给正在编辑的内容留时间）
		if !usedFiles[filename] && !strings.Contains(allContent, filename) {
			info, err := entry.Info()
			if err == nil && time.Since(info.ModTime()) > 24*time.Hour {
				path := filepath.Join(uploadDir, filename)
				if err := os.Remove(path); err == nil {
					count++
					log.Printf("清理任务：已删除孤立图片 %s", filename)
				}
			}
		}
	}

	if count > 0 {
		log.Printf("清理任务完成，共清理 %d 个无用文件", count)
	} else {
		log.Println("清理任务完成，未发现过期孤立文件")
	}
}

func extractAssetURLs(content string) []string {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	urls := make([]string, 0)

	matches := assetAttrPattern.FindAllStringSubmatch(content, -1)
	for _, match := range matches {
		if len(match) > 1 {
			urls = append(urls, match[1])
		}
	}

	mdMatches := mdAssetPattern.FindAllStringSubmatch(content, -1)
	for _, match := range mdMatches {
		if len(match) > 1 {
			urls = append(urls, match[1])
		}
	}

	if len(urls) == 0 {
		return nil
	}
	return urls
}

func addUsedFile(usedFiles map[string]bool, raw string) {
	f := func(c rune) bool {
		return c == '\n' || c == '\r' || c == ',' || c == '，' || c == ';' || c == '；'
	}
	parts := strings.FieldsFunc(raw, f)

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		parsed, err := url.Parse(part)
		if err == nil && parsed.Path != "" {
			part = parsed.Path
		}

		filename := filepath.Base(part)
		if filename == "." || filename == "/" || filename == `\` || filename == "" {
			continue
		}
		usedFiles[filename] = true
	}
}
