<#
.SYNOPSIS
    Builds and pushes the Copilot CLI Server Docker image to ACR

.PARAMETER AcrName
    Name of the Azure Container Registry

.PARAMETER ImageName
    Name of the Docker image (default: copilot-cli-server)

.PARAMETER ImageTag
    Tag for the Docker image (default: latest)

.EXAMPLE
    .\build-and-push.ps1 -AcrName "myacr" -ImageTag "v1.0.0"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AcrName,

    [Parameter(Mandatory = $false)]
    [string]$ImageName = "copilot-cli-server",

    [Parameter(Mandatory = $false)]
    [string]$ImageTag = "latest"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

Write-Host "Building and pushing Docker image..." -ForegroundColor Cyan
Write-Host "  ACR: $AcrName" -ForegroundColor Gray
Write-Host "  Image: ${ImageName}:${ImageTag}" -ForegroundColor Gray

# Login to ACR
Write-Host ""
Write-Host "Logging in to ACR..." -ForegroundColor Yellow
az acr login --name $AcrName

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to login to ACR"
    exit 1
}

# Get ACR login server
$acrLoginServer = az acr show --name $AcrName --query loginServer -o tsv
$fullImageName = "$acrLoginServer/${ImageName}:${ImageTag}"

Write-Host ""
Write-Host "Building Docker image..." -ForegroundColor Yellow
docker build -t $fullImageName $RootDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build failed"
    exit 1
}

Write-Host ""
Write-Host "Pushing image to ACR..." -ForegroundColor Yellow
docker push $fullImageName

if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker push failed"
    exit 1
}

Write-Host ""
Write-Host "Successfully pushed: $fullImageName" -ForegroundColor Green
