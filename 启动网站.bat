@echo off
chcp 65001 > nul
title JEJE Web 启动工具

echo [1/3] 正在清理 8080 端口...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8080 ^| findstr LISTENING') do (
    echo 发现占用进程 PID: %%a，正在终止...
    taskkill /F /PID %%a
)

echo [2/3] 正在启动服务...
start "JEJE_WEB_SERVER" cmd /c "npm run dev"

echo [3/3] 正在等待服务就绪并打开浏览器...
timeout /t 3 /nobreak > nul
start http://localhost:8080

echo 启动流程已完成。
pause
