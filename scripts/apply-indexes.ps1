# PowerShell script to apply database indexes on the server
# This script applies performance indexes to existing LogViewer database

param(
    [string]$ServerHost = "",
    [string]$PostgresContainer = "binance-postgres",
    [switch]$Local = $false
)

Write-Host "=== LogViewer Performance Optimization ===" -ForegroundColor Green
Write-Host ""

$scriptPath = Join-Path $PSScriptRoot "apply-indexes.sql"

if (-not (Test-Path $scriptPath)) {
    Write-Host "ERROR: SQL script not found: $scriptPath" -ForegroundColor Red
    exit 1
}

if ($Local) {
    Write-Host "Applying indexes to LOCAL database..." -ForegroundColor Yellow
    
    # Apply to local PostgreSQL container
    Get-Content $scriptPath | docker exec -i $PostgresContainer psql -U postgres
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "SUCCESS: Indexes applied successfully to local database!" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "ERROR: Failed to apply indexes to local database" -ForegroundColor Red
        exit 1
    }
} else {
    if ([string]::IsNullOrEmpty($ServerHost)) {
        Write-Host "ERROR: Please specify server host with -ServerHost parameter" -ForegroundColor Red
        Write-Host ""
        Write-Host "Usage examples:" -ForegroundColor Yellow
        Write-Host "  .\apply-indexes.ps1 -Local                          # Apply to local database"
        Write-Host "  .\apply-indexes.ps1 -ServerHost user@server.com     # Apply to remote database"
        exit 1
    }
    
    Write-Host "Applying indexes to REMOTE database on $ServerHost..." -ForegroundColor Yellow
    
    # Copy script to server
    Write-Host "1. Copying SQL script to server..." -ForegroundColor Cyan
    scp $scriptPath "${ServerHost}:/tmp/apply-indexes.sql"
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to copy SQL script to server" -ForegroundColor Red
        exit 1
    }
    
    # Execute script on server
    Write-Host "2. Executing SQL script on server..." -ForegroundColor Cyan
    ssh $ServerHost "docker exec -i $PostgresContainer psql -U postgres < /tmp/apply-indexes.sql"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "SUCCESS: Indexes applied successfully to remote database!" -ForegroundColor Green
        
        # Cleanup
        Write-Host "3. Cleaning up..." -ForegroundColor Cyan
        ssh $ServerHost "rm /tmp/apply-indexes.sql"
    } else {
        Write-Host ""
        Write-Host "ERROR: Failed to apply indexes to remote database" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=== Performance Optimization Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Restart log-viewer container: docker-compose -f docker-compose.server.yml restart app"
Write-Host "2. Monitor performance improvements in the application"
Write-Host "3. Check PERFORMANCE_OPTIMIZATION.md for more details"
Write-Host ""

