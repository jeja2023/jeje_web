# API 简要说明

## 基础信息
- Base URL: `/api`
- 返回 JSON
- 管理员接口使用 Cookie `session` 认证（`POST /api/admin/login` 后自动写入）

## 公共接口

### 健康检查
- `GET /api/health`
- 响应：`{"status":"ok"}`

### 获取验证码
- `GET /api/captcha`
- 响应示例：
  - `{"id":"xxx","question":"请计算 3 + 5","expires_in":300}`

### 项目列表
- `GET /api/projects`
- 响应示例：
  - `{"data":[...]}`

### 项目详情
- `GET /api/projects/:id`

### 留言列表（仅公开）
- `GET /api/messages`

### 提交留言
- `POST /api/messages`
- Body JSON：
  - `nickname` 必填
  - `contact` 可选
  - `content` 必填
  - `captcha_id` 必填
  - `captcha_answer` 必填
  - `website` 必须为空（防刷蜜罐字段）
- 响应示例：`{"message":"submitted"}`

## 管理接口（需要登录）

### 管理员登录
- `POST /api/admin/login`
- Body JSON：`{"username":"admin","password":"***"}`
- 成功会写入 `session` Cookie

### 管理员退出
- `POST /api/admin/logout`

### 留言管理
- `GET /api/admin/messages`
- `PATCH /api/admin/messages/:id` Body JSON：`{"status":0|1|2}`
- `DELETE /api/admin/messages/:id`
- `POST /api/admin/messages/:id/replies` Body JSON：`{"content":"..."}`

### 项目管理
- `GET /api/admin/projects`
- `POST /api/admin/projects`
- `PUT /api/admin/projects/:id`
- `DELETE /api/admin/projects/:id`
- Body JSON 字段：
  - `name` 必填
  - `summary` 可选
  - `cover_url` 可选
  - `content_html` 可选（支持 HTML）
  - `external_url` 可选
  - `sort_order` 数字（大在前）
  - `is_public` 布尔值

### 图片上传（富文本用）
- `POST /api/admin/uploads`
- Content-Type: `multipart/form-data`
- 字段：`file`
- 响应示例：`{"url":"/uploads/xxx.jpg"}`

## 备注
- 留言接口带基础限流与冷却时间。
- 登录失败次数过多会触发短期锁定（可通过环境变量调整）。
