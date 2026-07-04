#!/usr/bin/env bash
# Usage:
#   ./deploy.sh          — build + restart (default)
#   ./deploy.sh build    — build only (no restart)
#   ./deploy.sh restart  — restart only (no rebuild)
#   ./deploy.sh logs     — tail logs
#   ./deploy.sh stop     — stop container
#   ./deploy.sh status   — show container status

set -e

COMPOSE="docker compose"
ACTION="${1:-deploy}"

case "$ACTION" in
    deploy|"")
        echo "▶ Building image…"
        $COMPOSE build --no-cache
        echo "▶ Restarting container…"
        $COMPOSE up -d --force-recreate
        echo "▶ Waiting for health check…"
        sleep 5
        $COMPOSE ps
        ;;
    build)
        echo "▶ Building image…"
        $COMPOSE build --no-cache
        ;;
    restart)
        echo "▶ Restarting container…"
        $COMPOSE up -d --force-recreate
        $COMPOSE ps
        ;;
    logs)
        $COMPOSE logs -f --tail=100
        ;;
    stop)
        echo "▶ Stopping container…"
        $COMPOSE down
        ;;
    status)
        $COMPOSE ps
        ;;
    *)
        echo "Unknown action: $ACTION"
        echo "Usage: ./deploy.sh [deploy|build|restart|logs|stop|status]"
        exit 1
        ;;
esac
