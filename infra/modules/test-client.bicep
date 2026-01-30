// Test Client Container App
// Runs test scripts to verify connectivity to CLI server

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

@description('CLI server URL to test against')
param cliServerUrl string

@description('Tags for resources')
param tags object = {}

resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      activeRevisionsMode: 'Single'
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
          name: 'test-client'
          image: containerImage
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'CLI_SERVER_URL'
              value: cliServerUrl
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

@description('The resource ID of the Container App')
output id string = app.id

@description('The name of the Container App')
output name string = app.name
