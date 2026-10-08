// Diagnostic for "AppDefinitionDoesntExist" on chat bot install (README.md section 6b).
// Read-only: looks up the Case Swarm app in the tenant catalog and compares what Graph
// returns against Teams_Bot_Config__mdt.Default.Teams_App_Catalog_Id__c.
// Run: sf apex run --file scripts/apex/findTeamsAppCatalogId.apex -o devOrg

String configuredId = Teams_Bot_Config__mdt.getInstance('Default')?.Teams_App_Catalog_Id__c;
String manifestId = 'eb3d87b4-15ab-4268-8a5e-0a25650ff8e7';
System.debug('Configured Teams_App_Catalog_Id__c: ' + configuredId);

// 1. Does the configured id resolve at all?
HttpRequest byId = new HttpRequest();
byId.setEndpoint('callout:MS_Graph/v1.0/appCatalogs/teamsApps/' + configuredId);
byId.setMethod('GET');
byId.setTimeout(60000);
HttpResponse byIdRes = new Http().send(byId);
System.debug('GET by configured id -> ' + byIdRes.getStatusCode() + ' ' + byIdRes.getBody());

// 2. What id does the catalog actually have for this manifest?
HttpRequest byExternal = new HttpRequest();
byExternal.setEndpoint(
    'callout:MS_Graph/v1.0/appCatalogs/teamsApps?$filter=externalId+eq+\'' + manifestId + '\'&$expand=appDefinitions'
);
byExternal.setMethod('GET');
byExternal.setTimeout(60000);
HttpResponse byExternalRes = new Http().send(byExternal);
System.debug('GET by manifest externalId -> ' + byExternalRes.getStatusCode() + ' ' + byExternalRes.getBody());

// 3. Fallback: find it by name, in case the manifest id was regenerated on re-upload.
HttpRequest byName = new HttpRequest();
byName.setEndpoint('callout:MS_Graph/v1.0/appCatalogs/teamsApps?$filter=displayName+eq+\'Case Swarm\'&$expand=appDefinitions');
byName.setMethod('GET');
byName.setTimeout(60000);
HttpResponse byNameRes = new Http().send(byName);
System.debug('GET by displayName -> ' + byNameRes.getStatusCode() + ' ' + byNameRes.getBody());
