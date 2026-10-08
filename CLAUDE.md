# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Salesforce package (`force-app/`) with **three separate, non-overlapping Microsoft Teams
integrations**. Keeping them separate is a deliberate, explicit constraint — if a change to one
starts touching the others' classes/LWCs/relay functions, that's a sign the boundary is being
crossed and the approach needs rethinking:

1. **Case Swarm** (the original feature). Lets a Case be "swarmed" in Microsoft Teams: creates
   either a full Team or a lightweight group Chat backed by an M365 group/chat, adds selected
   subject-matter experts, and (for Chat swarms) posts an interactive Adaptive Card in Teams that
   lets people edit the Case inline, plus an optional in-Salesforce live chat bridge into that
   Teams chat. Uses the Case Swarm bot app (`teamsapp/`).
2. **MessagingSession → Teams chat**. When an Omni-Channel agent accepts a `MessagingSession`
   (any channel), a plain Teams chat (no card, no Team) is auto-created between the agent and
   customer, with a live in-Salesforce chat window and an End Chat archival/delete action. Reuses
   the *same* bot app as Case Swarm for plain messages, but is otherwise a fully separate code
   path — see "MessagingSession → Teams chat" below.
3. **"Talk to an Agent" Teams tab**. A second, separate Teams app (`teamsapp-talk-to-agent/`,
   tab-only, no bot) that lets someone start a `MessagingSession` *from inside Teams* via a fully
   custom chat UI, instead of a website widget. Entirely self-contained in one relay function
   (`relay/src/functions/talkToAgentTab.js`) — no Apex, no LWC, no shared relay code with the
   other two. See "Talk to an Agent tab" below.

A small Node.js Azure Function app (`relay/`) sits in front of Salesforce/Graph/Bot Framework/the
Messaging REST API for several related but distinct reasons — see "Relay" below. See `README.md`
for the full external setup walkthrough (Azure AD app registration, Named Credentials, Azure Bot
resource, Teams app catalog upload, Azure SignalR, etc.) — that doc is the source of truth for
infra/config steps and troubleshooting; this file is about the code.

