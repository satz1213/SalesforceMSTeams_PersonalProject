# Case Swarm — Azure SignalR Live Chat (Option D)

**Operational & troubleshooting guide** covering architecture, permissions, setup, and every issue hit bringing push live in this project.

**Last updated:** 2026-07-24  
**Status:** Working end-to-end (WebSocket push + RSC without @mention)  
**Feature flags:** `Use_Azure_Chat_Bridge__c` + `Use_Azure_SignalR__c` on `Teams_Bot_Config__mdt.Default`

---

## 1. What Option D is

Option D replaces continuous Graph history polling as the *primary* live path with **Azure SignalR Service (Serverless)**:

1. Agent opens Case Swarm Chat in Salesforce.
2. LWC loads one-shot history from Azure `chatHistory` (Graph).
3. LWC negotiates a SignalR connection, joins the chat group, and listens for `newMessage`.
4. When someone types in Teams, Bot Framework delivers `type=message` to the Azure relay.
5. Relay pushes a DTO to SignalR **group = Teams chatId**.
6. LWC appends the message immediately (no Salesforce Daily REST API per message).

**Teams remains source of truth.** Live Azure/SignalR chat does not write `Swarm_Message__c` on panel close.

### Why not poll forever?

| Path | Cost / risk while chat is open |
| --- | --- |
| Apex → Graph every ~5s | Salesforce callouts + Daily API |
| LWC → Azure → Graph every ~5s | Graph 10/10s throttle; Azure executions |
| SignalR push | Near-zero Graph while connected; Azure SignalR + Function on events only |

---

## 2. Architecture

```text
Teams group chat
  │
  ├─ install / Adaptive Card invoke
  │     → teamsBotRelay → Salesforce Apex REST (cards)
  │
  └─ plain type=message  (requires RSC ChatMessage.Read.Chat OR @mention)
        → teamsBotRelay
        → Azure SignalR output  groupName=chatId  target=newMessage

Salesforce LWC (caseSwarmChatCore)
  │
  ├─ getChatBridgeSession (Apex HMAC + flags + paths)
  ├─ GET /api/chatHistory  (one-shot on open; poll only if SignalR drops)
  ├─ POST /api/negotiate   → { url, accessToken }
  ├─ WebSocket wss://…signalr.net  (native JSON hub client in LWC)
  ├─ POST /api/joinChat    → AddToGroup(userId, chatId)
  └─ POST /api/chatSend    → Bot Framework + SignalR outbound echo
```

### Two Microsoft auth surfaces (do not conflate)

| Surface | Named Credential / resource | Purpose |
| --- | --- | --- |
| Microsoft Graph | `MS_Graph` | Create chat, members, **install Teams app**, list messages |
| Bot Framework Connector | `MS_Bot_Framework` / Azure Bot | Post as bot; receive activities at relay |
| Azure SignalR | `AzureSignalRConnectionString` on Function App | Negotiate + group push |

### Hub / group conventions

| Item | Value |
| --- | --- |
| SignalR hub name | `swarmChat` |
| Group name | Teams `conversation.id` / Case `Swarm_Team_Id__c` |
| Client event | `newMessage` with one DTO argument |
| User id for negotiate/join | Salesforce `UserInfo.getUserId()` (HMAC + `x-signalr-userid`) |

---

## 3. Permissions checklist (complete)

### 3.1 Entra app for Salesforce Graph (`MS_Graph`)

Application permissions + **admin consent**:

| Permission | Why |
| --- | --- |
| `Group.ReadWrite.All` | M365 group / team flows |
| `Team.Create` / team member perms | Team swarms |
| `Directory.Read.All` | Resolve users |
| `Chat.ReadWrite.All` | Create chats, members, list messages |
| `TeamsAppInstallation.ReadWriteAndConsentForChat.All` | **Required** to install a Teams app that declares RSC and to consent `ChatMessage.Read.Chat` in the install body |

> `TeamsAppInstallation.ReadWriteForChat.All` alone is **not** enough once the Teams app has RSC. Graph returns 403 listing the `…AndConsent…` permissions.

