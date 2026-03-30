#!/bin/bash
set -e

SERVER="192.168.31.36"
REMOTE_DIR="~/tv-remote"
SCRIPT_DIR="$(dirname "$0")"

echo "→ Синхронизирую файлы..."
rsync -av --exclude='.git' --exclude='frontend/node_modules' --exclude='frontend/dist' \
  "$SCRIPT_DIR/" "$SERVER:$REMOTE_DIR/"

echo "→ Пересобираю контейнеры..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build"

echo "✓ Готово: http://$SERVER:8099"
