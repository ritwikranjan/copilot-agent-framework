// API Service Container App
// Internal-only HTTP service that owns copilot interaction, session, and audit.
// No external ingress — only accessible within the VNet by Teams bot and Web app.

@description('Name of the Container App')
param name string

@description('Location for resources')
param location string = resourceGroup().location

@description('Resource ID of the Container App Environment')
param environmentId string

@description('Container image to deploy')
param containerImage string

@description('ACR login server')
param acrLoginServer string

@description('ACR username')
@secure()
param acrUsername string

@description('ACR password')
@secure()
param acrPassword string

@description('CLI URL for Copilot SDK (internal URL of copilot-cli-server)')
param cliUrl string

@description('Model to use')
param model string = 'gpt-5.2'

@description('Agent name')
param agentName string = 'copilot-api'

@description('Cosmos DB endpoint (empty = in-memory stores)')
param cosmosEndpoint string = ''

@description('Cosmos DB database name')
param cosmosDatabaseName string = 'AuditDB'

@description('User-assigned managed identity client ID for Cosmos DB')
param userAssignedMsiClientId string = ''

@description('Application Insights connection string')
param appInsightsConnectionString string = ''

@description('HTTP port to expose')
param targetPort int = 4000

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Maximum number of replicas')
param maxReplicas int = 3

@description('Tags for resources')
param tags object = {}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: false  // Internal only — not exposed to the internet
        targetPort: targetPort
        transport: 'http'
      }
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
      ]
      registries: [
        {
          server: acrLoginServer
          username: acrUsername
          passwordSecretRef: 'acr-password'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api-service'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'CLI_URL', value: cliUrl }
            { name: 'PORT', value: string(targetPort) }
            { name: 'MODEL', value: model }
            { name: 'AGENT_NAME', value: agentName }
            { name: 'ENABLE_AUDIT', value: !empty(cosmosEndpoint) ? 'true' : 'false' }
            { name: 'COSMOS_ENDPOINT', value: cosmosEndpoint }
            { name: 'COSMOS_DATABASE_NAME', value: cosmosDatabaseName }
            { name: 'USER_ASSIGNED_MSI_CLIENT_ID', value: userAssignedMsiClientId }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health'
                port: targetPort
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: targetPort
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '100'
              }
            }
          }
        ]
      }
    }
  }
}

@description('The resource ID of the Container App')
output id string = app.id

@description('The FQDN of the API service (internal)')
output fqdn string = app.properties.configuration.ingress.fqdn

@description('The internal URL of the API service')
output internalUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
