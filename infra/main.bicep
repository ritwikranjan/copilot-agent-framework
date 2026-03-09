// Main Bicep template for Unified Teams Copilot Agent
// Deploys: VNet, Container App Environment, CLI Server, Teams Copilot Agent, Cosmos DB (always enabled)

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

@description('Teams Copilot Agent container image name')
param agentImageName string = 'teams-copilot-agent'

@description('Teams Copilot Agent container image tag')
param agentImageTag string = 'latest'

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
param model string = 'gpt-4.1'

@description('Agent name identifier')
param agentName string = 'teams-copilot-agent'

@description('Enable serverless Cosmos DB (recommended for dev/test)')
param cosmosServerless bool = true

@description('Azure Tenant ID for bot and identity configuration')
param azureTenantId string

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
var agentAppName = '${baseName}-agent'
var cosmosAccountName = '${baseName}-cosmos'
var nfsStorageAccountName = replace('${baseName}nfssa', '-', '')  // Storage account names cannot have hyphens

// Reference existing ACR (may be in different resource group)
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
  scope: resourceGroup(acrResourceGroup)
}

var acrLoginServer = acr.properties.loginServer
var cliContainerImage = '${acrLoginServer}/${cliImageName}:${cliImageTag}'
var agentContainerImage = '${acrLoginServer}/${agentImageName}:${agentImageTag}'

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

// Internal CLI URL for Teams Agent to connect
// Using short service name format for Container Apps internal service discovery
var internalCliUrl = '${cliAppName}:${cliPort}'

// Deploy Teams Copilot Agent Container App
// The managed identity client ID is automatically used as the Bot ID
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
    cliUrl: internalCliUrl
    cosmosEndpoint: cosmosDb.outputs.endpoint
    cosmosDatabase: cosmosDb.outputs.databaseName
    model: model
    agentName: agentName
    targetPort: agentPort
    minReplicas: agentMinReplicas
    maxReplicas: agentMaxReplicas
    enableUserAuth: true
    azureTenantId: azureTenantId
    tags: tags
  }
  dependsOn: [
    cliApp
  ]
}

// Cosmos DB Role Assignment for Managed Identity
// Grant "Cosmos DB Built-in Data Contributor" role to the agent's managed identity
resource cosmosRoleAssignment 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2023-11-15' = {
  name: guid(cosmosAccountName, agentAppName, 'cosmos-contributor')
  parent: existingCosmosAccount
  properties: {
    roleDefinitionId: resourceId('Microsoft.DocumentDB/databaseAccounts/sqlRoleDefinitions', cosmosAccountName, '00000000-0000-0000-0000-000000000002') // Built-in Data Contributor
    principalId: agentApp.outputs.managedIdentityPrincipalId
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

@description('Session storage enabled')
output sessionStorageEnabled bool = enableSessionStorage
