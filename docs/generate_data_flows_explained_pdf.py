"""Generate first-time-friendly Case Swarm data-flow PDF from the Explained guide."""
from datetime import date
from pathlib import Path

from fpdf import FPDF

OUTPUT = Path(__file__).resolve().parent / "Case-Swarm-Data-Flows-Explained.pdf"

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
            self.cell(0, 8, "Case Swarm - Data Flows Explained (First-Time Guide)", align="C")
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def section_title(self, title: str, level: int = 1) -> None:
        self.set_x(self.l_margin)
        self.ln(5 if level == 1 else 3)
        size = 14 if level == 1 else (12 if level == 2 else 10.5)
        self.set_font("Helvetica", "B", size)
        self.set_text_color(*BRAND if level == 1 else (30, 30, 30))
        self.multi_cell(0, 7, safe(title))
        self.set_text_color(0, 0, 0)

    def body(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(40, 40, 40)
        self.multi_cell(0, 5.5, safe(text))
        self.ln(1)

    def bullet(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.multi_cell(0, 5.5, safe(f"- {text}"))

    def mono_block(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Courier", "", 8.5)
        self.set_text_color(50, 50, 50)
        self.set_fill_color(245, 245, 245)
        self.multi_cell(0, 4.5, safe(text), fill=True)
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def table(self, headers: list[str], rows: list[list[str]], col_widths: list[float] | None = None) -> None:
        usable = self.w - self.l_margin - self.r_margin
        if not col_widths:
            col_widths = [usable / len(headers)] * len(headers)
        self.set_font("Helvetica", "B", 8.5)
        self.set_fill_color(230, 240, 250)
        x0 = self.l_margin
        # Simple single-line cells to avoid wrap/x-position bugs
        h = 7
        if self.get_y() + h > self.h - 20:
            self.add_page()
        y0 = self.get_y()
        for i, htxt in enumerate(headers):
            self.set_xy(x0 + sum(col_widths[:i]), y0)
            self.cell(col_widths[i], h, safe(htxt)[:48], border=1, fill=True)
        self.ln(h)
        self.set_font("Helvetica", "", 7.5)
        for row in rows:
            # Soft-wrap long cells into multiple physical rows if needed
            wrapped: list[list[str]] = []
            for i, cell in enumerate(row):
                text = safe(str(cell))
                max_chars = max(int(col_widths[i] / 1.6), 6)
                parts = []
                while text:
                    parts.append(text[:max_chars])
                    text = text[max_chars:]
                wrapped.append(parts or [""])
            n = max(len(p) for p in wrapped)
            for line_i in range(n):
                if self.get_y() + h > self.h - 20:
                    self.add_page()
                y = self.get_y()
                for i in range(len(headers)):
                    part = wrapped[i][line_i] if line_i < len(wrapped[i]) else ""
                    self.set_xy(x0 + sum(col_widths[:i]), y)
                    self.cell(col_widths[i], h, part, border=1)
                self.ln(h)
        self.set_x(self.l_margin)


def build() -> None:
    pdf = DocPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*BRAND)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 9, "Case Swarm - Data Flows Explained")
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MUTED)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 6, "First-time guide: Salesforce, Azure, and Microsoft Teams")
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 6, f"Updated {date.today().isoformat()}  |  Live path: Azure bridge + SignalR (Option D)")
    pdf.ln(2)
    pdf.set_text_color(0, 0, 0)

    pdf.section_title("1. Big picture")
    pdf.body(
        "Case Swarm has two jobs: (1) Swarming - create a Teams Team or group Chat for a Case, "
        "add SMEs, install the bot, show a Case Adaptive Card. (2) Live chatting - let a Salesforce "
        "agent talk in that Teams chat from the Case page."
    )
    pdf.body("Three applications always involved:")
    pdf.table(
        ["App", "Owns"],
        [
            ["Salesforce", "Case, agent UI (LWC), Apex, Adaptive Card REST"],
            ["Azure", "Relay Functions + SignalR (dumb plumbing)"],
            ["Microsoft 365", "Teams chat, Graph, Bot Framework"],
        ],
        [45, 140],
    )
    pdf.ln(2)
    pdf.mono_block(
        "Salesforce  <->  Azure (relay / SignalR)  <->  Teams / Graph / Bot\n"
        "SF decides WHAT. Azure moves bytes. Microsoft is the real chat room."
    )

    pdf.section_title("2. Two Microsoft doors")
    pdf.body("Do not conflate Graph and Bot Framework:")
    pdf.table(
        ["Door", "Used for"],
        [
            ["Microsoft Graph (MS_Graph / GRAPH_*)", "Create chat/team, members, install app, list history"],
            ["Bot Framework (MS_Bot_Framework / MICROSOFT_APP_*)", "Post as Case Swarm bot; receive Teams activities"],
        ],
        [70, 115],
    )
    pdf.ln(2)
    pdf.body(
        "Graph app-only cannot reliably post live chat messages as this bot needs. "
        "Outbound live text and Adaptive Cards use Bot Framework instead."
    )

    pdf.section_title("3. What is a callout?")
    pdf.table(
        ["Term", "Meaning", "SF callout limit?"],
        [
            ["Apex callout", "Apex Http.send / Named Credential on SF server", "Yes"],
            ["Browser fetch", "LWC fetch() from agent browser to Azure", "No"],
            ["Azure HTTPS", "Function calls Graph or Bot Framework", "No (not SF)"],
        ],
        [40, 100, 45],
    )
    pdf.ln(2)
    pdf.body("Live outbound send (Azure bridge) - production:")
    pdf.mono_block(
        "Browser LWC  --fetch-->  Azure chatSend  --HTTPS-->  Bot Framework  -->  Teams\n"
        "              (not Apex)                    (not Salesforce)"
    )
    pdf.body("Apex fallback send (bridge off): LWC -> Apex sendMessage -> MS_Bot_Framework callout -> Bot -> Teams.")

    pdf.add_page()
    pdf.section_title("4. Flow A - Start a Chat swarm")
    pdf.body(
        "Agent starts Quick Chat -> SF asks Graph to create chat -> Case Active -> bot installed -> "
        "Teams tells Azure bot joined -> Azure tells SF -> SF stores serviceUrl and posts Case card."
    )
    pdf.table(
        ["Step", "App", "What happens"],
        [
            ["1", "SF", "caseSwarm LWC: pick SMEs, start Chat swarm"],
            ["2-3", "SF->Graph", "Apex callout MS_Graph: create chat + members (Azure_AD_Email_Id__c)"],
            ["4-5", "SF", "Case: Active, Type=Chat, Team_Id=chatId, Team_Url"],
            ["6", "SF->Graph", "Queueable installs Teams app (RSC for no-@mention read)"],
            ["7-8", "Teams->Azure->SF", "conversationUpdate via relay; Apex REST stores Swarm_Bot_Service_Url__c"],
            ["9", "SF->Bot", "Queueable posts Case Adaptive Card as bot"],
        ],
        [18, 42, 125],
    )
    pdf.ln(2)
    pdf.body(
        "Code: TeamsSwarmController, TeamsSwarmService, TeamsSwarmBotInstallQueueable, "
        "teamsBotRelay.js, TeamsBotMessagingResource, TeamsBotInstalledCardQueueable, TeamsBotConversationService."
    )

    pdf.section_title("5. Flow B - Team swarm (short)")
    pdf.body(
        "Graph creates M365 group then enables Team (async retry possible). Members added. "
        "Open in Teams only today - live SF text bridge and SignalR are Chat-swarm only."
    )

    pdf.section_title("6. Flow C - Open live chat in SF")
    pdf.body("Flags: Use_Azure_Chat_Bridge__c + Use_Azure_SignalR__c on Teams_Bot_Config CMDT.")
    pdf.table(
        ["Step", "Mechanism", "What happens"],
        [
            ["1", "Apex session", "getChatBridgeSession: HMAC, chatId, serviceUrl, paths"],
            ["2-3", "fetch + Graph", "GET /api/chatHistory one-shot via Azure"],
            ["4-7", "fetch + WSS", "negotiate, WebSocket, joinChat (group=chatId)"],
            ["8", "UI", "Live: SignalR push - no continuous Graph poll while connected"],
        ],
        [18, 40, 127],
    )
    pdf.ln(2)
    pdf.body("Code: caseSwarmChatCore.js, caseSwarmChatSignalR.js, chatHistory.js, negotiate.js, joinChat.js.")

    pdf.add_page()
    pdf.section_title("7. Flow D - Inbound Teams -> Salesforce")
    pdf.body(
        "SME types in Teams -> Bot Framework -> Azure relay -> SignalR newMessage -> LWC appends bubble. "
        "No Graph per message while SignalR is up. No Swarm_Message__c write on live Azure path."
    )
    pdf.mono_block(
        "Teams user -> Bot Framework -> teamsBotRelay -> SignalR group=chatId\n"
        "  -> LWC appendPushedMessage (dedupe)"
    )
    pdf.body("Card Edit/Save invokes still go Relay -> Salesforce Apex REST (business logic in Apex).")

    pdf.section_title("8. Flow E - Outbound SF -> Teams (no Graph)")
    pdf.body(
        "Agent types in SF -> browser POST Azure /api/chatSend -> Azure posts Bot Framework "
        "using Case Swarm_Bot_Service_Url__c + Swarm_Team_Id__c -> Teams shows Case Swarm bot -> "
        "SignalR echoes to LWC. Graph is not called."
    )
    pdf.table(
        ["Step", "Where", "SF Apex callout?"],
        [
            ["1", "LWC handleSend / sendViaAzure", "No"],
            ["2", "Browser fetch POST /api/chatSend + HMAC", "No"],
            ["3", "chatSend.js -> sendAgentMessage", "No"],
            ["4", "botSend.js POST .../v3/conversations/{id}/activities", "No"],
            ["5", "SignalR outbound echo", "No"],
        ],
        [18, 130, 37],
    )
    pdf.ln(2)
    pdf.body(
        "Exact files: caseSwarmChatCore.js (sendViaAzure), relay/src/functions/chatSend.js, "
        "relay/src/botSend.js (postActivity). Apex fallback: TeamsSwarmChatController.sendMessage -> "
        "TeamsBotConversationService.sendAgentText (THIS is an SF callout via MS_Bot_Framework)."
    )

    pdf.section_title("9. Why the Azure relay exists")
    pdf.body(
        "Salesforce Apex REST treats Authorization as a Salesforce session. Bot Framework always sends "
        "its JWT in Authorization. Relay authenticates to Salesforce (Connected App), puts SF token in "
        "Authorization, and moves Bot JWT to X-Bot-Framework-Authorization for TeamsBotJwtValidator."
    )
    pdf.mono_block(
        "Bot Framework                 Azure Relay                      Salesforce\n"
        "Authorization: Bot JWT   ->    Authorization: SF token\n"
        "                               X-Bot-Framework-Authorization: Bot JWT"
    )

    pdf.add_page()
    pdf.section_title("10. Cheat sheet - who talks to whom")
    pdf.table(
        ["Action", "SF callout?", "Browser fetch?", "Graph?", "Bot Framework?", "SignalR?"],
        [
            ["Create Chat swarm", "Yes Graph", "No", "Yes", "Card later", "No"],
            ["Open history once", "No", "Yes Azure", "Via Azure", "No", "No"],
            ["SignalR connect", "No", "Yes", "No", "No", "Yes"],
            ["Inbound Teams text", "No", "Push in", "No", "Receive relay", "Push"],
            ["Outbound (bridge)", "No", "Yes chatSend", "No", "Yes", "Echo"],
            ["Outbound (Apex)", "Yes Bot NC", "No", "No", "Yes", "No"],
            ["Card Edit invoke", "Relay->Apex", "No", "No", "Invoke", "No"],
        ],
        [38, 28, 32, 28, 32, 27],
    )

    pdf.ln(3)
    pdf.section_title("11. One-page memory aid")
    pdf.mono_block(
        "SWARM:   SF Apex --Graph--> Teams chat --> bot install\n"
        "         Teams --Bot--> Azure relay --Apex REST--> serviceUrl + card\n\n"
        "LIVE OPEN:  SF LWC --fetch--> Azure history (Graph once) --> SignalR join\n\n"
        "INBOUND:  Teams --Bot--> Azure --SignalR--> SF LWC\n"
        "          (no Graph per message; no Apex per message)\n\n"
        "OUTBOUND: SF LWC --fetch--> Azure chatSend --Bot Framework--> Teams\n"
        "          (+ SignalR echo). Not Graph. Not SF Apex callout on bridge path."
    )

    pdf.section_title("12. Related markdown in docs/")
    pdf.bullet("Case-Swarm-Data-Flows-Explained.md - this guide (source)")
    pdf.bullet("Case-Swarm-SignalR-Option-D-Guide.md - setup and troubleshooting")
    pdf.bullet("Case-Swarm-Chat-Bridge-Options-and-Limits.md - options and limits")
    pdf.bullet("Case-Swarm-Architecture-and-Data-Flows.md - deeper diagrams")

    pdf.output(str(OUTPUT))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    build()
