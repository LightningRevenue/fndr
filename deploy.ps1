# Usage:
#   .\deploy.ps1          — build + restart (default)
#   .\deploy.ps1 build    — build only
#   .\deploy.ps1 restart  — restart only
#   .\deploy.ps1 logs     — tail logs
#   .\deploy.ps1 stop     — stop container
#   .\deploy.ps1 status   — show status

param([string]$Action = "deploy")

$ErrorActionPreference = "Stop"

switch ($Action) {
    "deploy" {
        Write-Host "▶ Building image..." -ForegroundColor Cyan
        docker compose build --no-cache
        Write-Host "▶ Restarting container..." -ForegroundColor Cyan
        docker compose up -d --force-recreate
        Start-Sleep -Seconds 5
        docker compose ps
    }
    "build" {
        Write-Host "▶ Building image..." -ForegroundColor Cyan
        docker compose build --no-cache
    }
    "restart" {
        Write-Host "▶ Restarting container..." -ForegroundColor Cyan
        docker compose up -d --force-recreate
        docker compose ps
    }
    "logs" {
        docker compose logs -f --tail=100
    }
    "stop" {
        Write-Host "▶ Stopping container..." -ForegroundColor Cyan
        docker compose down
    }
    "status" {
        docker compose ps
    }
    default {
        Write-Host "Unknown action: $Action" -ForegroundColor Red
        Write-Host "Usage: .\deploy.ps1 [deploy|build|restart|logs|stop|status]"
        exit 1
    }
}
