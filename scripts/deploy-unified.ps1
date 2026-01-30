# Deploy Unified Teams Copilot Agent
# Builds Docker images, pushes to ACR, and deploys infrastructure with Bicep
# Includes Azure Bot Service registration and generates Teams App manifest

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroup,
    
    [Parameter(Mandatory=$true)]
    [string]$AcrName,
    
    [Parameter(Mandatory=$true)]
    [string]$GithubToken,
    
    [Parameter(Mandatory=$false)]
    [string]$BaseName = "copilot-unified",
    
    [Parameter(Mandatory=$false)]
    [string]$Location = "eastus",
    
    [Parameter(Mandatory=$false)]
    [string]$AcrResourceGroup = "",
    
    [Parameter(Mandatory=$false)]
    [string]$Model = "gpt-4.1",
    
    [Parameter(Mandatory=$false)]
    [bool]$CreateBotService = $true,
    
    [Parameter(Mandatory=$false)]
    [string]$CliImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$AgentImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$AgentName = "teams-copilot-agent",
    
    [Parameter(Mandatory=$false)]
    [string]$AgentDescription = "An AI assistant powered by GitHub Copilot",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipBuild,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipInfra,
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipManifest,

    [Parameter(Mandatory=$false)]
    [string]$AgentProfile = ""
)

$ErrorActionPreference = "Stop"

# Use same resource group for ACR if not specified
if ([string]::IsNullOrEmpty($AcrResourceGroup)) {
    $AcrResourceGroup = $ResourceGroup
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Deploying Unified Teams Copilot Agent" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Resource Group: $ResourceGroup"
Write-Host "ACR: $AcrName (in $AcrResourceGroup)"
Write-Host "Base Name: $BaseName"
Write-Host "Location: $Location"
Write-Host "Model: $Model"
Write-Host "Audit: Enabled (Cosmos DB)"
Write-Host "Create Bot Service: $CreateBotService"
if ($AgentProfile) {
    Write-Host "Agent Profile: $AgentProfile"
}
Write-Host "========================================" -ForegroundColor Cyan

# Get ACR Login Server
Write-Host "`nGetting ACR Login Server..." -ForegroundColor Yellow
$AcrLoginServer = az acr show --name $AcrName --resource-group $AcrResourceGroup --query "loginServer" -o tsv
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to get ACR login server"
    exit 1
}
Write-Host "ACR Login Server: $AcrLoginServer" -ForegroundColor Green

if (-not $SkipBuild) {
    # Login to ACR
    Write-Host "`nLogging into ACR..." -ForegroundColor Yellow
    az acr login --name $AcrName
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to login to ACR"
        exit 1
    }

    # Build and push CLI Server image
    Write-Host "`nBuilding CLI Server image..." -ForegroundColor Yellow
    $cliImage = "$AcrLoginServer/copilot-cli-server:$CliImageTag"
    docker build -t $cliImage -f services/cli/Dockerfile services/cli
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build CLI Server image"
        exit 1
    }

    Write-Host "Pushing CLI Server image..." -ForegroundColor Yellow
    docker push $cliImage
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push CLI Server image"
        exit 1
    }
    Write-Host "CLI Server image pushed: $cliImage" -ForegroundColor Green

    # Build and push Teams Copilot Agent image
    Write-Host "`nBuilding Teams Copilot Agent image..." -ForegroundColor Yellow
    $agentImage = "$AcrLoginServer/teams-copilot-agent:$AgentImageTag"
    $buildArgs = @("build", "-t", $agentImage, "-f", "services/teams-copilot-agent/Dockerfile")
    if ($AgentProfile) {
        Write-Host "Using agent profile: $AgentProfile" -ForegroundColor Yellow
        $buildArgs += @("--build-arg", "AGENT_PROFILE=$AgentProfile")
    }
    $buildArgs += "."
    docker @buildArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to build Teams Copilot Agent image"
        exit 1
    }

    Write-Host "Pushing Teams Copilot Agent image..." -ForegroundColor Yellow
    docker push $agentImage
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to push Teams Copilot Agent image"
        exit 1
    }
    Write-Host "Teams Copilot Agent image pushed: $agentImage" -ForegroundColor Green
}

$outputs = $null

