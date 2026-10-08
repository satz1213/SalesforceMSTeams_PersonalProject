# Case Swarm Chat Bridge — Options, Limits & Cost Reference

Reference for choosing and operating the Salesforce ↔ Microsoft Teams chat bridge.

**Last updated:** 2026-07-24  
**Current production path:** Azure live chat bridge (stateless Graph/Bot proxy; LWC polls Azure ~every 5s) — **option B**  
**Implemented upgrade path:** Azure SignalR push — **option D** (`Use_Azure_SignalR__c`)  
**Full Option D ops guide (permissions, setup, difficulties):** [Case-Swarm-SignalR-Option-D-Guide.md](./Case-Swarm-SignalR-Option-D-Guide.md) / [PDF](./Case-Swarm-SignalR-Option-D-Guide.pdf)  
**Also documented:** Azure Table Storage buffer (**option G**)  
**Revert path:** `Teams_Bot_Config__mdt.Default.Use_Azure_Chat_Bridge__c = false` → Apex Graph polling

---

## 1. Requirement (what we optimized for)

| Priority | Requirement |
| --- | --- |
| Must | Near–real-time chat between agent (Salesforce LWC) and SME (Teams) |
| Must | Chat swarms only (not Team/channel) |
| Nice | Do **not** need a Salesforce record per message (`Swarm_Message__c` optional / deferred) |
| Constraint | Protect **Salesforce** Daily REST API and Apex HTTP callouts |
| Constraint | Also care about **Azure** Function executions / cost |
| Constraint | Outbound posts as the **bot** (Graph app-only cannot send live chat messages) |

**Hard truth:** Every design spends somewhere (Salesforce, Azure, Graph, or UX delay). There is no free real-time path.

---

## 2. Architecture map (current)

```text
Teams chat
  │
  ├─ install / Adaptive Card invoke
  │     → teamsBotRelay → Salesforce TeamsBotMessagingResource
  │
  └─ plain type=message
        → teamsBotRelay → Azure SignalR group=chatId  (when Use_Azure_SignalR__c)
        → (or ack-only when SignalR off; LWC polls chatHistory)

Salesforce LWC (caseSwarmChatCore)
  │
  ├─ once: getChatBridgeSession (Apex HMAC token)
  ├─ SignalR on: one-shot GET Azure /api/chatHistory → Graph; then negotiate/join → SignalR push
  ├─ SignalR off: ~5s GET Azure /api/chatHistory → Graph
  └─ send: POST Azure /api/chatSend → Bot Framework (+ SignalR echo when enabled)
```

**Teams is the source of truth** for message history on the **current path (B)**. No Azure Table/Cosmos is used today. **Option G** documents Azure Table Storage as an optional buffer (live from Table, optional batch to SF).

**Transcript:** Azure/SignalR live chat does **not** persist `Swarm_Message__c` on close. Apex poll path may still upsert via `syncMessages` while open. Teams remains source of truth for live history.

### Feature flag

| CMDT field | Effect |
| --- | --- |
| `Use_Azure_Chat_Bridge__c = true` | LWC → Azure history/send |
| `Use_Azure_Chat_Bridge__c = false` | LWC → Apex `syncMessages` / `sendMessage` (original Graph poll) |
| `Use_Azure_SignalR__c = true` | (requires Azure bridge) LWC uses SignalR push; history one-shot; poll only on disconnect fallback |

Also required when Azure is on: `Chat_Bridge_Azure_Base_Url__c`, `Chat_Bridge_HMAC_Secret__c` (must match Azure `CHAT_BRIDGE_HMAC_SECRET`), CSP Trusted Site for the Function App URL. SignalR also needs `AzureSignalRConnectionString` on the Function App and CSP for `*.service.signalr.net`.

Details: [README.md](../README.md) section **6h**.

---

## 3. Options discussed (catalogue)

### A. Apex Graph poll (original)

- LWC every ~5s → Apex `syncMessages` → Graph list → optional `Swarm_Message__c` upsert  
- Send → Apex → Bot Framework callout → store Outbound row  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| High callouts while open | Low | ~5s | Low |

### B. Azure live poll (stateless) — **current**

- LWC every ~2s → Azure `chatHistory` → **Microsoft Graph** list  
- Send → Azure `chatSend` → Bot  
- Bot plain messages not forwarded to Salesforce  
- **No Azure Table / Cosmos** — Teams/Graph is the only message store  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Very low for chat | High if panels stay open (Graph list every poll) | ~0–2s | Low–medium |

### C. Azure poll tuned (5–10s or only while focused)

