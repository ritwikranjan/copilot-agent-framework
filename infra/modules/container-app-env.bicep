// Container App Environment module
// Creates a Container Apps Environment with VNet integration and optional NFS storage

@description('Name of the Container App Environment')
param name string

@description('Location for resources')
param location string

@description('Subnet ID for VNet integration')
param subnetId string

@description('Tags for resources')
param tags object = {}

// NFS Storage configuration (optional)
@description('Enable NFS storage for session persistence')
param enableNfsStorage bool = false

@description('NFS storage account name (required if enableNfsStorage is true)')
param nfsStorageAccountName string = ''

@description('NFS file share name')
param nfsShareName string = 'copilot-sessions'

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${name}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource env 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    vnetConfiguration: {
      infrastructureSubnetId: subnetId
      internal: false
    }
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
    zoneRedundant: false
  }
}

// NFS Azure Files storage for session persistence
// Note: Using 2024-02-02-preview API for NFS support
// shareName must be in format '/<accountName>/<fileShareName>'
resource nfsStorage 'Microsoft.App/managedEnvironments/storages@2024-02-02-preview' = if (enableNfsStorage) {
  parent: env
  name: 'session-state'
  properties: {
    nfsAzureFile: {
      server: '${nfsStorageAccountName}.file.${environment().suffixes.storage}'
      shareName: '/${nfsStorageAccountName}/${nfsShareName}'
      accessMode: 'ReadWrite'
    }
  }
}

@description('The resource ID of the Container App Environment')
output id string = env.id

@description('The name of the Container App Environment')
output name string = env.name

@description('The default domain of the Container App Environment')
output defaultDomain string = env.properties.defaultDomain

@description('The static IP of the Container App Environment')
output staticIp string = env.properties.staticIp