**Note:** several Apex/relay doc comments reference "README.md section 6g" (a Connected App /
run-as-user setup for the relay's Salesforce auth) that isn't actually in `README.md` — the code
evolved past the doc. Don't go looking for 6g; infer the setup from `relay/src/functions/teamsBotRelay.js`
and `TeamsBotMessagingResource.cls` instead if you need it.

## Commands

Run from the repo root unless noted.

```bash
npm run lint                  # eslint over aura/lwc JS
npm run test                  # = test:unit
npm run test:unit             # sfdx-lwc-jest (LWC Jest tests)
npm run test:unit:watch
npm run test:unit:debug
npm run test:unit:coverage
npm run prettier              # write formatting across cls/cmp/html/js/json/xml/etc
npm run prettier:verify       # check-only, used in CI/pre-commit
```

Run a single LWC Jest test file or pattern directly (faster than the full suite):
```bash
npx sfdx-lwc-jest -- path/to/component.test.js
npx sfdx-lwc-jest -- -t "test name substring"
```

Pre-commit (Husky + lint-staged) runs prettier, eslint, and `sfdx-lwc-jest --bail --findRelatedTests`
on staged files automatically — see `package.json` `lint-staged` config.

Apex deploy and tests use the Salesforce CLI, not npm:
```bash
sf project deploy start -d force-app/main/default
sf apex run test --test-level RunLocalTests --result-format human
sf apex run test --class-names TeamsSwarmServiceTest --result-format human
sf apex run --file scripts/apex/hello.apex
```

Relay (Azure Function, `relay/`) local dev:
```bash
cd relay
npm install
func start                     # requires Azure Functions Core Tools; needs local.settings.json
                                # (copy from local.settings.json.example and fill in SALESFORCE_*)
```
The relay has no test suite; it's intentionally minimal (see "Relay" below).

## Architecture

### Two independent Graph/Bot Framework surfaces

The integration uses two separate Microsoft auth flows for two different purposes — don't conflate
them when tracing a bug:

1. **Microsoft Graph** (`MS_Graph` Named Credential, app-only client-credentials) — `TeamsSwarmService.cls`.
   Creates/team-enables M365 groups, creates chats, adds members, installs the bot app into a chat,
   posts/lists chat messages. Almost everything provisioning-related goes through here.
2. **Bot Framework Connector API** (`MS_Bot_Framework` Named Credential, separate client-credentials
   grant, separate audience) — `TeamsBotConversationService.cls`. Used only to post Adaptive Card
   messages *as the bot* into a conversation, because Graph's application-only token is rejected by
   `POST /chats/{id}/messages` for messages that need to render as the bot (interactive cards, and
   the Case Swarm Chat bridge's outbound messages).

### Swarm creation flow (`TeamsSwarmController` → `TeamsSwarmService`)

`caseSwarm` LWC → `TeamsSwarmController.startSwarm`/`startChatSwarm` → `TeamsSwarmService` Graph calls
→ Case fields (`Swarm_Team_Id__c`, `Swarm_Group_Id__c`, `Swarm_Team_Url__c`, `Swarm_Status__c`,
`Swarm_Type__c`) updated. Team creation is async on Microsoft's side (`PUT /groups/{id}/team` can
return 202 while provisioning finishes in the background), so a **Scheduled Apex retry loop**
(`TeamsSwarmProvisionScheduler` + `TeamsSwarmProvisionQueueable`) polls until the team is ready —
Scheduled Apex can't itself make callouts, so the scheduler only re-enqueues the Queueable that does.
Chat swarms don't need this retry loop (chats are created synchronously) but do best-effort bot
install via `TeamsSwarmBotInstallQueueable`, deferred to its own transaction so a bot-install failure
never fails the swarm itself (see `Swarm_Bot_Install_Error__c` for surfacing that failure to agents).

Removing a member mirrors adding one: `TeamsSwarmController.getSwarmMembers`/`removeMemberFromSwarm`
→ `TeamsSwarmService.listGroupMembers`/`removeGroupMember` (Team swarms) or
`listChatMembers`/`removeChatMember` (Chat swarms). The `caseSwarm` LWC updates its member list
**optimistically** (local filter) after a successful removal rather than re-fetching from Graph —
Graph's eventual consistency means an immediate re-fetch can still show the just-removed member.

### Interactive card / bot messaging (Chat swarms only)

This is the most convoluted part of the system — trace it via the class doc comments before changing
anything:

- `TeamsBotMessagingResource` (Apex REST, `/services/apexrest/teamsbot/messages`) is Bot Framework's
  logical messaging endpoint, but Bot Framework never calls it directly — see "Relay" below.
- `TeamsBotJwtValidator` verifies the Bot Framework JWT (RS256, hand-rolled — Apex has no JWT/JOSE
  library) against Bot Framework's JWKS: signature, issuer, audience (must match the bot's Microsoft
  App Id), expiry.
- `TeamsAdaptiveCardBuilder` is pure JSON construction (no callouts/DML) for both the read-only view
  card and the editable form card — kept separate from `TeamsBotMessagingResource` so card-shape
  changes don't risk the messaging/validation logic.
- `conversationUpdate` (bot added to chat) → `TeamsSwarmBotInstallQueueable` records `serviceUrl` on
  `Swarm_Bot_Service_Url__c`, then `TeamsBotInstalledCardQueueable` posts the first view card via
  `TeamsBotConversationService`, split into its own transaction because by the time it runs the Case
  row is already claimed by the update that set `Swarm_Bot_Service_Url__c`.
- `invoke` (Edit Case / Save) → `TeamsBotMessagingResource` returns a refreshed card in the invoke
  response itself; Teams swaps it in place, no new message. Edits are scoped server-side to the Case
  whose `Swarm_Team_Id__c` matches the activity's conversation id — never trust a client-submitted
  `caseId`.
- `TeamsBotMessagingResource` is deliberately `without sharing` with plain SOQL/DML (not
  `WITH USER_MODE`) when it runs as the Guest Site path — the JWT validation is the real security
  boundary there, not object/field permissions, since the Guest User has no legitimate Case access to
  begin with.

### Relay (`relay/`)

Salesforce's REST dispatcher intercepts any standard `Authorization` header on a
`/services/apexrest/*` request and tries to validate it as a Salesforce session token — a platform
behavior with no Site-level opt-out. Bot Framework always sends its JWT in `Authorization`, so it
can't call `TeamsBotMessagingResource` directly regardless of bot/JWT config correctness.

The relay (`relay/src/functions/teamsBotRelay.js`, Azure Functions Node.js v4 programming model)
fixes this by authenticating to Salesforce itself (OAuth 2.0 client credentials against a Connected
App) and putting *that* token in `Authorization` where Salesforce expects it, while moving Bot
Framework's original JWT into `X-Bot-Framework-Authorization` — the header `TeamsBotJwtValidator`
actually checks. This also means Apex runs as a real internal user rather than an anonymous Guest
User, sidestepping Salesforce's "Secure guest user record access" restriction that otherwise blocks
Case visibility even from enqueued async Apex.

