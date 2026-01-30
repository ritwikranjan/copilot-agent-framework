// Azure Files NFS Storage module for session persistence
// Creates a Premium FileStorage account with NFS share for Copilot CLI session state
// Supports horizontal scaling by sharing session state across multiple CLI replicas

@description('Name of the storage account (must be globally unique)')
param storageAccountName string

@description('Location for resources')
param location string

@description('Name of the NFS file share')
param shareName string = 'copilot-sessions'

@description('Share quota in GB')
param shareQuotaGB int = 100

@description('VNet ID for private endpoint')
param vnetId string

@description('Subnet ID for private endpoint')
param subnetId string

@description('Subnet ID to allow in network rules (Container Apps subnet)')
param allowedSubnetId string

@description('Tags for resources')
param tags object = {}

// Premium FileStorage account (required for NFS)
// Storage suffix for environment compatibility (Azure Commercial, Government, China clouds)
var storageSuffix = environment().suffixes.storage

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  tags: tags
  kind: 'FileStorage'
  sku: {
    name: 'Premium_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: false  // NFS requires HTTP (uses TCP, not HTTPS)
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false      // Use managed identity auth
    largeFileSharesState: 'Enabled'
    networkAcls: {
      defaultAction: 'Deny'
      bypass: 'AzureServices'
      virtualNetworkRules: [
        {
          id: allowedSubnetId
          action: 'Allow'
        }
      ]
    }
  }
}

// NFS file share for session state
resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  name: '${storageAccount.name}/default/${shareName}'
  properties: {
    shareQuota: shareQuotaGB
    enabledProtocols: 'NFS'
    rootSquash: 'NoRootSquash'
  }
}

// Private DNS Zone for Azure Files
// Using environment-specific suffix for cloud compatibility
var privateDnsZoneName = 'privatelink.file.${storageSuffix}'

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: privateDnsZoneName
  location: 'global'
  tags: tags
}

// Link DNS zone to VNet
resource vnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: '${storageAccountName}-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetId
    }
  }
}

// Private endpoint for NFS storage
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-04-01' = {
  name: '${storageAccountName}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: '${storageAccountName}-connection'
        properties: {
          privateLinkServiceId: storageAccount.id
          groupIds: [
            'file'
          ]
        }
      }
    ]
  }
}

// DNS zone group for automatic DNS registration
resource privateDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-04-01' = {
  parent: privateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'privatelink-file-core-windows-net'
        properties: {
          privateDnsZoneId: privateDnsZone.id
        }
      }
    ]
  }
}

@description('Storage account name')
output storageAccountName string = storageAccount.name

@description('Storage account ID')
output storageAccountId string = storageAccount.id

@description('File share name')
output fileShareName string = shareName

@description('NFS mount path (for Container Apps)')
output nfsMountServer string = '${storageAccount.name}.file.${storageSuffix}'

@description('NFS mount share path')
output nfsMountPath string = '/${storageAccount.name}/${shareName}'
