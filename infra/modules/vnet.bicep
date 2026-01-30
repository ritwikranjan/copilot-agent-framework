// Virtual Network module for Container Apps
// Creates a VNet with a subnet for Container Apps Environment
// Includes service endpoints for Azure Storage (required for NFS)

@description('Name of the VNet')
param name string

@description('Location for resources')
param location string

@description('Address prefix for VNet (CIDR)')
param addressPrefix string = '10.0.0.0/16'

@description('Address prefix for Container Apps subnet (CIDR)')
param subnetPrefix string = '10.0.0.0/23'

@description('Tags for resources')
param tags object = {}

@description('Enable Microsoft.Storage service endpoint for NFS storage')
param enableStorageServiceEndpoint bool = false

resource vnet 'Microsoft.Network/virtualNetworks@2023-04-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [
        addressPrefix
      ]
    }
    subnets: [
      {
        name: 'container-apps'
        properties: {
          addressPrefix: subnetPrefix
          serviceEndpoints: enableStorageServiceEndpoint ? [
            {
              service: 'Microsoft.Storage'
              locations: [
                location
              ]
            }
          ] : []
        }
      }
    ]
  }
}

@description('The resource ID of the VNet')
output id string = vnet.id

@description('The name of the VNet')
output name string = vnet.name

@description('The resource ID of the Container Apps subnet')
output subnetId string = vnet.properties.subnets[0].id
