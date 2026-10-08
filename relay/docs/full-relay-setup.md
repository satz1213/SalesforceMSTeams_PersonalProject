# Case Swarm Azure Relay — full setup (your environment)

Tailored to the resources already in your Azure subscription.

## What you already have

| Resource | Value |
| --- | --- |
| Subscription | `Azure subscription 1` (`faf0597c-2872-4dce-8815-78ff4bbe042d`) |
| Resource group | `case-swarm-relay-sfchatsync_group` (Canada Central) |
| Function App | `case-swarm-relay-sfchatsync` (**Running**) |
| Function URL | `https://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net` |
| Salesforce CMDT base URL | same as Function URL (already set) |
| SignalR Service | **`case-swarm-signalr`** (`case-swarm-signalr.service.signalr.net`) — Free_F1 Serverless, created |

Older Function App `sfCaseTeamFunction` in `sfCaseSwarmResource` can be ignored for this path.

---

## Architecture (what the Function App does)

```text
Bot Framework ──POST──► /api/teamsBotRelay
                          │
                          ├─ type=message ──► Azure SignalR group=chatId ──► LWC
                          └─ install/invoke ──► Salesforce Apex REST

LWC ──HMAC──► /api/chatHistory   ──► Microsoft Graph (history)
LWC ──HMAC──► /api/chatSend      ──► Bot Framework (+ SignalR echo)
LWC ──HMAC──► /api/negotiate     ──► SignalR URL + token
LWC ──HMAC──► /api/joinChat      ──► add user to SignalR group
```

---

## Part A — App settings on the Function App (required)

Portal path:  
**Function App** `case-swarm-relay-sfchatsync` → **Settings** → **Environment variables** (or **Configuration** → **Application settings**).

Set / confirm these (names must match exactly):

### Salesforce (bot relay → Apex)

| Setting | Example / notes |
| --- | --- |
| `SALESFORCE_MESSAGING_ENDPOINT` | `https://mylightningapp-dev-dev-ed.my.salesforce.com/services/apexrest/teamsbot/messages` (or your Site URL if you still use the Guest Site path) |
| `SALESFORCE_LOGIN_URL` | `https://mylightningapp-dev-dev-ed.my.salesforce.com` |
| `SALESFORCE_CLIENT_ID` | Connected App consumer key (client credentials) |
| `SALESFORCE_CLIENT_SECRET` | Connected App consumer secret |

### Bot Framework (chatSend + Graph bot posts)

| Setting | Notes |
| --- | --- |
| `MICROSOFT_APP_ID` | Same as Salesforce `Teams_Bot_Config.Microsoft_App_Id__c` (`70b64ad6-…`) |
| `MICROSOFT_APP_PASSWORD` | Bot app client secret |
| `MICROSOFT_APP_TENANT_ID` | Optional if `GRAPH_TENANT_ID` is set; required for single-tenant bot apps |

### Microsoft Graph (chatHistory)

| Setting | Notes |
| --- | --- |
| `GRAPH_TENANT_ID` | Entra tenant id |
| `GRAPH_CLIENT_ID` | App with `Chat.Read.All` (app-only) |
| `GRAPH_CLIENT_SECRET` | App secret |

### Chat bridge (LWC ↔ Azure HMAC)

| Setting | Notes |
| --- | --- |
| `CHAT_BRIDGE_HMAC_SECRET` | Long random string; **must match** Salesforce `Chat_Bridge_HMAC_Secret__c` |
| `CHAT_BRIDGE_CORS_ORIGINS` | `*` for quick test, or your Lightning origin(s) |

### SignalR (Option D)

| Setting | Notes |
| --- | --- |
| `AzureSignalRConnectionString` | From SignalR resource → **Keys** → Primary connection string |
| `AzureWebJobsStorage` | Already present on Function Apps (do not clear) |
| `FUNCTIONS_WORKER_RUNTIME` | `node` |

After saving settings, the app restarts.

Generate a secret (PowerShell):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

---

## Part B — Create Azure SignalR (Option D)

Same RG + region as the Function App.

### Portal

1. Azure Portal → **Create a resource** → **SignalR Service**.
2. **Basics**
   - Resource group: `case-swarm-relay-sfchatsync_group`
   - Name: e.g. `case-swarm-signalr`
   - Region: **Canada Central**
   - Pricing: **Free** for solo proof (~20 connections), **Standard_S1** for shared/prod
3. **Networking**: public (default) is fine for Salesforce LWC browsers.
4. Create → open resource → **Settings** → **Keys** → copy **Primary connection string**.
5. Paste into Function App setting `AzureSignalRConnectionString`.
6. On the SignalR resource → **Settings** → **Settings** (or Features): ensure **Service mode = Serverless**.

### Azure CLI (after `az` is installed)

```bash
az login
az account set --subscription faf0597c-2872-4dce-8815-78ff4bbe042d

az signalr create \
  --name case-swarm-signalr \
  --resource-group case-swarm-relay-sfchatsync_group \
  --sku Free_F1 \
  --unit-count 1 \
  --service-mode Serverless \
  --location canadacentral

CONN=$(az signalr key list \
  -n case-swarm-signalr \
  -g case-swarm-relay-sfchatsync_group \
  --query primaryConnectionString -o tsv)

az functionapp config appsettings set \
  -n case-swarm-relay-sfchatsync \
  -g case-swarm-relay-sfchatsync_group \
  --settings AzureSignalRConnectionString="$CONN"
```