**`teamsBotRelay` itself is deliberately dumb plumbing — no business logic.** JWT validation, card
building, and Case updates all stay in `TeamsBotMessagingResource`/`TeamsAdaptiveCardBuilder`. If
you're tempted to add logic to that function, it almost certainly belongs in Apex instead, to avoid
the two implementations drifting. The other relay functions (`chatHistory`, `chatSend`, `negotiate`,
`joinChat` — see "Case Swarm Chat: three delivery modes" below) are a separate, newer surface with
a bit more of their own logic (Graph/Bot Framework proxying, SignalR broadcast shaping), but they're
still intentionally stateless — Teams/Graph stays the source of truth, nothing is persisted in Azure.

Auth for that second surface is a **different mechanism** from the Bot Framework JWT relay above: a
short-lived HMAC-signed token (`chatId|userId|exp`, see `relay/src/bridgeAuth.js` and
`TeamsSwarmChatController.getChatBridgeSession`/`Chat_Bridge_HMAC_Secret__c`) minted by Apex and
validated by the relay on every call — not a Salesforce session and not the bot's JWT.

`relay/src/functions/talkToAgentTab.js` is a third, unrelated surface: a plain anonymous GET that
serves a static HTML/JS page (the "Talk to an Agent" Teams tab's content). It has **no auth
mechanism of its own and no shared code with either surface above** — all of its Salesforce calls
happen client-side, straight from the browser to Salesforce's public `scrt2` messaging domain. See
"Talk to an Agent tab" below.

### Case Swarm Chat bridge (`caseSwarmChat*` LWCs, `TeamsSwarmChatController`, `Swarm_Message__c`)

A secondary feature, Chat-swarm-only: lets agents send/receive Teams chat messages from inside
Salesforce without leaving the Case page. `caseSwarmChat` (thin wrapper, just wires an "End Chat"
button) hosts `caseSwarmChatCore`, which does the real work; `caseSwarmChatWidget`/
`caseSwarmChatUtility` are the same core in different placements (record page vs. utility bar).
A transcript is written to `Swarm_Message__c` (`Direction__c`, `Body__c`, `Teams_Message_Id__c`,
etc.) only when the agent clicks **End Chat** — live messages in SignalR/Azure-poll mode are not
persisted per-message, Teams is the source of truth while the chat is active. `caseSwarmTeamsEmbed`
is unrelated to the chat bridge — it just surfaces the "Open in Teams" link/status, since Microsoft
Teams doesn't support being iframe-embedded (the `height` `@api` property is kept only for App
Builder compatibility with older page layouts). `swarmUsageTracker` is a plain ES module (not a
component) that `caseSwarm` and `caseSwarmChatCore` both import to share in-tab, approximate usage
counters — they're sibling LWCs placed independently on the page so can't call each other directly,
and this sidesteps needing a mounted Lightning Message Service listener.

#### Case Swarm Chat: three delivery modes

`TeamsSwarmChatController.getChatBridgeSession` (called once per chat session by
`caseSwarmChatCore`) picks one of three modes based on `Teams_Bot_Config__mdt.Default`, and the LWC
falls back down this list on any failure — no code redeploy needed to revert:

1. **Apex Graph polling** (default, `Use_Azure_Chat_Bridge__c = false`) — `syncMessages`/
   `sendMessage` poll/post via `TeamsSwarmService` Graph calls every ~5s. Subject to Salesforce
   callout limits.
2. **Azure REST polling** (`Use_Azure_Chat_Bridge__c = true`, `Use_Azure_SignalR__c = false`) — the
   LWC polls the relay's `chatHistory`/`chatSend` functions directly instead of Apex, moving the
   Graph/Bot Framework callouts off Salesforce. `chatHistory` reads via Graph
   (`relay/src/graphChat.js`); `chatSend` posts via Bot Framework Connector
   (`relay/src/botSend.js`, `onBehalfOf` so the bubble shows "{agent} via Case Swarm").
