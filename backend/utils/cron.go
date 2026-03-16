// 定时器工具 / Cron Utilities
package utils

import (
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jmoiron/sqlx"
)

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

	// 2. 获取数据库中正在引用的图片
	// 这里查询项目封面图
	var coverUrls []string
	if err := db.Select(&coverUrls, "SELECT cover_url FROM projects WHERE cover_url != ''"); err != nil {
		log.Printf("清理任务：获取封面引用失败 %v", err)
		return
	}

	// 提取文件名存入 Map 方便查找
	usedFiles := make(map[string]bool)
	for _, url := range coverUrls {
		parts := strings.Split(url, "/")
		if len(parts) > 0 {
			filename := parts[len(parts)-1]
			usedFiles[filename] = true
		}
	}

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

		// 如果文件没有被引用且创建时间超过 24 小时（给正在编辑的内容留时间）
		if !usedFiles[filename] {
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
