// Teams Copilot Agent Container App module
// Creates a Container App for the Teams Bot with Managed Identity

@description('Name of the Container App')
param name string

@description('Location for resources')
param location string

@description('Container App Environment ID')
param environmentId string

@description('Container image to deploy')
param containerImage string

@description('ACR login server')
param acrLoginServer string

@description('ACR username')
param acrUsername string

@description('ACR password')
@secure()
param acrPassword string

@description('CLI Server URL (internal)')
param cliUrl string

@description('Cosmos DB endpoint')
param cosmosEndpoint string

@description('Cosmos DB database name')
param cosmosDatabase string

@description('Model to use')
param model string = 'gpt-4.1'

@description('Agent name')
param agentName string = 'teams-copilot-agent'

@description('Target port for the container')
param targetPort int = 3978

@description('Minimum replicas')
param minReplicas int = 1

@description('Maximum replicas')
param maxReplicas int = 3

@description('Use User Authentication')
param enableUserAuth bool = true

@description('Azure Tenant ID')
param azureTenantId string

@description('Tags for resources')
param tags object = {}

// Create User-Assigned Managed Identity
resource managedIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${name}-identity'
  location: location
  tags: tags
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'http'
        allowInsecure: false
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
          name: 'teams-agent'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'CLI_URL'
              value: cliUrl
            }
            {
              name: 'MODEL'
              value: model
            }
            {
              name: 'AGENT_NAME'
              value: agentName
            }
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'ENABLE_AUDIT'
              value: 'true'
            }
            {
              name: 'COSMOS_ENDPOINT'
              value: cosmosEndpoint
            }
            {
              name: 'COSMOS_DATABASE_NAME'
              value: cosmosDatabase
            }
            {
              name: 'BOT_ID'
              value: managedIdentity.properties.clientId
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: managedIdentity.properties.clientId
            }
            {
              name: 'USER_ASSIGNED_MSI_CLIENT_ID'
              value: managedIdentity.properties.clientId
            }
            {
              name: 'ENABLE_USER_AUTH'
              value: string(enableUserAuth)
            }
            {
              name: 'AZURE_TENANT_ID'
              value: azureTenantId
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

@description('The resource ID of the Container App')
output id string = containerApp.id

@description('The name of the Container App')
output name string = containerApp.name

@description('The FQDN of the Container App')
output fqdn string = containerApp.properties.configuration.ingress.fqdn

@description('The Bot URL')
output botUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'

@description('The Teams Bot Messaging Endpoint')
output messagingEndpoint string = 'https://${containerApp.properties.configuration.ingress.fqdn}/api/messages'

@description('The Health Check URL')
output healthUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}/health'

@description('The Managed Identity resource ID')
output managedIdentityId string = managedIdentity.id

@description('The Managed Identity Client ID (Bot ID)')
output managedIdentityClientId string = managedIdentity.properties.clientId

@description('The Managed Identity Principal ID')
output managedIdentityPrincipalId string = managedIdentity.properties.principalId
