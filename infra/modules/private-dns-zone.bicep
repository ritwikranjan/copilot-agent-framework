// Private DNS Zone for Container Apps
// Required for internal Container App Environment name resolution

@description('Name of the Private DNS Zone')
param zoneName string = 'privatelink.azurecontainerapps.io'

@description('Resource ID of the VNet to link')
param vnetId string

@description('Name of the VNet link')
param vnetLinkName string

@description('Tags for resources')
param tags object = {}

resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: zoneName
  location: 'global'
  tags: tags
}

resource vnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: privateDnsZone
  name: vnetLinkName
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetId
    }
  }
}

@description('The resource ID of the Private DNS Zone')
output id string = privateDnsZone.id

@description('The name of the Private DNS Zone')
output name string = privateDnsZone.name
