// Main Bicep template for Copilot Agent Framework
// 4-service architecture: CLI Server, API Service, Teams Bot, Web App
// Plus: VNet, Container App Environment, Cosmos DB, Bot Service

targetScope = 'resourceGroup'

@description('Base name for all resources')
param baseName string = 'copilot-unified'

@description('Location for all resources')
param location string = resourceGroup().location

@description('Name of existing ACR (required)')
param acrName string

@description('Resource group containing the ACR (defaults to current resource group)')
param acrResourceGroup string = resourceGroup().name

@description('CLI Server container image name')
param cliImageName string = 'copilot-cli-server'

@description('CLI Server container image tag')
param cliImageTag string = 'latest'

@description('API Service container image name')
param apiImageName string = 'copilot-api-service'

@description('API Service container image tag')
param apiImageTag string = 'latest'

@description('Teams Copilot Agent container image name')
param agentImageName string = 'teams-copilot-agent'

@description('Teams Copilot Agent container image tag')
param agentImageTag string = 'latest'

@description('Web App container image name')
param webImageName string = 'copilot-web-app'

@description('Web App container image tag')
param webImageTag string = 'latest'

@description('GitHub PAT with Copilot access')
@secure()
param githubToken string

@description('Whether to create a new Azure Bot Service registration')
param createBotService bool = true

@description('TCP port for CLI server')
param cliPort int = 3000

@description('HTTP port for Teams Copilot Agent')
param agentPort int = 3978

@description('Model to use')
param model string = 'gpt-5.2'

@description('Agent name identifier')
param agentName string = 'copilot-api'

@description('Enable serverless Cosmos DB (recommended for dev/test)')
param cosmosServerless bool = true

@description('Azure Tenant ID for bot and identity configuration')
param azureTenantId string

@description('Entra ID Client ID for web app authentication')
param entraClientId string = ''

@description('Minimum replicas for CLI server')
param cliMinReplicas int = 1

@description('Maximum replicas for CLI server')
param cliMaxReplicas int = 3

@description('Object ID of the principal to grant Cosmos DB reader access (for audit data access)')
param cosmosReaderObjectId string = ''

@description('Minimum replicas for Teams Copilot Agent')
param agentMinReplicas int = 1

@description('Maximum replicas for Teams Copilot Agent')
param agentMaxReplicas int = 3

@description('Enable NFS storage for CLI session persistence (enables horizontal scaling)')
param enableSessionStorage bool = true

@description('Tags for all resources')
param tags object = {
  project: 'copilot-unified'
  environment: 'production'
}

// Resource names
var vnetName = '${baseName}-vnet'
var envName = '${baseName}-env'
var cliAppName = '${baseName}-cli'
var apiAppName = '${baseName}-api'
var agentAppName = '${baseName}-agent'
var webAppName = '${baseName}-web'
var cosmosAccountName = '${baseName}-cosmos'
var nfsStorageAccountName = replace('${baseName}nfssa', '-', '')  // Storage account names cannot have hyphens

// Reference existing ACR (may be in different resource group)
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
  scope: resourceGroup(acrResourceGroup)
}

var acrLoginServer = acr.properties.loginServer
var cliContainerImage = '${acrLoginServer}/${cliImageName}:${cliImageTag}'
var apiContainerImage = '${acrLoginServer}/${apiImageName}:${apiImageTag}'
var agentContainerImage = '${acrLoginServer}/${agentImageName}:${agentImageTag}'
var webContainerImage = '${acrLoginServer}/${webImageName}:${webImageTag}'

// Deploy VNet with /16 CIDR
module vnet 'modules/vnet.bicep' = {
  name: 'vnet-deployment'
  params: {
    name: vnetName
    location: location
    addressPrefix: '10.0.0.0/16'
    subnetPrefix: '10.0.0.0/23'
    enableStorageServiceEndpoint: enableSessionStorage
    tags: tags
  }
}

// Deploy NFS storage for CLI session persistence (if enabled)
// Uses Premium FileStorage with NFS protocol for horizontal scaling support
module nfsStorage 'modules/nfs-storage.bicep' = if (enableSessionStorage) {
  name: 'nfs-storage-deployment'
  params: {
    storageAccountName: nfsStorageAccountName
    location: location
    shareName: 'copilot-sessions'
    shareQuotaGB: 100
    vnetId: vnet.outputs.id
    subnetId: vnet.outputs.subnetId
    allowedSubnetId: vnet.outputs.subnetId
    tags: tags
  }
}

