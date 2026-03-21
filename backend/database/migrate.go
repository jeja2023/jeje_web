package database

import (
	"github.com/jmoiron/sqlx"
)

func EnsureSchema(db *sqlx.DB) error {
	// 确保基础表结构存在 / Ensure basic table structure exists
	return createTables(db)
}

func createTables(db *sqlx.DB) error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS projects (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			summary TEXT,
			cover_url TEXT,
			video_url TEXT,
			content_html TEXT,
			external_url TEXT,
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_public INTEGER NOT NULL DEFAULT 1,
			view_count INTEGER NOT NULL DEFAULT 0,
			tags TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			nickname TEXT NOT NULL,
			contact TEXT,
			content TEXT NOT NULL,
			status INTEGER NOT NULL DEFAULT 0,
			project_id INTEGER,
			ip TEXT,
			ua TEXT,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);`,
		`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);`,
		`CREATE TABLE IF NOT EXISTS replies (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			content TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_replies_message ON replies(message_id);`,
		`CREATE TABLE IF NOT EXISTS admins (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);`,
	}

	for _, q := range queries {
		if _, err := db.Exec(q); err != nil {
			return err
		}
	}
	return nil
}
