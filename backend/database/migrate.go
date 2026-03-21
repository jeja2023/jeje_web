package database

import (
	"fmt"

	"github.com/jmoiron/sqlx"
)

func EnsureSchema(db *sqlx.DB) error {
	// 确保基础表结构存在 / Ensure basic table structure exists
	if err := createTables(db); err != nil {
		return err
	}

	// 确保旧版本表结构的迁移 / Ensure migration for older table versions
	if err := ensureColumn(db, "projects", "view_count", "INT NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := ensureColumn(db, "projects", "tags", "VARCHAR(255)"); err != nil {
		return err
	}
	if err := ensureColumn(db, "projects", "video_url", "VARCHAR(500)"); err != nil {
		return err
	}
	if err := ensureColumn(db, "messages", "project_id", "BIGINT NULL COMMENT '关联的项目或文章ID'"); err != nil {
		return err
	}
	if err := ensureColumn(db, "messages", "ip", "VARCHAR(64)"); err != nil {
		return err
	}
	if err := ensureColumn(db, "messages", "ua", "VARCHAR(255)"); err != nil {
		return err
	}
	return nil
}

func createTables(db *sqlx.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS projects (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			name VARCHAR(200) NOT NULL,
			summary TEXT,
			cover_url VARCHAR(500),
			content_html MEDIUMTEXT,
			external_url VARCHAR(500),
			sort_order INT NOT NULL DEFAULT 0,
			is_public TINYINT NOT NULL DEFAULT 1,
			view_count INT NOT NULL DEFAULT 0,
			tags VARCHAR(255),
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
		`CREATE TABLE IF NOT EXISTS messages (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			nickname VARCHAR(100) NOT NULL,
			contact VARCHAR(200),
			content TEXT NOT NULL,
			status TINYINT NOT NULL DEFAULT 0,
			ip VARCHAR(64),
			ua VARCHAR(255),
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_messages_status (status),
			INDEX idx_messages_created (created_at)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
		`CREATE TABLE IF NOT EXISTS replies (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			message_id BIGINT NOT NULL,
			content TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			INDEX idx_replies_message (message_id),
			CONSTRAINT fk_replies_message FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
		`CREATE TABLE IF NOT EXISTS admins (
			id BIGINT AUTO_INCREMENT PRIMARY KEY,
			username VARCHAR(100) NOT NULL UNIQUE,
			password_hash VARCHAR(255) NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return err
		}
	}
	return nil
}

func ensureColumn(db *sqlx.DB, table string, column string, definition string) error {
	var count int
	err := db.Get(&count, "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", table, column)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)
	_, err = db.Exec(query)
	return err
}