Same as B with slower/smarter polling.

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Very low | Medium | OK | Low |

### D. SignalR / push — **implemented (flag off by default)**

- Teams `message` → relay → **Azure SignalR** group=`chatId` → LWC  
- Send → Azure `chatSend` → Bot + SignalR Outbound echo  
- One-shot `chatHistory` on open (+ catch-up on SignalR reconnect)  
- Continuous poll only as disconnect fallback (~10s)  
- Flag: `Use_Azure_SignalR__c` (requires `Use_Azure_Chat_Bridge__c = true`)  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Very low | Low (per message + connections) | Best | Medium |

### E. Per-message into Salesforce

- Every Teams message → relay → Apex REST (Daily API)  
- Every SF send → Apex callout  
- Optional Platform Events / `empApi` for UI  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| High (linear with messages) | Low | Best | Medium |

### F. Graph change-notification webhooks

- Graph POSTs to Azure on new chat messages; then same as D, G, or E depending on store/UI  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Depends | Medium (subscriptions + renewals) | Best | High |

### G. Azure Table Storage (message buffer)

Use **Azure Table Storage** (or Cosmos) as a chat buffer in front of Salesforce. Teams remains the collaboration UI; Azure holds a copy for the LWC and optional Case transcript.

**Typical flow**

```text
Teams message  -> bot relay (or Graph webhook)
               -> upsert row in Azure Table (PartitionKey = chatId)

SF send        -> Azure chatSend -> Bot Framework
               -> upsert Outbound row in same table

LWC            -> GET history from Table (cheap) OR SignalR push of new rows
               -> NOT Graph every 2s

Optional batch -> timer / on close -> upsert Swarm_Message__c in Salesforce
```

**Table shape (example)**

| Field | Example |
| --- | --- |
| PartitionKey | Teams `chatId` (`Case.Swarm_Team_Id__c`) |
| RowKey | Message / activity id |
| body, direction, senderName, sentAt | UI fields |
| Optional `_meta` row | Cached `serviceUrl` for Bot send |

**Why use Table vs current B (stateless Graph poll)**

| | B Stateless Graph poll | G Azure Table |
| --- | --- | --- |
| History source each poll | Graph list (~expensive, throttle risk) | Table query (cheap, fast) |
| Inbound write | None (read Graph later) | 1 Table upsert per Teams message |
| Graph list while panel open | Every ~2s | Rare (backup) or never |
| Offline / Graph blip | History poll fails | LWC can still read last stored rows |
| Extra Azure cost | Function exec + Graph | Function exec + **Table storage + transactions** |
| SF message records | Not required | Optional batch later |

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Very low (unless batch every message) | Medium (Table + 1 write/msg; low Graph) | Near real-time if LWC reads Table or SignalR | Medium–higher |

**Variants**

| Variant | Behavior |
| --- | --- |
| **G1 — Live from Table only** | No `Swarm_Message__c`; LWC polls Table or uses SignalR |
| **G2 — Table + batch to SF** | Live from Table; transcript lands on Case on close / every N minutes |
| **G3 — Table + SignalR** | Bot writes Table and pushes SignalR; best Azure efficiency + history buffer |

**Not built in the current repo** — current path is **B (stateless)**. Table was considered earlier and deferred when you chose no Azure storage + no SF message records for MVP.

### H. Sync on open / close / schedule only

- No live poll; one Graph sync when needed  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Very low | Very low | No | Low |

### I. SOQL-only UI poll

- Poll `listStoredMessages` only; something else must write rows (sync job, bot→SF, batch)  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| SOQL load, few callouts | Depends on writer | Only if rows appear | Low |

### J. Teams-only (no SF chat UI)

- Case has Open in Teams + swarm metadata only  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Minimal | Minimal | In Teams only | Lowest |

### K. Salesforce Messaging / BYOC

- Full Service Cloud messaging channel  

| SF | Azure | Live | Complexity |
| --- | --- | --- | --- |
| Platform | Adapter | Native Omni | Very high |

---

## 4. Ranking for *this* requirement

Optimized for: live chat + low SF + low Azure + reasonable complexity.

| Rank | Option | Verdict |
| --- | --- | --- |
| **1** | **D — SignalR push** | Most efficient / cost-effective **at scale** |
| **2** | **B — Azure poll ~2s (current)** | Best **simplicity / value now**; burns Azure/Graph while idle |
| **3** | **C — Slower / focus-only Azure poll** | Cheap interim if Azure $ grows |
| **4** | **G — Azure Table (+ optional SignalR/batch)** | Cuts Graph poll cost; adds storage ops; good if you want history buffer or later SF transcript |
| **5** | **E — Per-message Salesforce API** | Good for Azure; bad for SF |
| **6** | **A — Apex Graph poll** | Worst for SF callouts |
| **7** | **H — Sync on open/close** | Cheapest; fails live requirement |
| **8** | **K — Messaging BYOC** | Overkill for Case swarm widget |

