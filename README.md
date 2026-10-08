# Salesforce ↔ Microsoft Teams case swarming

Creates a Microsoft Team (backed by an M365 group) from a Case record and
adds selected subject-matter experts to it, so the case can be "swarmed"
in Teams. Trigger is a Lightning Web Component on the Case record page;
all Graph API calls happen server-side in Apex, never from the browser.

## Why not call Graph directly from LWC?

Two blockers:
1. **Auth** - Graph needs a bearer token. There's no safe way to hold a
   client secret (or even a long-lived delegated token) in code that runs
   in the user's browser.
2. **CORS** - `graph.microsoft.com` doesn't allow arbitrary browser
   origins to call it directly for app-only auth flows.

So the flow is: **LWC → Apex controller → Apex service → Named Credential → Graph**.

## 1. Azure AD app registration

1. Azure Portal → **Microsoft Entra ID** → **App registrations** → **New registration**.
   Name it e.g. `Salesforce-Case-Swarm`.
2. **API permissions** → **Add a permission** → **Microsoft Graph** →
   **Application permissions** (not delegated, since this is a
   service-to-service, headless flow) and add:
   - `Group.ReadWrite.All`
   - `Team.Create` (or `TeamMember.ReadWrite.All` if teams already exist)
   - `Directory.Read.All` (needed to resolve users for member add)
   - `Chat.ReadWrite.All` (needed to create chats and add chat members)
   - `TeamsAppInstallation.ReadWriteAndConsentForChat.All` (needed to install the
     interactive-card bot into a swarm chat **and** consent its RSC
     `ChatMessage.Read.Chat` so the bot receives all group-chat messages without
     @mention — see section 6. `TeamsAppInstallation.ReadWriteForChat.All` alone
     is not enough once the Teams app declares RSC.)
   - `Chat.ManageDeletion.All` (needed only if **End Chat** should delete the Teams chat
     after archiving the transcript — see `Teams_Bot_Config__mdt.Default.Delete_Teams_Chat_On_End__c`.
     No other permission here covers deletion; without it the delete returns 403 and the
     failure is recorded on `Case.Swarm_Chat_Delete_Error__c` while the rest of End Chat
     still succeeds. Graph's delete is a soft delete — a tenant admin can restore the chat
     for seven days.)
   Click **Grant admin consent** for your tenant.
3. **Certificates & secrets** → **New client secret**. Copy the value now,
   it's not retrievable later.
4. Note the **Application (client) ID** and **Directory (tenant) ID** from
   the app's Overview page.

## 2. Salesforce Named Credential (OAuth 2.0 client credentials)

Salesforce Setup → **Named Credentials** → **External Credentials** tab → **New**:

- Label / Name: `MS_Graph_Cred`
- Authentication Protocol: **OAuth 2.0**
- Authentication Flow Type: **Client Credentials with Client Secret Flow**
- Identity Provider URL: `https://login.microsoftonline.com/<TENANT_ID>/oauth2/v2.0/token`
- Scope: `https://graph.microsoft.com/.default`

Under **Principals**, add a Principal with the Client ID and Client Secret
from step 1, and assign a Permission Set to it that you'll also assign to
any user (typically an integration/automated process user) allowed to
invoke this flow.

Then **Named Credentials** tab → **New**:

- Label / Name: `MS_Graph` (must match `NAMED_CREDENTIAL` in `TeamsSwarmService.cls`)
- URL: `https://graph.microsoft.com`
- External Credential: `MS_Graph_Cred`
- Generate Authorization Header: checked
- Allow Merge Fields in HTTP Body/Header: unchecked (not needed)

Assign the Permission Set (from the Principal step) to the running user's
profile, and to any user context the Apex will execute as.

## 3. Custom fields

**On Case:**
| Field API Name | Type |
|---|---|
| `Swarm_Team_Id__c` | Text(255) |
| `Swarm_Group_Id__c` | Text(255) |
| `Swarm_Team_Url__c` | URL |
| `Swarm_Status__c` | Text(50) or Picklist (Active/Closed) |
| `Swarm_Bot_Service_Url__c` | Text(255) - only used by the interactive card, see section 6 |
| `Swarm_Bot_Install_Error__c` | Text(255) - diagnostic, see section 6 troubleshooting |

**On User:**
| Field API Name | Type |
|---|---|
| `Azure_AD_Email_Id__c` | Email - the person's Microsoft 365 email/userPrincipalName |
| `Azure_AD_Object_Id__c` | Text(50), external ID - optional, see below |

