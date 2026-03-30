#!/bin/bash
set -e

SERVER="192.168.31.36"
REMOTE_DIR="~/tv-remote"
SCRIPT_DIR="$(dirname "$0")"

# Check if only static files changed (no rebuild needed)
CHANGED=$(git -C "$SCRIPT_DIR" diff --name-only HEAD 2>/dev/null; git -C "$SCRIPT_DIR" diff --name-only 2>/dev/null)
NEEDS_BUILD=$(echo "$CHANGED" | grep -v '^static/' | grep -v '^rebuild.sh' | head -1)

echo "→ Синхронизирую файлы..."
rsync -av --exclude='.git' "$SCRIPT_DIR/" "$SERVER:$REMOTE_DIR/"

if [ -n "$NEEDS_BUILD" ]; then
    echo "→ Изменились не только статичные файлы, пересобираю образ..."
    ssh "$SERVER" "cd $REMOTE_DIR && docker compose up -d --build"
else
    echo "→ Только статика изменилась, перезапускаю без пересборки..."
    ssh "$SERVER" "docker restart tv-remote"
fi

echo "✓ Готово: http://$SERVER:8099"
