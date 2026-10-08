# Azure SignalR setup (Option D)

> **Full end-to-end guide (app settings, deploy, Salesforce, smoke tests):**  
> see [`full-relay-setup.md`](./full-relay-setup.md) — tailored to Function App `case-swarm-relay-sfchatsync`.

Provision once per environment, then wire the Function App.


## 1. Create SignalR Service

```bash
# Same region as the Function App. Use Standard for shared/prod (Free ≈ 20 connections).
az signalr create \
  --name <signalr-name> \
  --resource-group <rg> \
  --sku Standard_S1 \
  --unit-count 1 \
  --service-mode Serverless
```

## 2. Connection string → Function App

```bash
CONN=$(az signalr key list -n <signalr-name> -g <rg> --query primaryConnectionString -o tsv)
az functionapp config appsettings set \
  -n <function-app-name> -g <rg> \
  --settings AzureSignalRConnectionString="$CONN"
```

Local: copy `local.settings.json.example` → `local.settings.json` and set `AzureSignalRConnectionString`.
SignalR bindings also need `AzureWebJobsStorage` (Azurite locally).

## 3. Verify

- Function App `host.json` extension bundle is `[4.*, 5.0.0)` (includes SignalR).
- After deploy, `POST /api/negotiate?chatId=...` with a valid HMAC returns `{ url, accessToken }`.

## 4. Salesforce

- Set `Use_Azure_Chat_Bridge__c = true` and `Use_Azure_SignalR__c = true`.
- CSP Trusted Sites: Function App URL + `https://*.service.signalr.net` (connect-src).