This last pair is the piece that's easy to miss: Graph needs to identify
people by something other than Salesforce Id. `Azure_AD_Email_Id__c` is
what `TeamsSwarmController` and `TeamsBotMessagingResource` actually key
off of - Graph's `/users/{id|upn}` and chat-member bindings both accept a
userPrincipalName (typically the person's email) in place of the object
id, so populating email alone is enough for both Chat swarms and adding
members to an existing Team.

`Azure_AD_Object_Id__c` is kept for reference/future use but isn't read by
any of this code anymore - the one exception is `TeamsSwarmService.addMembers`
(adding members to a **new** Team/M365 Group via `POST /groups/{id}/members/$ref`),
which is untested against a live tenant since this switch and *should* accept
a UPN the same way, but hasn't been confirmed - verify this on the next
Team-type swarm and fall back to the object id there if Graph rejects it.

Populate `Azure_AD_Email_Id__c` via whatever you already use to bridge
identities:
- If you SSO into Salesforce via Azure AD, map the email/UPN claim from the
  SAML/OIDC assertion into this field during JIT provisioning, or
- Run a scheduled batch job that calls `GET /v1.0/users` and matches on
  email/UPN, or
- Populate it manually for a pilot group of agents/SMEs - see the "Adding a
  test user" walkthrough below.

Without this, `searchUsers` in the controller will return nothing, since
it only surfaces users that already have this field populated.

### Adding a test user (Microsoft 365 side)

1. **admin.microsoft.com** → **Users** → **Active users** → **Add a user** -
   give them a license that includes Teams.
2. **Azure Portal** → **Microsoft Entra ID** → **Users** → open them → note
   their **Object ID** if you want it for `Azure_AD_Object_Id__c` too (optional).
3. In Salesforce: **Setup** → **Users** → **New User**, then populate
   **Azure AD Email Id** with their Microsoft email and make sure they're **Active**.
   That's the only requirement for them to show up in the SME picker.

## 4. Deploy

```bash
sfdx force:source:deploy -p force-app/main/default
```
or with the newer CLI:
```bash
sf project deploy start -d force-app/main/default
```

Then add the **Case Swarm** component to the Case Lightning Record Page
via the App Builder, and grant `TeamsSwarmController` /
`TeamsSwarmService` access via a Permission Set to the relevant profiles.

## 5. What happens on "Start swarm"

1. Agent searches for and picks SMEs on the Case record.
2. LWC calls `TeamsSwarmController.startSwarm(caseId, memberAadObjectIds)`.
3. Apex creates an M365 Unified group (`POST /v1.0/groups`), team-enables
   it (`PUT /v1.0/groups/{id}/team`), and adds the agent + selected SMEs
   as members in a single Graph `$batch` call.
4. The Case is updated with the Team id, group id, and web URL.
5. The LWC shows an "Open in Teams" button using the stored URL.
6. For a **Chat** swarm only, the case-swarm bot is installed into the
   chat (`POST /v1.0/chats/{id}/installedApps`), which kicks off the
   interactive card described below.

## 6. Interactive case card (inline edit in Teams)

A card posted via the Graph calls above can only carry an `Action.OpenUrl`
button (a deep link back to Salesforce) - Teams won't let a plain API
message accept edits back. To get a card where participants can click
**Edit Case**, change Status/Priority/Owner/Subject/Description, and save
without leaving Teams, the card has to be sent and handled by a **bot**
registered with Teams, using the Adaptive Cards Universal Action model
(`Action.Execute`). This section wires that up. It only applies to **Chat**
swarms - Team/channel swarms still only get the "Open in Teams" link
(channel conversations need a different install/post flow; see "Notes /
next steps").

How it fits together, once set up:
1. `TeamsSwarmController.startChatSwarm` installs the bot into the new
   chat (`TeamsSwarmService.installBotApp`), best-effort - a failure here
   doesn't fail swarm creation, since the chat itself already succeeded.
2. Teams then calls the bot's messaging endpoint with a
   `conversationUpdate` activity announcing the bot joined. That's how the
   flow bootstraps itself: `TeamsBotMessagingResource` uses it to learn
   the conversation's `serviceUrl`, stores it on `Swarm_Bot_Service_Url__c`,
   and posts the first view card via the Bot Framework Connector API
   (`TeamsBotConversationService`).
3. Clicking **Edit Case** sends an `invoke` activity to the same endpoint;
   the handler returns a refreshed Adaptive Card (an edit form) as the
   invoke response, which Teams swaps in **in place** - no new message.
4. Clicking **Save** applies the submitted fields to the Case (scoped to
   the Case actually linked to that chat, not just whatever `caseId` the
   client sent) and returns the updated view card the same way.

### 6a. Azure Bot registration

1. Azure Portal → **Create a resource** → **Azure Bot**.
2. You can reuse the same App Registration as the Graph integration
   (section 1) or create a new single/multi-tenant one - either way, note
   its **Application (client) ID**; this is the bot's `Microsoft App Id`.
3. **Configuration** → **Messaging endpoint**: set this to the **relay's**
   URL (section 6f), not directly to Salesforce -
   `https://<your-function-app>.azurewebsites.net/api/teamsBotRelay`. See
   6f for why a direct Salesforce URL doesn't work here.
4. **Channels** → add the **Microsoft Teams** channel.
5. If you used a separate App Registration from step 1, add a new
   **Certificates & secrets** client secret for it, same as section 1 step 3.

### 6b. Teams app manifest + catalog upload

The `teamsapp/` folder at the repo root has a starter manifest.
Before packaging:
- Edit `teamsapp/manifest.json`: replace `id` with a fresh GUID if you
  want a distinct app identity, fill in `developer` with real values, and
  set `bots[0].botId` to the Microsoft App Id from 6a.
- Replace `teamsapp/color.png` (192x192) and `teamsapp/outline.png`
  (32x32, transparent) with real icons - the ones committed here are
  solid-color placeholders only, not meant to ship.

Then zip `manifest.json` + both PNGs (files at the zip root, no
subfolder) and upload it to your tenant's app catalog: **Teams Admin
Center** → **Teams apps** → **Manage apps** → **Upload new app**. Open the
uploaded app's details page and copy its **catalog id** (the Graph
`appCatalogs/teamsApps` id, not the manifest's `id`/`botId`) - that's
`Teams_Bot_Config__mdt.Default.Teams_App_Catalog_Id__c`.

### 6c. Salesforce Site (public messaging endpoint)

Bot Framework Activities carry a Bot Framework-issued JWT, not a
Salesforce session, so `TeamsBotMessagingResource` has to be reachable
without one. Setup → **Sites** → **New**:
- Point it at any Site Guest User; the Apex class does **not** rely on the
  Guest User's object/field permissions (see the security note below), so
  the Guest User just needs the **Teams Bot Site Guest** permission set
  (deployed with this package) assigned to its profile - nothing else.
- Under **Site Details**, ensure `services/apexrest/*` isn't blocked; the
  final endpoint is `https://<site-domain>/services/apexrest/teamsbot/messages`.

**Security note:** `TeamsBotMessagingResource` is `without sharing` and
updates Cases with plain SOQL/DML rather than `WITH USER_MODE`. That's
deliberate, not an oversight - the Guest User this runs as has no
legitimate org-level access to Case, so enforcing it would just break
every request. The `X-Bot-Framework-Authorization: Bearer <JWT>` header
(see 6f for why it's not the standard `Authorization` header), verified by
`TeamsBotJwtValidator` against Bot Framework's public signing keys (issuer,
audience = your bot's Microsoft App Id, expiry), is the actual security
boundary - the same trust model as any other API-key-gated webhook.
Card edits are additionally scoped server-side to the Case whose
`Swarm_Team_Id__c` matches the activity's conversation id, so a tampered
`caseId` in the submitted card data can't touch an unrelated Case.

### 6d. Bot Framework Named Credential

Same OAuth 2.0 client-credentials pattern as section 2, but against the
Bot Framework token endpoint and using the bot's Microsoft App Id/secret
from 6a. Salesforce Setup → **External Credentials** → **New**:

- Label / Name: `MS_Bot_Framework_Cred`
- Authentication Flow Type: **Client Credentials with Client Secret Flow**
- Identity Provider URL: `https://login.microsoftonline.com/<TENANT_ID>/oauth2/v2.0/token`
- Scope: `https://api.botframework.com/.default`

Add a Principal with the bot's Client ID/Secret, and assign the resulting
auto-generated Permission Set to the Site Guest User's profile (the same
one you assigned **Teams Bot Site Guest** to in 6c). Then **Named
Credentials** → **New**:

- Label / Name: `MS_Bot_Framework` (must match `NAMED_CREDENTIAL` in
  `TeamsBotConversationService.cls`)
- URL: `https://smba.trafficmanager.net` - this is the Bot Framework
  Connector host Teams has used across regions to date. If a serviceUrl
  ever shows up on a different host, `TeamsBotConversationService` throws
  rather than silently calling the wrong endpoint - update both the Named
  Credential and that check if so.
- External Credential: `MS_Bot_Framework_Cred`
- Generate Authorization Header: checked

### 6e. Custom Metadata

Setup → **Custom Metadata Types** → **Teams Bot Config** → **Manage
Records** → edit the **Default** record deployed by this package:
- `Microsoft App Id`: from 6a
- `Teams App Catalog Id`: from 6b

### 6f. Relay (required - Salesforce can't receive Bot Framework's call directly)

Bot Framework always sends its JWT in a standard `Authorization: Bearer`
header - that's fixed by the Bot Connector protocol, not configurable.
Salesforce's REST dispatcher intercepts any `Authorization` header on a
`/services/apexrest/*` request and tries to validate it as a Salesforce
session token, returning a platform-level 401 **before Apex ever runs** -
even on a Guest Site. There's no Site setting to disable this; it's core
platform behavior. So Bot Framework cannot call
`TeamsBotMessagingResource` directly, regardless of how correctly
everything else in section 6 is configured.

The fix is a minimal relay - `relay/teamsBotRelay/` in this repo - that
sits in front of Salesforce and does exactly one thing: moves the JWT from
`Authorization` to a header Salesforce doesn't intercept
(`X-Bot-Framework-Authorization`), then forwards the request unchanged.
All real logic (JWT validation, card building, Case updates) stays in
Apex; the relay is deliberately dumb plumbing so there's nothing to keep
in sync.

To deploy it as an Azure Function via the Portal (no local tooling
needed):
1. Azure Portal → **Create a resource** → **Function App**. Runtime stack
   **Node.js**, hosting plan **Consumption** (free tier covers this
   easily).
2. Once created → **Functions** → **Create** → **HTTP trigger** template →
   Authorization level **Anonymous** → name it `teamsBotRelay`.
3. Open the function → **Code + Test** → replace the generated code with
   `relay/teamsBotRelay/index.js`, and check `function.json` matches
   `relay/teamsBotRelay/function.json` (POST-only HTTP trigger, anonymous,
   `req`/`res` binding names).
4. **Configuration** → **Application settings** → **New application
   setting**: name `SALESFORCE_MESSAGING_ENDPOINT`, value your Salesforce
   endpoint from 6c - `https://<site-domain>/services/apexrest/teamsbot/messages`.
   Save (this restarts the function).
5. Get the function's URL (**Get Function URL** button - no `?code=` query
   param needed since it's anonymous auth). That's what goes in the Azure
   Bot's messaging endpoint (6a), not the Salesforce URL directly.

### Troubleshooting: chat is created but the card never shows up

This is expected until all of 6a-6e are done. `TeamsSwarmController` never
fails "Start swarm" over this - installing the bot is best-effort, since
the chat (the primary value) already succeeded by that point. Check the
Case's **Swarm Bot Install Error** field (`Swarm_Bot_Install_Error__c`)
right after starting a chat swarm; it holds the exact failure from the
last attempt (and is cleared on the next successful one). Common ones:
- **`Teams_App_Catalog_Id__c is not configured`** - the custom metadata
  record still has its placeholder value (6e not done).
- **A callout/Named Credential error** (not an HTTP status at all) -
  `MS_Bot_Framework`'s External Credential has no Principal/secret
  configured yet (6d not done).
- **`404`** from `/installedApps` - the catalog id in `Teams_Bot_Config__mdt`
  doesn't match a real app in your tenant's catalog (double-check the id
  you copied in 6b - it's the catalog entry's id, not the manifest's `id`
  or `botId`).
- **No error at all, but still no card** - the bot install call itself
  succeeded, so the gap is downstream: either the Azure Bot's messaging
  endpoint (6a) isn't pointed at the **relay's** URL (6f), the relay isn't
  deployed/configured correctly, or the Site (6c) isn't actually
  reachable/active. Nothing calls back into `TeamsBotMessagingResource` in
  that case, so there's no second error to record on the Case - check the
  Azure Bot resource's **Test in Web Chat** panel instead: it shows
  per-message delivery errors even for a plain "hi" with no swarm
  involved, which isolates whether the problem is the endpoint chain at
  all versus something Teams-chat-install-specific.
- **Test in Web Chat shows "HTTP status code Unauthorized" on every
  message, even though the JWT/config all look right** - this is the
  6f problem: something's still sending Bot Framework's request straight
  to Salesforce instead of through the relay (double-check the Azure Bot's
  messaging endpoint value), or the relay isn't renaming the header
  correctly. You can confirm which side is rejecting it: `curl` the
  Salesforce URL directly with a fake `Authorization: Bearer x` header - a
  response body like `{"message":"Session expired or invalid",...}` is
  Salesforce's platform rejecting it before Apex runs (the 6f problem);
  an empty 401/400 body is `TeamsBotMessagingResource` itself rejecting a
  bad token (a different, JWT-validation-side problem).

### 6h. Optional Azure live chat bridge (avoids Apex Graph polling)

By default the Case Swarm Chat LWC uses **Apex `syncMessages`** every ~5s
(Graph callouts from Salesforce). To move live chat off Salesforce callout
limits, enable the **stateless Azure proxy** in the same Function App as
the relay (`relay/`):

| Function | Role |
|---|---|
| `teamsBotRelay` | Install/card invoke → Salesforce; plain `message` → SignalR push when configured (else ack-only) |
| `chatHistory` | LWC → Graph `GET /chats/{id}/messages` (Teams is source of truth; no Azure storage) |
| `chatSend` | LWC → Bot Framework text post (+ SignalR Outbound echo when SignalR is on) |
| `negotiate` | LWC → Azure SignalR connection info (HMAC) |
| `joinChat` | Add Salesforce user to SignalR group = Teams `chatId` |

**App settings** (see `relay/local.settings.json.example`):
`MICROSOFT_APP_ID`, `MICROSOFT_APP_PASSWORD`, `GRAPH_TENANT_ID`,
`GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `CHAT_BRIDGE_HMAC_SECRET`,
optional `CHAT_BRIDGE_CORS_ORIGINS`. For SignalR push also set
`AzureSignalRConnectionString` (see `relay/docs/signalr-setup.md`).

**Salesforce Custom Metadata** `Teams_Bot_Config.Default`:
- `Chat_Bridge_Azure_Base_Url__c` = Function App base URL (no trailing slash)
- `Chat_Bridge_HMAC_Secret__c` = same value as `CHAT_BRIDGE_HMAC_SECRET`
- `Use_Azure_Chat_Bridge__c` = **true** to enable Azure poll/send
- `Use_Azure_SignalR__c` = **true** to enable SignalR push (requires Azure bridge + SignalR connection string)

**CSP:** update trusted site `Chat_Bridge_Azure_Connect` endpoint to your
Function App URL (Connect-Src). For SignalR, keep
`Chat_Bridge_SignalR_Connect` (`https://*.service.signalr.net`) or set your
exact SignalR hostname if your org rejects wildcards.

**Modes:**
- Azure bridge off → Apex Graph poll
- Azure bridge on, SignalR off → LWC polls Azure `chatHistory` ~every 5s
- Both on → one-shot history + SignalR live push; Azure poll only if SignalR disconnects for ~10s

**Revert to Apex Graph polling:** set `Use_Azure_Chat_Bridge__c` = **false**
(or clear the Azure URL/secret). The LWC keeps the original
`syncMessages` / `sendMessage` path — no code redeploy required.

**Revert SignalR to Azure poll:** set `Use_Azure_SignalR__c` = **false**.

### Known limitations

- **Team/channel swarms don't get the interactive card** - only Chat
  swarms do. Posting into a channel and bootstrapping the bot's install
  there uses a different Graph/Bot Framework flow
  (`POST /v1.0/teams/{id}/installedApps` and a channel `conversationUpdate`)
  that isn't wired up yet.
- **No replay protection beyond token expiry** - `TeamsBotJwtValidator`
  checks signature/issuer/audience/expiry, which is what Microsoft's own
  guidance calls for, but doesn't track used token ids. Not a practical
  risk at swarm volumes, but worth knowing if this endpoint ever sees
  heavier traffic.
- **JWKS is fetched fresh on every request** - fine at low volume; if this
  becomes hot, cache the keys (Platform Cache) instead of calling
  `login.botframework.com` on every invoke.

## Notes / next steps you may want

- **Async provisioning**: `PUT /groups/{id}/team` can return `202` while
  Teams finishes provisioning in the background (usually a few seconds).
  The code above stores the id immediately; if you need to guarantee the
  team is fully ready before posting to a channel, poll the
  `teamsAsyncOperation` resource from the response's `Location` header in
  a Queueable Apex job instead of doing it synchronously.
- **Rate limits**: Graph throttles at the tenant level. For high swarm
  volume, wrap the service calls in a Queueable with retry/backoff on
  `429` responses (respect the `Retry-After` header).
- **Cleanup**: Consider a scheduled job that archives/deletes swarm
  teams for Cases that have been Closed for N days, to avoid an
  ever-growing list of teams in your tenant.
