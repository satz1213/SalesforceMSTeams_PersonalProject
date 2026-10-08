"""Business-facing Case Swarm presentation PDF (landscape slides)."""
from datetime import date
from pathlib import Path

from fpdf import FPDF

DOCS = Path(__file__).resolve().parent
OUT = DOCS / "Case-Swarm-Business-Overview.pdf"
IMG1 = DOCS / "case-swarm-business-swarm-only.png"
IMG2 = DOCS / "case-swarm-business-sf-chat-poll.png"
BRAND = (0, 112, 210)
MUTED = (100, 100, 100)


class BizPDF(FPDF):
    def footer(self):
        self.set_y(-12)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(
            0,
            8,
            f"Case Swarm - Business Overview  |  {date.today().isoformat()}  |  Page {self.page_no()}",
            align="C",
        )


def build() -> None:
    pdf = BizPDF(orientation="L", format="A4")
    pdf.set_auto_page_break(True, 16)

    # Cover
    pdf.add_page()
    pdf.set_xy(pdf.l_margin, 50)
    pdf.set_font("Helvetica", "B", 28)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 12, "Case Swarm", align="C")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 10, "How it works for the business", align="C")
    pdf.set_x(pdf.l_margin)
    pdf.ln(8)
    pdf.set_font("Helvetica", "", 12)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        7,
        "Two simple pictures: swarm in Teams only, or chat from the Case page with a transcript.",
        align="C",
    )

    # Slide A
    pdf.add_page()
    pdf.set_xy(pdf.l_margin, pdf.t_margin)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 8, "A. Case Swarm only - collaborate in Teams")
    pdf.set_x(pdf.l_margin)
    pdf.ln(1)
    if IMG1.exists():
        pdf.image(str(IMG1), x=25, w=240)
    pdf.set_xy(pdf.l_margin, 155)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(
        0,
        6,
        "1) Agent starts a swarm on the Case and picks experts.  "
        "2) A Team or Chat is created in Microsoft Teams.  "
        "3) Experts collaborate in Teams (and can use a Case card).  "
        "4) Salesforce keeps the Case and an Open in Teams link - not a full chat transcript.",
    )

    # Slide B
    pdf.add_page()
    pdf.set_xy(pdf.l_margin, pdf.t_margin)
    pdf.set_font("Helvetica", "B", 16)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 8, "B. Case Swarm + chat in Salesforce")
    pdf.set_x(pdf.l_margin)
    pdf.ln(1)
    if IMG2.exists():
        pdf.image(str(IMG2), x=25, w=240)
    pdf.set_xy(pdf.l_margin, 155)
    pdf.set_font("Helvetica", "", 11)
    pdf.set_text_color(30, 30, 30)
    pdf.multi_cell(
        0,
        6,
        "1) Same swarm Chat in Teams.  "
        "2) Agent can message from the Case page.  "
        "3) Expert replies in Teams appear in Salesforce within a few seconds.  "
        "4) Messages are saved as a transcript on the Case for handoffs and audit.",
    )

    # Comparison
    pdf.add_page()
    pdf.set_xy(pdf.l_margin, pdf.t_margin)
    pdf.set_font("Helvetica", "B", 18)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 9, "Which mode fits?")
    pdf.set_x(pdf.l_margin)
    pdf.ln(8)

    widths = [70, 90, 100]
    headers = ["Question", "Swarm only", "Swarm + Salesforce chat"]
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(*BRAND)
    pdf.set_text_color(255, 255, 255)
    pdf.set_x(pdf.l_margin)
    for h, w in zip(headers, widths):
        pdf.cell(w, 9, h, border=1, fill=True)
    pdf.ln()

    rows = [
        ("Where do experts talk?", "Teams", "Teams"),
        ("Agent chats from Case page?", "No (opens Teams)", "Yes"),
        ("Transcript on the Case?", "No", "Yes"),
        ("Best when...", "Experts live in Teams", "Agent stays in SF + needs audit trail"),
    ]
    fill = False
    pdf.set_font("Helvetica", "", 10)
    for row in rows:
        pdf.set_x(pdf.l_margin)
        pdf.set_fill_color(248, 248, 248) if fill else pdf.set_fill_color(255, 255, 255)
        pdf.set_text_color(30, 30, 30)
        for cell, w in zip(row, widths):
            pdf.cell(w, 12, cell, border=1, fill=True)
        pdf.ln()
        fill = not fill

    pdf.set_x(pdf.l_margin)
    pdf.ln(12)
    pdf.set_font("Helvetica", "I", 10)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(
        0,
        6,
        "For IT deep-dives: Case-Swarm-Architecture-and-Data-Flows.md and "
        "Case-Swarm-Chat-Bridge-Options-and-Limits.md",
    )

    pdf.output(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
