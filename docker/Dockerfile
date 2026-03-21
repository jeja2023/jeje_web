# 第一阶段：编译 Go 后端
FROM golang:1.25-alpine AS builder

WORKDIR /app

# 设置 Go 代理以加速国内依赖下载
ENV GOPROXY=https://goproxy.cn,direct

# 复制依赖文件并下载
COPY backend/go.mod backend/go.sum ./
RUN go mod download

# 复制后端源码并进行静态编译 (不再需要 CGO，因为使用了现代 Go 驱动)
COPY backend/ .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/jeje_web main.go

# 第二阶段：运行环境
FROM alpine:latest

# 安装基础库和时区数据
RUN apk --no-cache add ca-certificates tzdata mailcap
ENV TZ=Asia/Shanghai

WORKDIR /app

# 复制后端程序
COPY --from=builder /app/jeje_web .

# 复制前端资源
COPY frontend/ ./frontend

# 复制配置模板
COPY backend/.env.example ./.env

# 创建数据存储目录 (数据库和上传文件都放在这里)
RUN mkdir -p /app/storage/uploads

# 暴露端口
EXPOSE 8080

# 启动程序
CMD ["./jeje_web"]
