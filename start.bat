@echo off
chcp 65001 >nul
cd /d %~dp0
if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install
)
echo 正在启动德州扑克服务器...
call npm start
pause
