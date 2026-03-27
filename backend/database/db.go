// Database Connection (SQLite)
package database

import (
	"log"
	"path/filepath"
	"jeje_web/config"

	"github.com/jmoiron/sqlx"
	_ "modernc.org/sqlite" // Pure Go SQLite Driver (No CGO needed)
)

func OpenDB(cfg config.Config) (*sqlx.DB, error) {
	// 确保数据库文件存放在与上传文件同一个 storage 目录下，便于备份
	dbPath := filepath.Join(filepath.Dir(cfg.UploadDir), cfg.DBName)
	db, err := sqlx.Connect("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	
	// SQLite 调优配置
	db.SetMaxOpenConns(1) // SQLite 同时只能一个进程写，所以设为 1 最稳
	log.Printf("数据库连接成功 (SQLite): %s", dbPath)
	return db, nil
}