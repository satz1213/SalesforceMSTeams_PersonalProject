"""Generate Case Swarm architecture & data-flow PDF (text diagrams; see .md for Mermaid)."""
from datetime import date
from pathlib import Path

from fpdf import FPDF

OUTPUT = Path(__file__).resolve().parent / "Case-Swarm-Architecture-and-Data-Flows.pdf"
BRAND = (0, 112, 210)
MUTED = (100, 100, 100)


def safe(text: str) -> str:
    return (
        text.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u2192", "->")
        .replace("\u2190", "<-")
        .replace("\u00a0", " ")
    )


class DocPDF(FPDF):
    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(*MUTED)
            self.cell(0, 8, "Case Swarm Architecture and Data Flows", align="C")
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def section(self, title: str, level: int = 1) -> None:
        self.set_x(self.l_margin)
        self.ln(3 if level == 1 else 2)
        self.set_font("Helvetica", "B", 14 if level == 1 else 11)
        self.set_text_color(*(BRAND if level == 1 else (0, 0, 0)))
        self.multi_cell(0, 6, safe(title))
        self.set_x(self.l_margin)

    def p(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, safe(text))
        self.set_x(self.l_margin)
        self.ln(1)

    def code(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Courier", "", 7.5)
        self.set_fill_color(245, 245, 245)
        self.set_text_color(40, 40, 40)
        for line in text.strip().split("\n"):
            self.set_x(self.l_margin)
            self.cell(0, 4, safe(line), new_x="LMARGIN", new_y="NEXT", fill=True)
        self.ln(2)
        self.set_x(self.l_margin)

    def table(self, headers: list[str], rows: list[list[str]], widths: list[float]) -> None:
        def header_row() -> None:
            self.set_x(self.l_margin)
            self.set_font("Helvetica", "B", 8)
            self.set_fill_color(*BRAND)
            self.set_text_color(255, 255, 255)
            for i, h in enumerate(headers):
                self.cell(widths[i], 6, safe(h), border=1, fill=True)
            self.ln()

        header_row()
        fill = False
        self.set_font("Helvetica", "", 7.5)
        for row in rows:
            if self.get_y() > 270:
                self.add_page()
                header_row()
                self.set_font("Helvetica", "", 7.5)
            self.set_x(self.l_margin)
            y0 = self.get_y()
            line_h = 4
            max_lines = 1
            for i, c in enumerate(row):
                chars = max(int(widths[i] / 1.7), 6)
                max_lines = max(max_lines, max(1, (len(safe(c)) + chars - 1) // chars))
            row_h = line_h * max_lines + 2
            self.set_fill_color(248, 248, 248) if fill else self.set_fill_color(255, 255, 255)
            self.set_text_color(30, 30, 30)
            x0 = self.l_margin
            for i, c in enumerate(row):
                x = x0 + sum(widths[:i])
                self.rect(x, y0, widths[i], row_h, style="DF" if fill else "D")
                self.set_xy(x + 1, y0 + 1)
                self.multi_cell(widths[i] - 2, line_h, safe(c))
            self.set_y(y0 + row_h)
            fill = not fill
        self.set_x(self.l_margin)
        self.ln(3)


def build() -> None:
    pdf = DocPDF()
    pdf.set_auto_page_break(True, 18)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 20)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 9, "Case Swarm")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 7, "Architecture and Data Flows")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 5, f"Generated {date.today().isoformat()}")
    pdf.set_x(pdf.l_margin)
    pdf.ln(2)
    pdf.p(
        "Interactive Mermaid diagrams: docs/Case-Swarm-Architecture-and-Data-Flows.md. "
        "This PDF is a printable companion."
    )
    pdf.p(
        "Covers (1) Case swarming alone and (2) Case swarming with Salesforce Apex chat polling "
        "and Swarm_Message__c creation. Azure live bridge is out of scope here "
        "(see Case-Swarm-Chat-Bridge-Options-and-Limits)."
    )

    pdf.section("1. Case swarming alone")
    pdf.p(
        "Creates a Team or Chat in Microsoft Teams, updates Case swarm fields, and for Chat swarms "
        "installs the bot and posts an Adaptive Card. No Swarm_Message__c transcript."
    )
    pdf.section("Architecture", 2)
    pdf.code(
        """[Salesforce]                         [Azure]              [Microsoft]
caseSwarm LWC
  -> TeamsSwarmController
  -> TeamsSwarmService --MS_Graph--> Graph --> Teams Chat/Team
  -> Case (Status, Type, Ids, Url)
  -> BotInstall Queueable --Graph--> install app into chat
                                         Teams
                                           | Bot Framework activity
                                           v
                                     teamsBotRelay
                                           | SF OAuth + X-Bot-Framework-Auth
                                           v
                               TeamsBotMessagingResource
                                 -> set Swarm_Bot_Service_Url__c
                                 -> card Queueable
                                 -> Bot Framework sendCard
                                 -> Teams Adaptive Card
                                 -> invoke Edit/Save updates Case"""
    )
    pdf.section("Case fields", 2)
    pdf.table(
        ["Field", "Purpose"],
        [
            ["Swarm_Status__c", "Provisioning / Active / Failed"],
            ["Swarm_Type__c", "Team or Chat"],
            ["Swarm_Team_Id__c", "Team/group id or chat id"],
            ["Swarm_Group_Id__c", "M365 group id (Team path)"],
            ["Swarm_Team_Url__c", "Open in Teams link"],
            ["Swarm_Bot_Service_Url__c", "Bot serviceUrl (Chat path)"],
            ["Swarm_Bot_Install_Error__c", "Non-fatal bot install error"],
        ],
        [55, 125],
    )
    pdf.section("Chat swarm sequence", 2)
    pdf.code(
        """Agent -> startSwarm(Chat)
  -> Graph POST /chats -> Case Active + chatId
  -> enqueue installBot -> Graph installedApps
  -> Teams conversationUpdate -> Relay -> Apex REST
  -> Case.Swarm_Bot_Service_Url__c
  -> Queueable sendCard via Bot Framework
  -> SME Edit/Save on card -> Relay -> Apex -> update Case -> refreshed card"""
    )
    pdf.section("Team swarm sequence", 2)
    pdf.code(
        """Agent -> startSwarm(Team)
  -> Graph POST /groups -> Case Provisioning
  -> Scheduler/Queueable enableTeam + add members
  -> Case Active
  (No interactive bot card on Team path today)"""
    )

    pdf.add_page()
    pdf.section("2. Case swarming + SF polling chat sync")
    pdf.p(
        "When Use_Azure_Chat_Bridge__c = false (or Azure session falls back). "
        "Same swarm provision as section 1, plus live chat UI that polls Apex every ~5s. "
        "Swarm_Message__c is written DURING the session."
    )
    pdf.section("Architecture", 2)
    pdf.code(
        """Swarm provision (section 1) unchanged.

Live chat (SF poll mode):
  caseSwarmChatCore
    |-- every ~5s --> TeamsSwarmChatController.syncMessages
    |                    -> Graph GET /chats/{id}/messages
    |                    -> upsert Swarm_Message__c (Inbound; skip bot rows)
    |
    |-- send --------> TeamsSwarmChatController.sendMessage
                         -> Bot Framework sendText
                         -> insert Swarm_Message__c Outbound (immediate)
                         -> Teams shows message as bot"""
    )
    pdf.section("Send from Salesforce", 2)
    pdf.code(
        """LWC sendMessage(caseId, body)
  -> Bot Framework POST activity "AgentName: body"
  -> Teams
  -> INSERT Swarm_Message__c Outbound (Teams_Message_Id = bot:activityId)
  -> return stored list to LWC

Cost: 1 Apex callout + 1 DML per send"""
    )
    pdf.section("Receive from Teams (poll)", 2)
    pdf.code(
        """SME posts in Teams
  ... wait until next LWC poll (~5s) ...
LWC syncMessages(caseId)
  -> Graph list messages
  -> upsert human messages as Inbound
  -> skip application/bot Graph rows
  -> LWC renders; unread badge if new Inbound

Cost: 1 Apex Graph callout per poll tick (+ DML when new)
NOTE: No Graph webhook - Salesforce PULLS on a timer."""
    )
    pdf.section("Exact code locations - SF chat poll", 2)
    pdf.p(
        "Runs only when useAzureBridge is false (CMDT Use_Azure_Chat_Bridge__c = false, or Azure session fallback). "
        "No Graph webhook is involved."
    )
    pdf.table(
        ["Step", "Location", "What"],
        [
            ["1 Interval", "caseSwarmChatCore.js APEX_SYNC_INTERVAL_MS=5000 (~L33-34)", "5s cadence"],
            ["2 Timer", "startPolling() (~L349-360)", "setInterval -> syncQuietly()"],
            ["3 Branch", "syncQuietly() (~L413-419)", "Apex path: fetchApexSync()"],
            ["4 LWC call", "fetchApexSync() (~L433-435)", "syncMessages({ caseId })"],
            ["5 Apex entry", "TeamsSwarmChatController.syncMessages (~L199-202)", "upsertFromGraph(false)"],
            ["6 Callout", "TeamsSwarmService.listChatMessages (~L253-260)", "GET .../chats/{id}/messages"],
            ["7 Persist", "upsertFromGraph in ChatController", "Upsert Swarm_Message__c Inbound"],
        ],
        [28, 95, 57],
    )
    pdf.code(
        """CALL CHAIN (SF poll only):
caseSwarmChatCore.startPolling()          // setInterval every 5000 ms
  -> syncQuietly()                        // useAzureBridge ? Azure : Apex
  -> fetchApexSync()                      // SF poll path only
  -> TeamsSwarmChatController.syncMessages(caseId)
  -> upsertFromGraph(caseId, false)
  -> TeamsSwarmService.listChatMessages(chatId, 50)
  -> Http.send GET callout:MS_Graph/.../chats/{id}/messages
  -> upsert Swarm_Message__c

Azure bridge ON: same timer, but syncQuietly uses fetchAzureHistory()
  (browser -> Azure -> Graph). Does NOT call syncMessages each tick."""
    )
    pdf.section("What creates Swarm_Message__c", 2)
    pdf.table(
        ["Event", "Writer", "Timing"],
        [
            ["Agent sends from LWC", "sendMessage insert", "Immediate"],
            ["SME posts in Teams", "syncMessages upsert", "Next poll (~5s)"],
            ["Bot/application Graph rows", "Skipped in syncMessages", "N/A"],
            ["Adaptive Card edit", "Case fields only", "No chat row"],
        ],
        [55, 60, 65],
    )

    pdf.section("3. Side-by-side")
    pdf.table(
        ["Concern", "Swarm alone", "Swarm + SF chat poll"],
        [
            ["Creates Team/Chat", "Yes", "Yes"],
            ["Bot + Case card", "Chat yes", "Chat yes"],
            ["Live SF-Teams messaging UI", "No", "Yes"],
            ["Swarm_Message during session", "No", "Yes"],
            ["Graph list from Apex while open", "No", "Every ~5s"],
            ["Bot send from Apex", "Card only", "Card + chat text"],
        ],
        [55, 55, 70],
    )

    pdf.section("4. Flag reminder")
    pdf.table(
        ["Use_Azure_Chat_Bridge__c", "Chat live path"],
        [
            ["false", "Section 2 - SF Apex poll + immediate Swarm_Message__c"],
            ["true", "Azure chatHistory/chatSend; transcript only via persistTranscript on close"],
        ],
        [55, 125],
    )

    pdf.section("5. Related code")
    pdf.table(
        ["Area", "Path"],
        [
            ["Start swarm", "TeamsSwarmController, TeamsSwarmService, caseSwarm"],
            ["Bot / card", "TeamsBotMessagingResource, install/card Queueables"],
            ["Relay", "relay/src/functions/teamsBotRelay.js"],
            ["SF chat poll (exact)", "See section Exact code locations - caseSwarmChatCore L349-435 -> syncMessages -> listChatMessages L253-260"],
            ["Transcript object", "Swarm_Message__c"],
        ],
        [45, 135],
    )

    pdf.section("6. Webhook?")
    pdf.p(
        "No Microsoft Graph change-notification webhook is used for chat sync. "
        "Inbound messages are discovered by polling (Apex syncMessages or Azure chatHistory). "
        "Bot Framework does POST activities to the Azure relay for bot install and Adaptive Card invoke - "
        "that is the bot messaging endpoint, not a Graph chat-message webhook."
    )

    pdf.output(str(OUTPUT))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    build()