3. **Azure SignalR push, "Option D"** (both flags `true`) — one-shot history load, then a live push
   connection via Azure SignalR Service (`negotiate`/`joinChat` relay functions,
   `relay/src/signalrHub.js`). The LWC's `caseSwarmChatSignalR.js` is a **hand-rolled WebSocket
   client speaking the SignalR JSON protocol directly** — it deliberately avoids
   `@microsoft/signalr` + LWC `loadScript`, which repeatedly hung/failed under Lightning Web
   Security. Falls back to mode 2's poll if the socket disconnects for ~10s
   (`SIGNALR_DISCONNECT_FALLBACK_MS`). **The `signalr.js`/`signalrLwc.js` static resources and
   `scripts/build-signalr-lwc-resource.js`/`patch-signalr-static.js` are leftovers from that
   abandoned `loadScript` approach — nothing loads them anymore; don't assume they're load-bearing.**

Auth for modes 2/3 is the short-lived HMAC bridge token described above, never a Salesforce session
or the Bot Framework JWT. README.md section 6h is the source of truth for the relay app settings,
CMDT fields, and CSP trusted sites this requires — check it before changing this flow.

### MessagingSession → Teams chat

Channel-agnostic: reacts to *any* `MessagingSession` (Omni-Channel routing object for
Embedded/Enhanced Messaging, standard or custom channels) once it's accepted, regardless of which
`MessagingChannel` created it. Doesn't care about or touch Case Swarm.

- `MessagingSessionTeamsChatHandler.handleAfterUpdate` (called from a plain trigger, not a
  framework) fires when `Status` just became `'Active'`, `Teams_Chat_Id__c` is still blank,
  `User__c` is populated, and `OwnerId` starts with `'005'` (a User, not a Queue) — then enqueues
  `MessagingSessionTeamsChatQueueable`. **`MessagingSession.Status` is only settable at insert, not
  via update DML** (a real platform constraint) — the handler can't be tested by firing real
  trigger DML, only by calling it directly with hand-built before/after records.
- `MessagingSessionTeamsChatQueueable` resolves both users' `Azure_AD_Email_Id__c`, dedupes to a
  single member if agent and customer resolve to the *same* identity (Graph rejects a chat with
  duplicate members), calls `TeamsSwarmService.createChat(topic, ownerIdentifier,
  allMemberIdentifiers)` — a 3-arg overload used so these chats aren't branded "Case Swarm - ..." —
  then writes `Teams_Chat_Id__c`/`Teams_Chat_Url__c` back onto the session.
- `TeamsBotMessagingResource.handleBotInstalled`'s `conversationUpdate` path, when no Case matches
  the conversation id, falls through to `signalMessagingSessionChatReady`: looks up the
  `MessagingSession` by `Teams_Chat_Id__c`, records `Teams_Bot_Service_Url__c`, and returns a
  `{signalRGroup, teamsChatId, teamsChatUrl, serviceUrl}` payload in the REST response body — which
  `relay/src/functions/teamsBotRelay.js` forwards on to the SignalR group so the LWC gets pushed a
  "your chat is ready" event instead of having to poll for it.
- `messagingSessionTeamsChatEmbed` LWC: a state machine (waiting/live/ended) that starts on a
  bounded `refreshApex` poll (`WAIT_POLL_INTERVAL_MS` × `WAIT_POLL_MAX_ATTEMPTS`) as a fallback in
  case the SignalR push never arrives, then switches to a live message list/composer once
  `Teams_Chat_Id__c` populates, reusing `c/caseSwarmChatSignalR` for the live push connection.
  `MessagingSessionTeamsChatController.getEmbedSession`/`getChatSession` mint the HMAC bridge
  tokens for the waiting vs. live SignalR groups respectively.
