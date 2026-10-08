"""Technical architect PDF — PNG diagrams + boxed text data flows."""
from datetime import date
from pathlib import Path

from fpdf import FPDF

DOCS = Path(__file__).resolve().parent
OUT = DOCS / "Case-Swarm-Technical-Architecture.pdf"
IMG1 = DOCS / "case-swarm-tech-swarm-alone.png"
IMG2 = DOCS / "case-swarm-tech-sf-chat-poll.png"
BRAND = (0, 112, 210)
MUTED = (100, 100, 100)


def safe(text: str) -> str:
    return (
        text.replace("\u2014", "-")
        .replace("\u2013", "-")
        .replace("\u2018", "'")
        .replace("\u2019", "'")
        .replace("\u2192", "->")
        .replace("\u00a0", " ")
    )


class TechPDF(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(
            0,
            8,
            f"Case Swarm Technical Architecture  |  {date.today().isoformat()}  |  Page {self.page_no()}",
            align="C",
        )

    def title_bar(self, text: str) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(*BRAND)
        self.multi_cell(0, 7, safe(text))
        self.set_x(self.l_margin)
        self.ln(2)

    def body(self, text: str, size: int = 10) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", size)
        self.set_text_color(30, 30, 30)
        self.multi_cell(0, 5, safe(text))
        self.set_x(self.l_margin)
        self.ln(1)

    def box_diagram(self, lines: list[str], font_size: float = 7.5) -> None:
        """Draw a bordered monospace diagram."""
        self.set_x(self.l_margin)
        usable = self.w - self.l_margin - self.r_margin
        line_h = font_size * 0.45 + 1.2
        pad = 2
        height = len(lines) * line_h + pad * 2
        x = self.l_margin
        y = self.get_y()
        if y + height > self.page_break_trigger:
            self.add_page()
            y = self.get_y()
        self.set_draw_color(0, 112, 210)
        self.set_fill_color(252, 252, 252)
        self.rect(x, y, usable, height, style="DF")
        self.set_font("Courier", "", font_size)
        self.set_text_color(25, 25, 25)
        ty = y + pad
        for line in lines:
            self.set_xy(x + 2, ty)
            self.cell(usable - 4, line_h, safe(line))
            ty += line_h
        self.set_y(y + height + 3)
        self.set_x(self.l_margin)

    def simple_table(self, headers: list[str], rows: list[list[str]], widths: list[float]) -> None:
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 8)
        self.set_fill_color(*BRAND)
        self.set_text_color(255, 255, 255)
        for h, w in zip(headers, widths):
            self.cell(w, 7, safe(h), border=1, fill=True)
        self.ln()
        fill = False
        self.set_font("Helvetica", "", 8)
        for row in rows:
            self.set_x(self.l_margin)
            self.set_fill_color(248, 248, 248) if fill else self.set_fill_color(255, 255, 255)
            self.set_text_color(30, 30, 30)
            for cell, w in zip(row, widths):
                self.cell(w, 8, safe(cell)[:70], border=1, fill=True)
            self.ln()
            fill = not fill
        self.set_x(self.l_margin)
        self.ln(3)