### 3.2 Teams app manifest RSC (no @mention)

In `teamsapp/manifest.json` (v1.0.1+):

```json
"webApplicationInfo": {
  "id": "<same as bots[0].botId / Microsoft App Id>",
  "resource": "https://Api"
},
"authorization": {
  "permissions": {
    "resourceSpecific": [
      {
        "name": "ChatMessage.Read.Chat",
        "type": "Application"
      }
    ]
  }
}
```

Without this, group-chat bots only receive messages when **@mentioned**.

### 3.3 Graph install body (Apex)

`TeamsSwarmService.installBotApp` must POST:

```json
{
  "teamsApp@odata.bind": "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/<catalogId>",
  "consentedPermissionSet": {
    "resourceSpecificPermissions": [
      {
        "permissionValue": "ChatMessage.Read.Chat",
        "permissionType": "Application"
      }
    ]
  }
}
```

Mismatch → `ResourceSpecificPermissionsMismatch`. Missing Consent Graph permission → 403 as above.

### 3.4 Salesforce CMDT / config

| Setting | Purpose |
| --- | --- |
| `Use_Azure_Chat_Bridge__c` | LWC uses Azure history/send |
| `Use_Azure_SignalR__c` | Enable negotiate/join/push (requires bridge on) |
| `Chat_Bridge_Azure_Base_Url__c` | Function App base URL (`https://…`) |
| `Chat_Bridge_HMAC_Secret__c` | Must match Azure `CHAT_BRIDGE_HMAC_SECRET` |
| `Teams_App_Catalog_Id__c` | Graph `appCatalogs/teamsApps` id (not manifest GUID) |

### 3.5 Azure Function App settings

| Setting | Purpose |
| --- | --- |
| `AzureSignalRConnectionString` | Serverless SignalR |
| `CHAT_BRIDGE_HMAC_SECRET` | Bridge token validation |
| `SALESFORCE_*` | Relay → Apex for cards only |
| Bot / Graph settings as already used for chatSend | Outbound |

### 3.6 Salesforce CSP Trusted Sites (LEX, connect-src)

