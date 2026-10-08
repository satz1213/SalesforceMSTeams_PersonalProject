"""Generate Case Swarm SignalR Option D operational PDF (setup, permissions, difficulties)."""
from datetime import date
from pathlib import Path

from fpdf import FPDF

OUTPUT = Path(__file__).resolve().parent / "Case-Swarm-SignalR-Option-D-Guide.pdf"

BRAND = (0, 112, 210)
MUTED = (100, 100, 100)


def safe(text: str) -> str:
    return (
        text.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2192", "->")
        .replace("\u2022", "-")
        .replace("\u00d7", "x")
        .replace("\u2248", "~")
        .replace("\u2260", "!=")
        .replace("\u2011", "-")
        .replace("\xa0", " ")
        .replace("\u2026", "...")
    )


class DocPDF(FPDF):
    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(*MUTED)
            self.cell(0, 8, "Case Swarm - Azure SignalR Live Chat (Option D)", align="C")
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def section_title(self, title: str, level: int = 1) -> None:
        self.set_x(self.l_margin)
        self.ln(4 if level == 1 else 2)
        size = 14 if level == 1 else (12 if level == 2 else 10.5)
        self.set_font("Helvetica", "B", size)
        self.set_text_color(*(BRAND if level == 1 else (0, 0, 0)))
        self.multi_cell(0, 6.5, safe(title))
        self.set_x(self.l_margin)
        self.ln(1)

    def body_text(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, safe(text))
        self.set_x(self.l_margin)
        self.ln(1)

    def bullet(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, safe(f"  -  {text}"))
        self.set_x(self.l_margin)

    def numbered(self, n: int, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, safe(f"  {n}. {text}"))
        self.set_x(self.l_margin)

    def code_block(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Courier", "", 7.5)
        self.set_fill_color(245, 245, 245)
        self.set_text_color(40, 40, 40)
        for line in text.strip().split("\n"):
            self.set_x(self.l_margin)
            self.cell(0, 4, safe(line[:110]), new_x="LMARGIN", new_y="NEXT", fill=True)
        self.ln(2)
        self.set_x(self.l_margin)

    def simple_table(self, headers: list[str], rows: list[list[str]], col_widths: list[float] | None = None) -> None:
        if col_widths is None:
            usable = self.w - self.l_margin - self.r_margin
            col_widths = [usable / len(headers)] * len(headers)

        def draw_header() -> None:
            self.set_x(self.l_margin)
            self.set_font("Helvetica", "B", 8)
            self.set_fill_color(*BRAND)
            self.set_text_color(255, 255, 255)
            for i, h in enumerate(headers):
                self.cell(col_widths[i], 6, safe(h), border=1, fill=True)
            self.ln()

        draw_header()
        self.set_font("Helvetica", "", 7.5)
        fill = False
        for row in rows:
            line_h = 4
            max_lines = 1
            for i, cell in enumerate(row):
                chars = max(int(col_widths[i] / 1.8), 8)
                max_lines = max(max_lines, max(1, (len(safe(cell)) + chars - 1) // chars))
            row_h = line_h * max_lines + 2
            if self.get_y() + row_h > self.page_break_trigger:
                self.add_page()
                draw_header()
                self.set_font("Helvetica", "", 7.5)
            self.set_x(self.l_margin)
            y0 = self.get_y()
            x0 = self.l_margin
            self.set_fill_color(248, 248, 248) if fill else self.set_fill_color(255, 255, 255)
            self.set_text_color(30, 30, 30)
            for i, cell in enumerate(row):
                x = x0 + sum(col_widths[:i])
                self.set_xy(x, y0)
                self.rect(x, y0, col_widths[i], row_h, style="DF" if fill else "D")
                self.set_xy(x + 1, y0 + 1)
                self.multi_cell(col_widths[i] - 2, line_h, safe(cell))
            self.set_y(y0 + row_h)
            fill = not fill
        self.set_x(self.l_margin)
        self.ln(3)


def build() -> None:
    pdf = DocPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Cover
    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 9, "Case Swarm Chat")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 8, "Azure SignalR Live Chat (Option D)")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 6, "Operational guide: architecture, permissions, setup, and difficulties")
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 6, f"Generated {date.today().isoformat()}  |  Status: working end-to-end")
    pdf.set_x(pdf.l_margin)
    pdf.ln(3)
    pdf.body_text(
        "Source markdown: docs/Case-Swarm-SignalR-Option-D-Guide.md. "
        "Feature flags: Teams_Bot_Config__mdt.Default Use_Azure_Chat_Bridge__c + Use_Azure_SignalR__c."
    )

    # 1
    pdf.section_title("1. What Option D is")
    pdf.body_text(
        "Option D replaces continuous Graph history polling as the primary live path with "
        "Azure SignalR Service (Serverless). The agent opens Case Swarm Chat; the LWC loads "
        "one-shot history, negotiates SignalR, joins the chat group, and listens for newMessage. "
        "When someone types in Teams, Bot Framework delivers type=message to the Azure relay, "
        "which pushes a DTO to SignalR group=chatId. The LWC appends immediately without a "
        "Salesforce Daily REST API hit per message. Teams remains source of truth; "
        "persistTranscript still pulls Graph into Swarm_Message__c once at end of session."
    )
    pdf.simple_table(
        ["Path", "Cost / risk while chat is open"],
        [
            ["Apex -> Graph ~5s", "Salesforce callouts + Daily API"],
            ["LWC -> Azure -> Graph ~5s", "Graph 10/10s throttle; Azure executions"],
            ["SignalR push (D)", "Near-zero Graph while connected; SignalR + Functions on events"],
        ],
        [55, 125],
    )

    # 2
    pdf.section_title("2. Architecture")
    pdf.code_block(
        """Teams group chat
  |- install / Adaptive Card invoke -> teamsBotRelay -> Salesforce Apex REST
  `- plain type=message (RSC ChatMessage.Read.Chat OR @mention)
        -> teamsBotRelay -> Azure SignalR group=chatId target=newMessage

Salesforce LWC (caseSwarmChatCore)
  |- getChatBridgeSession (HMAC + flags)
  |- GET /api/chatHistory (one-shot on open; poll only if SignalR drops)
  |- POST /api/negotiate -> { url, accessToken }
  |- WebSocket wss://...signalr.net (native JSON hub client)
  |- POST /api/joinChat -> AddToGroup(userId, chatId)
  `- POST /api/chatSend -> Bot Framework + SignalR outbound echo"""
    )
    pdf.section_title("2.1 Auth surfaces (do not conflate)", 2)
    pdf.simple_table(
        ["Surface", "Credential / resource", "Purpose"],
        [
            ["Microsoft Graph", "MS_Graph", "Chat, members, install Teams app, list messages"],
            ["Bot Framework", "MS_Bot_Framework / Azure Bot", "Post as bot; activities to relay"],
            ["Azure SignalR", "AzureSignalRConnectionString", "Negotiate + group push"],
        ],
        [40, 55, 85],
    )
    pdf.section_title("2.2 Hub conventions", 2)
    pdf.simple_table(
        ["Item", "Value"],
        [
            ["Hub name", "swarmChat"],
            ["Group name", "Teams conversation.id / Case Swarm_Team_Id__c"],
            ["Client event", "newMessage (one DTO argument)"],
            ["SignalR user id", "Salesforce UserInfo.getUserId()"],
        ],
        [50, 130],
    )

    # 3 Permissions
    pdf.section_title("3. Permissions checklist (complete)")
    pdf.section_title("3.1 Entra app for MS_Graph (Application + admin consent)", 2)
    pdf.simple_table(
        ["Permission", "Why"],
        [
            ["Group.ReadWrite.All", "M365 group / team flows"],
            ["Team.Create / team member perms", "Team swarms"],
            ["Directory.Read.All", "Resolve users"],
            ["Chat.ReadWrite.All", "Create chats, members, list messages"],
            [
                "TeamsAppInstallation.ReadWriteAndConsentForChat.All",
                "REQUIRED to install RSC app and consent ChatMessage.Read.Chat",
            ],
        ],
        [75, 105],
    )
    pdf.body_text(
        "TeamsAppInstallation.ReadWriteForChat.All alone is NOT enough once the Teams app "
        "declares RSC. Graph returns 403 listing the ...AndConsent... permissions."
    )

    pdf.section_title("3.2 Teams app manifest RSC (no @mention)", 2)
    pdf.body_text(
        "Without ChatMessage.Read.Chat RSC, group-chat bots only receive messages when "
        "@mentioned. Manifest v1.0.1+ must include webApplicationInfo.id = bot App Id and "
        "authorization.permissions.resourceSpecific ChatMessage.Read.Chat Application."
    )
    pdf.code_block(
        """"webApplicationInfo": { "id": "<bot Microsoft App Id>", "resource": "https://Api" },
"authorization": {
  "permissions": {
    "resourceSpecific": [
      { "name": "ChatMessage.Read.Chat", "type": "Application" }
    ]
  }
}"""
    )

    pdf.section_title("3.3 Graph install body (Apex TeamsSwarmService.installBotApp)", 2)
    pdf.code_block(
        """POST /v1.0/chats/{chatId}/installedApps
{
  "teamsApp@odata.bind": "https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/{catalogId}",
  "consentedPermissionSet": {
    "resourceSpecificPermissions": [
      { "permissionValue": "ChatMessage.Read.Chat", "permissionType": "Application" }
    ]
  }
}"""
    )
    pdf.body_text(
        "Missing consentedPermissionSet -> ResourceSpecificPermissionsMismatch. "
        "Missing Consent Graph permission -> 403 Forbidden."
    )

    pdf.section_title("3.4 Salesforce CMDT", 2)
    pdf.simple_table(
        ["Setting", "Purpose"],
        [
            ["Use_Azure_Chat_Bridge__c", "LWC uses Azure history/send"],
            ["Use_Azure_SignalR__c", "negotiate/join/push (requires bridge on)"],
            ["Chat_Bridge_Azure_Base_Url__c", "Function App base URL with https://"],
            ["Chat_Bridge_HMAC_Secret__c", "Must match Azure CHAT_BRIDGE_HMAC_SECRET"],
            ["Teams_App_Catalog_Id__c", "Graph appCatalogs/teamsApps id (not manifest GUID)"],
        ],
        [70, 110],
    )

    pdf.section_title("3.5 Azure Function App settings", 2)
    pdf.bullet("AzureSignalRConnectionString - Serverless SignalR connection string")
    pdf.bullet("CHAT_BRIDGE_HMAC_SECRET - must match Salesforce CMDT secret")
    pdf.bullet("SALESFORCE_* - relay to Apex for Adaptive Cards only")
    pdf.bullet("Existing Bot/Graph settings used by chatSend")

    pdf.section_title("3.6 CSP Trusted Sites (LEX connect-src)", 2)
    pdf.simple_table(
        ["Site", "Endpoint"],
        [
            ["Chat_Bridge_Azure_Connect", "https://<function-app>.azurewebsites.net"],
            ["Chat_Bridge_SignalR_Connect", "https://case-swarm-signalr.service.signalr.net"],
            ["Chat_Bridge_SignalR_Wss", "wss://case-swarm-signalr.service.signalr.net"],
        ],
        [70, 110],
    )
    pdf.body_text(
        "https and wss are SEPARATE allowlist entries. Missing wss blocks the WebSocket "
        "even when https is present. Azure CSP must include the https:// scheme."
    )

    # 4 Setup
    pdf.section_title("4. Setup steps (ordered)")
    pdf.section_title("4.1 Azure SignalR + Function App", 2)
    pdf.numbered(1, "Create Azure SignalR Service: Serverless (Free_F1 fine for dev).")
    pdf.numbered(2, "Set Function App AzureSignalRConnectionString from primary connection string.")
    pdf.numbered(3, "Deploy relay with negotiate, joinChat, SignalR outputs on teamsBotRelay/chatSend.")
    pdf.numbered(4, "Confirm Functions extension bundle supports SignalR bindings.")
    pdf.numbered(5, "Set CHAT_BRIDGE_HMAC_SECRET identical to Salesforce CMDT.")

    pdf.section_title("4.2 Teams app (RSC)", 2)
    pdf.numbered(1, "Update teamsapp/manifest.json with RSC + webApplicationInfo.id = bot App Id.")
    pdf.numbered(2, "Bump version; zip manifest + icons; upload to Teams Admin catalog.")
    pdf.numbered(3, "Copy catalog teamsApps id into Teams_App_Catalog_Id__c.")
    pdf.numbered(4, "Entra Graph app: ReadWriteAndConsentForChat.All + Grant admin consent.")

    pdf.section_title("4.3 Salesforce", 2)
    pdf.numbered(1, "Deploy Apex/LWC/CMDT/CSP including Chat_Bridge_SignalR_Wss.")
    pdf.numbered(2, "Set CMDT: base URL, HMAC, both feature flags true, catalog id.")
    pdf.numbered(3, "Confirm installBotApp sends consentedPermissionSet.")

    pdf.section_title("4.4 Smoke test", 2)
    pdf.numbered(1, "Start a NEW Chat swarm (old chats may lack RSC install).")
    pdf.numbered(2, "Bot install succeeds (Swarm_Bot_Install_Error__c empty).")
    pdf.numbered(3, "Case chat badge: Live: SignalR push.")
    pdf.numbered(4, "Network: WebSocket to *.service.signalr.net; negotiate/joinChat 200.")
    pdf.numbered(5, "Type in Teams WITHOUT @mention -> LWC updates instantly.")
    pdf.numbered(6, "Optional: Sync / ~30s confirms Graph backup poll.")

    # 5 Client
    pdf.section_title("5. Client implementation notes")
    pdf.section_title("5.1 Native WebSocket hub (not @microsoft/signalr static resource)", 2)
    pdf.body_text(
        "Loading @microsoft/signalr via loadScript under Lightning Web Security failed "
        "repeatedly (see section 6). Production uses caseSwarmChatSignalR.js: minimal JSON "
        "hub protocol, handshake, newMessage invocations, ping/pong, reconnect with fresh negotiate."
    )
    pdf.section_title("5.2 Polling while SignalR is connected", 2)
    pdf.body_text(
        "During bring-up (before RSC), the LWC kept a ~30s Graph chatHistory poll even while "
        "SignalR showed connected. That backup is OFF now: while SignalR is connected there is "
        "no continuous poll; poll resumes only on disconnect fallback."
    )
    pdf.section_title("5.3 Session / HMAC", 2)
    pdf.bullet("Apex mints short-lived HMAC for chatId + userId.")
    pdf.bullet("Negotiate requires x-signalr-userid matching token userId.")
    pdf.bullet("joinChat adds that user to SignalR group chatId.")

    # 6 Difficulties
    pdf.section_title("6. Difficulties faced (and fixes)")
    pdf.body_text("Real blockers encountered bringing Option D live in this project:")

    difficulties = [
        (
            "6.1 CSP Azure URL missing https://",
            "Symptom: fell back to ~5s poll; negotiate blocked. "
            "Cause: Chat_Bridge_Azure_Connect host without scheme. "
            "Fix: full https:// Function App URL.",
        ),
        (
            "6.2 require is not defined (SignalR static resource)",
            "Symptom: badge showed require is not defined. "
            "Cause: LWS injects CommonJS module/exports; UMD took Node path. "
            "Attempted UMD patches; insufficient.",
        ),
        (
            "6.3 require(abort-controller) / AbortController unavailable",
            "Symptom: LWS hides free AbortController; SignalR Node polyfill path. "
            "Attempted polyfill + fetch bridge; still fragile under LWS.",
        ),
        (
            "6.4 loadLibrary timed out after 20000ms",
            "Symptom: ~5ms download but loadScript never settled. "
            "Cause: LWS evaluation hang (unreliable with bare self). "
            "Fix: abandoned loadScript/@microsoft/signalr; native WebSocket client in LWC.",
        ),
        (
            "6.5 CSP blocks wss:// despite https:// allowlist",
            "Symptom: CSP violation on WebSocket. "
            "Cause: Salesforce lists https and wss separately. "
            "Fix: Chat_Bridge_SignalR_Wss = wss://case-swarm-signalr.service.signalr.net.",
        ),
        (
            "6.6 Connected but no Teams messages unless @mention",
            "Symptom: green badge; plain text never arrives; @mention works. "
            "Cause: group bots only get mentions without RSC. "
            "Fix: manifest RSC + install consentedPermissionSet + Consent Graph permission. "
            "Interim during bring-up: ~30s Graph backup poll (later removed).",
        ),
        (
            "6.7 ResourceSpecificPermissionsMismatch on bot install",
            "Symptom: install fails after adding RSC to manifest. "
            "Cause: POST lacked consentedPermissionSet. "
            "Fix: Apex installBotApp includes ChatMessage.Read.Chat Application consent.",
        ),
        (
            "6.8 403 missing ...ReadWriteAndConsentForChat.All",
            "Symptom: after body fix, Graph 403 listing Consent permissions. "
            "Cause: Entra app only had ReadWriteForChat.All. "
            "Fix: add ReadWriteAndConsentForChat.All, admin consent, new swarm.",
        ),
        (
            "6.9 Public static resource CDN stickiness",
            "Symptom: patched signalr JS not used after deploy. "
            "Cause: cacheControl=Public. Lesson: Private or new resource name; moot after native client.",
        ),
        (
            "6.10 Concurrent loadScript from multiple LWC hosts",
            "Symptom: bare undefined when widget + record + utility all mounted. "
            "Lesson: shared module promise if using loadScript; native client avoids this.",
        ),
    ]
    for title, body in difficulties:
        pdf.section_title(title, 3)
        pdf.body_text(body)

    # 7 Runtime
    pdf.section_title("7. Runtime behaviour reference")
    pdf.simple_table(
        ["Badge", "Meaning"],
        [
            ["Live: SignalR push", "WebSocket up; push only (no continuous Graph poll)"],
            ["SignalR: ...", "Connecting / error / poll fallback"],
            ["Live: Azure poll (~5s)", "Bridge on, SignalR off"],
            ["Live: Apex poll (~5s)", "Bridge off"],
        ],
        [55, 125],
    )
    pdf.simple_table(
        ["Inbound path", "When it works"],
        [
            ["SignalR push", "Bot received activity (RSC or @mention) -> relay -> group"],
            ["Graph poll fallback", "Only when SignalR is down / reconnecting"],
            ["Outbound SF -> Teams", "chatSend -> Bot + SignalR echo"],
        ],
        [50, 130],
    )

    # 8 Troubleshooting
    pdf.section_title("8. Troubleshooting quick matrix")
    pdf.simple_table(
        ["Symptom", "Check"],
        [
            ["Still polling every 5s", "Flags, CSP https, badge error text"],
            ["CSP / wss blocked", "Chat_Bridge_SignalR_Wss present"],
            ["negotiate 401", "HMAC secret match; x-signalr-userid"],
            ["joinChat 401", "Token chatId match"],
            ["Push only on @mention", "RSC uploaded? Consent install? Graph Consent perm?"],
            ["Install PermissionsMismatch", "consentedPermissionSet? Catalog = RSC app?"],
            ["Install 403 Consent", "Entra ...AndConsent...All + admin consent"],
            ["Cards work, push doesn't", "Relay SignalR output? Connection string set?"],
        ],
        [55, 125],
    )

    # 9 Files
    pdf.section_title("9. Key repo files")
    pdf.simple_table(
        ["Area", "Path"],
        [
            ["LWC core", "force-app/.../lwc/caseSwarmChatCore/"],
            ["Native SignalR client", ".../caseSwarmChatSignalR.js"],
            ["Apex session / bridge", "TeamsSwarmChatController.cls"],
            ["Bot install + RSC body", "TeamsSwarmService.installBotApp"],
            ["Relay push", "relay/src/functions/teamsBotRelay.js"],
            ["Negotiate / join", "relay/src/functions/negotiate.js, joinChat.js"],
            ["Hub helpers", "relay/src/signalrHub.js"],
            ["Teams manifest", "teamsapp/manifest.json"],
            ["CSP", "cspTrustedSites/Chat_Bridge_*"],
            ["SignalR Azure notes", "relay/docs/signalr-setup.md"],
        ],
        [55, 125],
    )

    # 10 Rollback
    pdf.section_title("10. Rollback")
    pdf.numbered(1, "Use_Azure_SignalR__c = false -> Azure ~5s poll (bridge still on).")
    pdf.numbered(2, "Use_Azure_Chat_Bridge__c = false -> Apex Graph poll.")
    pdf.numbered(
        3,
        "Optional: remove RSC from Teams manifest and revert install body if Consent "
        "permission must be dropped (returns @mention requirement for bot-received messages).",
    )

    # 11 Summary
    pdf.section_title("11. Summary")
    pdf.body_text("Option D is viable in Salesforce LWC if:")
    pdf.numbered(
        1,
        "You avoid shipping @microsoft/signalr through loadScript under LWS "
        "(use a native WebSocket hub client).",
    )
    pdf.numbered(2, "You allowlist both https and wss for SignalR.")
    pdf.numbered(
        3,
        "You treat RSC + Consent Graph permission + consentedPermissionSet as mandatory "
        "for no-@mention push.",
    )
    pdf.numbered(
        4,
        "Optionally keep a slow Graph backup during RSC bring-up; once push is proven, "
        "stop polling while SignalR is connected.",
    )
    pdf.ln(2)
    pdf.body_text(
        "Once those are in place: green Live: SignalR push, Teams text without @mention, "
        "Adaptive Cards unchanged via relay -> Salesforce."
    )

    pdf.output(str(OUTPUT))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    build()
