#!/bin/bash
set -e

SERVER="192.168.31.36"
REMOTE_DIR="~/tv-remote"

echo "→ Синхронизирую файлы..."
rsync -av --exclude='.git' "$(dirname "$0")/" "$SERVER:$REMOTE_DIR/"

echo "→ Пересобираю и перезапускаю контейнер..."
ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build"

echo "✓ Готово: http://$SERVER:8099"