Install Azure CLI on Windows if needed:

```powershell
winget install -e --id Microsoft.AzureCLI
# then open a new terminal
```

---

## Part C — Deploy relay code to the Function App

The repo uses the **Node.js v4 programming model** (`relay/src/functions/*.js`). Deploy the whole `relay/` folder, not a single portal-edited function.

### Option 1 — VS Code / Azure Functions extension

1. Open folder `relay/` in VS Code.
2. Install **Azure Functions** extension.
3. `npm install` in `relay/`.
4. Sign in → right-click Function App `case-swarm-relay-sfchatsync` → **Deploy to Function App**.

### Option 2 — Azure Functions Core Tools + zip

```powershell
cd c:\Personal\Projects\SFMSTeamsInOutProject\relay
npm install
# Install func if needed: winget install Microsoft.Azure.FunctionsCoreTools
func azure functionapp publish case-swarm-relay-sfchatsync
```

### Confirm functions exist

In Portal → Function App → **Functions**, you should see:

- `teamsBotRelay`
- `chatHistory`
- `chatSend`
- `negotiate`
- `joinChat`

### Point Azure Bot at the relay

Azure Bot resource → **Configuration** → **Messaging endpoint**:

```text
https://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net/api/teamsBotRelay
```

(Not the Salesforce Apex REST URL.)

---

## Part D — Salesforce enablement

Already deployed to `devOrg`: LWC, Apex session fields, Static Resource `signalr`, CSP `Chat_Bridge_SignalR_Connect`, CMDT field `Use_Azure_SignalR__c`.

Still configure in Salesforce Setup:

1. **Custom Metadata** → `Teams Bot Config` → **Default**
   - `Chat_Bridge_Azure_Base_Url__c` =  
     `https://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net`  
     (no trailing slash)
   - `Chat_Bridge_HMAC_Secret__c` = same as Azure `CHAT_BRIDGE_HMAC_SECRET`
   - `Use_Azure_Chat_Bridge__c` = **true** (Azure poll/send)
   - `Use_Azure_SignalR__c` = **true** (only after SignalR connection string is set)

2. **CSP Trusted Sites**
   - `Chat_Bridge_Azure_Connect` → Function App URL (connect-src) — update placeholder if still `your-relay.azurewebsites.net`
   - `Chat_Bridge_SignalR_Connect` → `https://*.service.signalr.net` (or your exact `https://case-swarm-signalr.service.signalr.net`)

3. Hard refresh the Case page (or logout/in) so the LWC loads the new static resource.

---

## Part E — Smoke tests

### 1. Relay health (Bot path)

Azure Bot → **Test in Web Chat** → send `hi`.  
Should not show Unauthorized. Install/card flows still go to Salesforce via the relay.

### 2. Chat history (Azure bridge)

With `Use_Azure_Chat_Bridge__c = true` and SignalR still false: open Case Swarm Chat → messages load within ~5s of Teams posts.

### 3. SignalR negotiate

With SignalR configured, from a machine that has a valid HMAC token (easier: open Case chat in Salesforce and watch browser Network):

- `POST .../api/negotiate?chatId=<Swarm_Team_Id__c>` with headers  
  `X-Chat-Bridge-Token`, `x-signalr-userid`  
  → `200` + `{ url, accessToken }`
- `POST .../api/joinChat` → `200`
- SME types in Teams → LWC updates **without** waiting for the 5s poll

### 4. Transcript

Close/minimize the chat widget → `Swarm_Message__c` rows appear via `persistTranscript`.

---

## Rollback

| Goal | Action |
| --- | --- |
| Stop SignalR, keep Azure poll | `Use_Azure_SignalR__c = false` |
| Stop all Azure chat | `Use_Azure_Chat_Bridge__c = false` |
| Keep bot cards working | Leave Function App + Bot messaging endpoint as-is |

---

## Checklist

- [ ] Function App app settings complete (SF + Bot + Graph + HMAC)
- [ ] SignalR created (Serverless) in same RG/region
- [ ] `AzureSignalRConnectionString` set on Function App
- [ ] Latest `relay/` code published (includes negotiate/joinChat/push)
- [ ] Azure Bot messaging endpoint → `/api/teamsBotRelay`
- [ ] SF CMDT: base URL + HMAC + bridge true (+ SignalR true when ready)
- [ ] CSP Trusted Sites updated for Function App (+ SignalR)
- [ ] Smoke: history, send, live inbound push, transcript on close

---

## Common failures

| Symptom | Likely cause |
| --- | --- |
| Bot Test in Web Chat → Unauthorized | Messaging endpoint still points at Salesforce, or SF OAuth settings wrong on relay |
| LWC: chatHistory 401 | HMAC secret mismatch between Azure and CMDT |
| LWC: negotiate 503 | `AzureSignalRConnectionString` missing |
| LWC: CSP / blocked WebSocket | Update `Chat_Bridge_SignalR_Connect` / Function CSP |
| Graph 429 while SignalR off | Expected under poll; enable SignalR to cut Graph list volume |
| No live push, poll still works | `Use_Azure_SignalR__c` still false, or joinChat failed (check Function logs) |

Function logs: Portal → Function App → **Log stream** or Application Insights.