// Deploy Container App Environment
// Note: When enableSessionStorage is true, env depends on nfsStorage via the storage account name parameter
module env 'modules/container-app-env.bicep' = {
  name: 'env-deployment'
  params: {
    name: envName
    location: location
    subnetId: vnet.outputs.subnetId
    enableNfsStorage: enableSessionStorage
    nfsStorageAccountName: enableSessionStorage ? nfsStorageAccountName : ''
    nfsShareName: 'copilot-sessions'
    tags: tags
  }
  // Explicit dependency when session storage is enabled
  dependsOn: enableSessionStorage ? [nfsStorage] : []
}

// Deploy CLI Server Container App
module cliApp 'modules/container-app.bicep' = {
  name: 'cli-app-deployment'
  params: {
    name: cliAppName
    location: location
    environmentId: env.outputs.id
    containerImage: cliContainerImage
    acrLoginServer: acrLoginServer
    acrUsername: acr.listCredentials().username
    acrPassword: acr.listCredentials().passwords[0].value
    githubToken: githubToken
    targetPort: cliPort
    minReplicas: cliMinReplicas
    maxReplicas: cliMaxReplicas
    enableSessionStorage: enableSessionStorage
    sessionStorageName: 'session-state'
    azureTenantId: azureTenantId
    azureSubscriptionId: subscription().subscriptionId
    tags: tags
  }
}

// Deploy Cosmos DB for audit (always enabled - required for audit logging)
module cosmosDb 'modules/cosmos-db.bicep' = {
  name: 'cosmos-deployment'
  params: {
    accountName: cosmosAccountName
    location: location
    serverless: cosmosServerless
    tags: tags
  }
}

// Deploy Application Insights for telemetry (throttling, latencies, conversation trends)
module appInsights 'modules/app-insights.bicep' = {
  name: 'appinsights-deployment'
  params: {
    baseName: baseName
    location: location
    tags: tags
  }
}

// Internal CLI URL for API Service to connect
// Using short service name format for Container Apps internal service discovery
var internalCliUrl = '${cliAppName}:${cliPort}'

// Deploy API Service (internal-only, no external endpoint)
module apiApp 'modules/api-service.bicep' = {
  name: 'api-deployment'
  params: {
    name: apiAppName
    location: location
    environmentId: env.outputs.id
    containerImage: apiContainerImage
    acrLoginServer: acrLoginServer
    acrUsername: acr.listCredentials().username
    acrPassword: acr.listCredentials().passwords[0].value
    cliUrl: internalCliUrl
    model: model
    agentName: agentName
    cosmosEndpoint: cosmosDb.outputs.endpoint
    cosmosDatabaseName: cosmosDb.outputs.databaseName
    appInsightsConnectionString: appInsights.outputs.connectionString
    tags: tags
  }
  dependsOn: [
    cliApp
  ]
}

// Internal API URL for Teams Agent and Web App to connect
// Internal API URL using short service name (same Container Apps environment)
// Container Apps internal ingress routes through port 80 by default
var internalApiUrl = 'http://${apiAppName}'

// Deploy Teams Copilot Agent Container App (thin frontend → API service)
module agentApp 'modules/teams-copilot-agent.bicep' = {
  name: 'agent-deployment'
  params: {
    name: agentAppName
    location: location
    environmentId: env.outputs.id
    containerImage: agentContainerImage
    acrLoginServer: acrLoginServer
    acrUsername: acr.listCredentials().username
    acrPassword: acr.listCredentials().passwords[0].value
    apiUrl: internalApiUrl
    appInsightsConnectionString: appInsights.outputs.connectionString
    targetPort: agentPort
    minReplicas: agentMinReplicas
    maxReplicas: agentMaxReplicas
    enableUserAuth: true
    azureTenantId: azureTenantId
    tags: tags
  }
  dependsOn: [
    apiApp
  ]
}

// Deploy Web App (external, Next.js frontend with MSAL auth)
module webApp 'modules/web-app.bicep' = {
  name: 'web-deployment'
  params: {
    name: webAppName
    location: location
    environmentId: env.outputs.id
    containerImage: webContainerImage
    acrLoginServer: acrLoginServer
    acrUsername: acr.listCredentials().username
    acrPassword: acr.listCredentials().passwords[0].value
    apiUrl: internalApiUrl
    entraClientId: entraClientId
    entraTenantId: azureTenantId
    appInsightsConnectionString: appInsights.outputs.connectionString
    tags: tags
  }
  dependsOn: [
    apiApp
  ]
}

