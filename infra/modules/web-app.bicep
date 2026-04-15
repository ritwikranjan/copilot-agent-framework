// Web App Container App
// Next.js frontend with MSAL auth (external ingress)

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

@description('Internal API service URL')
param apiUrl string

@description('Entra ID Client ID for MSAL')
param entraClientId string

@description('Entra ID Tenant ID (microsoft.com)')
param entraTenantId string

@description('Application Insights connection string')
param appInsightsConnectionString string = ''

@description('Tags for resources')
param tags object = {}

@description('Minimum number of replicas')
param minReplicas int = 1

@description('Maximum number of replicas')
param maxReplicas int = 3

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3001
        transport: 'http'
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
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
          name: 'web-app'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'API_URL', value: apiUrl }
            { name: 'PORT', value: '3001' }
            { name: 'NEXT_PUBLIC_ENTRA_CLIENT_ID', value: entraClientId }
            { name: 'NEXT_PUBLIC_ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'ENTRA_CLIENT_ID', value: entraClientId }
            { name: 'ENTRA_TENANT_ID', value: entraTenantId }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
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

@description('The FQDN of the Web App')
output fqdn string = app.properties.configuration.ingress.fqdn

@description('The full URL of the Web App')
output webUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
