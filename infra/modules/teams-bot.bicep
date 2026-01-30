// Teams Bot Container App
// Deploys a Microsoft Teams Bot that connects to the Custom Agent API

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

@description('URL of the Custom Agent API service')
param apiServiceUrl string

@description('Microsoft Bot Framework App ID')
param botId string

@description('Microsoft Bot Framework App Password (optional if using Managed Identity)')
@secure()
param botPassword string = ''

@description('Use Managed Identity for authentication (recommended)')
param useManagedIdentity bool = true

@description('Azure Tenant ID (required for Managed Identity)')
param azureTenantId string = ''

@description('Optional: Auth token for API service (for testing)')
@secure()
param apiAuthToken string = ''

@description('HTTP port to expose')
param targetPort int = 3978

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Maximum number of replicas')
param maxReplicas int = 3

@description('CPU allocation')
param cpu string = '0.5'

@description('Memory allocation')
param memory string = '1Gi'

@description('Tags for resources')
param tags object = {}

// Build secrets array - conditionally include API auth token
var baseSecrets = [
  {
    name: 'acr-password'
    value: acrPassword
  }
  {
    name: 'bot-password'
    value: botPassword
  }
]

var apiTokenSecret = !empty(apiAuthToken) ? [
  {
    name: 'api-auth-token'
    value: apiAuthToken
  }
] : []

var secrets = concat(baseSecrets, apiTokenSecret)

// Build env vars - conditionally include API auth token and Managed Identity settings
var baseEnvVars = [
  {
    name: 'API_SERVICE_URL'
    value: apiServiceUrl
  }
  {
    name: 'PORT'
    value: string(targetPort)
  }
  {
    name: 'BOT_ID'
    value: botId
  }
  {
    name: 'BOT_PASSWORD'
    secretRef: 'bot-password'
  }
  {
    name: 'USE_MANAGED_IDENTITY'
    value: useManagedIdentity ? 'true' : 'false'
  }
  {
    name: 'AZURE_TENANT_ID'
    value: azureTenantId
  }
  {
    name: 'API_AUTH_SCOPE'
    value: 'api://${botId}/copilotApi'
  }
  {
    name: 'NODE_ENV'
    value: 'production'
  }
]

var apiTokenEnvVar = !empty(apiAuthToken) ? [
  {
    name: 'API_AUTH_TOKEN'
    secretRef: 'api-auth-token'
  }
] : []

var envVars = concat(baseEnvVars, apiTokenEnvVar)

resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: location
  tags: tags
  identity: useManagedIdentity ? {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', botId)}': {}
    }
  } : {
    type: 'None'
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'http'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: secrets
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
          name: 'teams-bot'
          image: containerImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: envVars
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: targetPort
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
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
                concurrentRequests: '50'
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

@description('The name of the Container App')
output name string = app.name

@description('The FQDN of the Container App')
output fqdn string = app.properties.configuration.ingress.fqdn

@description('The full URL of the Teams Bot service')
output botUrl string = 'https://${app.properties.configuration.ingress.fqdn}'

@description('The Bot Framework messaging endpoint')
output messagingEndpoint string = 'https://${app.properties.configuration.ingress.fqdn}/api/messages'

@description('The health check URL')
output healthUrl string = 'https://${app.properties.configuration.ingress.fqdn}/health'
