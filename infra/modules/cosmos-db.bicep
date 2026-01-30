// Cosmos DB module for Audit Logging
// Creates a Cosmos DB account with SQL API and AAD-only authentication

@description('Cosmos DB account name')
param accountName string

@description('Location for resources')
param location string

@description('Enable serverless mode (recommended for dev/test)')
param serverless bool = true

@description('Tags for resources')
param tags object = {}

var databaseName = 'AuditDB'

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: accountName
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: serverless ? [
      {
        name: 'EnableServerless'
      }
    ] : []
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true // AAD-only authentication
    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
    publicNetworkAccess: 'Enabled'
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: databaseName
  properties: {
    resource: {
      id: databaseName
    }
  }
}

@description('The resource ID of the Cosmos DB account')
output id string = cosmosAccount.id

@description('The name of the Cosmos DB account')
output name string = cosmosAccount.name

@description('The Cosmos DB endpoint')
output endpoint string = cosmosAccount.properties.documentEndpoint

@description('The database name')
output databaseName string = databaseName
