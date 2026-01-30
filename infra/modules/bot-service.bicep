// Azure Bot Service module
// Creates an Azure Bot Service registration for Teams integration

@description('Base name for resources')
param baseName string

@description('The messaging endpoint for the bot')
param messagingEndpoint string

@description('The Managed Identity resource ID')
param managedIdentityId string

@description('The Managed Identity Client ID')
param managedIdentityClientId string

@description('Tags for resources')
param tags object = {}

resource botService 'Microsoft.BotService/botServices@2022-09-15' = {
  name: '${baseName}-bot'
  location: 'global'
  tags: tags
  kind: 'azurebot'
  sku: {
    name: 'F0' // Free tier
  }
  properties: {
    displayName: baseName
    endpoint: messagingEndpoint
    msaAppType: 'UserAssignedMSI'
    msaAppId: managedIdentityClientId
    msaAppMSIResourceId: managedIdentityId
    msaAppTenantId: subscription().tenantId
  }
}

// Enable Teams channel
resource teamsChannel 'Microsoft.BotService/botServices/channels@2022-09-15' = {
  parent: botService
  name: 'MsTeamsChannel'
  location: 'global'
  properties: {
    channelName: 'MsTeamsChannel'
    properties: {
      enableCalling: false
      isEnabled: true
    }
  }
}

@description('The Bot Service name')
output botServiceName string = botService.name

@description('The Bot Service resource ID')
output botServiceId string = botService.id