**One-line recommendation**

- **Today:** keep **Azure poll (B)** until SignalR is provisioned.  
- **At scale / Graph throttle:** enable **SignalR (D)** (`Use_Azure_SignalR__c = true`).  
- **If you also need a durable Azure-side history or batch transcript to SF:** consider **Table (G)** later.  
- **Do not** go to per-message Salesforce (E) unless SF limits no longer matter.  
- **Do not** return to Apex polling (A) for live chat.

---

## 5. Worked example — limits comparison

Assumptions: **Active Chat** swarm, panel open **45 minutes**, **25 messages** (15 from Teams, 10 from Salesforce), bot already installed.

| Meter | A Apex poll 5s | B Azure poll 2s | D SignalR | G Table + poll Table | E SF per message |
| --- | --- | --- | --- | --- | --- |
| SF Daily REST API (chat) | ~1–2 | ~1–2 | ~1–2 | ~1–2 (or +1–3 if batch) | ~15–17 |
| Apex HTTP callouts (chat) | ~540+ | ~0 | ~0 | ~0 | ~10–13 |
| Azure Function-ish ops | Low | ~1,300+ history | ~25–40 events | ~1,300 Table reads + ~25 writes | ~25 |
| Graph list while open | ~540 (from SF) | ~1,300 (from Azure) | ~0–1 (on open) | ~0 | 0 |
| Azure Table transactions | 0 | 0 | 0 | ~1,300 reads + ~25 writes | 0 |
| Live UX | ~5s | ~0–2s | Instant push | ~0–2s (or instant with SignalR) | Instant |

Note: **G** still has many Function executions if the LWC polls Table every 2s; combine with **SignalR (G3)** to drop reads to ~per message.

---

## 6. What is / isn’t a Salesforce “callout” or “API limit”

| Hop | SF Daily REST API? | Apex HTTP callout? |
| --- | --- | --- |
| LWC → Apex `syncMessages` | No | **Yes** (to Graph) |
| LWC → Azure `chatHistory` (browser `fetch`) | No | **No** |
| Azure → Graph | No | No (Microsoft Graph) |
| Azure → Bot Framework | No | No |
| Relay → Apex REST (bot install / card) | **Yes** | No (inbound) |
| LWC → Apex `sendMessage` → Bot | No | **Yes** |
| LWC → Azure `chatSend` → Bot | No | **No** |

---

## 7. Azure side — standard Functions limits (summary)

See also: [Azure Functions scale and hosting](https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale)

| Resource | Consumption (legacy) | Flex Consumption |
| --- | --- | --- |
| Default timeout | 5 min | 30 min |
| Max timeout | 10 min | Unbounded\* |
| HTTP response hard cap | **~230 seconds** (all plans) | Same |
| Memory / instance | 1.5 GB | 512 MB / 2 GB / 4 GB |
| Max instances | Win 200 / Linux 100 | Up to ~1,000 (regional quota) |
| Outbound connections / instance | 600 active | High / unbounded |

\*HTTP triggers still bound by the ~230s load-balancer limit.

**Billing (classic Consumption free grant — verify current pricing):** ~1M executions/month and ~400k GB-seconds free, then pay-per-use.

**Your poll math:** 1 open panel @ 2s ≈ **30 executions/min** ≈ **~43k/day**. Ten panels × 8 hours ≈ **~144k/day**.

**What fails first at growth:** often **Microsoft Graph throttling (429)** and **Function execution cost**, not Functions hard timeouts.

---

## 8. SignalR path (Option D) — implemented

| Need | Purpose | Status |
| --- | --- | --- |
| Azure SignalR Service (Serverless) | Hold live connections | Provision per env — see `relay/docs/signalr-setup.md` |
| `negotiate` Function | LWC gets SignalR URL + token (HMAC) | `relay/src/functions/negotiate.js` |
| `joinChat` Function | Add SF userId to SignalR group=`chatId` | `relay/src/functions/joinChat.js` |
| `teamsBotRelay` on `type=message` | Push DTO to SignalR group | Implemented |
| `chatSend` | SF → Bot + SignalR Outbound echo | Implemented |
| One-shot `chatHistory` | Load last N on open / reconnect | Kept |
| LWC SignalR client | Static Resource + connect/join/push; poll fallback | `caseSwarmChatCore` |
| CSP | Function App + `https://*.service.signalr.net` | `Chat_Bridge_*_Connect` |
| CMDT | `Use_Azure_SignalR__c` (requires Azure bridge) | Default **false** |

