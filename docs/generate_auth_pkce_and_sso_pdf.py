"""Salesforce in Teams - Authentication reference: PKCE popup + Teams SSO / Token Exchange.

Portrait, text-and-table style (matches the original salesforce_in_teams_pkce_auth.pdf layout),
built with fpdf2 for consistency with this project's other doc-generator scripts.
"""
from datetime import date
from pathlib import Path

from fpdf import FPDF

DOCS = Path(__file__).resolve().parent
OUT = DOCS / "Salesforce-in-Teams-Authentication-PKCE-and-SSO.pdf"

BOTTOM_MARGIN = 18
BRAND = (0, 112, 210)      # Salesforce blue, matches this project's other docs
DARK = (30, 30, 30)
MUTED = (100, 100, 100)
BOX_BG = (246, 248, 250)
BOX_BORDER = (210, 216, 222)
CODE_BG = (40, 44, 52)
CODE_FG = (220, 223, 228)
TABLE_HEAD_BG = BRAND
TABLE_ROW_ALT = (248, 248, 248)


def safe(text: str) -> str:
    return (
        text.replace("—", "-")
        .replace("–", "-")
        .replace("‘", "'")
        .replace("’", "'")
        .replace("“", '"')
        .replace("”", '"')
        .replace("→", "->")
        .replace("…", "...")
        .replace(" ", " ")
        .replace("×", "x")
    )


class DocPDF(FPDF):
    def __init__(self):
        super().__init__(orientation="P", format="A4")
        self.set_auto_page_break(True, margin=BOTTOM_MARGIN)
        self.set_margins(16, 14, 16)
        self.section_no = 0

    def footer(self):
        self.set_y(-13)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(*MUTED)
        self.cell(
            0, 8,
            f"Salesforce in Teams - Authentication (PKCE + SSO)  |  {date.today().isoformat()}  |  Page {self.page_no()}",
            align="C",
        )

    def multi_cell(self, w, h=None, text="", *args, **kwargs):
        # fpdf2 justifies by default, which stretches lines containing long identifiers/URLs.
        if len(args) < 2:
            kwargs.setdefault("align", "L")
        return super().multi_cell(w, h, text, *args, **kwargs)

    def usable_w(self) -> float:
        return self.w - self.l_margin - self.r_margin

    # ---- headings ----
    def h1(self, text: str, number: str | None = None):
        if self.get_y() > 40 and self.get_y() > self.h - BOTTOM_MARGIN - 80:
            self.add_page()
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(*BRAND)
        label = f"{number}. {text}" if number else text
        self.multi_cell(0, 8, safe(label))
        self.set_draw_color(*BRAND)
        self.set_line_width(0.6)
        y = self.get_y() + 1
        self.line(self.l_margin, y, self.l_margin + self.usable_w(), y)
        self.ln(4)
        self.set_x(self.l_margin)

    def h2(self, text: str):
        self.ln(1)
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 12.5)
        self.set_text_color(20, 20, 20)
        self.multi_cell(0, 6.5, safe(text))
        self.ln(1)
        self.set_x(self.l_margin)

    def h3(self, text: str):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10.5)
        self.set_text_color(*BRAND)
        self.multi_cell(0, 5.5, safe(text))
        self.set_x(self.l_margin)

    # ---- text ----
    def body(self, text: str, size: float = 10):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", size)
        self.set_text_color(*DARK)
        self.multi_cell(0, 5, safe(text))
        self.set_x(self.l_margin)
        self.ln(1.5)

    def bullets(self, items: list[str], size: float = 10):
        self.set_font("Helvetica", "", size)
        self.set_text_color(*DARK)
        for item in items:
            self.set_x(self.l_margin)
            self.cell(4, 5, safe("-"))
            self.set_x(self.l_margin + 4)
            self.multi_cell(self.usable_w() - 4, 5, safe(item))
        self.ln(1.5)
        self.set_x(self.l_margin)

    def numbered_step(self, n: int, title: str, text: str):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 10.5)
        self.set_text_color(*BRAND)
        self.cell(7, 6, f"{n}.")
        self.set_text_color(20, 20, 20)
        self.multi_cell(self.usable_w() - 7, 6, safe(title))
        self.set_x(self.l_margin + 9)
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*DARK)
        self.multi_cell(self.usable_w() - 9, 5, safe(text))
        self.ln(2)
        self.set_x(self.l_margin)

    def callout(self, title: str, text: str):
        self.set_x(self.l_margin)
        x = self.l_margin
        w = self.usable_w()
        self.set_font("Helvetica", "B", 9.5)
        title_lines = self.multi_cell(w - 8, 5, safe(title), dry_run=True, output="LINES")
        self.set_font("Helvetica", "", 9.5)
        body_lines = self.multi_cell(w - 8, 5, safe(text), dry_run=True, output="LINES")
        height = (len(title_lines) + len(body_lines)) * 5 + 8
        y = self.get_y()
        if y + height > self.page_break_trigger:
            self.add_page()
            y = self.get_y()
        self.set_fill_color(*BOX_BG)
        self.set_draw_color(*BOX_BORDER)
        self.rect(x, y, w, height, style="DF")
        self.set_xy(x + 4, y + 4)
        self.set_font("Helvetica", "B", 9.5)
        self.set_text_color(*BRAND)
        self.multi_cell(w - 8, 5, safe(title))
        self.set_x(x + 4)
        self.set_font("Helvetica", "", 9.5)
        self.set_text_color(*DARK)
        self.multi_cell(w - 8, 5, safe(text))
        self.set_y(y + height + 4)
        self.set_x(self.l_margin)

    def code(self, lines: list[str], font_size: float = 8.2):
        self.set_x(self.l_margin)
        x = self.l_margin
        w = self.usable_w()
        line_h = font_size * 0.5 + 1.4
        pad = 3
        height = len(lines) * line_h + pad * 2
        y = self.get_y()
        if y + height > self.page_break_trigger:
            self.add_page()
            y = self.get_y()
        self.set_fill_color(*CODE_BG)
        self.rect(x, y, w, height, style="F")
        self.set_font("Courier", "", font_size)
        self.set_text_color(*CODE_FG)
        ty = y + pad
        for line in lines:
            self.set_xy(x + 3, ty)
            self.cell(w - 6, line_h, safe(line))
            ty += line_h
        self.set_y(y + height + 4)
        self.set_x(self.l_margin)

    def _table_header(self, headers: list[str], widths: list[float]):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 8.5)
        self.set_fill_color(*TABLE_HEAD_BG)
        self.set_text_color(255, 255, 255)
        self.set_draw_color(*BOX_BORDER)
        for h, w in zip(headers, widths):
            self.cell(w, 7, safe(h), border=1, fill=True)
        self.ln()

    def table(self, headers: list[str], rows: list[list[str]], widths: list[float], row_h: float = 6.5):
        # auto_page_break must be OFF while manually drawing a row's rect()+cell() calls below -
        # otherwise fpdf2 can trigger a page break MID-ROW (inside one cell's text loop), splitting
        # a single logical row's rects and text fragments across two pages. Pagination is instead
        # handled explicitly, per whole row, before any drawing for that row starts.
        self.set_auto_page_break(False, margin=BOTTOM_MARGIN)
        self._table_header(headers, widths)
        fill = False
        self.set_font("Helvetica", "", 8.3)
        for row in rows:
            self.set_x(self.l_margin)
            max_lines = 1
            cell_lines = []
            for cell, w in zip(row, widths):
                lines = self.multi_cell(w, 4.3, safe(cell), dry_run=True, output="LINES")
                cell_lines.append(lines)
                max_lines = max(max_lines, len(lines))
            h = max(row_h, max_lines * 4.3 + 2)

            if self.get_y() + h > self.h - BOTTOM_MARGIN:
                self.add_page()
                self._table_header(headers, widths)
                self.set_font("Helvetica", "", 8.3)

            self.set_fill_color(*TABLE_ROW_ALT) if fill else self.set_fill_color(255, 255, 255)
            y0 = self.get_y()
            x0 = self.l_margin
            for w in widths:
                self.rect(x0, y0, w, h, style="DF")
                x0 += w
            x0 = self.l_margin
            for lines, w in zip(cell_lines, widths):
                ty = y0 + 1
                self.set_text_color(*DARK)
                for ln in lines:
                    self.set_xy(x0 + 1, ty)
                    self.cell(w - 2, 4.3, ln)
                    ty += 4.3
                x0 += w
            self.set_y(y0 + h)
            fill = not fill
        self.set_x(self.l_margin)
        self.ln(3)
        self.set_auto_page_break(True, margin=BOTTOM_MARGIN)

    def qa(self, q: str, a: str):
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "B", 9.8)
        self.set_text_color(*BRAND)
        self.multi_cell(0, 5.2, safe("Q: " + q))
        self.set_x(self.l_margin)
        self.set_font("Helvetica", "", 9.8)
        self.set_text_color(*DARK)
        self.multi_cell(0, 5.2, safe("A: " + a))
        self.ln(2)
        self.set_x(self.l_margin)


