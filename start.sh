#!/usr/bin/env bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "首次运行，正在安装依赖..."
  npm install
fi
echo "正在启动德州扑克服务器..."
npm start
