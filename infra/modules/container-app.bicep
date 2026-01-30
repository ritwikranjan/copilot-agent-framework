// Container App module for CLI Server
// Creates a Container App for the Copilot CLI Server (internal TCP endpoint)
// Supports NFS storage for session persistence across replicas

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

@description('GitHub token for Copilot')
@secure()
param githubToken string

@description('Target port for the container')
param targetPort int = 3000

@description('Minimum replicas')
param minReplicas int = 1

@description('Maximum replicas')
param maxReplicas int = 3

@description('Tags for resources')
param tags object = {}

@description('Azure Tenant ID')
param azureTenantId string

@description('Azure Subscription ID')
param azureSubscriptionId string

// Session storage configuration
@description('Enable NFS session storage for scaling support')
param enableSessionStorage bool = false

@description('Environment storage name for NFS mount')
param sessionStorageName string = 'session-state'

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      ingress: {
        external: false
        targetPort: targetPort
        transport: 'tcp'
        exposedPort: targetPort
      }
      secrets: [
        {
          name: 'acr-password'
          value: acrPassword
        }
        {
          name: 'github-token'
          value: githubToken
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
          name: 'cli-server'
          image: containerImage
          resources: {
            cpu: json('1')
            memory: '2Gi'
          }
          env: [
            {
              name: 'COPILOT_GITHUB_TOKEN'
              secretRef: 'github-token'
            }
            {
              name: 'AZURE_TOKEN_CREDENTIALS'
              value: 'prod'
            }
            {
              name: 'AZURE_TENANT_ID'
              value: azureTenantId
            }
            {
              name: 'AZURE_SUBSCRIPTION_ID'
              value: azureSubscriptionId
            }
          ]
          probes: [
            {
              type: 'Liveness'
              failureThreshold: 3
              periodSeconds: 10
              successThreshold: 1
              tcpSocket: {
                port: targetPort
              }
              timeoutSeconds: 5
            }
            {
              type: 'Readiness'
              failureThreshold: 48
              periodSeconds: 5
              successThreshold: 1
              tcpSocket: {
                port: targetPort
              }
              timeoutSeconds: 5
            }
            {
              type: 'Startup'
              failureThreshold: 240
              initialDelaySeconds: 1
              periodSeconds: 1
              successThreshold: 1
              tcpSocket: {
                port: targetPort
              }
              timeoutSeconds: 3
            }
          ]
          volumeMounts: enableSessionStorage ? [
            {
              volumeName: 'copilot-sessions'
              mountPath: '/root/.copilot/session-state'
            }
          ] : []
        }
      ]
      volumes: enableSessionStorage ? [
        {
          name: 'copilot-sessions'
          storageName: sessionStorageName
          storageType: 'NfsAzureFile'
        }
      ] : []
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

@description('The CLI URL (internal)')
output cliUrl string = '${name}:${targetPort}'

@description('Whether the app is internal-only')
output isInternalOnly bool = !containerApp.properties.configuration.ingress.external

@description('The System-Assigned Managed Identity Principal ID (for granting access to Azure resources via MCP)')
output systemAssignedIdentityPrincipalId string = containerApp.identity.principalId
