// Private DNS Zone A Record Module
// Creates an A record in an existing private DNS zone

@description('Name of the private DNS zone')
param zoneName string

@description('Name of the A record (use * for wildcard)')
param recordName string

@description('IPv4 address for the A record')
param ipv4Address string

@description('TTL in seconds')
param ttl int = 300

// Reference the existing private DNS zone
resource privateDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' existing = {
  name: zoneName
}

// Create the A record
resource aRecord 'Microsoft.Network/privateDnsZones/A@2020-06-01' = {
  parent: privateDnsZone
  name: recordName
  properties: {
    ttl: ttl
    aRecords: [
      {
        ipv4Address: ipv4Address
      }
    ]
  }
}

@description('The fully qualified domain name of the A record')
output fqdn string = '${recordName}.${zoneName}'