| Site | Endpoint |
| --- | --- |
| `Chat_Bridge_Azure_Connect` | `https://<function-app>.azurewebsites.net` (**must include https://**) |
| `Chat_Bridge_SignalR_Connect` | `https://case-swarm-signalr.service.signalr.net` |
| `Chat_Bridge_SignalR_Wss` | `wss://case-swarm-signalr.service.signalr.net` |

`https` and `wss` are **separate** allowlist entries. Missing `wss` → CSP blocks the WebSocket even when https is allowed.

---

## 4. Setup steps (ordered)

### A. Azure SignalR + Function App

1. Create Azure SignalR Service: **Serverless**, Free_F1 is fine for dev.
2. Copy primary connection string → Function App setting `AzureSignalRConnectionString`.
3. Deploy relay with `negotiate`, `joinChat`, SignalR output on `teamsBotRelay` / `chatSend`.
4. Confirm extension bundle supports SignalR bindings.
5. Set `CHAT_BRIDGE_HMAC_SECRET` identical to Salesforce CMDT secret.

### B. Teams app (RSC)

1. Update `teamsapp/manifest.json` with `ChatMessage.Read.Chat` + `webApplicationInfo.id` = bot App Id.
2. Bump version; zip manifest + icons; upload to Teams Admin catalog.
3. Copy **catalog** `teamsApps` id into `Teams_App_Catalog_Id__c`.
4. Ensure Entra Graph app has `…ReadWriteAndConsentForChat.All` + admin consent.

### C. Salesforce

1. Deploy Apex/LWC/CMDT/CSP (including `Chat_Bridge_SignalR_Wss`).
2. Set CMDT: Azure bridge URL, HMAC, both feature flags true, catalog id.
3. Deploy `TeamsSwarmService.installBotApp` that sends `consentedPermissionSet`.

### D. Smoke test

1. Start a **new** Chat swarm (old chats may lack RSC install).
2. Confirm bot install succeeds (`Swarm_Bot_Install_Error__c` empty).
3. Open Case chat → badge **Live: SignalR push**.
4. Network: WebSocket to `….service.signalr.net`; `negotiate` / `joinChat` 200.
5. Type in Teams **without** @mention → LWC updates (instant push).
6. Optional: click Sync to force a Graph refresh; disconnect SignalR (or kill WebSocket) to confirm poll fallback resumes.

---

## 5. Client implementation notes

### Native WebSocket hub (not `@microsoft/signalr` static resource)

Loading `@microsoft/signalr` via `loadScript` under **Lightning Web Security** failed repeatedly (see §6). Production path:

- `caseSwarmChatCore/caseSwarmChatSignalR.js` — minimal JSON protocol client
- Handshake `{"protocol":"json","version":1}\x1e`
- Handles Invocation type 1 (`newMessage`), Ping type 6, Close type 7
- Reconnect with fresh negotiate token

### Backup poll (removed once RSC worked)

During bring-up (before RSC), the LWC kept a **~30s** Graph `chatHistory` poll even while SignalR showed connected, so messages still appeared when the bot only received @mentions. **That backup is off now:** while SignalR is connected there is no continuous poll; poll resumes only on disconnect fallback.

### Session / HMAC

- Apex mints short-lived HMAC for `chatId` + `userId`.
- Negotiate requires header `x-signalr-userid` to match token userId.
- joinChat adds that user to SignalR group `chatId`.

---

## 6. Difficulties faced (and fixes)

These are the real blockers encountered bringing Option D live.

### 6.1 CSP Azure URL missing `https://`

**Symptom:** LWC fell back to ~5s poll; negotiate blocked.  
**Cause:** Org CSP `Chat_Bridge_Azure_Connect` had host without scheme.  
**Fix:** Endpoint must be `https://case-swarm-relay-….azurewebsites.net`.

### 6.2 SignalR static resource: `require is not defined`

**Symptom:** Badge `SignalR: require is not defined`.  
**Cause:** LWS injects CommonJS `module`/`exports`; UMD browser build took Node path.  
**Attempted fix:** Patch UMD / shadow module.  
**Outcome:** Insufficient; more LWS issues followed.

### 6.3 `require('abort-controller')` / AbortController unavailable

**Symptom:** LWS hides free `AbortController`; SignalR Node polyfill path.  
**Attempted fix:** Polyfill + fetch bridge in static resource wrapper.  
**Outcome:** Still fragile under LWS.

### 6.4 `loadLibrary timed out after 20000ms`

**Symptom:** Network showed ~5ms download; `loadScript` promise never settled.  
**Cause:** LWS script evaluation hang (notably unreliable with bare `self`).  
**Fix:** **Abandoned `loadScript` / `@microsoft/signalr`.** Native WebSocket client in LWC.

### 6.5 CSP blocks `wss://` despite `https://` allowlist

**Symptom:** Console CSP violation on WebSocket connect.  
**Cause:** Salesforce connect-src lists https and wss separately.  
**Fix:** Add CSP Trusted Site `wss://case-swarm-signalr.service.signalr.net`.

### 6.6 Connected but no Teams messages (unless @mention)

**Symptom:** Badge green; plain Teams text never arrives; @mention works.  
**Cause:** Group-chat bots only get mentions unless RSC `ChatMessage.Read.Chat`.  
**Fix:** Manifest RSC + Graph install with `consentedPermissionSet` + Consent Graph permission.  
**Interim (during bring-up):** ~30s Graph backup poll while SignalR connected — later removed once RSC push was reliable.

### 6.7 `ResourceSpecificPermissionsMismatch` on bot install

**Symptom:** Install fails after adding RSC to manifest.  
**Cause:** Install POST lacked `consentedPermissionSet` matching app definition.  
**Fix:** Apex body includes `ChatMessage.Read.Chat` Application consent set.

### 6.8 403 missing `…ReadWriteAndConsentForChat.All`

**Symptom:** After body fix, Graph 403 listing Consent permissions.  
**Cause:** Entra app still only had `ReadWriteForChat.All`.  
**Fix:** Add `TeamsAppInstallation.ReadWriteAndConsentForChat.All`, admin consent, new swarm.

### 6.9 Public static resource CDN stickiness

**Symptom:** Patched `signalr` JS not used after deploy.  
**Cause:** `cacheControl=Public` CDN.  
**Lesson:** Prefer Private or new resource name when iterating; moot after native client.

### 6.10 Concurrent `loadScript` from multiple LWC hosts

**Symptom:** Bare undefined rejections when widget + record + utility all mounted.  
**Lesson:** Module-level shared promise if ever using loadScript again; native client avoids this.

---

## 7. Runtime behaviour reference

| Badge | Meaning |
| --- | --- |
| Live: SignalR push | WebSocket up; push only (no continuous Graph poll) |
| SignalR: … | Connecting / error detail / poll fallback |
| Live: Azure poll (~5s) | Bridge on, SignalR off |
| Live: Apex poll (~5s) | Bridge off |

| Inbound path | When it works |
| --- | --- |
| SignalR push | Bot received activity (RSC or @mention) → relay → group |
| Graph poll fallback | Only when SignalR is down / reconnecting |
| Outbound SF → Teams | `chatSend` → Bot + SignalR echo |

---

## 8. Troubleshooting quick matrix

| Symptom | Check |
| --- | --- |
| Still polling every 5s | Flags, CSP https, badge error text |
| CSP / wss blocked | `Chat_Bridge_SignalR_Wss` present |
| negotiate 401 | HMAC secret match; `x-signalr-userid` |
| joinChat 401 | Token chatId match |
| Push only on @mention | RSC manifest uploaded? Consent install? Graph Consent permission? |
| Install ResourceSpecificPermissionsMismatch | Apex sending consentedPermissionSet? Catalog id = RSC app version? |
| Install 403 Consent | Entra `…ReadWriteAndConsentForChat.All` + admin consent |
| Cards work, push doesn't | Relay deployed with SignalR output? `AzureSignalRConnectionString`? |

---

## 9. Key repo files

| Area | Path |
| --- | --- |
| LWC core | `force-app/.../lwc/caseSwarmChatCore/` |
| Native SignalR client | `.../caseSwarmChatSignalR.js` |
| Apex session / bridge | `TeamsSwarmChatController.cls` |
| Bot install + RSC body | `TeamsSwarmService.installBotApp` |
| Relay push | `relay/src/functions/teamsBotRelay.js` |
| Negotiate / join | `relay/src/functions/negotiate.js`, `joinChat.js` |
| Hub helpers | `relay/src/signalrHub.js` |
| Teams manifest | `teamsapp/manifest.json` |
| CSP | `cspTrustedSites/Chat_Bridge_*` |
| SignalR Azure notes | `relay/docs/signalr-setup.md` |

---

## 10. Rollback

1. Set `Use_Azure_SignalR__c = false` → Azure ~5s poll (bridge still on).  
2. Set `Use_Azure_Chat_Bridge__c = false` → Apex Graph poll.  
3. Optional: remove RSC from Teams manifest and revert install body if Consent permission must be dropped (returns @mention requirement for bot-received messages).

---

## 11. Summary

Option D is viable in Salesforce LWC **if**:

1. You avoid shipping `@microsoft/signalr` through `loadScript` under LWS (use a native WebSocket hub client).  
2. You allowlist **both** `https` and `wss` for SignalR.  
3. You treat **RSC + Consent Graph permission + consentedPermissionSet** as mandatory for no-@mention push.  
4. You can optionally keep a slow Graph backup during RSC bring-up; once push is proven, stop polling while SignalR is connected.

Once those are in place, live chat works: green **Live: SignalR push**, Teams text without @mention, Adaptive Cards unchanged via the existing relay → Salesforce path.
