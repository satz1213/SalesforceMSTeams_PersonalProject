"""Generate Case Swarm Chat Bridge options/limits reference PDF."""
from datetime import date
from pathlib import Path

from fpdf import FPDF

OUTPUT = Path(__file__).resolve().parent / "Case-Swarm-Chat-Bridge-Options-and-Limits.pdf"

BRAND = (0, 112, 210)
MUTED = (100, 100, 100)


def safe(text: str) -> str:
    """Map common Unicode to Latin-1-safe equivalents for Helvetica."""
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
    )


class BridgePDF(FPDF):
    def header(self):
        if self.page_no() > 1:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(*MUTED)
            self.cell(0, 8, "Case Swarm Chat Bridge - Options, Limits & Cost", align="C")
            self.ln(4)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

    def section_title(self, title: str, level: int = 1) -> None:
        self.set_x(self.l_margin)
        self.ln(4 if level == 1 else 2)
        size = 15 if level == 1 else (12 if level == 2 else 11)
        self.set_font("Helvetica", "B", size)
        self.set_text_color(*(BRAND if level == 1 else (0, 0, 0)))
        self.multi_cell(0, 7, safe(title))
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
            self.cell(0, 4, safe(line), new_x="LMARGIN", new_y="NEXT", fill=True)
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
            # Estimate height for wrapped cells via max line count
            line_h = 4
            max_lines = 1
            for i, cell in enumerate(row):
                # rough wrap estimate
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
    pdf = BridgePDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    # Cover
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 22)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 10, "Case Swarm Chat Bridge")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 8, "Options, Limits and Cost Reference")
    pdf.set_x(pdf.l_margin)
    pdf.ln(4)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 6, f"Generated {date.today().isoformat()}")
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 6, "Current path: Azure live chat bridge (LWC polls Azure ~every 2s)")
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(
        0,
        6,
        "Revert: Teams_Bot_Config.Use_Azure_Chat_Bridge__c = false -> Apex Graph polling",
    )
    pdf.set_x(pdf.l_margin)
    pdf.ln(4)
    pdf.body_text(
        "Reference for choosing and operating the Salesforce <-> Microsoft Teams chat bridge. "
        "Source markdown: docs/Case-Swarm-Chat-Bridge-Options-and-Limits.md"
    )

    # 1
    pdf.section_title("1. Requirement (what we optimized for)")
    pdf.simple_table(
        ["Priority", "Requirement"],
        [
            ["Must", "Near-real-time chat: agent (Salesforce LWC) <-> SME (Teams)"],
            ["Must", "Chat swarms only (not Team/channel)"],
            ["Nice", "No Salesforce record required per message (Swarm_Message__c deferred)"],
            ["Constraint", "Protect Salesforce Daily REST API and Apex HTTP callouts"],
            ["Constraint", "Also care about Azure Function executions / cost"],
            ["Constraint", "Outbound posts as the bot (Graph app-only cannot send live chat)"],
        ],
        [35, 145],
    )
    pdf.body_text(
        "Hard truth: every design spends somewhere (Salesforce, Azure, Graph, or UX delay). "
        "There is no free real-time path."
    )

    # 2
    pdf.section_title("2. Architecture map (current)")
    pdf.code_block(
        """Teams chat
  |- install / Adaptive Card invoke
  |     -> teamsBotRelay -> Salesforce TeamsBotMessagingResource
  |- plain type=message
        -> teamsBotRelay returns 200 (no Salesforce call)

Salesforce LWC (caseSwarmChatCore)
  |- once: getChatBridgeSession (Apex HMAC token)
  |- ~2s:  GET  Azure /api/chatHistory  -> Microsoft Graph list messages
  |- send: POST Azure /api/chatSend     -> Bot Framework Connector"""
    )
    pdf.body_text(
        "Teams is the source of truth for message history in the current path (B). "
        "No Azure Table/Cosmos is used today. Option G (Azure Table Storage) is documented as an alternative buffer."
    )
    pdf.section_title("Feature flag", level=2)
    pdf.simple_table(
        ["CMDT field", "Effect"],
        [
            ["Use_Azure_Chat_Bridge__c = true", "LWC -> Azure history/send"],
            ["Use_Azure_Chat_Bridge__c = false", "LWC -> Apex syncMessages / sendMessage (original Graph poll)"],
        ],
        [70, 110],
    )
    pdf.body_text(
        "Also required when Azure is on: Chat_Bridge_Azure_Base_Url__c, Chat_Bridge_HMAC_Secret__c "
        "(match Azure CHAT_BRIDGE_HMAC_SECRET), CSP Trusted Site for the Function App URL. See README section 6h."
    )

    # 3
    pdf.add_page()
    pdf.section_title("3. Options catalogue")

    options = [
        (
            "A. Apex Graph poll (original)",
            "LWC every ~5s -> Apex syncMessages -> Graph; send via Apex Bot callout; optional Swarm_Message__c.",
            [["High callouts while open", "Low", "~5s", "Low"]],
        ),
        (
            "B. Azure live poll (stateless) - CURRENT",
            "LWC every ~2s -> Azure chatHistory -> Microsoft Graph list; send via Azure chatSend -> Bot; "
            "plain messages not forwarded to SF. No Azure Table - Teams/Graph is the only message store.",
            [["Very low for chat", "High if panels stay open (Graph every poll)", "~0-2s", "Low-medium"]],
        ),
        (
            "C. Azure poll tuned (5-10s / focus only)",
            "Same as B with slower or smarter polling.",
            [["Very low", "Medium", "OK", "Low"]],
        ),
        (
            "D. SignalR / push (recommended next at scale)",
            "Teams message -> relay -> Azure SignalR -> LWC; send via Azure Bot; optional one-time Graph history on open. "
            "Prefer SignalR over raw SSE on Functions (HTTP ~230s limit).",
            [["Very low", "Low (per message + connections)", "Best", "Medium"]],
        ),
        (
            "E. Per-message into Salesforce",
            "Every Teams message -> Apex REST; every SF send -> Apex callout; optional Platform Events.",
            [["High (linear with messages)", "Low", "Best", "Medium"]],
        ),
        (
            "F. Graph change-notification webhooks",
            "Graph POSTs to Azure on new messages; then push (D), Table (G), or SF write (E).",
            [["Depends", "Medium (subscriptions)", "Best", "High"]],
        ),
        (
            "G. Azure Table Storage (message buffer)",
            "Bot/webhook upserts each message into Azure Table (PartitionKey=chatId). LWC reads Table (cheap) "
            "instead of Graph every 2s. Optional batch to Swarm_Message__c on close / timer. "
            "Variants: G1 live Table only; G2 Table+batch to SF; G3 Table+SignalR. Not built in current repo (current=B).",
            [["Very low (unless batch every msg)", "Medium (Table writes + cheap reads)", "Near RT / instant w/ SignalR", "Medium-higher"]],
        ),
        (
            "H. Sync on open / close / schedule only",
            "No live poll; one Graph sync when needed.",
            [["Very low", "Very low", "No", "Low"]],
        ),
        (
            "I. SOQL-only UI poll",
            "Poll listStoredMessages only; another writer must create rows.",
            [["SOQL load", "Depends on writer", "Only if rows appear", "Low"]],
        ),
        (
            "J. Teams-only (no SF chat UI)",
            "Case has Open in Teams + swarm metadata only.",
            [["Minimal", "Minimal", "In Teams only", "Lowest"]],
        ),
        (
            "K. Salesforce Messaging / BYOC",
            "Full Service Cloud messaging channel.",
            [["Platform", "Adapter", "Native Omni", "Very high"]],
        ),
    ]

    for title, desc, rows in options:
        pdf.section_title(title, level=2)
        pdf.body_text(desc)
        pdf.simple_table(["SF", "Azure", "Live", "Complexity"], rows, [45, 50, 40, 45])
        if title.startswith("G."):
            pdf.section_title("Option G flow", level=3)
            pdf.code_block(
                """Teams message  -> bot relay (or Graph webhook)
               -> upsert Azure Table (PartitionKey = chatId)
SF send        -> chatSend -> Bot Framework
               -> upsert Outbound in same table
LWC            -> GET history from Table (not Graph every 2s)
Optional batch -> timer / on close -> Swarm_Message__c"""
            )
            pdf.simple_table(
                ["B Stateless Graph poll", "G Azure Table"],
                [
                    ["History each poll: Graph list", "History each poll: Table query"],
                    ["Inbound write: none", "1 Table upsert per Teams message"],
                    ["Graph while open: every ~2s", "Graph rare / never"],
                    ["Graph blip: history fails", "LWC can read last stored rows"],
                ],
                [90, 90],
            )

    # 4
    pdf.add_page()
    pdf.section_title("4. Ranking for this requirement")
    pdf.body_text("Optimized for: live chat + low SF + low Azure + reasonable complexity.")
    pdf.simple_table(
        ["Rank", "Option", "Verdict"],
        [
            ["1", "D - SignalR push", "Most efficient / cost-effective at scale"],
            ["2", "B - Azure poll ~2s (current)", "Best simplicity / value now; burns Azure/Graph while idle"],
            ["3", "C - Slower / focus-only Azure poll", "Cheap interim if Azure $ grows"],
            ["4", "G - Azure Table (+ optional SignalR/batch)", "Cuts Graph poll cost; adds storage; good for history buffer / SF transcript"],
            ["5", "E - Per-message Salesforce API", "Good for Azure; bad for SF"],
            ["6", "A - Apex Graph poll", "Worst for SF callouts"],
            ["7", "H - Sync on open/close", "Cheapest; fails live requirement"],
            ["8", "K - Messaging BYOC", "Overkill for Case swarm widget"],
        ],
        [18, 62, 100],
    )
    pdf.section_title("One-line recommendation", level=2)
    pdf.bullet("Today: keep Azure poll (B).")
    pdf.bullet("If Azure/Graph poll volume hurts: prefer SignalR (D) first; use Table (G) if you also need Azure history or batch transcript to SF.")
    pdf.bullet("Do not go to per-message Salesforce (E) unless SF limits no longer matter.")
    pdf.bullet("Do not return to Apex polling (A) for live chat.")

    # 5
    pdf.section_title("5. Worked example - limits comparison")
    pdf.body_text(
        "Assumptions: Active Chat swarm, panel open 45 minutes, 25 messages "
        "(15 from Teams, 10 from Salesforce), bot already installed."
    )
    pdf.simple_table(
        ["Meter", "A Apex 5s", "B Azure 2s", "D SignalR", "G Table poll", "E SF/msg"],
        [
            ["SF Daily REST API", "~1-2", "~1-2", "~1-2", "~1-2 (+batch)", "~15-17"],
            ["Apex callouts (chat)", "~540+", "~0", "~0", "~0", "~10-13"],
            ["Azure Function ops", "Low", "~1,300+ hist", "~25-40", "~1,300 reads+25 writes", "~25"],
            ["Graph list open", "~540 SF", "~1,300 Azure", "~0-1", "~0", "0"],
            ["Table transactions", "0", "0", "0", "~1,300+25", "0"],
            ["Live UX", "~5s", "~0-2s", "Instant", "~0-2s / instant", "Instant"],
        ],
        [36, 28, 30, 28, 36, 28],
    )
    pdf.body_text(
        "Note: G still has many Function executions if LWC polls Table every 2s; "
        "combine with SignalR (G3) to drop reads to about per message."
    )

    # 6
    pdf.section_title("6. What is / isn't a Salesforce callout or API limit")
    pdf.simple_table(
        ["Hop", "SF Daily REST API?", "Apex HTTP callout?"],
        [
            ["LWC -> Apex syncMessages", "No", "Yes (to Graph)"],
            ["LWC -> Azure chatHistory (browser fetch)", "No", "No"],
            ["Azure -> Graph", "No", "No (Microsoft Graph)"],
            ["Azure -> Bot Framework", "No", "No"],
            ["Relay -> Apex REST (bot install / card)", "Yes", "No (inbound)"],
            ["LWC -> Apex sendMessage -> Bot", "No", "Yes"],
            ["LWC -> Azure chatSend -> Bot", "No", "No"],
        ],
        [85, 45, 50],
    )

    # 7
    pdf.add_page()
    pdf.section_title("7. Azure Functions limits (summary)")
    pdf.body_text("See Microsoft Learn: Azure Functions scale and hosting.")
    pdf.simple_table(
        ["Resource", "Consumption (legacy)", "Flex Consumption"],
        [
            ["Default timeout", "5 min", "30 min"],
            ["Max timeout", "10 min", "Unbounded*"],
            ["HTTP response hard cap", "~230 seconds (all plans)", "Same"],
            ["Memory / instance", "1.5 GB", "512 MB / 2 GB / 4 GB"],
            ["Max instances", "Win 200 / Linux 100", "Up to ~1,000 (regional quota)"],
            ["Outbound connections / instance", "600 active", "High / unbounded"],
        ],
        [55, 60, 65],
    )
    pdf.body_text(
        "*HTTP triggers still bound by the ~230s load-balancer limit. "
        "Classic Consumption free grant (verify current pricing): ~1M executions/month and ~400k GB-seconds, then pay-per-use."
    )
    pdf.body_text(
        "Poll math: 1 open panel @ 2s ~ 30 executions/min ~ 43k/day. "
        "Ten panels x 8 hours ~ 144k/day. "
        "What fails first at growth: often Microsoft Graph throttling (429) and Function execution cost."
    )

    # 8
    pdf.section_title("8. SignalR path - what's needed (upgrade)")
    pdf.simple_table(
        ["Need", "Purpose"],
        [
            ["Azure SignalR Service (Serverless)", "Hold live connections"],
            ["negotiate Function", "LWC gets SignalR URL + token"],
            ["Update teamsBotRelay", "On type=message, push to SignalR group = chatId"],
            ["Keep chatSend", "SF -> Bot; optional SignalR echo"],
            ["Optional one-shot chatHistory", "Load last N on open only"],
            ["LWC SignalR client", "Subscribe; remove/slow 2s poll"],
            ["CSP for SignalR + Function hosts", "Browser connect-src"],
            ["CMDT mode flag", "e.g. Poll vs SignalR; keep poll fallback"],
        ],
        [70, 110],
    )
    pdf.body_text(
        "Not required for live MVP: message Table storage, Graph webhooks, SF Platform Events, per-message Apex. "
        "Do not rely on raw long-lived SSE from a Consumption/Flex HTTP Function alone (230s cut-off)."
    )

    # 9
    pdf.section_title("9. Enable / revert (operations)")
    pdf.section_title("Enable Azure bridge (current)", level=2)
    pdf.numbered(1, "Deploy Salesforce metadata + relay/ Function App.")
    pdf.numbered(2, "Set Azure app settings: Bot + Graph + CHAT_BRIDGE_HMAC_SECRET (+ CORS).")
    pdf.numbered(3, "Set CMDT: Azure base URL + HMAC secret.")
    pdf.numbered(4, "Update CSP Trusted Site Chat_Bridge_Azure_Connect to the real Function URL.")
    pdf.numbered(5, "Set Use_Azure_Chat_Bridge__c = true.")
    pdf.numbered(6, "Smoke-test SF <-> Teams.")
    pdf.section_title("Revert to Apex Graph polling", level=2)
    pdf.body_text(
        "Set Use_Azure_Chat_Bridge__c = false (or clear Azure URL/secret). "
        "No code rollback required. LWC uses syncMessages / sendMessage again."
    )

    # 10
    pdf.section_title("10. Decision cheat sheet")
    pdf.simple_table(
        ["If you care most about...", "Choose"],
        [
            ["Shipping / ops simplicity", "B - Azure poll (current)"],
            ["Azure $ with many open panels", "D - SignalR (or C as quick win)"],
            ["Cut Graph list cost but keep poll UI", "G - Azure Table (history from Table)"],
            ["Live chat + later Case transcript", "G2 - Table + batch to Swarm_Message__c"],
            ["Best Azure efficiency + history buffer", "G3 - Table + SignalR"],
            ["Salesforce API / callouts", "B, D, or G (avoid A and E)"],
            ["Live not required", "H"],
            ["Full Service Console messaging", "K"],
        ],
        [70, 110],
    )

    # 11
    pdf.section_title("11. Related code & docs")
    pdf.simple_table(
        ["Path", "Role"],
        [
            ["relay/.../teamsBotRelay.js", "Bot -> SF for cards; ack-only for plain messages"],
            ["relay/.../chatHistory.js", "Azure -> Graph history"],
            ["relay/.../chatSend.js", "Azure -> Bot send"],
            ["lwc/caseSwarmChatCore/", "UI; Azure vs Apex mode"],
            ["TeamsSwarmChatController.cls", "getChatBridgeSession, legacy sync/send"],
            ["Teams_Bot_Config__mdt", "Bridge flag, URL, HMAC"],
            ["README.md 6f / 6h", "Relay + Azure chat bridge setup"],
        ],
        [70, 110],
    )

    # 12
    pdf.section_title("12. Glossary")
    pdf.simple_table(
        ["Term", "Meaning"],
        [
            ["Callout", "Apex HTTP request from Salesforce to an external system"],
            ["Daily REST API", "Inbound REST/SOAP to Salesforce (e.g. relay -> Apex REST)"],
            ["Stateless proxy", "Azure does not store chat; Teams/Graph holds history (current B)"],
            ["Azure Table Storage", "Cheap key-value chat buffer (G); PartitionKey = chatId"],
            ["SignalR", "Azure push service for browsers; preferred over raw SSE on Functions"],
        ],
        [40, 140],
    )

    pdf.output(str(OUTPUT))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    build()
