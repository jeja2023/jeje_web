// 数据模型
package models

import "time"

type Project struct {
	ID          int64     `db:"id" json:"id"`
	Name        string    `db:"name" json:"name"`
	Summary     string    `db:"summary" json:"summary"`
	CoverURL    string    `db:"cover_url" json:"cover_url"`
	VideoURL    string    `db:"video_url" json:"video_url"`
	ContentHTML string    `db:"content_html" json:"content_html"`
	ExternalURL string    `db:"external_url" json:"external_url"`
	SortOrder   int       `db:"sort_order" json:"sort_order"`
	IsPublic    bool      `db:"is_public" json:"is_public"`
	ViewCount   int       `db:"view_count" json:"view_count"`
	Tags        string    `db:"tags" json:"tags"`
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at" json:"updated_at"`
}

type Message struct {
	ID        int64     `db:"id" json:"id"`
	ProjectID *int64    `db:"project_id" json:"project_id,omitempty"`
	Nickname  string    `db:"nickname" json:"nickname"`
	Contact   string    `db:"contact" json:"contact"`
	Content   string    `db:"content" json:"content"`
	Status    int       `db:"status" json:"status"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
	IP        string    `db:"ip" json:"ip"`
	UA          string    `db:"ua" json:"ua"`
	ProjectName string    `json:"project_name,omitempty" db:"project_name"`
	Replies     []Reply   `json:"replies" db:"-"`
}

type Reply struct {
	ID        int64     `db:"id" json:"id"`
	MessageID int64     `db:"message_id" json:"message_id"`
	Content   string    `db:"content" json:"content"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type Admin struct {
	ID           int64     `db:"id"`
	Username     string    `db:"username"`
	PasswordHash string    `db:"password_hash"`
	CreatedAt    time.Time `db:"created_at"`
}

type Setting struct {
	K         string    `db:"k" json:"k"`
	V         string    `db:"v" json:"v"`
	UpdatedAt time.Time `db:"updated_at" json:"updated_at"`
}
