using 'main.bicep'

// Base name for all resources
param baseName = 'copilot-unified'

// Existing ACR name (required)
param acrName = ''

// Resource group containing the ACR (defaults to current resource group)
// param acrResourceGroup = ''

// CLI Server container image settings
param cliImageName = 'copilot-cli-server'
param cliImageTag = 'latest'

// Teams Copilot Agent container image settings
param agentImageName = 'teams-copilot-agent'
param agentImageTag = 'latest'

// GitHub token - MUST be provided at deployment time
// Use: az deployment group create ... --parameters githubToken='your-token'
param githubToken = ''

// Whether to create a new Azure Bot Service registration
param createBotService = true

// TCP port for CLI server
param cliPort = 3000

// HTTP port for Teams Copilot Agent
param agentPort = 3978

// Model to use
param model = 'gpt-4.1'

// Agent name identifier
param agentName = 'teams-copilot-agent'

// Enable serverless Cosmos DB (recommended for dev/test)
param cosmosServerless = true

// Azure Tenant ID - MUST be provided at deployment time
param azureTenantId = ''

// Object ID for Cosmos DB reader role (leave empty to skip)
param cosmosReaderObjectId = ''

// Scaling settings for CLI server
param cliMinReplicas = 1
param cliMaxReplicas = 3

// Scaling settings for Teams Copilot Agent
param agentMinReplicas = 1
param agentMaxReplicas = 3

// Enable NFS storage for CLI session persistence (enables horizontal scaling)
param enableSessionStorage = true

// Tags
param tags = {
  project: 'copilot-unified'
  environment: 'production'
}
