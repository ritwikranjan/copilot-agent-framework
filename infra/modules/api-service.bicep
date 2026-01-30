// API Service Container App
// Deploys a Copilot-powered API service with Azure AD authentication

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

@description('Azure AD Tenant ID')
param azureTenantId string = 'common'

@description('Azure AD Client ID for token validation')
param azureClientId string

@description('Azure AD Audience for token validation')
param azureAudience string = ''

@description('Required role for authorization (optional)')
param requiredRole string = ''

@description('HTTP port to expose')
param targetPort int = 8080

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

// Compute audience if not provided
var effectiveAudience = !empty(azureAudience) ? azureAudience : 'api://${azureClientId}'

resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: location
  tags: tags
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
        corsPolicy: {
          allowedOrigins: ['*']
          allowedMethods: ['GET', 'POST', 'OPTIONS']
          allowedHeaders: ['*']
          maxAge: 3600
        }
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
            cpu: json(cpu)
            memory: memory
          }
          env: [
            {
              name: 'CLI_URL'
              value: cliUrl
            }
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'AZURE_TENANT_ID'
              value: azureTenantId
            }
            {
              name: 'AZURE_CLIENT_ID'
              value: azureClientId
            }
            {
              name: 'AZURE_AUDIENCE'
              value: effectiveAudience
            }
            {
              name: 'REQUIRED_ROLE'
              value: requiredRole
            }
            {
              name: 'NODE_ENV'
              value: 'production'
            }
            {
              name: 'LOG_LEVEL'
              value: 'warn'
            }
          ]
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

@description('The name of the Container App')
output name string = app.name

@description('The FQDN of the Container App')
output fqdn string = app.properties.configuration.ingress.fqdn

@description('The full URL of the API service')
output apiUrl string = 'https://${app.properties.configuration.ingress.fqdn}'

@description('The health check URL')
output healthUrl string = 'https://${app.properties.configuration.ingress.fqdn}/health'
