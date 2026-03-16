// 数据库初始化 / Database Seed
package database

import (
	"database/sql"

	"jeje_web/config"

	"github.com/jmoiron/sqlx"
	"golang.org/x/crypto/bcrypt"
)

func BootstrapAdmin(db *sqlx.DB, cfg config.Config) error {
	if cfg.AdminUser == "" || cfg.AdminPass == "" {
		return nil
	}

	var count int
	if err := db.Get(&count, "SELECT COUNT(*) FROM admins"); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPass), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	_, err = db.Exec(
		"INSERT INTO admins (username, password_hash) VALUES (?, ?)",
		cfg.AdminUser,
		string(hash),
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	return nil
}