def build() -> None:
    pdf = TechPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(True, 16)

    # Cover
    pdf.add_page()
    pdf.set_xy(pdf.l_margin, 50)
    pdf.set_font("Helvetica", "B", 26)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 11, "Case Swarm", align="C")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 9, "Technical Architecture", align="C")
    pdf.set_x(pdf.l_margin)
    pdf.ln(8)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        6,
        "Capability view: protocols, APIs, credentials, data stores.\n"
        "Includes visual diagrams (PNG) and boxed text architecture / data-flow diagrams.",
        align="C",
    )

    # System context architecture
    pdf.add_page()
    pdf.title_bar("Architecture - system context")
    pdf.body("Capability boxes only. Two outbound Microsoft auth surfaces (Graph vs Bot Framework).")
    pdf.box_diagram(
        [
            "+--------------------------- SALESFORCE ---------------------------+",
            "|  [Case Swarm UI]     [Case Chat UI]                              |",
            "|         |                  |                                      |",
            "|         v                  v                                      |",
            "|  [Swarm Orchestration] [Chat Bridge API]                         |",
            "|         |               /           \\                             |",
            "|         |        sync/list        send                            |",
            "|         v            |              |                             |",
            "|  [Case swarm fields] |              |                             |",
            "|                      v              v                             |",
            "|         [NC: Microsoft Graph]  [NC: Bot Framework]                |",
            "|                      |              |                             |",
            "|  [Bot Messaging REST API + JWT validation]                        |",
            "|  [Chat transcript custom object]                                  |",
            "+----------------------------+--+-----------------------------------+",
            "                             |  |",
            "              inbound bot    |  |  outbound Graph / Bot",
            "              activities     |  |",
            "+----------------------------v  v-----------------------------------+",
            "| AZURE: [Bot Activity Relay]   (SF OAuth + Bot JWT header rewrite) |",
            "+----------------------------+--------------------------------------+",
            "                             |",
            "+----------------------------v--------------------------------------+",
            "| MICROSOFT 365                                                     |",
            "|  [Microsoft Graph API]  <-->  [Teams Chat / Team]                 |",
            "|  [Bot Framework Connector API] --> posts card / chat as bot       |",
            "+-------------------------------------------------------------------+",
        ],
        font_size=7,
    )

    # Auth table
    pdf.title_bar("Auth surfaces (do not conflate)")
    pdf.simple_table(
        ["Integration", "Protocol", "Purpose"],
        [
            ["Graph Named Credential", "Client credentials", "Create chat/group/team, members, list, install app"],
            ["Bot Framework Named Credential", "Client credentials", "Post Adaptive Cards and live chat text as bot"],
            ["Bot Activity Relay -> Salesforce", "Connected App OAuth", "Inbound bot activities; Bot JWT in custom header"],
        ],
        [60, 45, 155],
    )
    pdf.body(
        "Graph app-only cannot post interactive live chat (401). Outbound chat/cards use Bot Framework. "
        "Salesforce rejects Bot JWT in Authorization; relay moves it to a custom header for Apex validation."
    )

    # Diagram 1 - PNG then boxed dataflow
    pdf.add_page()
    pdf.title_bar("1a. Architecture diagram - swarm provision + Adaptive Card")
    if IMG1.exists():
        pdf.image(str(IMG1), x=18, w=255)
    else:
        pdf.body("(PNG missing: case-swarm-tech-swarm-alone.png)")

    pdf.add_page()
    pdf.title_bar("1b. Data flow (boxed) - swarm provision + Adaptive Card")
    pdf.body("No chat transcript object written in this flow. Chat path shown; Team path uses group + async enable Team.")
    pdf.box_diagram(
        [
            "  [Case Swarm UI]",
            "        |",
            "        v  start swarm (Chat) + members",
            "  [Swarm Orchestration]",
            "        |",
            "        +----------> [NC Graph] ---> POST /chats ---> [Teams Chat]",
            "        |                                              ^",
            "        v                                              |",
            "  [Case: Active, type=Chat, chat id, URL]              |",
            "        |                                              |",
            "        v  async                                       |",
            "  [Bot app install via Graph] -------------------------+",
            "        |",
            "        v  bot-added activity",
            "  [Teams] --> [Bot Framework] --> [Bot Activity Relay]",
            "                                        |",
            "                                        v  SF token + Bot JWT (custom header)",
            "                               [Bot Messaging REST API]",
            "                                  | validate JWT",
            "                                  | store Bot service URL on Case",
            "                                  v",
            "                               [NC Bot Framework] --> post Adaptive Card --> [Teams]",
        ],
        font_size=7.5,
    )
    pdf.body(
        "Why relay: Bot Framework always sends Authorization Bearer Bot-JWT; Salesforce Apex REST treats "
        "Authorization as a Salesforce session and would 401 before Apex. Relay swaps tokens."
    )

    # Diagram 2 - PNG then boxed dataflow
    pdf.add_page()
    pdf.title_bar("2a. Architecture diagram - Apex poll chat sync")
    pdf.body("Azure chat bridge feature flag OFF.")
    if IMG2.exists():
        pdf.image(str(IMG2), x=18, w=255)
    else:
        pdf.body("(PNG missing: case-swarm-tech-sf-chat-poll.png)")

    pdf.add_page()
    pdf.title_bar("2b. Data flow (boxed) - Apex poll chat sync")
    pdf.body(
        "Condition: Use_Azure_Chat_Bridge = false (or Azure session fallback). "
        "No Graph webhook - Salesforce PULLS messages on a timer."
    )
    pdf.box_diagram(
        [
            "  INBOUND (Teams -> Salesforce)                    OUTBOUND (Salesforce -> Teams)",
            "  ---------------------------                     ------------------------------",
            "  [SME posts in Teams Chat]                       [Agent types in Case Chat UI]",
            "           |                                                |",
            "           | (message sits in Teams)                        v",
            "           |                                       [Chat Bridge API: send]",
            "           v                                                |",
            "  [Case Chat UI]  setInterval every ~5s                     |",
            "           |                                                v",
            "           v                                       [NC Bot Framework]",
            "  [Chat Bridge API: sync]                                   |",
            "           |                                                v",
            "           v                                       POST conversation activity",
            "  [NC Graph] GET /chats/{id}/messages                       |",
            "           |                                                v",
            "           v                                       [Teams Chat] (appears as bot)",
            "  skip bot/application rows                                 |",
            "  upsert Inbound --> [Chat transcript object] <----+--------+  insert Outbound",
            "           |                                       |           (immediate)",
            "           v                                       |",
            "  UI renders message list <------------------------+",
        ],
        font_size=7,
    )

    pdf.title_bar("Exact poll call chain (code path)")
    pdf.box_diagram(
        [
            "  Case Chat UI: startPolling()                 // setInterval 5000 ms",
            "       -> syncQuietly()                        // if NOT Azure bridge",
            "       -> fetchApexSync()",
            "       -> Chat Bridge API: syncMessages(caseId)",
            "       -> upsertFromGraph(caseId, includeBot=false)",
            "       -> Graph client: listChatMessages(chatId, 50)",
            "       -> Http.send  GET callout:MS_Graph/.../chats/{id}/messages",
            "       -> upsert Chat transcript custom object",
            "",
            "  Azure bridge ON: same timer, but syncQuietly -> fetchAzureHistory()",
            "  (browser -> Azure -> Graph). Does NOT call syncMessages each tick.",
        ],
        font_size=7.5,
    )

    # Persistence + checklist
    pdf.add_page()
    pdf.title_bar("Chat transcript persistence (Apex poll mode)")
    pdf.simple_table(
        ["Direction", "Mechanism", "When written", "Notes"],
        [
            ["Outbound", "Bot Framework callout + DML insert", "Immediate", "External id = bot activity id"],
            ["Inbound", "Graph list + DML upsert", "Next poll ~5s", "External id = Teams message id"],
            ["Bot Graph echo", "Filtered on sync", "Not stored again", "Avoid duplicate Outbound"],
            ["Card field edit", "Bot Messaging REST -> Case DML", "Case fields only", "No transcript row"],
        ],
        [35, 90, 55, 80],
    )

    pdf.title_bar("Runtime cost (architect view)")
    pdf.simple_table(
        ["Operation", "Salesforce impact"],
        [
            ["Chat panel open ~45 min", "~540 Apex HTTP callouts to Graph (not Daily REST API)"],
            ["Each agent send", "1 Bot Framework callout + 1 DML"],
            ["Bot install / card invoke", "Inbound Daily REST API via relay"],
        ],
        [70, 190],
    )

    pdf.title_bar("Webhook?")
    pdf.body(
        "No Microsoft Graph change-notification webhook for chat messages. "
        "Inbound chat is always pull (Apex poll or Azure history poll). "
        "Bot Framework POSTs to the Azure relay only for bot install and Adaptive Card invoke "
        "(bot messaging endpoint, not a Graph chat webhook)."
    )

    pdf.title_bar("Capability map")
    pdf.body(
        "Case Swarm UI / Case Chat UI (Lightning) | "
        "Swarm Orchestration + async provision (Apex) | "
        "Chat Bridge API sync/send (Apex) | "
        "Bot Messaging REST + JWT validation | "
        "Bot Activity Relay (Azure Functions) | "
        "Named Credentials: Graph + Bot Framework | "
        "Transcript custom object (external id = Teams message id) | "
        "Identity: Azure AD email/UPN on User"
    )

    pdf.output(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
