"""Generate Salesforce-Teams Case Swarm architecture PDF."""
from datetime import date
from pathlib import Path

from fpdf import FPDF

OUTPUT = Path(__file__).resolve().parent / "Salesforce-Teams-Case-Swarm-Architecture.pdf"

# Brand color (Salesforce blue)
BRAND = (0, 112, 210)
MUTED = (100, 100, 100)


class ArchPDF(FPDF):
    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(*MUTED)
            self.cell(0, 8, "Salesforce - Microsoft Teams Case Swarm Architecture", align="C")
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def section_title(self, title: str, level: int = 1) -> None:
        self.ln(4 if level == 1 else 2)
        size = 16 if level == 1 else (13 if level == 2 else 11)
        self.set_font("Helvetica", "B", size)
        if level == 1:
            self.set_text_color(*BRAND)
        else:
            self.set_text_color(0, 0, 0)
        self.multi_cell(0, 7, title)
        self.ln(2)

    def body_text(self, text: str) -> None:
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, text)
        self.ln(2)

    def bullet(self, text: str, indent: int = 0) -> None:
        self.set_x(self.l_margin + indent * 5)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, f"  -  {text}")

    def numbered(self, n: int, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, f"  {n}. {text}")

    def code_block(self, text: str) -> None:
        self.set_font("Courier", "", 7)
        self.set_fill_color(245, 245, 245)
        self.set_text_color(40, 40, 40)
        for line in text.strip().split("\n"):
            self.cell(0, 4, line, ln=True, fill=True)
        self.ln(3)

    def simple_table(self, headers: list[str], rows: list[list[str]], col_widths: list[int] | None = None) -> None:
        if col_widths is None:
            usable = self.w - self.l_margin - self.r_margin
            col_widths = [int(usable / len(headers))] * len(headers)

        def draw_header() -> None:
            self.set_x(self.l_margin)
            self.set_font("Helvetica", "B", 9)
            self.set_fill_color(0, 112, 210)
            self.set_text_color(255, 255, 255)
            for i, h in enumerate(headers):
                self.cell(col_widths[i], 7, h, border=1, fill=True)
            self.ln()

        draw_header()
        self.set_font("Helvetica", "", 8)
        self.set_text_color(30, 30, 30)
        fill = False

        for row in rows:
            if self.get_y() > self.h - 30:
                self.add_page()
                draw_header()
                self.set_font("Helvetica", "", 8)
                self.set_text_color(30, 30, 30)

            x_start = self.l_margin
            y_start = self.get_y()
            line_sets: list[list[str]] = []
            row_height = 7
            for i, cell in enumerate(row):
                lines = self.multi_cell(col_widths[i], 5, cell, dry_run=True, output="LINES")
                line_sets.append(lines)
                row_height = max(row_height, len(lines) * 5)

            for i, lines in enumerate(line_sets):
                x = x_start + sum(col_widths[:i])
                bg = (248, 248, 248) if fill else (255, 255, 255)
                self.set_fill_color(*bg)
                self.rect(x, y_start, col_widths[i], row_height, style="DF")
                self.set_xy(x + 1, y_start + 1)
                for line in lines:
                    self.cell(col_widths[i] - 2, 5, line, new_x="RIGHT", new_y="TOP")
                    self.set_xy(x + 1, self.get_y() + 5)

            self.set_xy(self.l_margin, y_start + row_height)
            fill = not fill

        self.ln(4)
        self.set_x(self.l_margin)


