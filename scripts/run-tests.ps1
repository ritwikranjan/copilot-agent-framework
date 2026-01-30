<#
.SYNOPSIS
    Triggers test execution in the test client container

.DESCRIPTION
    Restarts the test client container to run tests and streams logs

.PARAMETER ResourceGroupName
    Name of the resource group containing test infrastructure

.PARAMETER TestAppName
    Name of the test client Container App (default: copilot-cli-test-client)

.PARAMETER Follow
    Follow logs after triggering tests

.EXAMPLE
    .\run-tests.ps1 -ResourceGroupName "copilot-cli-test-rg"

.EXAMPLE
    .\run-tests.ps1 -ResourceGroupName "copilot-cli-test-rg" -Follow
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $false)]
    [string]$TestAppName = "copilot-cli-test-client",

    [Parameter(Mandatory = $false)]
    [switch]$Follow
)

$ErrorActionPreference = "Stop"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Running Tests" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Scale up the test client to 1 replica to trigger test run
Write-Host "Starting test client container..." -ForegroundColor Yellow
az containerapp update `
    --name $TestAppName `
    --resource-group $ResourceGroupName `
    --min-replicas 1 `
    --max-replicas 1 `
    --output none

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to start test container"
    exit 1
}

# Wait for container to start
Write-Host "Waiting for container to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Create a new revision to restart the container
Write-Host "Triggering new test run..." -ForegroundColor Yellow
az containerapp revision restart `
    --name $TestAppName `
    --resource-group $ResourceGroupName `
    --revision $(az containerapp revision list -n $TestAppName -g $ResourceGroupName --query "[0].name" -o tsv) `
    --output none 2>$null

# If restart fails, try updating a label to force new revision
if ($LASTEXITCODE -ne 0) {
    $timestamp = Get-Date -Format "yyyyMMddHHmmss"
    az containerapp update `
        --name $TestAppName `
        --resource-group $ResourceGroupName `
        --set-env-vars "TEST_RUN_ID=$timestamp" `
        --output none
}

Write-Host ""
Write-Host "Tests triggered! Fetching logs..." -ForegroundColor Green
Write-Host ""

# Show logs
if ($Follow) {
    az containerapp logs show `
        --name $TestAppName `
        --resource-group $ResourceGroupName `
        --follow `
        --tail 100
} else {
    # Wait a bit for tests to complete
    Start-Sleep -Seconds 30
    
    az containerapp logs show `
        --name $TestAppName `
        --resource-group $ResourceGroupName `
        --tail 100
}

Write-Host ""
Write-Host "To view more logs:" -ForegroundColor Cyan
Write-Host "  az containerapp logs show -n $TestAppName -g $ResourceGroupName --tail 200" -ForegroundColor Gray

# Scale back down to save costs
Write-Host ""
Write-Host "Scaling down test client..." -ForegroundColor Yellow
az containerapp update `
    --name $TestAppName `
    --resource-group $ResourceGroupName `
    --min-replicas 0 `
    --max-replicas 1 `
    --output none
