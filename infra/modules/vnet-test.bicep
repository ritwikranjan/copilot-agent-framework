// Virtual Network for Test Infrastructure
// Creates multiple subnets for CLI server, test client, and private endpoints

@description('Name of the virtual network')
param name string

@description('Location for resources')
param location string = resourceGroup().location

@description('Address prefix for the VNet')
param addressPrefix string = '10.0.0.0/16'

@description('Tags for resources')
param tags object = {}

resource vnet 'Microsoft.Network/virtualNetworks@2023-05-01' = {
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
        name: 'cli-server'
        properties: {
          addressPrefix: '10.0.0.0/23'
          // No delegation - Container Apps Environment will add it
        }
      }
      {
        name: 'test-client'
        properties: {
          addressPrefix: '10.0.4.0/23'
          // No delegation - Container Apps Environment will add it
        }
      }
      {
        name: 'endpoints'
        properties: {
          addressPrefix: '10.0.8.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

@description('The resource ID of the VNet')
output id string = vnet.id

@description('The name of the VNet')
output name string = vnet.name

@description('The resource ID of the CLI server subnet')
output cliServerSubnetId string = vnet.properties.subnets[0].id

@description('The resource ID of the test client subnet')
output testClientSubnetId string = vnet.properties.subnets[1].id

@description('The resource ID of the endpoints subnet')
output endpointsSubnetId string = vnet.properties.subnets[2].id