def build():
    pdf = DocPDF()

    # ---------------- Cover ----------------
    pdf.add_page()
    pdf.set_xy(pdf.l_margin, 60)
    pdf.set_font("Helvetica", "B", 24)
    pdf.set_text_color(*BRAND)
    pdf.multi_cell(0, 11, "Salesforce in Teams", align="C")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 15)
    pdf.set_text_color(40, 40, 40)
    pdf.multi_cell(0, 9, "Authentication Reference", align="C")
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "", 12)
    pdf.set_text_color(*MUTED)
    pdf.ln(2)
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 6, "Two login mechanisms, how they fit together, every setting\nthey depend on, and every real issue hit (and fixed) building them.", align="C")
    pdf.ln(10)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 10.5)
    pdf.set_text_color(*DARK)
    pdf.multi_cell(0, 6, "Part A - OAuth 2.0 Authorization Code + PKCE (interactive popup)", align="C")
    pdf.set_x(pdf.l_margin)
    pdf.multi_cell(0, 6, "Part B - Microsoft Teams SSO + OAuth 2.0 Token Exchange (silent)", align="C")
    pdf.ln(14)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "", 9)
    pdf.set_text_color(*MUTED)
    pdf.multi_cell(0, 5, date.today().isoformat(), align="C")

    # ---------------- Overview ----------------
    pdf.add_page()
    pdf.h1("Overview", "0")
    pdf.body(
        "The \"Salesforce in Teams\" personal tab (teamsapp-salesforce/, app id "
        "3aed85f6-5208-454a-8c48-9ad5fbd14057) authenticates each person with their own real "
        "Salesforce access - never a shared integration user, never a relay holding anyone's "
        "token. Two mechanisms exist, tried in this order every time the tab needs a session:"
    )
    pdf.table(
        ["Order", "Mechanism", "What it feels like"],
        [
            ["1st", "Teams SSO + Token Exchange (Part B)", "Completely silent - no popup, no click, no visible sign-in step at all."],
            ["2nd (fallback)", "OAuth 2.0 Authorization Code + PKCE (Part A)", "A \"Sign in\" button, then a real popup showing Salesforce's login page."],
        ],
        [22, 78, 84],
    )
    pdf.body(
        "The fallback is automatic and silent to the code path, not just a manual option: "
        "ensureSfSession() in salesforceTabHome.js tries loginWithTeamsSso() first; on ANY "
        "failure there (missing setup, a revoked consent, an Azure AD outage, anything) it "
        "surfaces a real \"Sign in\" button instead, which runs the Part A flow. This means Part B "
        "can be adopted or rolled back at any time by changing only Salesforce/Azure AD "
        "configuration - no code redeploy, no Teams app reinstall - the same \"no redeploy needed "
        "to revert\" pattern already used elsewhere in this project (e.g. the Case Swarm chat "
        "bridge's three delivery modes)."
    )
    pdf.callout(
        "Why not just build Part B and skip Part A entirely?",
        "Part A was built first and reached working end-to-end before Part B existed - it remains "
        "the safety net. Part B needs meaningfully more setup (a second Azure AD app, an Apex "
        "class doing real JWT signature validation, a Salesforce Permission Set assignment for "
        "every user) and depends on infrastructure a given org may not have finished configuring. "
        "Keeping Part A as the automatic fallback means the tab never gets stuck if any piece of "
        "Part B's setup is missing, misconfigured, or not yet done for a new person."
    )

    # =========================================================================================
    # PART A - PKCE
    # =========================================================================================
    pdf.add_page()
    pdf.h1("Part A - OAuth 2.0 Authorization Code + PKCE (interactive popup)", "A")

    pdf.h2("A.1  Why this design (the constraint that forced it)")
    pdf.body(
        "A Microsoft Teams personal tab is rendered as an <iframe>. Salesforce's own login page "
        "refuses to render inside any iframe, from any origin - proven live against this exact "
        "org, not assumed:"
    )
    pdf.code([
        "$ curl -sD - -o /dev/null https://mylightningapp-dev-dev-ed.my.salesforce.com/",
        "X-FRAME-OPTIONS: DENY",
        "Content-Security-Policy: frame-ancestors 'none'",
    ])
    pdf.body(
        "Checked the \"maybe it's fine once already logged in\" loophole too, not just the login "
        "page - an authenticated Lightning page was tested the same way (via /secur/frontdoor.jsp):"
    )
    pdf.code([
        "X-FRAME-OPTIONS: SAMEORIGIN",
        "Content-Security-Policy: frame-ancestors 'self'",
    ])
    pdf.body(
        "'self' still excludes Teams (a different origin) - there is no sequencing trick that lets "
        "Salesforce's UI or login screen render directly inside the Teams tab's iframe, logged in "
        "or not. This is why the login step has to happen in a real, separate, top-level browser "
        "window (a popup), not a redirect of the tab itself."
    )
    pdf.callout(
        "Not a workaround - a documented Teams pattern",
        "microsoftTeams.authentication.authenticate({url, width, height}) is the Teams SDK's own "
        "generic OAuth popup helper, built for exactly this situation (any third-party identity "
        "provider). It is a completely different API from Teams SSO's getAuthToken() (Part B)."
    )
    pdf.body(
        "The popup also deliberately shows full browser chrome, including the address bar with "
        "Salesforce's/Microsoft's raw URL visible - Microsoft's intentional anti-phishing design "
        "for any third-party OAuth popup in Teams, so a malicious Teams app can never show a "
        "chrome-less, spoofed \"Microsoft login\" page. Every third-party OAuth Teams integration "
        "(Dropbox, Zoom, Asana, etc.) looks the same way. Not a defect."
    )

    pdf.h2("A.2  Architecture at a glance")
    pdf.body(
        "The relay's only job is serving two static pages (salesforceTabHome.js, "
        "salesforceAuthCallback.js). No auth or data logic runs in Azure at all - every OAuth step "
        "and every Salesforce data call happens in the browser, using that person's own token "
        "(\"Option B\" in the project plan: the fastest path to real per-user data, at the cost of "
        "the access token living in the browser rather than behind a server)."
    )

    pdf.h2("A.3  Sequence - first-time login")
    pdf.numbered_step(1, "Tab loads",
        "salesforceTabHome.js checks localStorage (key sfUserSession) for a saved session. Nothing is there yet.")
    pdf.numbered_step(2, "Teams SSO is tried first and fails (or isn't set up)",
        "ensureSfSession() always tries loginWithTeamsSso() before ever considering the popup - see Part B. "
        "This step assumes that attempt failed or Part B isn't configured in this environment.")
    pdf.numbered_step(3, "A real \"Sign in\" button appears",
        "promptInteractiveSignIn() replaces the loading status with a button. The popup is deliberately NOT "
        "opened automatically here - see the FailedToOpenWindow issue in the troubleshooting log below for why.")
    pdf.numbered_step(4, "PKCE pair generated (on click)",
        "randomPkceVerifier() makes a random 64-byte value (code_verifier); pkceChallengeFor() SHA-256-hashes "
        "it and base64url-encodes the result (code_challenge). The verifier is stashed in localStorage under "
        "sfPkceVerifier so the popup (a different page load) can read it back in step 7.")
    pdf.numbered_step(5, "Popup opens",
        "microsoftTeams.authentication.authenticate() opens Salesforce's real /services/oauth2/authorize URL "
        "(client_id, redirect_uri, code_challenge, scope) in a Teams-managed popup - a real top-level browser "
        "context, not the tab's iframe. Called synchronously from the button's click handler, a genuine user "
        "gesture, so browsers don't block it.")
    pdf.numbered_step(6, "Salesforce's login page loads in the popup",
        "The org's login page has the Azure_AD_SSO Auth Provider enabled, so it shows \"Login with Microsoft\" - "
        "the person is already signed into Microsoft (via Teams), so this resolves in at most one "
        "\"Continue as ___\" click, never a typed Salesforce username/password.")
    pdf.numbered_step(7, "Salesforce resolves the identity, popup exchanges the code itself",
        "AzureAdSsoRegistrationHandler.cls matches the Microsoft identity's email/UPN against a Salesforce "
        "User's Azure_AD_Email_Id__c field. Salesforce redirects the popup to salesforceAuthCallback.js with "
        "an authorization code. That page - not the tab - reads the verifier from localStorage and does the "
        "full code-for-token exchange itself (POST /services/oauth2/token, grant_type=authorization_code, no "
        "client secret - PKCE is the proof of possession instead), then calls "
        "microsoftTeams.authentication.notifySuccess(JSON.stringify(session)) with the complete session.")
    pdf.numbered_step(8, "Session handed back and saved",
        "The tab's authenticate() promise resolves with that exact JSON string. loginWithPopup() parses it "
        "directly and calls saveSfSession() - localStorage's own sfUserSession key. See the storage-"
        "partitioning issue below for why this handoff is NOT a shared-storage read.")
    pdf.numbered_step(9, "Data loads",
        "loadListView() calls Salesforce's UI API directly - fetch(session.instanceUrl + path, {headers: "
        "{Authorization: 'Bearer ' + accessToken}}) - and renders the person's own records.")

    pdf.h2("A.4  Sequence - every visit after that (no popup)")
    pdf.body(
        "ensureSfSession() (called by sfGetWithRetry() before every UI API request) reads the stored session "
        "and uses it optimistically - it does not pre-check expiry, since Salesforce doesn't return a usable "
        "expires_in for this flow. Whether the token is still fresh only matters once a real request is made:"
    )
    pdf.numbered_step(1, "Session found", "loadSfSession() returns the saved session - used immediately, no popup shown.")
    pdf.numbered_step(2, "Access token still valid", "sfGetOnce() succeeds normally - the common case for anyone who used the app recently.")
    pdf.numbered_step(3, "Access token expired", "Salesforce returns 401. sfGetWithRetry()'s catch handler calls refreshAccessToken(refreshToken) - a plain POST with grant_type=refresh_token, no popup at all.")
    pdf.numbered_step(4, "Refreshed session saved, request retried", "The new access_token is saved (refresh_token isn't rotated by default) and the original call retried once, transparently.")
    pdf.numbered_step(5, "Only if the refresh itself fails", "(refresh token expired/revoked) the session is cleared and the interactive \"Sign in\" prompt (step 3 of A.3) reappears - the only case after first login where it comes back.")
    pdf.callout(
        "Token lifetimes",
        "Access token: short-lived per the org's Session Settings - irrelevant to the person, refreshed "
        "silently. Refresh token: refreshTokenPolicyType=SpecificLifetime, 365 Days on the "
        "Salesforce_In_Teams app - comfortably covers normal gaps in usage. Also invalidated early by an "
        "admin revoking access, a password/MFA change, or the browser clearing storage (private/incognito "
        "windows wipe it on close)."
    )

    pdf.h2("A.5  De-duping concurrent logins")
    pdf.body(
        "loadListView() and loadAppNavObjectTabs() fire several Salesforce calls in parallel on first load. "
        "With no stored session yet, each one independently seeing \"no session\" would otherwise open its "
        "OWN popup/SSO attempt at the same moment - real, reproduced bugs (see the troubleshooting log). "
        "Fixed with a single shared in-flight promise:"
    )
    pdf.code([
        "var pendingLogin = null;",
        "function ensureSfSession() {",
        "  var session = loadSfSession();",
        "  if (session && session.accessToken) return Promise.resolve(session);",
        "  if (!pendingLogin) {",
        "    pendingLogin = loginWithTeamsSso().then(onSuccess, onSsoFailure);",
        "  }",
        "  return pendingLogin;  // every concurrent caller awaits the SAME promise",
        "}",
    ])

    pdf.h2("A.6  Where each piece lives in the code")
    pdf.table(
        ["Function (salesforceTabHome.js)", "Role"],
        [
            ["saveSfSession / loadSfSession / clearSfSession", "Read/write the session object to/from localStorage under sfUserSession."],
            ["randomPkceVerifier / pkceChallengeFor / base64UrlEncode", "PKCE pair generation via the Web Crypto API (crypto.getRandomValues, crypto.subtle.digest)."],
            ["loginWithPopup()", "Builds the /services/oauth2/authorize URL, stashes the verifier, opens the popup, and receives the finished session from notifySuccess()."],
            ["refreshAccessToken(refreshToken)", "POSTs grant_type=refresh_token - the silent-refresh path."],
            ["ensureSfSession()", "Tries loginWithTeamsSso() (Part B) first; on failure, marks needsInteractiveSignIn instead of auto-opening a popup."],
            ["signInInteractively() / promptInteractiveSignIn()", "The real \"Sign in\" button and its click handler - the only place loginWithPopup() is ever actually called."],
            ["sfGetOnce(session, path) / sfGetWithRetry(path)", "The per-user Salesforce call, plus refresh-then-retry and re-prompt-as-last-resort logic. Every UI API call goes through sfGetWithRetry."],
            ["loadListView(objectApiName, listViewApiName)", "Calls ui-api/list-info, ui-api/list-records, and a ListView SOQL query, and renders the table for any object."],
        ],
        [70, 114],
        row_h=8,
    )
    pdf.body(
        "relay/src/functions/salesforceAuthCallback.js - the popup's registered redirect target. Does the "
        "FULL code-for-token exchange itself (moved here specifically to fix the browser-throttling issue "
        "below), then calls notifySuccess()/notifyFailure(). Still deliberately minimal otherwise, matching "
        "this project's convention that the relay carries no business logic beyond this."
    )

    pdf.h2("A.7  Salesforce-side configuration reference")
    pdf.h3("Auth Provider: Azure_AD_SSO")
    pdf.table(
        ["Field", "Value"],
        [
            ["Provider Type", "Open ID Connect (not the built-in \"Microsoft\" type, not the legacy \"Microsoft Access Control Service\" type)"],
            ["Authorize Endpoint URL", "https://login.microsoftonline.com/80040ab0-138a-4eaa-8a1c-68e4f0465151/oauth2/v2.0/authorize"],
            ["Token Endpoint URL", "https://login.microsoftonline.com/80040ab0-138a-4eaa-8a1c-68e4f0465151/oauth2/v2.0/token"],
            ["User Info Endpoint URL", "https://graph.microsoft.com/oidc/userinfo (required - a real login failed with No_Endpoint_URL until set; pulled from this tenant's own /v2.0/.well-known/openid-configuration, not guessed)"],
            ["Token Issuer", "https://login.microsoftonline.com/80040ab0-138a-4eaa-8a1c-68e4f0465151/v2.0"],
            ["Default Scopes", "openid profile email"],
            ["Execution User", "Required once a Registration Handler is set - runs the handler's SOQL query"],
            ["Registration Handler", "AzureAdSsoRegistrationHandler"],
            ["Callback URL (auto-generated)", "https://mylightningapp-dev-dev-ed.my.salesforce.com/services/authcallback/Azure_AD_SSO - must exactly match the Redirect URI registered in Azure AD"],
        ],
        [55, 129],
        row_h=8,
    )
    pdf.h3("Registration Handler: AzureAdSsoRegistrationHandler.cls")
    pdf.body(
        "Runs on first login via the Auth Provider (later logins call updateUser() instead, once Salesforce "
        "auto-creates a ThirdPartyAccountLink). Matches the incoming identity's email/username against "
        "User.Azure_AD_Email_Id__c - the same field this org uses everywhere else to bridge a Microsoft/Teams "
        "identity to a Salesforce User. Throws a clear NoLinkedUserException if no match is found - never "
        "silently fails or auto-provisions a new user."
    )
    pdf.h3("External Client App: Salesforce_In_Teams")
    pdf.table(
        ["Field", "Value"],
        [
            ["Client type", "Public (isConsumerSecretOptional = true) - no secret can be safely kept in browser-delivered code"],
            ["PKCE", "Required (isPkceRequired = true)"],
            ["OAuth Scopes", "Api, RefreshToken, OpenID"],
            ["Callback URL", "https://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net/api/salesforceAuthCallback"],
            ["Consumer Key", "3MVG9G9pzCUSkzZsud2BdW9TWBEoplncNXHW02MLEybqDY0coXFBNmBujduJ2Du59lbZXigmCVI4V91wkBg0q (not a secret - sent openly by design)"],
            ["Permitted Users", "AdminApprovedPreAuthorized - \"Admin approved users are pre-authorized\" (see Part B section B.7 - changed from the original AllSelfAuthorized once Token Exchange required it; a Permission Set granting access must be assigned to every real user)"],
            ["Refresh token lifetime", "SpecificLifetime, 365 Days"],
        ],
        [50, 134],
        row_h=8,
    )
    pdf.body(
        "A CorsWhitelistOrigin entry for the relay's own origin, plus the separate org-wide \"Enable CORS for "
        "OAuth endpoints\" checkbox (Setup -> CORS), were both required - the whitelist alone covers regular "
        "UI API/REST calls but not /services/oauth2/token specifically."
    )

    pdf.h2("A.8  Troubleshooting log (real issues hit while building this)")
    pdf.table(
        ["Symptom", "Cause", "Fix"],
        [
            ["Generic \"Problem Logging In\" page, no detail; ErrorCode=No_Endpoint_URL",
             "Registration Handler / Auth Provider failure with no LoginHistory row created",
             "Set a debug-log TraceFlag on both the Auth Provider's Execution User and the Automated Process user, then retried, to surface the real error"],
            ["\"Select an execution user to run the registration handler\"",
             "OpenID Connect Auth Providers require a User Info Endpoint URL, which some field references omit",
             "Set it to this tenant's real userinfo_endpoint from its own /v2.0/.well-known/openid-configuration"],
            ["Login popup never opens at all (Teams Desktop only)",
             "A Registration Handler requires an Execution User to be set on the Auth Provider",
             "Set executionUser to the admin account"],
            ["Teams rejects a re-uploaded app package: \"needs a new app version number\"",
             "Teams requires manifestVersion's version field to strictly increase on every re-upload",
             "Bump the version field before re-zipping and re-uploading"],
            ["Update appears to persist, then reverts (Desktop only)",
             "Desktop Teams' embedded browser engine caches tab content aggressively",
             "Fully quit Teams Desktop (system tray -> Quit) and reopen"],
            ["THREE popups open at once on a first-ever load (private windows especially)",
             "loadListView() fires 3 parallel calls; each independently saw \"no session\" and called loginWithPopup(), racing on the shared sfPkceVerifier localStorage key",
             "De-dupe: only the first caller starts the login; every concurrent caller awaits that same in-flight promise (see A.5)"],
            ["Popup completes cleanly, but the tab still says \"Could not load cases right now\" - private/incognito windows specifically",
             "Chrome's third-party storage partitioning (enabled first in Incognito, ahead of general rollout) puts the popup's own storage and the iframe's storage in different, mutually invisible buckets",
             "Stop relying on a shared-storage read entirely - pass the finished session as the string argument to notifySuccess(), which Teams delivers back as authenticate()'s resolved value over its own postMessage bridge"],
            ["\"FailedToOpenWindow\" when falling back to the popup after a failed silent SSO attempt",
             "Browsers only reliably allow window.open()-based popups triggered synchronously by a real user click; an async SSO attempt in front of it pushes the popup call too far from any real gesture",
             "Never auto-open the popup after an async failure - show a real \"Sign in\" button and only call the popup from that button's own click handler (A.3, step 3)"],
        ],
        [58, 65, 61],
        row_h=9,
    )

    # =========================================================================================
    # PART B - SSO / TOKEN EXCHANGE
    # =========================================================================================
    pdf.add_page()
    pdf.h1("Part B - Microsoft Teams SSO + OAuth 2.0 Token Exchange (silent)", "B")

    pdf.h2("B.1  What this adds over Part A")
    pdf.body(
        "Part A works, but every login (the first one, and any time a refresh token expires or is revoked) "
        "shows a popup with Salesforce's own login page in it - expected Teams behavior, but still a visible "
        "step. Part B removes that entirely when it succeeds: microsoftTeams.authentication.getAuthToken() "
        "hands back a signed Azure AD token for whoever is already signed into Teams, with zero user "
        "interaction, and Salesforce's OAuth 2.0 Token Exchange flow trades that token directly for a real "
        "per-user Salesforce session - no popup, no click, nothing visible at all."
    )
    pdf.callout(
        "The verification happens INSIDE Salesforce, not in the browser",
        "The Teams tab never validates the Azure AD token itself - it just relays it to Salesforce's token "
        "endpoint. A new Apex class, SalesforceInTeamsTokenExchangeHandler, does full RS256/JWKS signature "
        "verification plus issuer/audience/expiry checks server-side, the same discipline TeamsBotJwtValidator "
        "already uses for a different issuer (Bot Framework) in the Case Swarm feature. Deliberately not "
        "reused/shared code - this project's convention is to copy a proven pattern across features rather "
        "than couple them."
    )

    pdf.h2("B.2  Architecture at a glance")
    pdf.body(
        "Still no relay in the auth path - the tab calls Teams SSO and Salesforce's token endpoint directly, "
        "exactly like Part A calls Salesforce's authorize/token endpoints directly. The only new server-side "
        "component is the Apex handler, which runs inside Salesforce itself as part of its own OAuth machinery."
    )
    pdf.code([
        "Teams tab                 Microsoft Entra ID              Salesforce",
        "----------                -----------------              ----------",
        "getAuthToken()  -------->  issues a v2.0 access",
        "                           token for THIS app's",
        "                           own exposed API scope",
        "     |",
        "     v",
        "POST /services/oauth2/token",
        "  grant_type=...token-exchange",
        "  subject_token=<AAD token>  ------------------->  Salesforce routes to the",
        "                                                    registered OauthTokenExchangeHandler",
        "                                                          |",
        "                                                          v",
        "                                        SalesforceInTeamsTokenExchangeHandler.cls",
        "                                          1. fetch Microsoft's JWKS (Remote Site Setting)",
        "                                          2. verify RS256 signature",
        "                                          3. check iss / aud / exp",
        "                                          4. match User.Azure_AD_Email_Id__c",
        "                                                          |",
        "     <---------------------------------------------------+",
        "  real Salesforce access_token + instance_url",
    ], font_size=7.3)

    pdf.h2("B.3  Sequence - silent sign-in (success path)")
    pdf.numbered_step(1, "Tab loads, no stored session",
        "ensureSfSession() calls loginWithTeamsSso() before considering the popup at all.")
    pdf.numbered_step(2, "Teams issues an Azure AD token silently",
        "microsoftTeams.authentication.getAuthToken() resolves with a signed v2.0 access token for the "
        "\"Salesforce In Teams SSO\" Azure AD app's own exposed scope - no popup, no consent screen, since the "
        "two well-known Teams client ids are pre-authorized on that scope (B.4).")
    pdf.numbered_step(3, "Token exchanged with Salesforce",
        "A POST to /services/oauth2/token with grant_type=urn:ietf:params:oauth:grant-type:token-exchange, "
        "subject_token=<the AAD token>, subject_token_type=...access_token, and the same client_id as Part A.")
    pdf.numbered_step(4, "Salesforce validates and resolves the identity",
        "SalesforceInTeamsTokenExchangeHandler.validateIncomingToken() fetches Microsoft's JWKS, verifies the "
        "RS256 signature, checks iss/aud/exp, then getUserForTokenSubject() matches the token's email/UPN "
        "against User.Azure_AD_Email_Id__c - the exact same field and convention as Part A's Registration Handler.")
    pdf.numbered_step(5, "Session saved, data loads",
        "loginWithTeamsSso() saves {accessToken, refreshToken, instanceUrl} exactly like Part A's session shape - "
        "everything downstream (sfGetWithRetry, loadListView, etc.) is identical either way.")

    pdf.h2("B.4  Azure AD-side configuration reference")
    pdf.table(
        ["Setting", "Value / requirement"],
        [
            ["App registration", "A second, separate Azure AD app (\"Salesforce In Teams SSO\") - not the Azure_AD_SSO Auth Provider's app, and independent of the top-level Teams manifest id (confirmed: they don't need to match)"],
            ["Expose an API - Application ID URI", "api://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net/b186fa34-7fdf-48be-80c3-7e736eb501b3 - MUST include the tab's actual hostname, not just a bare client id (see B.7)"],
            ["Scope", "access_as_user, admins and users can consent"],
            ["Authorized client applications on that scope", "1fec8e78-bce4-4aaf-ab1b-5451cc387264 (Teams desktop/mobile) and 5e3ce6c0-2b1f-4285-8d4b-75ee78787346 (Teams web) - both required for silent consent"],
            ["Manifest", "\"api\": { \"requestedAccessTokenVersion\": 2 } - the modern field name/location; the Azure Portal UI still labels it accessTokenAcceptedVersion, but the underlying manifest field moved under api"],
            ["teamsapp-salesforce/manifest.json", "webApplicationInfo: { id: \"<client id>\", resource: \"<the Application ID URI above>\" }"],
        ],
        [58, 126],
        row_h=9,
    )

    pdf.h2("B.5  Salesforce-side configuration reference")
    pdf.table(
        ["Setting", "Value / requirement"],
        [
            ["ExtlClntAppGlobalOauthSettings.isTokenExchangeEnabled", "true (on Salesforce_In_Teams)"],
            ["ExtlClntAppOauthConfigurablePolicies.isTokenExchangeFlowEnabled", "true"],
            ["ExtlClntAppOauthConfigurablePolicies.permittedUsersPolicyType", "AdminApprovedPreAuthorized (Setup label: \"Admin approved users are pre-authorized\") - required for a non-interactive flow; see B.7"],
            ["OauthTokenExchangeHandler metadata", "Salesforce_In_Teams_TokenExchange - points at SalesforceInTeamsTokenExchangeHandler, isAccessTokenSupported=true, everything else (id token, JWT, refresh token, SAML2, user/contact creation) false"],
            ["\"Enable New App\" association", "Setup -> Token Exchange Handlers -> the handler -> Enable New App -> select Salesforce_In_Teams, set a Run As execution user - a Setup-UI-only step with no equivalent deployable metadata field"],
            ["Permission Set + assignment", "An empty Permission Set (Salesforce_In_Teams) listed on the app's policy (commaSeparatedPermissionSet); must be assigned to every real user of this tab once Permitted Users is admin-approved"],
            ["Remote Site Setting", "Azure_AD_JWKS -> https://login.microsoftonline.com (the JWKS fetch in fetchPublicKey() is a real outbound Apex callout and is blocked without this, same as Bot_Framework_Keys for a different domain)"],
        ],
        [62, 122],
        row_h=10,
    )

    pdf.h2("B.6  SalesforceInTeamsTokenExchangeHandler.cls")
    pdf.body(
        "Extends Auth.Oauth2TokenExchangeHandler. Self-contained rather than reusing "
        "TeamsBotJwtValidator.cls (a different issuer, a different feature) - the JWKS/RSA-from-JWK "
        "verification logic is the same proven pattern, copied rather than shared."
    )
    pdf.code([
        "global override Auth.TokenValidationResult validateIncomingToken(",
        "    String appDeveloperName, Auth.IntegratingAppType appType,",
        "    String incomingToken, Auth.OAuth2TokenExchangeType tokenType) {",
        "  try {",
        "    Map<String, Object> claims = validateAndDecode(incomingToken); // RS256/JWKS + iss/aud/exp",
        "    ... build Auth.UserData from claims.preferred_username/upn/email/name/oid ...",
        "    return new Auth.TokenValidationResult(true, null, userData, incomingToken, tokenType, null);",
        "  } catch (Exception e) {",
        "    return new Auth.TokenValidationResult(false); // Salesforce never surfaces WHY to the caller",
        "  }",
        "}",
        "",
        "global override User getUserForTokenSubject(Id networkId, Auth.TokenValidationResult result,",
        "    Boolean canCreateUser, String appDeveloperName, Auth.IntegratingAppType appType) {",
        "  String identifier = result.getUserData().email; // or .username",
        "  return [SELECT Id FROM User WHERE Azure_AD_Email_Id__c = :identifier",
        "          AND IsActive = true LIMIT 1]; // never auto-provisions",
        "}",
    ], font_size=7.6)
    pdf.body(
        "Confirmed live against a real Teams SSO token: iss matches "
        "https://login.microsoftonline.com/<tenant>/v2.0 exactly; aud is the bare Client ID (not the "
        "Application ID URI) - both are still accepted in EXPECTED_AUDIENCES since Microsoft doesn't "
        "publicly document this as guaranteed behavior."
    )

    pdf.h2("B.7  Troubleshooting log (the full journey to a working sign-in)")
    pdf.table(
        ["Symptom", "Root cause", "Fix"],
        [
            ["\"App resource defined in manifest and iframe origin do not match\"",
             "The Application ID URI had no domain in it (api://<client-id> alone) - Teams checks that the domain portion of resource matches the tab's actual hostname",
             "Set the Application ID URI to include that hostname: api://<tab-domain>/<client-id> (B.4)"],
            ["\"App webApplicationInfo or resource not defined in manifest\" (appeared AFTER the fix above was made)",
             "webApplicationInfo changes need a genuine uninstall + cache clear + reinstall, not a plain \"update\" - Teams was still running a stale cached manifest",
             "Fully remove the app (not update), test via Teams web client first (less local caching than desktop), then re-upload as a fresh install"],
            ["\"FailedToOpenWindow\" when the automatic fallback tried to open the popup",
             "See Part A's troubleshooting log - the same browser popup-blocker issue, triggered here by the async getAuthToken() failure happening first",
             "Same fix: a real \"Sign in\" button, popup only opened from its click handler"],
            ["AADSTS500011: \"resource principal ... was not found in the tenant\"",
             "getAuthToken() resolves the resource against the signed-in user's own home tenant; a mismatch between where the Azure AD app lives and that tenant, or a URI typo, produces this",
             "Confirmed the Application ID URI matched exactly and the app registration was in the correct tenant"],
            ["\"token handler not found\" (invalid_request)",
             "OauthTokenExchangeHandler is a GLOBAL, org-wide component - confirmed by deploying every field the Metadata API would accept and finding no per-app link field at all. The actual link is a Setup-UI-only \"Enable New App\" step with no deployable metadata equivalent",
             "Setup -> Token Exchange Handlers -> the handler -> Enable New App -> select the app, set a Run As user"],
            ["\"token handler validation failed\" (generic, no detail)",
             "Salesforce never surfaces the handler's real rejection reason to the caller, by design",
             "Added temporary System.debug() logging inside the handler, retrieved the real ApexLog via the Tooling API after a live retry, then removed the logging once confirmed"],
            ["Debug log: \"Unauthorized endpoint ... Setup->Security->Remote site settings\"",
             "fetchPublicKey()'s JWKS callout to login.microsoftonline.com had no Remote Site Setting - unrelated to the token's actual validity",
             "Added the Azure_AD_JWKS Remote Site Setting (B.5)"],
            ["invalid_grant: \"user hasn't approved this consumer\" (after the handler itself started succeeding)",
             "Token Exchange, like JWT Bearer flow, requires a prior approval that included a refresh_token grant on file - a non-interactive flow has no consent screen of its own to create that approval, so AllSelfAuthorized isn't sufficient",
             "Permitted Users -> \"Admin approved users are pre-authorized\" + a Permission Set listed on the app's policy, assigned to the user (B.5)"],
        ],
        [52, 66, 66],
        row_h=13,
    )
    pdf.callout(
        "Debugging technique worth keeping: pulling the real Apex debug log",
        "Salesforce's OAuth error responses to the browser are deliberately generic (\"token handler validation "
        "failed\") and never explain why a custom handler rejected a token. The only way to see the real reason "
        "is a debug log: create a TraceFlag on the handler's Run As user (Tooling API sobject TraceFlag, a "
        "DebugLevel id, a future ExpirationDate), have the person retry, then query ApexLog for "
        "Operation = 'OauthTokenExchangeApexExec' and fetch its Body. This is how every Part B issue past the "
        "first two was actually diagnosed, not guessed."
    )

    # =========================================================================================
    # RELATIONSHIP + FAQ
    # =========================================================================================
    pdf.add_page()
    pdf.h1("How the two parts fit together", "C")
    pdf.body(
        "Nothing in Part A changed to make room for Part B - loginWithTeamsSso() was added as a new, "
        "independent first attempt, and ensureSfSession() decides which one actually ran a session:"
    )
    pdf.code([
        "ensureSfSession()",
        "  |-- session already in localStorage? -> use it (no network call at all)",
        "  |-- loginWithTeamsSso()  (Part B, silent)",
        "  |     |-- succeeds -> session saved, done",
        "  |     '-- fails    -> falls through, marks needsInteractiveSignIn",
        "  '-- caller shows a real \"Sign in\" button -> loginWithPopup()  (Part A, interactive)",
    ], font_size=8)
    pdf.body(
        "Both paths save the exact same session shape ({accessToken, refreshToken, instanceUrl}) to the "
        "same localStorage key (sfUserSession), so every function downstream of ensureSfSession() - "
        "sfGetWithRetry, loadListView, the object-tab picker, everything - is completely unaware of which "
        "path actually produced the session it's using."
    )

    pdf.h1("FAQ", "D")
    pdf.qa(
        "Do people have to log in every time they open the app?",
        "No. With Part B working, most people never see any login step at all, ever. Even without it "
        "(Part A alone), only the very first time - after that, a stored session is reused silently "
        "(with automatic background refresh) until it's explicitly signed out, the refresh token expires "
        "or is revoked (~365 days), or the browser's storage is cleared."
    )
    pdf.qa(
        "Why does the fallback popup show a full address bar with Salesforce's/Microsoft's raw URL?",
        "Deliberate, not a bug - Teams shows full browser chrome on any third-party OAuth popup so a "
        "malicious Teams app can never fake a chrome-less \"Microsoft login\" screen. Every third-party "
        "OAuth Teams integration works this way."
    )
    pdf.qa(
        "Can this be done without the popup entirely, fully invisible?",
        "Yes - this is exactly what Part B does, and it's now built and confirmed working, not just a "
        "researched option. It needed a second Azure AD app exposing an API, a new Apex class doing real "
        "JWT signature validation, and a change from AllSelfAuthorized to an admin-approved Permission Set "
        "model - a materially bigger build than Part A, which is exactly why Part A remains as the "
        "automatic fallback rather than being replaced."
    )
    pdf.qa(
        "What happens for a brand new person who's never used this tab before?",
        "If Part B's setup is complete for them (their user has the Permission Set assigned and "
        "Azure_AD_Email_Id__c populated), their very first sign-in is already silent. If not yet assigned, "
        "they see Part A's interactive popup instead, and their admin needs to assign them the Permission "
        "Set before Part B can work for them - Part A alone has no such per-person setup requirement."
    )
    pdf.qa(
        "What happens if my company's Salesforce uses a different SSO provider (e.g. Okta)?",
        "Part A's popup mechanism is IdP-agnostic - it simply renders whatever that org's real login page "
        "shows. The specific Azure_AD_SSO Auth Provider built here was needed only because this dev "
        "sandbox had no SSO configured at all; it should not be replicated as a competing, parallel login "
        "path in an org that already has a company-mandated SSO provider."
    )
    pdf.qa(
        "Is the access token exposed in the browser a real security concern?",
        "It's a known, deliberate trade-off (\"Option B\" in the project plan) - the token lives in the "
        "browser rather than behind a server, in exchange for a much smaller build with no relay-held "
        "secrets. Revisit only if this trade-off ever stops being acceptable for the sensitivity of the "
        "data involved; a relay/BFF-based alternative (\"Option A\") was scoped but not built."
    )

    pdf.output(str(OUT))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