if (-not $SkipInfra) {
    # Create Resource Group if it doesn't exist
    Write-Host "`nEnsuring Resource Group exists..." -ForegroundColor Yellow
    az group create --name $ResourceGroup --location $Location --output none
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to create resource group"
        exit 1
    }

    # Deploy Infrastructure
    Write-Host "`nDeploying infrastructure with Bicep..." -ForegroundColor Yellow
    Write-Host "This will create:" -ForegroundColor Yellow
    Write-Host "  - VNet and Container Apps Environment" -ForegroundColor Yellow
    Write-Host "  - CLI Server Container App" -ForegroundColor Yellow
    Write-Host "  - Teams Copilot Agent Container App" -ForegroundColor Yellow
    Write-Host "  - Cosmos DB for audit logging" -ForegroundColor Yellow
    if ($CreateBotService) {
        Write-Host "  - Azure Bot Service registration" -ForegroundColor Yellow
    }
    Write-Host ""

    $deploymentResult = az deployment group create `
        --resource-group $ResourceGroup `
        --template-file infra/main.bicep `
        --parameters baseName=$BaseName `
        --parameters acrName=$AcrName `
        --parameters acrResourceGroup=$AcrResourceGroup `
        --parameters githubToken=$GithubToken `
        --parameters cliImageTag=$CliImageTag `
        --parameters agentImageTag=$AgentImageTag `
        --parameters model=$Model `
        --parameters createBotService=$CreateBotService `
        --parameters location=$Location `
        --query properties.outputs `
        --output json

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Infrastructure deployment failed"
        exit 1
    }

    # Parse deployment outputs
    $outputs = $deploymentResult | ConvertFrom-Json

    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "Deployment Complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "CLI Server URL: $($outputs.cliUrl.value)" -ForegroundColor White
    Write-Host "Teams Bot URL: $($outputs.agentBotUrl.value)" -ForegroundColor White
    Write-Host "Bot Messaging Endpoint: $($outputs.agentMessagingEndpoint.value)" -ForegroundColor White
    Write-Host "Health Check URL: $($outputs.agentHealthUrl.value)" -ForegroundColor White
    Write-Host "Bot ID (Managed Identity): $($outputs.botId.value)" -ForegroundColor White
    Write-Host "Static IP: $($outputs.staticIp.value)" -ForegroundColor White
    Write-Host "Cosmos DB Endpoint: $($outputs.cosmosEndpoint.value)" -ForegroundColor White
    if ($CreateBotService) {
        Write-Host "Bot Service Name: $($outputs.botServiceName.value)" -ForegroundColor White
    }
} else {
    Write-Host "`nInfrastructure deployment skipped, fetching existing outputs..." -ForegroundColor Yellow
    $deploymentResult = az deployment group show `
        --resource-group $ResourceGroup `
        --name main `
        --query properties.outputs `
        --output json 2>$null
    
    if ($LASTEXITCODE -eq 0 -and $deploymentResult) {
        $outputs = $deploymentResult | ConvertFrom-Json
    } else {
        Write-Warning "Could not fetch deployment outputs. Manifest generation will be skipped."
    }
}

# Generate Teams App Manifest
if (-not $SkipManifest -and $outputs) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Generating Teams App Manifest" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    $manifestDir = "output/teams-manifest"
    New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
    
    $botId = $outputs.botId.value
    $agentFqdn = $outputs.agentFqdn.value
    
    # Generate manifest.json
    $manifest = @{
        '$schema' = "https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json"
        manifestVersion = "1.17"
        version = "1.0.0"
        id = $botId
        developer = @{
            name = "Your Company"
            websiteUrl = "https://example.com"
            privacyUrl = "https://example.com/privacy"
            termsOfUseUrl = "https://example.com/terms"
        }
        name = @{
            short = $AgentName
            full = "$AgentName - Powered by GitHub Copilot"
        }
        description = @{
            short = $AgentDescription
            full = "$AgentDescription. Built using the Teams Copilot Agent framework."
        }
        icons = @{
            color = "color.png"
            outline = "outline.png"
        }
        accentColor = "#FFFFFF"
        bots = @(
            @{
                botId = $botId
                scopes = @("personal", "team", "groupChat")
                commandLists = @()
                supportsFiles = $false
            }
        )
        permissions = @("identity", "messageTeamMembers")
        validDomains = @($agentFqdn)
    }
    
    $manifest | ConvertTo-Json -Depth 10 | Set-Content "$manifestDir/manifest.json" -Encoding UTF8
    
    # Generate placeholder icons (32x32 color, 32x32 outline)
    # Create simple PNG placeholders using base64
    $colorPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAWElEQVRYR+3WwQkAIAwF0d77X3qz0IM/EEER3DMJJC8FJKfnJ9f/6AH4D+ADXDVw5wK4cwHcuQDuXAB3LoA7F8CdC+DOBXDnArhzAdy5AO5cAHcuwO8N3AHcICEhAE8N9gAAAABJRU5ErkJggg=="
    $outlinePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAUElEQVRYR+3WsQkAIAxF0b//pTuIuIAOYCFYWliI/oSQQOAVCST/9Prn+h89AP8BfICrBu5cAHcugDsXwJ0L4M4FcOcCuHMB3LkA7lwAdy7A7w3cATA0ISEbMh0nAAAAAElFTkSuQmCC"
    
    [System.IO.File]::WriteAllBytes("$manifestDir/color.png", [System.Convert]::FromBase64String($colorPngBase64))
    [System.IO.File]::WriteAllBytes("$manifestDir/outline.png", [System.Convert]::FromBase64String($outlinePngBase64))
    
    # Create ZIP file
    $zipPath = "output/$BaseName-teams-manifest.zip"
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
    }
    Compress-Archive -Path "$manifestDir/*" -DestinationPath $zipPath
    
    Write-Host "`nTeams App Manifest generated!" -ForegroundColor Green
    Write-Host "  Manifest JSON: $manifestDir/manifest.json" -ForegroundColor White
    Write-Host "  ZIP Package: $zipPath" -ForegroundColor White
    
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "DEPLOYMENT COMPLETE!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Yellow
    Write-Host "1. Test the health endpoint:" -ForegroundColor Yellow
    Write-Host "   curl $($outputs.agentHealthUrl.value)" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Upload the Teams manifest to Teams Admin Center:" -ForegroundColor Yellow
    Write-Host "   - Go to https://admin.teams.microsoft.com" -ForegroundColor White
    Write-Host "   - Navigate to Teams apps > Manage apps > Upload" -ForegroundColor White
    Write-Host "   - Upload: $zipPath" -ForegroundColor White
    Write-Host ""
    Write-Host "3. Or sideload in Teams:" -ForegroundColor Yellow
    Write-Host "   - Open Teams > Apps > Manage your apps" -ForegroundColor White
    Write-Host "   - Click 'Upload an app' > 'Upload a custom app'" -ForegroundColor White
    Write-Host "   - Select: $zipPath" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host "`nManifest generation skipped" -ForegroundColor Yellow
}

Write-Host "`nDone!" -ForegroundColor Green