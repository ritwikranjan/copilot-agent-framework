// Application Insights module
// Creates a Log Analytics Workspace and Application Insights resource

@description('Base name for resources')
param baseName string

@description('Location for resources')
param location string

@description('Log retention in days')
param retentionInDays int = 30

@description('Tags for resources')
param tags object = {}

// Log Analytics Workspace (required backend for App Insights)
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${baseName}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
  }
}

// Application Insights
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${baseName}-appinsights'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
  }
}

@description('Application Insights connection string')
output connectionString string = appInsights.properties.ConnectionString

@description('Application Insights instrumentation key')
output instrumentationKey string = appInsights.properties.InstrumentationKey

@description('Application Insights resource ID')
output id string = appInsights.id

@description('Log Analytics Workspace ID')
output workspaceId string = logAnalyticsWorkspace.id