- **End Chat** (`MessagingSessionTeamsChatController.endChat`) pulls Graph history, upserts it to
  `Swarm_Message__c` via a `Messaging_Session__c` lookup (the *same* transcript object Case Swarm
  Chat uses — a deliberate reuse, not a new object), clears the three `Teams_*` fields, and
  best-effort enqueues `MessagingSessionChatDeleteQueueable` if `Delete_Teams_Chat_On_End__c` is
  true (mirrors `TeamsSwarmChatDeleteQueueable` but with no dedicated error-tracking field, per this
  feature's "no extra tracking fields" convention).

### "Talk to an Agent" tab (`relay/src/functions/talkToAgentTab.js`, `teamsapp-talk-to-agent/`)

A Teams personal tab whose entire implementation is one relay function serving a static page — no
Apex, no LWC, no shared relay code with either feature above. Its only job is to create a
`MessagingSession`; once an agent accepts it, control passes into "MessagingSession → Teams chat"
above completely unchanged, same as any other channel entry point.

Renders a **fully custom chat UI** against Salesforce's **Custom Client REST API** for Messaging
In-App and Web (the org's `MIAW_Custom_Client` deployment, `DeploymentType = API`, on the same
underlying "Live Chat" `MessagingChannel` used by the org's standard web widget deployment) instead
of loading Salesforce's own `bootstrap.min.js` widget UI. All calls go straight from the browser to
Salesforce's public `scrt2` domain via `fetch` — no relay proxying, no server-side auth:

1. `POST /iamessage/api/v2/authorization/unauthenticated/access-token` → bearer token.
2. `POST /iamessage/api/v2/conversation` → creates the conversation (this is what creates the
   `MessagingSession`), with the page's own pre-chat form fields (name/email) as
   `routingAttributes` — replaces Salesforce's default pre-chat form entirely.
3. `GET /eventrouter/v1/sse` (via `fetch` + a manual stream reader, **not** the native
   `EventSource` API, because `EventSource` can't send a custom `Authorization` header this
   endpoint requires) — real-time incoming events. **Requires an `X-Org-Id` header** in addition to
   the bearer token, or it 400s with "OrgId is required"; this isn't mentioned anywhere obvious and
   was found by inspecting the raw error response.
4. `POST /iamessage/api/v2/conversation/{id}/message` → send a message.
5. `DELETE /iamessage/api/v2/conversation/{id}?esDeveloperName=...` → end the conversation (End
   Chat). **Must have no request body and the `X-Org-Id` header** — a `/close` sub-path and a JSON
   body both 400/404; this exact shape was reverse-engineered via trial and error, not documented.

SSE event shapes actually observed from this org (field names aren't documented publicly, so verify
against real payloads before changing this parsing logic):
- `CONVERSATION_MESSAGE` — text lives at
  `conversationEntry.entryPayload` (a JSON *string*, needs a second `JSON.parse`) →
  `.abstractMessage.staticContent.text`. Sender role/name are on `conversationEntry.sender.role`
  and `conversationEntry.senderDisplayName` directly (not inside `entryPayload`).
- `CONVERSATION_PARTICIPANT_CHANGED` — fires for **both** an agent joining and leaving (End Chat
  from the Salesforce/agent side does *not* reliably send `CONVERSATION_CLOSE_CONVERSATION`; this
  is the actual signal). The event's own `sender` is `"Automated Process"` (a system entity, not
  the agent) — the real agent identity/display name is inside
  `entryPayload.entries[].participant`/`.displayName`, keyed by `operation: "add"` vs `"remove"`.
- `ping` — a plain SSE keep-alive (`event: ping`, incrementing counter as `data`), sent
  periodically to hold the connection open through proxies. Harmless, expected, not a new HTTP
  request — don't mistake it for a reconnect loop.

The SSE reconnect logic uses **exponential backoff with a hard cap** (`SSE_MAX_RETRIES`), and the
read loop explicitly checks `conversationEnded` and calls `reader.cancel()` once the conversation is
over, rather than retrying/pumping forever. This isn't just tidiness: a previous version retried
every 5s indefinitely on failure, which is suspected to have contributed to a since-resolved
incident where Omni-Channel agent presence login (`/routing/v1/agents/login`) started failing
org-wide — though the actual confirmed root cause that day was the org's **data storage exceeding
its limit** (`TenantUsageEntitlement`/`DataStorageMB` — Developer Edition orgs have very small
storage caps, e.g. 5MB, easily exhausted by test data), not the retry loop itself. Both are worth
ruling out if agent presence/routing ever mysteriously breaks again with no related code changes.

The conversation session (`accessToken`/`conversationId`/`lastEventId`) is persisted to
`localStorage` and resumed on tab reload instead of always starting a new one — reloading
mid-conversation would otherwise create a new `MessagingSession` (and abandon the old one) every
time. Message history isn't refetched on resume (no transcript endpoint wired up), so a resumed
view starts empty aside from a "Resuming your conversation..." notice, even though it's the same
underlying session.

### Identity bridging

Graph and the bot's chat-member logic key off `User.Azure_AD_Email_Id__c` (the person's M365
userPrincipalName/email), not Salesforce Id or `Azure_AD_Object_Id__c` — the latter is populated for
reference but not read by current code except one untested path in `TeamsSwarmService.addMembers`
(new Team member add, not chat add). If SME search or member-add is failing, check this field is
populated before looking anywhere else.