def build_pdf() -> FPDF:
    pdf = ArchPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Title page
    pdf.ln(30)
    pdf.set_font("Helvetica", "B", 24)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 12, "Salesforce - Microsoft Teams\nCase Swarm Integration", align="C")
    pdf.ln(8)
    pdf.set_font("Helvetica", "", 16)
    pdf.set_text_color(60, 60, 60)
    pdf.cell(0, 10, "Architecture & Component Reference", align="C", ln=True)
    pdf.ln(10)
    pdf.set_font("Helvetica", "I", 11)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 8, f"Generated: {date.today():%B %d, %Y}", align="C", ln=True)
    pdf.cell(0, 8, "Project: SFMSTeamsInOutProject", align="C", ln=True)

    pdf.add_page()

    pdf.section_title("1. Executive Overview")
    pdf.body_text(
        "This solution enables Salesforce Service Cloud agents to start a Microsoft Teams "
        "swarm directly from a Case record. A swarm brings subject-matter experts (SMEs) "
        "into a shared Teams workspace - either a Team (M365 group) or a group Chat - so they "
        "can collaborate on resolving the case."
    )
    pdf.body_text(
        "For Chat swarms, a Teams bot posts an interactive Adaptive Card that lets participants "
        "view and edit Case fields (Status, Priority, Owner, Subject, Description) inline inside "
        "Teams, with changes written back to Salesforce."
    )
    pdf.body_text(
        "Key design principle: all Microsoft API calls run server-side in Apex. The Lightning "
        "Web Component (LWC) never calls Microsoft Graph or Bot Framework directly."
    )

    pdf.section_title("2. High-Level Architecture")
    pdf.body_text(
        "The integration spans three platforms: Salesforce (business logic and data), "
        "Microsoft 365 / Teams (collaboration), and Azure (bot registration and HTTP relay)."
    )
    pdf.code_block("""
+-----------------------------------------------------------------------------+
|                              SALESFORCE ORG                                  |
|  caseSwarm (LWC) --> TeamsSwarmController --> TeamsSwarmService (Graph)     |
|  TeamsBotMessagingResource <-- relay <-- Azure Bot Service                  |
|  Named Credentials: MS_Graph, MS_Bot_Framework                               |
+-----------------------------------------------------------------------------+
         | Graph API / Bot Connector API                    ^
         v                                                |
+-----------------------------------------------------------------------------+
|                         MICROSOFT AZURE / M365                               |
|  Azure AD App  |  Azure Bot Service  |  Azure Function (teamsBotRelay)      |
|                         Microsoft Teams (Team / Chat / Bot)                  |
+-----------------------------------------------------------------------------+
""")

    pdf.section_title("3. Why Server-Side Integration?")
    pdf.bullet("Authentication: Graph requires OAuth bearer tokens. Client secrets cannot safely live in browser code (LWC).")
    pdf.bullet("CORS: graph.microsoft.com does not accept arbitrary browser-origin requests for app-only auth.")
    pdf.bullet("Pattern: LWC -> Apex Controller -> Apex Service -> Named Credential -> Microsoft APIs.")
    pdf.ln(2)

    pdf.section_title("4. Component Inventory")

    pdf.section_title("4.1 Salesforce - User Interface", level=2)
    pdf.simple_table(
        ["Component", "Type", "Purpose"],
        [
            ["caseSwarm", "LWC", "Case page UI: SME search, swarm type (Team/Chat), Start swarm, Add members, Open in Teams, status polling."],
        ],
        [30, 28, 132],
    )

    pdf.section_title("4.2 Salesforce - Apex Controllers & Services", level=2)
    pdf.simple_table(
        ["Component", "Purpose"],
        [
            ["TeamsSwarmController", "LWC entry point: searchUsers(), startSwarm(), addMembersToSwarm()."],
            ["TeamsSwarmService", "Graph API: create group, enable team, add members, create chat, install bot."],
            ["TeamsSwarmProvisionQueueable", "Retries team enablement until Graph propagates new group."],
            ["TeamsSwarmProvisionScheduler", "Schedules first provisioning retry."],
            ["TeamsSwarmBotInstallQueueable", "Installs bot into chat asynchronously after swarm creation."],
            ["TeamsBotMessagingResource", "REST /teamsbot/messages - handles Bot Framework activities."],
            ["TeamsBotJwtValidator", "Validates Bot Framework RS256 JWT against JWKS."],
            ["TeamsAdaptiveCardBuilder", "Builds view/edit Adaptive Card JSON (Action.Execute)."],
            ["TeamsBotConversationService", "Posts cards via Bot Framework Connector API v3."],
            ["TeamsBotInstalledCardQueueable", "Posts initial case card after bot installation."],
        ],
        [50, 140],
    )

    pdf.section_title("4.3 Salesforce - Configuration & Data", level=2)
    pdf.simple_table(
        ["Resource", "Purpose"],
        [
            ["MS_Graph / MS_Graph_Cred", "Named Credential for Microsoft Graph (client credentials)."],
            ["MS_Bot_Framework / MS_Bot_Framework_Cred", "Named Credential for Bot Framework Connector API."],
            ["Teams_Bot_Config__mdt", "Microsoft App Id and Teams App Catalog Id."],
            ["Teams_Swarm_User", "Permission set for swarm Apex access."],
            ["Case custom fields", "Swarm_Team_Id__c, Swarm_Group_Id__c, Swarm_Team_Url__c, Swarm_Status__c, Swarm_Type__c, Swarm_Bot_Service_Url__c, Swarm_Bot_Install_Error__c."],
            ["User custom fields", "Azure_AD_Email_Id__c (required), Azure_AD_Object_Id__c (optional)."],
        ],
        [50, 140],
    )

    pdf.section_title("4.4 Microsoft Azure", level=2)
    pdf.simple_table(
        ["Component", "Purpose"],
        [
            ["Azure AD App Registration", "Service identity for Graph and bot. Permissions: Group.ReadWrite.All, Team.Create, Directory.Read.All, Chat.ReadWrite.All, TeamsAppInstallation.ReadWriteForChat.All."],
            ["Azure Bot Service", "Registers bot; messaging endpoint points to relay (not Salesforce directly)."],
            ["Azure Function: teamsBotRelay", "Rewrites Authorization header; OAuth to Salesforce; forwards request body."],
            ["Teams App Catalog", "Custom app from teamsapp/manifest.json for bot install in chats."],
        ],
        [50, 140],
    )

    pdf.section_title("5. Authentication & Connection Establishment")

    pdf.section_title("5.1 Salesforce to Microsoft Graph", level=2)
    pdf.numbered(1, "Agent clicks Start swarm in LWC.")
    pdf.numbered(2, "LWC calls TeamsSwarmController.startSwarm() via @AuraEnabled Apex.")
    pdf.numbered(3, "Apex calls TeamsSwarmService using callout:MS_Graph.")
    pdf.numbered(4, "Named Credential obtains OAuth token from login.microsoftonline.com (client credentials).")
    pdf.numbered(5, "Scope: https://graph.microsoft.com/.default")
    pdf.numbered(6, "Graph creates M365 group/Chat; members identified by User.Azure_AD_Email_Id__c.")
    pdf.ln(2)

    pdf.section_title("5.2 Salesforce to Bot Framework Connector", level=2)
    pdf.numbered(1, "TeamsBotMessagingResource captures conversation serviceUrl on bot install.")
    pdf.numbered(2, "Stored on Case.Swarm_Bot_Service_Url__c.")
    pdf.numbered(3, "TeamsBotConversationService posts to {serviceUrl}/v3/conversations/{id}/activities.")
    pdf.numbered(4, "Authenticated via MS_Bot_Framework Named Credential.")
    pdf.ln(2)

    pdf.section_title("5.3 Bot Framework to Salesforce (Inbound)", level=2)
    pdf.body_text("This connection requires the Azure Function relay.")
    pdf.numbered(1, "Teams action triggers Bot Framework POST to Azure Bot messaging endpoint.")
    pdf.numbered(2, "Azure Bot forwards to teamsBotRelay Azure Function.")
    pdf.numbered(3, "Relay reads Bot JWT from Authorization header.")
    pdf.numbered(4, "Relay gets Salesforce OAuth token (Connected App client credentials).")
    pdf.numbered(5, "Relay forwards to /services/apexrest/teamsbot/messages with Authorization = Salesforce token and X-Bot-Framework-Authorization = Bot JWT.")
    pdf.numbered(6, "TeamsBotJwtValidator validates Bot JWT; resource processes activity and returns card JSON for invoke actions.")
    pdf.ln(2)

    pdf.section_title("5.4 Why Relay (Not Power Automate)", level=2)
    pdf.bullet("Salesforce intercepts Authorization on apexrest and treats it as a Salesforce session - Bot JWT causes 401 before Apex runs.")
    pdf.bullet("Relay moves Bot JWT to X-Bot-Framework-Authorization.")
    pdf.bullet("Azure Function chosen for synchronous low-latency pass-through required by Teams invoke responses.")
    pdf.ln(2)

    pdf.section_title("6. End-to-End User Flows")

    pdf.section_title("6.1 Start Team Swarm", level=2)
    pdf.numbered(1, "Agent selects SMEs and swarm type Team.")
    pdf.numbered(2, "TeamsSwarmService.createGroup() - POST /v1.0/groups.")
    pdf.numbered(3, "Case: Swarm_Status__c = Provisioning, Swarm_Type__c = Team.")
    pdf.numbered(4, "Async job retries PUT /groups/{id}/team until ready.")
    pdf.numbered(5, "Members added via Graph $batch; status becomes Active.")
    pdf.ln(2)

    pdf.section_title("6.2 Start Chat Swarm (Interactive Bot Card)", level=2)
    pdf.numbered(1, "TeamsSwarmService.createChat() - POST /v1.0/chats.")
    pdf.numbered(2, "Case immediately Active; bot install queued async.")
    pdf.numbered(3, "Graph installs bot; Teams sends conversationUpdate to relay.")
    pdf.numbered(4, "Initial Adaptive Card posted; Edit/Save updates Case in Salesforce.")
    pdf.ln(2)

    pdf.section_title("6.3 Add Members", level=2)
    pdf.numbered(1, "Agent selects SMEs on active swarm Case.")
    pdf.numbered(2, "Graph addMembers (Team) or addChatMembers (Chat).")
    pdf.ln(2)

    pdf.section_title("7. Identity & Data Model")
    pdf.body_text("Users need Azure_AD_Email_Id__c (M365 email/UPN) to appear in SME picker and be added to swarms.")
    pdf.simple_table(
        ["Case Field", "Description"],
        [
            ["Swarm_Team_Id__c", "Graph Team id or Chat id."],
            ["Swarm_Group_Id__c", "M365 group id (Team swarms only)."],
            ["Swarm_Team_Url__c", "Deep link to open in Teams."],
            ["Swarm_Status__c", "Empty, Provisioning, Active, or Failed."],
            ["Swarm_Type__c", "Team or Chat."],
            ["Swarm_Bot_Service_Url__c", "Bot Framework serviceUrl for posting cards."],
            ["Swarm_Bot_Install_Error__c", "Diagnostic if bot install fails."],
        ],
        [50, 140],
    )

    pdf.section_title("8. Security Model")
    pdf.bullet("Outbound: OAuth client credentials in Salesforce External Credentials.")
    pdf.bullet("Inbound: Bot Framework JWT validated (RS256, issuer, audience, expiry).")
    pdf.bullet("Relay OAuth proves integration caller; Bot JWT proves Bot Framework origin.")
    pdf.bullet("Case updates scoped: Swarm_Team_Id__c must match conversation id.")
    pdf.ln(2)

    pdf.section_title("9. Deployment Checklist")
    pdf.simple_table(
        ["Step", "Platform", "Action"],
        [
            ["1", "Azure AD", "Register app; Graph permissions; client secret."],
            ["2", "Salesforce", "MS_Graph Named Credential."],
            ["3", "Salesforce", "Case/User fields; populate Azure_AD_Email_Id__c."],
            ["4", "Salesforce", "Deploy package; add caseSwarm LWC to Case page."],
            ["5", "Azure", "Create Azure Bot; messaging endpoint = relay URL."],
            ["6", "Azure", "Deploy teamsBotRelay Function App."],
            ["7", "Salesforce", "Connected App for relay OAuth."],
            ["8", "Teams", "Upload teamsapp manifest; note catalog id."],
            ["9", "Salesforce", "Teams_Bot_Config__mdt; MS_Bot_Framework credential."],
            ["10", "Salesforce", "Expose REST endpoint for relay."],
        ],
        [12, 28, 150],
    )

    pdf.section_title("10. Known Limitations")
    pdf.bullet("Interactive bot card works for Chat swarms only, not Team/channel swarms.")
    pdf.bullet("Team provisioning is asynchronous (Provisioning status until Graph completes).")
    pdf.bullet("JWKS fetched on every bot request (fine at low volume).")
    pdf.bullet("Relay uses real integration user OAuth instead of Guest Site (Case access restrictions).")

    pdf.ln(6)
    pdf.set_font("Helvetica", "I", 9)
    pdf.set_text_color(*MUTED)
    pdf.cell(0, 8, "- End of document -", align="C")

    return pdf


def main() -> None:
    pdf = build_pdf()
    pdf.output(OUTPUT)
    print(f"Created: {OUTPUT}")


if __name__ == "__main__":
    main()