**Enable:** set `AzureSignalRConnectionString` on the Function App, deploy relay + SF metadata, then `Use_Azure_Chat_Bridge__c = true` and `Use_Azure_SignalR__c = true`.

**Rollback:** `Use_Azure_SignalR__c = false` → Azure poll (B). `Use_Azure_Chat_Bridge__c = false` → Apex poll (A).

**Not required:** message Table storage, Graph webhooks, SF Platform Events, per-message Apex.

**Do not** rely on raw long-lived SSE from a Consumption/Flex HTTP Function alone (230s cut-off).

---

## 9. Enable / revert (operations)

### Enable Azure bridge (poll — option B)

1. Deploy Salesforce metadata + `relay/` Function App.  
2. Set Azure app settings: Bot + Graph + `CHAT_BRIDGE_HMAC_SECRET` (+ CORS).  
3. Set CMDT: Azure base URL + HMAC secret.  
4. Update CSP Trusted Site `Chat_Bridge_Azure_Connect` to the real Function URL.  
5. Set `Use_Azure_Chat_Bridge__c = true`.  
6. Smoke-test SF ↔ Teams.

### Enable SignalR push (option D)

1. Complete Azure bridge enablement above.  
2. Provision Azure SignalR (Serverless) and set `AzureSignalRConnectionString` — see `relay/docs/signalr-setup.md`.  
3. Deploy updated `relay/` (negotiate / joinChat / push).  
4. Deploy SF metadata (CMDT field, Apex, LWC, Static Resource `signalr`, CSP `Chat_Bridge_SignalR_Connect`).  
5. Set `Use_Azure_SignalR__c = true`.  
6. Smoke-test: open Case chat → history loads → SME types in Teams → LWC updates without waiting for poll.

### Revert

| Goal | Action |
| --- | --- |
| Back to Azure poll | `Use_Azure_SignalR__c = false` |
| Back to Apex Graph poll | `Use_Azure_Chat_Bridge__c = false` (or clear Azure URL/secret) |

No code rollback required.

---

## 10. Decision cheat sheet

| If you care most about… | Choose |
| --- | --- |
| Shipping / ops simplicity | **B — Azure poll** |
| Azure $ / Graph throttle with many open panels | **D — SignalR** (implemented; enable flag) |
| Cut Graph list cost but keep poll UI | **G — Azure Table** (history from Table, not Graph) |
| Live chat + later Case transcript | **G2 — Table + batch to `Swarm_Message__c`** |
| Best Azure efficiency + history buffer | **G3 — Table + SignalR** |
| Salesforce API / callouts | **B, D, or G** (avoid **A** and **E**) |
| Case transcript only, no live SF chat | **H** or batch without live UI |
| Live not required | **H** |
| Full Service Console messaging | **K** |

---

## 11. Related code & docs

| Path | Role |
| --- | --- |
| `relay/src/functions/teamsBotRelay.js` | Bot → SF for cards; SignalR push for plain messages |
| `relay/src/functions/negotiate.js` | SignalR connection info (HMAC) |
| `relay/src/functions/joinChat.js` | Add user to SignalR group |
| `relay/src/functions/chatHistory.js` | Azure → Graph history |
| `relay/src/functions/chatSend.js` | Azure → Bot send + SignalR echo |
| `relay/docs/signalr-setup.md` | Azure SignalR provision steps |
| `force-app/.../lwc/caseSwarmChatCore/` | UI; Azure poll vs SignalR vs Apex |
| `force-app/.../classes/TeamsSwarmChatController.cls` | `getChatBridgeSession`, legacy sync/send |
| `Teams_Bot_Config__mdt` | Bridge + SignalR flags, URL, HMAC |
| `README.md` §6f / §6h | Relay + Azure chat bridge / SignalR setup |

---

## 12. Glossary

| Term | Meaning |
| --- | --- |
| **Callout** | Apex HTTP request from Salesforce to an external system (counts against callout limits) |
| **Daily REST API** | Inbound REST/SOAP to Salesforce (e.g. relay → Apex REST) |
| **Stateless proxy** | Azure does not store chat; Teams/Graph holds history (current **B**) |
| **Azure Table Storage** | Cheap key-value store for chat buffer (**G**); PartitionKey = chatId |
| **SignalR** | Azure push service for browsers; preferred over raw SSE on Functions |