// Cosmos DB Role Assignment for API Service Managed Identity
// The API service owns all Cosmos DB access (session + audit stores)
resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  name: guid(cosmosAccountName, apiAppName, 'cosmos-contributor')
  parent: existingCosmosAccount
  properties: {
    roleDefinitionId: resourceId('Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions', cosmosAccountName, '00000000-0000-0000-0000-000000000002') // Built-in Data Contributor
    principalId: apiApp.outputs.systemAssignedIdentityPrincipalId
    scope: cosmosDb.outputs.id
  }
}

// Cosmos DB Role Assignment for additional reader access
// Grant "Cosmos DB Built-in Data Reader" role to the specified object ID for audit data access
resource cosmosReaderRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = if (!empty(cosmosReaderObjectId)) {
  name: guid(cosmosAccountName, cosmosReaderObjectId, 'cosmos-reader')
  parent: existingCosmosAccount
  properties: {
    roleDefinitionId: resourceId('Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions', cosmosAccountName, '00000000-0000-0000-0000-000000000001') // Built-in Data Reader
    principalId: cosmosReaderObjectId
    scope: cosmosDb.outputs.id
  }
}

// Reference existing cosmos account for role assignment
resource existingCosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' existing = {
  name: cosmosAccountName
  dependsOn: [
    cosmosDb
  ]
}

// Deploy Azure Bot Service (if enabled)
module botService 'modules/bot-service.bicep' = if (createBotService) {
  name: 'bot-service-deployment'
  params: {
    baseName: baseName
    messagingEndpoint: agentApp.outputs.messagingEndpoint
    managedIdentityId: agentApp.outputs.managedIdentityId
    managedIdentityClientId: agentApp.outputs.managedIdentityClientId
    tags: tags
  }
}

// Outputs
@description('The CLI URL for SDK clients (internal-only, not accessible from Internet)')
output cliUrl string = cliApp.outputs.cliUrl

@description('The CLI Server FQDN')
output cliAppFqdn string = cliApp.outputs.fqdn

@description('The Teams Copilot Agent Bot URL')
output agentBotUrl string = agentApp.outputs.botUrl

@description('The Teams Copilot Agent FQDN')
output agentFqdn string = agentApp.outputs.fqdn

@description('The Teams Bot Messaging Endpoint (for Bot Framework registration)')
output agentMessagingEndpoint string = agentApp.outputs.messagingEndpoint

@description('The Teams Copilot Agent Health Check URL')
output agentHealthUrl string = agentApp.outputs.healthUrl

@description('The Managed Identity Client ID (for Bot Framework registration)')
output managedIdentityClientId string = agentApp.outputs.managedIdentityClientId

@description('The ACR login server')
output acrLoginServer string = acrLoginServer

@description('The CLI Server App name')
output cliAppName string = cliApp.outputs.name

@description('The Teams Copilot Agent App name')
output agentAppName string = agentApp.outputs.name

@description('The Environment static IP')
output staticIp string = env.outputs.staticIp

@description('Internal CLI URL (used by agents within the same environment)')
output internalCliUrl string = internalCliUrl

@description('CLI Server is internal-only')
output cliIsInternalOnly bool = cliApp.outputs.isInternalOnly

@description('Cosmos DB Endpoint')
output cosmosEndpoint string = cosmosDb.outputs.endpoint

@description('Bot Service ID (same as Managed Identity Client ID)')
output botId string = agentApp.outputs.managedIdentityClientId

@description('Bot Service Name')
#disable-next-line BCP318
output botServiceName string = createBotService ? botService.outputs.botServiceName : 'not-created'

@description('CLI Server System-Assigned Managed Identity Principal ID (for granting access to Azure resources via MCP)')
output cliServerIdentityPrincipalId string = cliApp.outputs.systemAssignedIdentityPrincipalId

@description('NFS Storage Account Name (for session persistence)')
output nfsStorageAccountName string = enableSessionStorage ? nfsStorageAccountName : ''

@description('Application Insights Connection String')
output appInsightsConnectionString string = appInsights.outputs.connectionString

@description('Session storage enabled')
output sessionStorageEnabled bool = enableSessionStorage

@description('API Service internal URL')
output apiInternalUrl string = internalApiUrl

@description('API Service FQDN (internal)')
output apiFqdn string = apiApp.outputs.fqdn

@description('Web App URL')
output webAppUrl string = webApp.outputs.webUrl

@description('Web App FQDN')
output webAppFqdn string = webApp.outputs.fqdn
