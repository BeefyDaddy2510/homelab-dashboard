#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-/opt/homelab-dashboard}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"

cd "$APP_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Docker Compose is not available." >&2
  exit 1
fi

$COMPOSE -f "$COMPOSE_FILE" pull
$COMPOSE -f "$COMPOSE_FILE" up -d --remove-orphans
docker image prune -f

echo "Homelab Dashboard refreshed from $APP_DIR/$COMPOSE_FILE"
