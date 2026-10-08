/**
 * Serves the "Salesforce Org" Teams tab's first screen: a multi-object list-view browser (Cases,
 * Accounts, Contacts, and whatever else) with a real list-view picker, plus links into
 * salesforceTabRecordFull's Case record detail page.
 *
 * Per-user auth (OAuth 2.0 Authorization Code + PKCE, or silent Teams SSO + Token Exchange when
 * that's set up - no relay in the auth/data path either way) - replaces the earlier run-as-user
 * proof of concept (salesforceMyCases.js, kept unused as an easy revert).
 *
 * The header (app name + a current-object switcher whose menu lists Cases/Accounts/Contacts/...,
 * like a Lightning console app's navigation menu) is NOT hardcoded - it's read live
 * from the signed-in user's own current Salesforce app (UI API's /ui-api/apps, the one flagged
 * "selected") and its navItems, filtered to real object entries. This means adding another object
 * as a tab here is a pure Salesforce configuration change (add it to that person's Salesforce App's
 * navigation in Setup) - no code change, no relay redeploy, no Teams app reinstall. Table columns
 * within each object's list are also never hardcoded - they're whatever the selected list view's
 * own columns are.
 *
 * Only Case has a real record detail page today (salesforceTabRecordFull.js - the earlier
 * salesforceTabRecord.js "Page Layout" comparison variant was retired once Lightning was settled
 * on as the only version worth keeping). Clicking a Case row opens it as a same-origin iframe in a closable tab appended to
 * the same tab row (Console-app style). Other objects don't have a dedicated page built yet, so a
 * row click there opens the record directly in Salesforce instead (via a new tab/window) - a
 * deliberate, narrower fallback rather than a broken custom page. Deep-link aware: a subPageId in
 * the Teams context skips the list and opens straight into that Case's tab (deep links are
 * Case-only, matching how "Copy link to this case" already works).
 */
const { app } = require('@azure/functions');

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Salesforce</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #242424;
  }
  a { color: #5B5FC7; text-decoration: none; }
  a:hover { color: #464775; text-decoration: underline; }
  .card { background: #FFFFFF; border: 1px solid #E1E1E1; border-radius: 8px; }
  /* Shared with salesforceTabRecordFull.js - same values verbatim, so a button or a status
     message looks identical on either page. Any new page in this feature should reuse these
     same class names/values rather than inventing another one-off button style. */
  .btn-primary { background: #5B5FC7; color: #fff; border: none; border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(91,95,199,0.35); transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease; }
  .btn-primary:hover { background: #464775; box-shadow: 0 3px 8px rgba(70,71,117,0.35); }
  .btn-primary:active { transform: translateY(1px); box-shadow: 0 1px 2px rgba(70,71,117,0.3); }
  .btn-secondary { background: #fff; color: #5B5FC7; border: 1px solid #D9D9F7; border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(17,17,26,0.04); transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease; }
  .btn-secondary:hover { background: #F5F5FF; border-color: #B9BBF2; box-shadow: 0 3px 8px rgba(91,95,199,0.18); }
  .btn-secondary:active { transform: translateY(1px); }
  .btn-primary:disabled, .btn-secondary:disabled { background: #E1E1E1; color: #A19F9D; border-color: #E1E1E1; box-shadow: none; cursor: default; transform: none; }
  .status { font-size: 0.8rem; color: #8A8A8A; min-height: 1em; }
  .status.error { color: #C0392B; }
  .pill { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  th { text-align: left; padding: 8px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #A19F9D; background: #FAFAFA; border-bottom: 1px solid #E1E1E1; white-space: nowrap; }
  td { padding: 8px 16px; font-size: 13px; border-bottom: 1px solid #F0F0F0; white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  .avatar-sm { width: 22px; height: 22px; border-radius: 50%; background: #5B5FC7; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; }
  /* Flat, divider-separated tab, matching a real Salesforce Console tab bar exactly (reference: no
     box/border around each tab, just plain text/icons with a chevron, separated from its neighbor by
     a single thin vertical rule; the active tab gets a light tint + colored underline, nothing else
     does). Replaces the previous attempt's bordered-box-per-tab look, which was closer but still not
     quite it - the real bar has no individual borders at all. Used for BOTH the object switcher and
     opened record/Search tabs, so the whole row reads as one continuous bar. */
  .tab { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; white-space: nowrap; padding: 8px 12px; font-size: 13px; font-weight: 600; color: #242424; background: transparent; border: none; border-right: 1px solid #E1E1E1; border-bottom: 2px solid transparent; cursor: pointer; font-family: inherit; transition: background 0.12s ease; }
  .tab:hover { background: #FAFAFA; }
  /* The app's own real accent color (see renderAppHeader) drives the active tab's underline+tint -
     object switcher, opened records, Search alike - a real Console app colors this with its own
     brand color, not a fixed one regardless of app. */
  .tab.active { background: #F5F9FF; border-bottom-color: var(--tab-accent, #0176D3); }
  .tab-chevron { color: #706E6B; font-size: 10px; }
  .tab-record .tab-close { margin-left: 2px; }
  .tab-close { font-size: 14px; line-height: 1; color: #A19F9D; padding: 1px 3px; border-radius: 4px; }
  .tab-close:hover { color: #C0392B; background: #FBEEEC; }
  .record-tab-frame { width: 100%; height: calc(100vh - 170px); border: none; border-radius: 8px; background: #FFFFFF; display: none; }
  .record-tab-frame.active { display: block; }

  .nav-picker { position: absolute; top: calc(100% + 4px); left: 0; z-index: 20; width: 260px; background: #fff; border: 1px solid #E1E1E1; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.14); padding: 8px; }
  .nav-picker-search { width: 100%; box-sizing: border-box; font-size: 12.5px; padding: 6px 9px; border: 1px solid #D8D9DB; border-radius: 6px; margin-bottom: 6px; }
  .nav-picker-list { max-height: 220px; overflow-y: auto; }
  .nav-picker-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 9px; font-size: 13px; border-radius: 6px; cursor: pointer; }
  .nav-picker-item:hover { background: #F3F2F1; }
  .nav-picker-item.active { background: #EEF4FF; font-weight: 600; }
  .nav-picker-item .nav-label { flex: 1; }
  .nav-picker-sep { height: 1px; background: #EDEBE9; margin: 6px 0; }
  .nav-picker-caption { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #A19F9D; padding: 6px 9px 2px; }
  .nav-picker-add { color: #0B5CAB; }
  /* Dropdown switcher, fourth design: the exact same bordered-tab look as the opened record/Search
     tabs next to it (see .tab above) - matches a real Salesforce Console tab bar directly, per
     reference screenshot. Earlier attempts all missed: a plain bordered box alone (looked like a
     duplicate of the list-view <select> below it), plain breadcrumb text (an extra click just to go
     anywhere), a full tab-strip for every object (rejected as a whole-strip redesign), and a filled
     color pill (read as a badge/tag, not a real control). navSwitchWrap only carries position:
     relative now, for the dropdown menu's own positioning - the switcher button itself is a plain
     .tab, just like any other tab in the row. */
  /* No gap here - the tabs' own border-right dividers provide the spacing, a flex gap on top of
     that would double it up unevenly. The search button (not a tab) gets its own small margins
     instead, for breathing room on either side of it. */
  .app-header { display: flex; align-items: center; gap: 0; margin-bottom: 20px; }
  .app-name { font-size: 13px; font-weight: 600; color: #616161; white-space: nowrap; padding: 8px 12px 8px 0; border-right: 1px solid #E1E1E1; }
  .nav-switch-wrap { position: relative; }
  /* Real inline search box in the header (not just an icon that navigates away) - a compact live-
     results dropdown (see renderHeaderSearchResults) appears under it as you type, reusing the same
     .nav-picker panel look as the object switcher's own menu. Enter, or "See all results", opens the
     full Search tab (salesforceTabSearch.js) for a more thorough view. */
  .header-search-wrap { position: relative; display: flex; align-items: center; margin: 0 8px; flex: 0 1 200px; min-width: 100px; }
  .header-search-icon { position: absolute; left: 8px; font-size: 11px; color: #A19F9D; pointer-events: none; }
  .header-search-input { width: 100%; box-sizing: border-box; font-size: 12.5px; padding: 6px 8px 6px 26px; border: 1px solid #D1D1D1; border-radius: 6px; color: #242424; background: #FAFAFA; font-family: inherit; }
  .header-search-input:focus { outline: none; border-color: #0176D3; background: #fff; box-shadow: 0 0 0 2px rgba(1,118,211,0.12); }
  .header-search-result-title { font-size: 13px; font-weight: 600; color: #242424; }
  .header-search-result-subtitle { font-size: 11px; color: #A19F9D; margin-top: 1px; }
  .record-tab-row { display: none; align-items: center; gap: 0; overflow-x: auto; }
  .record-tab-label { font-size: 12.5px; font-weight: 600; color: #242424; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
  .record-tab-label.is-loading { color: #A19F9D; font-weight: 400; font-style: italic; }
  .nav-icon { width: 20px; height: 20px; border-radius: 4px; flex: none; }
  .nav-icon-letter { display: inline-flex; align-items: center; justify-content: center; background: #8A8886; color: #fff; font-size: 11px; font-weight: 700; }
  .nav-picker-empty { padding: 10px 9px; font-size: 12px; color: #A19F9D; }
</style>
</head>
<body>
<div style="min-height: 100%; background: #F5F5F5; padding: 20px 24px; box-sizing: border-box;">
  <div style="max-width: 1120px; margin: 0 auto;">

    <!-- Salesforce-style header (see renderAppHeader/renderObjectTabs): the user's default app name,
         a dropdown switcher for the current object (a real bordered tab, same look as the opened
         record/Search tabs next to it - see .tab), and opened Case records/Search appended to the
         same row. Nothing here is hardcoded - it is all read from the user's own app. -->
    <div class="app-header" id="appHeader">
      <div class="app-name" id="appName">Salesforce</div>
      <div class="nav-switch-wrap" id="navSwitchWrap">
        <button type="button" class="tab" id="navSwitchBtn" aria-haspopup="true">
          <span class="record-tab-label" id="navSwitchLabel">Loading&hellip;</span>
          <span class="tab-chevron">&#9662;</span>
        </button>
      </div>
      <div class="header-search-wrap" id="headerSearchWrap">
        <span class="header-search-icon">&#128269;</span>
        <input type="text" id="headerSearchInput" class="header-search-input" placeholder="Search..." autocomplete="off" />
      </div>
      <div class="record-tab-row" id="recordTabRow"></div>
    </div>

    <div id="listPane">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
        <h1 id="listHeading" style="margin: 0; font-size: 20px; font-weight: 700; white-space: nowrap;">Cases</h1>
        <select id="listViewPicker" style="font-size: 13px; padding: 6px 10px; border: 1px solid #D1D1D1; border-radius: 4px; color: #424242; background: #fff;"></select>
        <button type="button" id="signOutBtn" style="margin-left: auto; background: none; border: none; color: #616161; font-size: 12px; cursor: pointer; text-decoration: underline; padding: 4px;">Sign out</button>
      </div>

      <div class="status" id="status" style="padding: 8px 0;">Loading&hellip;</div>
      <div class="card" id="casesCard" style="display: none; overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse;">
          <thead><tr id="headerRow"></tr></thead>
          <tbody id="bodyRows"></tbody>
        </table>
      </div>
      <div id="countLine" style="margin-top: 10px; font-size: 11px; color: #A19F9D;"></div>
    </div>

    <!-- Opened record tabs render as iframes appended here. -->
    <div id="recordTabsContainer"></div>
  </div>
</div>

<script src="https://res.cdn.office.net/teams-js/2.19.0/js/MicrosoftTeams.min.js" crossorigin="anonymous"></script>

<script>
(function () {
  var statusEl = document.getElementById('status');
  var casesCard = document.getElementById('casesCard');
  var headerRow = document.getElementById('headerRow');
  var bodyRows = document.getElementById('bodyRows');
  var countLine = document.getElementById('countLine');
  var listHeading = document.getElementById('listHeading');
  var listViewPicker = document.getElementById('listViewPicker');
  var signOutBtn = document.getElementById('signOutBtn');
  var appName = document.getElementById('appName');
  var navSwitchWrap = document.getElementById('navSwitchWrap');
  var navSwitchBtn = document.getElementById('navSwitchBtn');
  var navSwitchLabel = document.getElementById('navSwitchLabel');
  var recordTabRow = document.getElementById('recordTabRow');
  var listPane = document.getElementById('listPane');
  var recordTabsContainer = document.getElementById('recordTabsContainer');
  var headerSearchWrap = document.getElementById('headerSearchWrap');
  var headerSearchInput = document.getElementById('headerSearchInput');

  var allColumns = [];
  var allRows = [];
  var activeObjectApiName = null; // which object's list view #listPane currently shows
  // Which object's data is CURRENTLY sitting in allRows/#bodyRows (there is only one shared list
  // pane, so only one object can genuinely be "loaded" at a time) - lets returning to an
  // already-loaded object (closing a record tab, re-picking the same object from the switcher) skip
  // a wasted refetch instead of always reloading from scratch. Cleared on error, so a failed load
  // still retries automatically next time this object's tab is activated.
  var listViewLoadedFor = null;
  var lastSelectedListView = {}; // objectApiName -> list view API name the person actually picked,
  // so returning to an object (even after a real reload) shows what they chose, not always the
  // default view.

  // ---------------- Salesforce per-user OAuth (Authorization Code + PKCE via Teams popup) ----------------
  // Public client, no secret; CLIENT_ID is sent openly by design, safe to embed here.
  var SF_LOGIN_DOMAIN = 'https://mylightningapp-dev-dev-ed.my.salesforce.com';
  var SF_CLIENT_ID = '3MVG9G9pzCUSkzZsud2BdW9TWBEoplncNXHW02MLEybqDY0coXFBNmBujduJ2Du59lbZXigmCVI4V91wkBg0q';
  var SF_REDIRECT_URI = 'https://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net/api/salesforceAuthCallback';
  var SF_SCOPES = 'api refresh_token openid';
  var SF_API_VERSION = 'v61.0';
  var SF_SESSION_KEY = 'sfUserSession';

  function saveSfSession(session) {
    try { localStorage.setItem(SF_SESSION_KEY, JSON.stringify(session)); } catch (e) {}
  }
  function loadSfSession() {
    try {
      var raw = localStorage.getItem(SF_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSfSession() {
    try { localStorage.removeItem(SF_SESSION_KEY); } catch (e) {}
  }

  function base64UrlEncode(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  function randomPkceVerifier() {
    var bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
  }
  function pkceChallengeFor(verifier) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)).then(function (digest) {
      return base64UrlEncode(new Uint8Array(digest));
    });
  }

  function refreshAccessToken(refreshToken) {
    var body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', refreshToken);
    body.set('client_id', SF_CLIENT_ID);
    return fetch(SF_LOGIN_DOMAIN + '/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && data.error_description) || 'Salesforce token request failed.');
        return data;
      });
    });
  }

  // ---------------- Teams SSO + Salesforce Token Exchange (silent, no popup at all) ----------------
  // Tried FIRST, before the PKCE popup below - completely silent when it works: Teams SSO
  // (getAuthToken()) hands back a signed Azure AD token for whoever is already signed into Teams,
  // no user interaction at all, and Salesforce's OAuth 2.0 Token Exchange flow trades that directly
  // for a real per-user Salesforce token. The actual identity verification happens INSIDE
  // Salesforce (SalesforceInTeamsTokenExchangeHandler.cls does full RS256/JWKS validation there),
  // not here - this function is just plumbing.
  //
  // Requires setup this environment may not have yet: an Azure AD app exposing an API
  // (webApplicationInfo in the Teams manifest) and "Enable Token Exchange Flow" turned on for the
  // SF_CLIENT_ID Connected App/External Client App, with SalesforceInTeamsTokenExchangeHandler.cls
  // registered as its handler. Deliberately never the only path: ensureSfSession() below falls
  // back to the PKCE popup on ANY failure here, so this silently does nothing (not break anything)
  // until that setup is complete - same "no redeploy needed to revert/adopt" fallback-ladder
  // pattern as caseSwarmChat's three delivery modes elsewhere in this project.
  function loginWithTeamsSso() {
    if (!window.microsoftTeams || !microsoftTeams.authentication || !microsoftTeams.authentication.getAuthToken) {
      return Promise.reject(new Error('Teams SSO is not available in this context.'));
    }
    return microsoftTeams.authentication.getAuthToken().then(function (aadToken) {
      var body = new URLSearchParams();
      body.set('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
      body.set('subject_token', aadToken);
      body.set('subject_token_type', 'urn:ietf:params:oauth:token-type:access_token');
      body.set('client_id', SF_CLIENT_ID);
      return fetch(SF_LOGIN_DOMAIN + '/services/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
      }).then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error((data && data.error_description) || 'Salesforce token exchange failed.');
          return data;
        });
      });
    }).then(function (tokenResponse) {
      var session = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token, // may be absent depending on the exchange's own OAuth policy - refresh code below already tolerates that
        instanceUrl: tokenResponse.instance_url
      };
      saveSfSession(session);
      return session;
    });
  }

  // Salesforce blocks iframing, so login can't be a top-level redirect of the tab (itself an
  // iframe) - microsoftTeams.authentication.authenticate() opens it in a real popup instead.
  //
  // The code-for-token exchange itself happens in the POPUP (salesforceAuthCallback.js), not
  // here, for the browser-throttling reason already covered elsewhere. The actual session handoff
  // back to THIS tab is the string passed to microsoftTeams.authentication.notifySuccess(...),
  // which authenticate()'s resolved value carries here directly over Teams' own postMessage
  // bridge - deliberately NOT a shared-localStorage read. Reported live: in a private/incognito
  // window the popup would complete cleanly (visibly closing right away) but this tab still
  // reported "Could not load cases right now" every time, even after Retry. Root cause: a private
  // window is exactly where Chrome's third-party storage partitioning is enabled first (ahead of
  // its general rollout) - the popup is a genuine top-level navigation to this origin, while this
  // tab is the same origin loaded inside an iframe under teams.microsoft.com, and partitioning
  // keys storage by (top-level site, embedded site), so those are two different, mutually
  // invisible localStorage buckets. No amount of retrying a storage *read* here could ever see
  // what the popup's storage *write* did. The popup still best-effort writes to its own
  // localStorage too (harmless, and it happens to help in contexts that don't partition, like the
  // Teams desktop client), but this tab now takes the session from the notifySuccess() payload
  // itself, which needs no shared storage at all.
  function loginWithPopup() {
    var verifier = randomPkceVerifier();
    try { localStorage.setItem('sfPkceVerifier', verifier); } catch (e) {}
    var authPromise = pkceChallengeFor(verifier).then(function (challenge) {
      var authorizeUrl = SF_LOGIN_DOMAIN + '/services/oauth2/authorize' +
        '?response_type=code' +
        '&client_id=' + encodeURIComponent(SF_CLIENT_ID) +
        '&redirect_uri=' + encodeURIComponent(SF_REDIRECT_URI) +
        '&code_challenge=' + encodeURIComponent(challenge) +
        '&code_challenge_method=S256' +
        '&scope=' + encodeURIComponent(SF_SCOPES);

      return microsoftTeams.authentication.authenticate({ url: authorizeUrl, width: 600, height: 720 });
    }).then(function (result) {
      var session = null;
      // result is the exact string the popup passed to notifySuccess() - parse it directly rather
      // than falling back to a storage read, which the partitioning issue above can make invisible.
      try { session = result ? JSON.parse(result) : null; } catch (e) { session = null; }
      if (!session || !session.accessToken) {
        // Fallback for older/other contexts (e.g. a stale popup still on the pre-fix build, or a
        // non-partitioned context) where storage genuinely is shared - try it before giving up.
        session = loadSfSession();
      }
      if (!session || !session.accessToken) throw new Error('Sign-in did not complete - no session was saved.');
      saveSfSession(session); // this tab's own localStorage write - independent of the popup's
      return session;
    });

    // Belt-and-braces: authenticate() itself should always settle, but if the Teams popup
    // handshake ever silently stalls (seen intermittently in private-browsing contexts), this
    // stops the UI from being stuck on "Loading..." forever with no way out but a guessed reload.
    var timeout = new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error('Sign-in is taking too long - please try again.')); }, 45000);
    });
    return Promise.race([authPromise, timeout]);
  }

  // Uses a stored session optimistically; sfGetWithRetry below handles a bad/expired token.
  //
  // loadListView() fires three sfGetWithRetry() calls in parallel (list-info, list-records, the
  // list-view picker) - on a first-ever load (no stored session yet, e.g. a private window) all
  // three would otherwise call ensureSfSession() at the same moment and each see "no session",
  // opening THREE concurrent authenticate() popups that race on the single shared
  // localStorage 'sfPkceVerifier' key (each loginWithPopup() call overwrites it with a fresh
  // verifier). Whichever popup's token exchange runs after another has already overwritten that
  // key fails with a PKCE mismatch - and since that failure can throw synchronously out of
  // Promise.all's array-construction step rather than as a rejection, it can leave the page
  // silently stuck on "Loading cases..." forever, with neither the success path nor the .catch()
  // ever running. Fixed by de-duping: only the FIRST caller actually starts loginWithPopup(); every
  // concurrent caller awaits that same in-flight promise instead of starting its own.
  // ensureSfSession() only ever tries the SILENT path (a stored session, or Teams SSO). It
  // deliberately does NOT fall back to the interactive popup itself - loginWithPopup() opens a
  // real window.open()-backed popup, and browsers only reliably allow that when it's called
  // synchronously from a genuine user click. Chaining it automatically after an async SSO failure
  // (which is what this used to do) pushes it too far from any real user gesture, and browsers
  // silently block it - confirmed live via a real "FailedToOpenWindow" error in the Teams web
  // client (worked fine in the desktop client's own webview, which doesn't apply the same
  // popup-blocking heuristics - masking the issue during earlier testing there).
  //
  // Instead, a failure here is marked needsInteractiveSignIn and left for the CALLER to handle by
  // showing a real "Sign in" button - see promptInteractiveSignIn() below - whose own click
  // handler calls signInInteractively() directly, a real synchronous user gesture.
  var pendingLogin = null;
  function ensureSfSession() {
    var session = loadSfSession();
    if (session && session.accessToken) return Promise.resolve(session);
    if (!pendingLogin) {
      pendingLogin = loginWithTeamsSso().then(function (result) {
        pendingLogin = null;
        return result;
      }, function (err) {
        pendingLogin = null;
        console.error('Teams SSO sign-in failed, interactive sign-in is needed:', err);
        var interactiveErr = new Error('Sign-in is needed.');
        interactiveErr.needsInteractiveSignIn = true;
        throw interactiveErr;
      });
    }
    return pendingLogin;
  }

  // Called ONLY from a real click handler (a "Sign in" button) - never automatically - so the
  // resulting loginWithPopup() call is a genuine user gesture browsers will actually allow.
  var pendingInteractiveSignIn = null;
  function signInInteractively() {
    if (!pendingInteractiveSignIn) {
      pendingInteractiveSignIn = loginWithPopup().then(function (result) {
        pendingInteractiveSignIn = null;
        return result;
      }, function (err) {
        pendingInteractiveSignIn = null;
        throw err;
      });
    }
    return pendingInteractiveSignIn;
  }

  // Shows a real "Sign in" button inside the given container, replacing its current content;
  // clicking it runs signInInteractively() and, on success, calls retryFn() to resume whatever was
  // waiting on a session.
  function promptInteractiveSignIn(container, message, retryFn) {
    container.innerHTML = '';
    container.appendChild(document.createTextNode(message + ' '));
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Sign in';
    btn.className = 'btn-primary'; // shared with salesforceTabRecordFull.js, not a one-off style
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Signing in\\u2026';
      signInInteractively().then(function () {
        retryFn();
      }).catch(function (err) {
        console.error('Interactive sign-in failed:', err);
        promptInteractiveSignIn(container, 'Sign-in did not complete - please try again.', retryFn);
      });
    });
    container.appendChild(btn);
  }

  function sfGetOnce(session, path) {
    return fetch(session.instanceUrl + path, {
      headers: { Authorization: 'Bearer ' + session.accessToken }
    }).then(function (res) {
      if (res.status === 401) {
        var err = new Error('Salesforce rejected the access token.');
        err.isAuthError = true;
        throw err;
      }
      if (!res.ok) throw new Error('Salesforce request failed: ' + res.status);
      return res.json();
    });
  }

  // Tries a silent refresh on a 401; only falls back to a popup login if the refresh itself fails.
  function sfGetWithRetry(path) {
    var currentSession;
    return ensureSfSession().then(function (session) {
      currentSession = session;
      return sfGetOnce(session, path);
    }).catch(function (err) {
      if (!err.isAuthError) throw err;
      if (!currentSession || !currentSession.refreshToken) {
        clearSfSession();
        // Routed through ensureSfSession(), not loginWithPopup() directly, so multiple in-flight
        // requests whose tokens expire around the same moment share one popup instead of racing.
        return ensureSfSession().then(function (session) { return sfGetOnce(session, path); });
      }
      return refreshAccessToken(currentSession.refreshToken).then(function (tokenResponse) {
        var refreshed = {
          accessToken: tokenResponse.access_token,
          refreshToken: currentSession.refreshToken, // Salesforce doesn't rotate refresh tokens by default
          instanceUrl: tokenResponse.instance_url || currentSession.instanceUrl
        };
        saveSfSession(refreshed);
        return sfGetOnce(refreshed, path);
      }).catch(function () {
        clearSfSession();
        return ensureSfSession().then(function (session) { return sfGetOnce(session, path); });
      });
    });
  }

  // POST/DELETE variants of sfGetWithRetry, for the pinned-tab persistence below - same
  // ensureSfSession()/401-retry shape as sfGetOnce/sfGetWithRetry, just a different HTTP verb.
  function sfWriteOnce(session, method, path, body) {
    var headers = { Authorization: 'Bearer ' + session.accessToken };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(session.instanceUrl + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      if (res.status === 401) {
        var err = new Error('Salesforce rejected the access token.');
        err.isAuthError = true;
        throw err;
      }
      if (!res.ok) throw new Error('Salesforce request failed: ' + res.status);
      return res.status === 204 ? null : res.json();
    });
  }
  function sfWriteWithRetry(method, path, body) {
    var currentSession;
    return ensureSfSession().then(function (session) {
      currentSession = session;
      return sfWriteOnce(session, method, path, body);
    }).catch(function (err) {
      if (!err.isAuthError) throw err;
      clearSfSession();
      return ensureSfSession().then(function (session) { return sfWriteOnce(session, method, path, body); });
    });
  }

  // ---------------- "+" pinned tabs (Teams_Pinned_Tab__c) ----------------
  // Persists which extra object tabs a person has personally added, beyond whatever their
  // Salesforce app's own navigation already shows automatically - see the custom object's own
  // description for why this is a real Salesforce object (per-person, works across devices/
  // browsers) rather than localStorage (per-browser only).
  var currentUserIdPromise = null;
  function getCurrentUserId() {
    if (!currentUserIdPromise) {
      currentUserIdPromise = sfGetWithRetry('/services/oauth2/userinfo').then(function (info) {
        return info.user_id;
      });
    }
    return currentUserIdPromise;
  }

  function fetchPinnedTabs() {
    return getCurrentUserId().then(function (userId) {
      var soql = "SELECT Id, Object_Api_Name__c, Label__c, Sort_Order__c FROM Teams_Pinned_Tab__c " +
        "WHERE OwnerId = '" + userId.replace(/'/g, "\\\\'") + "' ORDER BY Sort_Order__c";
      return sfGetWithRetry('/services/data/' + SF_API_VERSION + '/query?q=' + encodeURIComponent(soql));
    }).then(function (result) {
      return (result.records || []).map(function (r) {
        return { id: r.Id, objectApiName: r.Object_Api_Name__c, label: r.Label__c, sortOrder: r.Sort_Order__c };
      });
    }).catch(function (err) {
      console.error('Could not load pinned tabs:', err);
      return []; // best-effort - the page still works with just the app-nav tabs
    });
  }

  function createPinnedTab(objectApiName, label, nextSortOrder) {
    return sfWriteWithRetry('POST', '/services/data/' + SF_API_VERSION + '/sobjects/Teams_Pinned_Tab__c', {
      Object_Api_Name__c: objectApiName,
      Label__c: label,
      Sort_Order__c: nextSortOrder
    }).then(function (result) {
      return { id: result.id, objectApiName: objectApiName, label: label, sortOrder: nextSortOrder };
    });
  }

  function deletePinnedTab(pinId) {
    return sfWriteWithRetry('DELETE', '/services/data/' + SF_API_VERSION + '/sobjects/Teams_Pinned_Tab__c/' + encodeURIComponent(pinId));
  }

  signOutBtn.addEventListener('click', function () {
    clearSfSession();
    location.reload();
  });

  // Case only - the only object with a real record detail page today (see header comment).
  // salesforceTabRecordFull.js ("Lightning") is the sole version now - salesforceTabRecord.js (the
  // "Page Layout" comparison variant) is retired; this always points at the former.
  function recordPageUrl(id) {
    return 'salesforceTabRecordFull?id=' + encodeURIComponent(id);
  }

  // ---------------- Unified tab row: one entry per object list-view tab (Cases/Accounts/...,
  // read live from the user's own Salesforce app nav - see loadAppNavObjectTabs() below) plus one
  // per opened Case record (Console-app style, appended alongside). All share one active/inactive
  // switching mechanism so clicking any tab correctly deactivates every other one, of either kind.
  var allTabs = {}; // tabId -> { kind: 'list' | 'record', btn, frame? (record only), objectApiName (list only) }

  function activateTab(tabId) {
    Object.keys(allTabs).forEach(function (id) {
      var t = allTabs[id];
      var isActive = id === tabId;
      if (t.btn) t.btn.classList.toggle('active', isActive);
      if (t.kind === 'record') t.frame.classList.toggle('active', isActive);
    });
    var active = allTabs[tabId];
    var isListTab = !!(active && active.kind === 'list');
    listPane.style.display = isListTab ? 'block' : 'none';
    // The switcher isn't tracked in allTabs (it represents "whichever object", not one fixed tab
    // id), so its own active/blue-underline state is driven directly here: on exactly when the list
    // itself is what's showing, off whenever a record/Search tab is the one active instead - same
    // rule real Salesforce Console tabs use.
    navSwitchBtn.classList.toggle('active', isListTab);
    if (isListTab) selectObjectTab(active.objectApiName, tabId);
  }

  // ---- Record tabs (Case only today - see header comment) ----
  // Live-updates a record tab's label once salesforceTabRecordFull.js reports the record's real
  // title via postMessage - needed for the deep-link path, which only ever has a bare record id to
  // start from. Same-origin only (the iframe and this page share an origin) - the targetOrigin
  // check on the sending end (window.location.origin) is what actually enforces that.
  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.type === 'salesforceRecordTitle') {
      var t = allTabs[e.data.recordId];
      if (t && t.kind === 'record' && t.labelSpan) {
        t.labelSpan.textContent = e.data.title;
        t.labelSpan.classList.remove('is-loading');
      }
    } else if (e.data.type === 'salesforceRecordFieldsChanged') {
      // A field was just saved from inside the record iframe (Close Case, Update Reason, ...) -
      // the Cases list behind it is still showing whatever it fetched when the tab first opened,
      // so patch the matching row's already-visible columns and re-render immediately, rather than
      // requiring a manual reload to see it. Best-effort: only touches columns the current list
      // view actually displays: a field this list view doesn't show (or a different object's list
      // being open right now) is a silent no-op, not an error.
      var row = allRows.filter(function (r) { return r.__id === e.data.recordId; })[0];
      if (row) {
        var changed = false;
        Object.keys(e.data.fields || {}).forEach(function (fieldApiName) {
          if (Object.prototype.hasOwnProperty.call(row, fieldApiName)) {
            row[fieldApiName] = e.data.fields[fieldApiName];
            changed = true;
          }
        });
        if (changed) render();
      }
    } else if (e.data.type === 'salesforceOpenRecord') {
      // From salesforceTabSearch.js: a Case result was clicked - open/activate it as a normal
      // record tab, same as clicking a Cases-list row would (openRecordTab is defined further
      // below in this same IIFE - safe to call here, function declarations are hoisted).
      openRecordTab(e.data.recordId, e.data.label, e.data.objectApiName);
    } else if (e.data.type === 'salesforceCloseRecordTab') {
      // From salesforceTabRecordFull.js's "Cases" breadcrumb - same as clicking the tab's own "x"
      // (closeRecordTab is defined further below in this same IIFE - safe to call here, function
      // declarations are hoisted). Falls back to the list tab that was open before, already-loaded.
      closeRecordTab(e.data.recordId);
    }
  });

  function closeRecordTab(id) {
    var t = allTabs[id];
    if (!t) return;
    var wasActive = t.btn.classList.contains('active');
    t.btn.remove();
    t.frame.remove();
    delete allTabs[id];
    if (!recordTabRow.children.length) recordTabRow.style.display = 'none';
    if (wasActive) {
      // Fall back to whichever list tab was last active, or the first remaining tab if none yet.
      var fallbackId = activeObjectApiName ? ('obj:' + activeObjectApiName) : Object.keys(allTabs)[0];
      if (fallbackId && allTabs[fallbackId]) activateTab(fallbackId);
    }
  }

  // label is the record's real display value when the caller already has it (a row click - the
  // list's own first column is already showing it); pass null from a context that only has the
  // bare id (a Teams deep link) and the tab shows a "Loading..." placeholder until the record
  // iframe reports its real title back via the postMessage listener above.
  function openRecordTab(id, label, objectApiName) {
    if (allTabs[id]) {
      activateTab(id);
      return;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab tab-record';

    var navEntry = (navEntries || []).filter(function (e) { return e.objectApiName === (objectApiName || 'Case'); })[0];
    btn.appendChild(navIcon(navEntry || { label: objectApiName || 'Case' }));

    var labelSpan = document.createElement('span');
    labelSpan.className = 'record-tab-label';
    if (label) {
      labelSpan.textContent = label;
    } else {
      labelSpan.textContent = 'Loading\u2026';
      labelSpan.classList.add('is-loading');
    }
    btn.appendChild(labelSpan);

    // Purely visual, matching the reference's per-tab chevron (real Salesforce Console tabs use
    // theirs to open a tab context menu - not built here, this just completes the look).
    var chevron = document.createElement('span');
    chevron.className = 'tab-chevron';
    chevron.textContent = '\\u25be';
    btn.appendChild(chevron);

    var closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '\\u00d7';
    closeBtn.setAttribute('aria-label', 'Close ' + (label || 'record tab'));
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeRecordTab(id);
    });
    btn.appendChild(closeBtn);

    btn.addEventListener('click', function () { activateTab(id); });
    recordTabRow.appendChild(btn);
    recordTabRow.style.display = 'flex';

    var frame = document.createElement('iframe');
    frame.className = 'record-tab-frame';
    frame.src = recordPageUrl(id);
    recordTabsContainer.appendChild(frame);

    allTabs[id] = { kind: 'record', btn: btn, frame: frame, labelSpan: labelSpan };
    activateTab(id);
  }

  // ---- Search tab (singleton - re-opening it just re-activates it) ----
  // Same tab-strip/iframe mechanism as a record tab above (reuses closeRecordTab - it only keys off
  // allTabs[id], it doesn't care which kind a tab is), pointed at salesforceTabSearch.js instead.
  // initialQuery (optional) comes from the header search box's "See all results"/Enter - pre-fills
  // and runs that search on the full Search tab instead of landing on it empty.
  var SEARCH_TAB_ID = '__search';

  function openSearchTab(initialQuery) {
    if (allTabs[SEARCH_TAB_ID]) {
      activateTab(SEARCH_TAB_ID);
      if (initialQuery) {
        // Best-effort - the Search tab may not have finished loading/wiring up its own listener yet
        // on the very first activation; harmless no-op if the message arrives too early.
        try { allTabs[SEARCH_TAB_ID].frame.contentWindow.postMessage({ type: 'salesforceRunSearch', term: initialQuery }, window.location.origin); } catch (e) {}
      }
      return;
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tab tab-record';

    var icon = document.createElement('span');
    icon.className = 'nav-icon nav-icon-letter';
    icon.textContent = '🔍'; // magnifying glass - a real object icon would look like a
    // mismatched entity type here, this is deliberately generic
    btn.appendChild(icon);

    var labelSpan = document.createElement('span');
    labelSpan.className = 'record-tab-label';
    labelSpan.textContent = 'Search';
    btn.appendChild(labelSpan);

    var chevron = document.createElement('span');
    chevron.className = 'tab-chevron';
    chevron.textContent = '▾';
    btn.appendChild(chevron);

    var closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close Search');
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeRecordTab(SEARCH_TAB_ID);
    });
    btn.appendChild(closeBtn);

    btn.addEventListener('click', function () { activateTab(SEARCH_TAB_ID); });
    recordTabRow.appendChild(btn);
    recordTabRow.style.display = 'flex';

    var frame = document.createElement('iframe');
    frame.className = 'record-tab-frame';
    frame.src = 'salesforceTabSearch' + (initialQuery ? ('?q=' + encodeURIComponent(initialQuery)) : '');
    recordTabsContainer.appendChild(frame);

    allTabs[SEARCH_TAB_ID] = { kind: 'record', btn: btn, frame: frame, labelSpan: labelSpan };
    activateTab(SEARCH_TAB_ID);
  }

  // ---- Inline header search box (compact live-results dropdown) ----
  // A smaller, self-contained copy of salesforceTabSearch.js's own SOSL search (same object list/
  // escaping approach) rather than sharing code with it - consistent with this project's existing
  // convention of each page being self-contained (see e.g. the duplicated session-auth helpers
  // across salesforceTabHome.js/salesforceTabRecordFull.js/salesforceTabSearch.js). "See all
  // results"/Enter opens the full Search tab for a more thorough, grouped view.
  var HEADER_SEARCH_OBJECTS = [
    { objectApiName: 'Case', label: 'Cases', fields: ['Id', 'CaseNumber', 'Subject', 'Status'],
      title: function (r) { return r.CaseNumber; }, subtitle: function (r) { return r.Subject || r.Status || ''; } },
    { objectApiName: 'Account', label: 'Accounts', fields: ['Id', 'Name'],
      title: function (r) { return r.Name; }, subtitle: function () { return ''; } },
    { objectApiName: 'Contact', label: 'Contacts', fields: ['Id', 'Name', 'Email'],
      title: function (r) { return r.Name; }, subtitle: function (r) { return r.Email || ''; } }
  ];
  var HEADER_SEARCH_RESULTS_PER_OBJECT = 3;
  var HEADER_SEARCH_MIN_LENGTH = 2;
  var HEADER_SEARCH_DEBOUNCE_MS = 300;

  function escapeSoslForHeader(term) {
    return term.replace(/([?&|!{}\\[\\]()^~*:"'+-])/g, '\\\\$1');
  }

  function buildHeaderSoslQuery(term) {
    var returning = HEADER_SEARCH_OBJECTS.map(function (o) {
      return o.objectApiName + '(' + o.fields.join(', ') + ' LIMIT ' + HEADER_SEARCH_RESULTS_PER_OBJECT + ')';
    }).join(', ');
    return 'FIND {' + escapeSoslForHeader(term) + '*} IN ALL FIELDS RETURNING ' + returning;
  }

  var headerSearchPanel = null;
  function closeHeaderSearchPanel() {
    if (headerSearchPanel) { headerSearchPanel.remove(); headerSearchPanel = null; }
  }

  function renderHeaderSearchResults(term, groups) {
    closeHeaderSearchPanel();
    var panel = document.createElement('div');
    panel.className = 'nav-picker';
    panel.style.width = '300px';

    var list = document.createElement('div');
    list.className = 'nav-picker-list';
    list.style.maxHeight = '320px';
    var any = false;
    groups.forEach(function (group) {
      if (!group.rows.length) return;
      any = true;
      var cap = document.createElement('div');
      cap.className = 'nav-picker-caption';
      cap.textContent = group.config.label;
      list.appendChild(cap);
      group.rows.forEach(function (row) {
        var item = document.createElement('div');
        item.className = 'nav-picker-item';
        var navEntry = (navEntries || []).filter(function (e) { return e.objectApiName === group.config.objectApiName; })[0];
        item.appendChild(navIcon(navEntry || { label: group.config.label }));
        var label = document.createElement('span');
        label.className = 'nav-label';
        label.innerHTML = '<div class="header-search-result-title">' + escapeHtml(group.config.title(row)) + '</div>' +
          '<div class="header-search-result-subtitle">' + escapeHtml(group.config.subtitle(row)) + '</div>';
        item.appendChild(label);
        item.addEventListener('click', function () {
          closeHeaderSearchPanel();
          headerSearchInput.value = '';
          openRecordFor(group.config.objectApiName, row.Id, group.config.title(row));
        });
        list.appendChild(item);
      });
    });
    if (!any) list.innerHTML = '<div class="nav-picker-empty">No results.</div>';
    panel.appendChild(list);

    var sep = document.createElement('div');
    sep.className = 'nav-picker-sep';
    panel.appendChild(sep);
    var seeAll = document.createElement('div');
    seeAll.className = 'nav-picker-item nav-picker-add';
    seeAll.textContent = 'See all results for "' + term + '"…';
    seeAll.addEventListener('click', function () {
      closeHeaderSearchPanel();
      openSearchTab(term);
    });
    panel.appendChild(seeAll);

    headerSearchWrap.appendChild(panel);
    positionPanel(headerSearchWrap, panel);
    closeOnOutsideClick(headerSearchWrap, panel);
    headerSearchPanel = panel;
  }

  var headerSearchDebounceTimer = null;
  var headerSearchSeq = 0; // guards a slow, older response from overwriting a newer one
  function runHeaderSearch(term) {
    var mySeq = ++headerSearchSeq;
    sfGetWithRetry('/services/data/' + SF_API_VERSION + '/search/?q=' + encodeURIComponent(buildHeaderSoslQuery(term)))
      .then(function (data) {
        if (mySeq !== headerSearchSeq) return;
        var byObject = {};
        (data.searchRecords || []).forEach(function (r) {
          var type = r.attributes && r.attributes.type;
          if (!byObject[type]) byObject[type] = [];
          byObject[type].push(r);
        });
        var groups = HEADER_SEARCH_OBJECTS.map(function (config) {
          return { config: config, rows: byObject[config.objectApiName] || [] };
        });
        renderHeaderSearchResults(term, groups);
      })
      .catch(function (err) {
        if (mySeq !== headerSearchSeq) return;
        console.error('Header search failed:', err);
        closeHeaderSearchPanel();
      });
  }

  headerSearchInput.addEventListener('input', function () {
    var term = headerSearchInput.value.trim();
    if (headerSearchDebounceTimer) clearTimeout(headerSearchDebounceTimer);
    if (term.length < HEADER_SEARCH_MIN_LENGTH) { closeHeaderSearchPanel(); return; }
    headerSearchDebounceTimer = setTimeout(function () { runHeaderSearch(term); }, HEADER_SEARCH_DEBOUNCE_MS);
  });
  headerSearchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var term = headerSearchInput.value.trim();
      if (term.length >= HEADER_SEARCH_MIN_LENGTH) {
        closeHeaderSearchPanel();
        openSearchTab(term);
      }
    } else if (e.key === 'Escape') {
      closeHeaderSearchPanel();
    }
  });

  // ---- Object list-view tabs (Cases/Accounts/Contacts/... - read live, see loadAppNavObjectTabs) ----
  var objectTabsMeta = {}; // objectApiName -> { label, iconUrl, color } - label for status/heading text, iconUrl/color for the switcher pill
  var pinnedTabIds = {}; // objectApiName -> Teams_Pinned_Tab__c record id, for the unpin ("x") button
  var allAppsCache = null; // the /ui-api/apps result, cached for the "+" picker's cross-app nav scan

  function selectObjectTab(objectApiName, tabId) {
    activeObjectApiName = objectApiName;
    var meta = objectTabsMeta[objectApiName] || { label: objectApiName };
    listHeading.textContent = meta.label;
    renderNavSwitch(meta);
    // Normally activateTab() itself sets this (on for a list tab, off for a record/Search tab), but
    // the very first render calls selectObjectTab() directly rather than through activateTab() -
    // set it here too so the switcher shows its active underline immediately on load, not just after
    // the first real tab switch.
    navSwitchBtn.classList.add('active');

    if (listViewLoadedFor === objectApiName) {
      // Already showing this object's data (e.g. closing a record tab falls back here, or the
      // switcher just re-picked the object that's already open) - activateTab() only ever hides/
      // shows #listPane, it never clears its contents, so the table/picker/status are already
      // exactly right. Skip the refetch: reloading here used to also silently reset the list-view
      // picker back to the default view every time, discarding whatever view the person had picked.
      return;
    }
    loadListView(objectApiName, lastSelectedListView[objectApiName] || null);
  }

  // Updates the switcher tab's icon/label to the object actually being shown. Reuses navIcon() -
  // the exact same colored-icon-or-letter-tile element the dropdown menu's own rows use - so the
  // switcher's icon looks identical to that object's icon everywhere else in this page.
  function renderNavSwitch(meta) {
    navSwitchLabel.textContent = meta.label;
    var oldIcon = navSwitchBtn.querySelector('.nav-icon');
    var newIcon = navIcon(meta);
    if (oldIcon) navSwitchBtn.replaceChild(newIcon, oldIcon);
    else navSwitchBtn.insertBefore(newIcon, navSwitchBtn.firstChild);
  }

  // navObjectItems = entries read from the user's own Salesforce app nav (not removable - that's
  // Salesforce's own configuration, not this page's). pinnedItems = objects the person personally
  // added via the menu's "+ Add an object" item (removable - each carries the Teams_Pinned_Tab__c id
  // its own "x" deletes).
  //
  // The header shows ONE current-object switcher (a dropdown, styled as the same bordered tab as
  // opened records - see .tab); its menu (toggleNavMenu) lists all of these. Opened record/Search
  // tabs live inline in the same header (recordTabRow), untouched by re-renders.
  var navEntries = []; // ordered: { tabId, objectApiName, label, iconUrl, removable, pinId }
  var currentAppMeta = null; // { label, headerColor } of the user's default app, for the header

  function renderObjectTabs(navObjectItems, pinnedItems) {
    pinnedTabIds = {};
    navEntries = [];
    // Drop stale list entries (e.g. one just unpinned) so allTabs never points at a removed object.
    Object.keys(allTabs).forEach(function (id) { if (allTabs[id].kind === 'list') delete allTabs[id]; });

    function addEntry(item, removable) {
      objectTabsMeta[item.objectApiName] = { label: item.label, iconUrl: item.iconUrl || null, color: item.color || null };
      var tabId = 'obj:' + item.objectApiName;
      allTabs[tabId] = { kind: 'list', btn: null, objectApiName: item.objectApiName };
      if (removable) pinnedTabIds[item.objectApiName] = item.id;
      navEntries.push({ tabId: tabId, objectApiName: item.objectApiName, label: item.label, iconUrl: item.iconUrl || null, color: item.color || null, removable: removable, pinId: item.id });
    }
    navObjectItems.forEach(function (item) { addEntry(item, false); });
    pinnedItems.forEach(function (item) { addEntry(item, true); });

    renderAppHeader();
    // A pin/unpin re-render keeps whatever object is open; only the first render (or an object that
    // no longer exists) jumps to the first entry.
    var keepCurrent = activeObjectApiName && allTabs['obj:' + activeObjectApiName];
    if (keepCurrent) {
      renderNavSwitch(objectTabsMeta[activeObjectApiName] || { label: activeObjectApiName });
    } else if (navEntries.length) {
      selectObjectTab(navEntries[0].objectApiName, navEntries[0].tabId);
    }
  }

  function renderAppHeader() {
    appName.textContent = (currentAppMeta && currentAppMeta.label) || 'Salesforce';
    // Drives every active tab's underline+tint (see .tab.active) with the app's own real accent
    // color - falls back to Salesforce's own classic blue, matching the reference screenshot,
    // not a Teams-purple default.
    document.documentElement.style.setProperty('--tab-accent', (currentAppMeta && currentAppMeta.headerColor) || '#0176D3');
  }

  function buildUnpinX(item) {
    var closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '\\u00d7';
    closeBtn.setAttribute('aria-label', 'Unpin ' + item.label);
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      unpinTab(item.objectApiName, item.id);
    });
    return closeBtn;
  }

  function letterIcon(label) {
    var el = document.createElement('span');
    el.className = 'nav-icon nav-icon-letter';
    el.textContent = (label || '?').charAt(0).toUpperCase();
    return el;
  }
  // The standard Salesforce object icon when the app nav supplied one; a neutral letter tile
  // otherwise (pinned objects, or an icon that fails to load).
  function navIcon(entry) {
    if (!entry.iconUrl) return letterIcon(entry.label);
    var img = document.createElement('img');
    img.className = 'nav-icon';
    img.alt = '';
    // The icon file is a white glyph on transparent; Lightning supplies the coloured tile from the
    // nav item's own colour, so do the same or it renders white-on-white.
    if (entry.color) img.style.backgroundColor = '#' + entry.color;
    img.src = entry.iconUrl;
    img.onerror = function () { if (img.parentNode) img.parentNode.replaceChild(letterIcon(entry.label), img); };
    return img;
  }

  // Shared by the nav menu and the "+ Add an object" picker: keeps the panel on screen and closes
  // it on an outside click (but not a click inside the panel itself).
  function positionPanel(wrap, panel) {
    var r = wrap.getBoundingClientRect();
    if (r.left + 280 > window.innerWidth - 8) { panel.style.left = 'auto'; panel.style.right = '0'; }
  }
  function closeOnOutsideClick(wrap, panel) {
    setTimeout(function () {
      document.addEventListener('click', function onDocClick(e) {
        if (!wrap.contains(e.target)) {
          panel.remove();
          document.removeEventListener('click', onDocClick);
        }
      });
    }, 0);
  }

  // The navigation menu: every object in the user's default app, then their pinned objects, then
  // "+ Add an object". The current object is highlighted. Opened by clicking the switcher pill.
  function toggleNavMenu() {
    var existing = navSwitchWrap.querySelector('.nav-picker');
    if (existing) { existing.remove(); return; }
    document.querySelectorAll('.nav-picker').forEach(function (el) { el.remove(); });

    var panel = document.createElement('div');
    panel.className = 'nav-picker';
    panel.style.width = '280px';
    var search = null;
    if (navEntries.length > 8) {
      search = document.createElement('input');
      search.type = 'text';
      search.className = 'nav-picker-search';
      search.placeholder = 'Find an item\\u2026';
      panel.appendChild(search);
    }
    var list = document.createElement('div');
    list.className = 'nav-picker-list';
    list.style.maxHeight = '340px';
    panel.appendChild(list);

    function row(entry) {
      var item = document.createElement('div');
      item.className = 'nav-picker-item' + (entry.objectApiName === activeObjectApiName ? ' active' : '');
      item.appendChild(navIcon(entry));
      var label = document.createElement('span');
      label.className = 'nav-label';
      label.textContent = entry.label;
      item.appendChild(label);
      if (entry.removable) item.appendChild(buildUnpinX({ objectApiName: entry.objectApiName, id: entry.pinId, label: entry.label }));
      item.addEventListener('click', function () {
        panel.remove();
        activateTab(entry.tabId);
      });
      return item;
    }

    function renderList(filter) {
      var lower = (filter || '').trim().toLowerCase();
      list.innerHTML = '';
      var match = function (e) { return !lower || e.label.toLowerCase().indexOf(lower) !== -1; };
      var fromApp = navEntries.filter(function (e) { return !e.removable && match(e); });
      var pinned = navEntries.filter(function (e) { return e.removable && match(e); });
      fromApp.forEach(function (e) { list.appendChild(row(e)); });
      if (pinned.length) {
        var cap = document.createElement('div');
        cap.className = 'nav-picker-caption';
        cap.textContent = 'Pinned by you';
        list.appendChild(cap);
        pinned.forEach(function (e) { list.appendChild(row(e)); });
      }
      if (!fromApp.length && !pinned.length) list.innerHTML = '<div class="nav-picker-empty">No matching items.</div>';
      var sep = document.createElement('div');
      sep.className = 'nav-picker-sep';
      list.appendChild(sep);
      var add = document.createElement('div');
      add.className = 'nav-picker-item nav-picker-add';
      add.textContent = '+ Add an object\\u2026';
      add.addEventListener('click', function () {
        panel.remove();
        togglePinPicker(navSwitchWrap);
      });
      list.appendChild(add);
    }
    renderList('');
    if (search) search.addEventListener('input', function () { renderList(search.value); });

    navSwitchWrap.appendChild(panel);
    positionPanel(navSwitchWrap, panel);
    if (search) search.focus();
    closeOnOutsideClick(navSwitchWrap, panel);
  }
  // The chevron always opens the switcher menu (the one explicit "change object" control, reachable
  // even while a record/Search tab is showing - so switching straight to a different object from a
  // record page still works). Clicking the rest of the tab (icon/label/padding) while a record/
  // Search tab is the one currently open goes straight back to that object's already-loaded list
  // instead - opening the menu there just to re-pick the object you're already on was exactly the
  // reported friction. When the list is already what's showing, there's nothing to "go back" to, so
  // it falls back to opening the menu too, same as the chevron.
  navSwitchBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    var clickedChevron = !!(e.target.closest && e.target.closest('.tab-chevron'));
    var listShowing = listPane.style.display !== 'none';
    if (!clickedChevron && !listShowing && activeObjectApiName) {
      activateTab('obj:' + activeObjectApiName);
      return;
    }
    toggleNavMenu();
  });

  function unpinTab(objectApiName, pinId) {
    deletePinnedTab(pinId).then(function () {
      return refreshObjectTabs();
    }).catch(function (err) {
      console.error('Could not unpin tab:', err);
    });
  }

  // Re-reads app-nav + pinned tabs and re-renders - used after a pin/unpin, so the tab row and the
  // "+" picker's candidate list (which excludes already-shown objects) both stay in sync.
  function refreshObjectTabs() {
    return Promise.all([fetchAppNavItems(), fetchPinnedTabs()]).then(function (results) {
      renderObjectTabs(results[0], results[1]);
    });
  }

  // Reads the signed-in user's own current Salesforce app (whichever one UI API flags "selected")
  // and turns its real navItems into object-tab entries - see header comment for why this, not a
  // hardcoded object list, is what makes "add another object tab" a pure Salesforce config change
  // instead of a code change. Also caches the full /ui-api/apps result for the "+" picker below.
  function fetchAppNavItems() {
    return sfGetWithRetry('/services/data/' + SF_API_VERSION + '/ui-api/apps?formFactor=Large')
      .then(function (result) {
        allAppsCache = result.apps || [];
        var selectedApp = allAppsCache.filter(function (a) { return a.selected; })[0] || allAppsCache[0];
        if (!selectedApp) throw new Error('No Salesforce app available for this user.');
        currentAppMeta = { label: selectedApp.label, headerColor: selectedApp.headerColor };
        return sfGetWithRetry('/services/data/' + SF_API_VERSION + '/ui-api/apps/' +
          encodeURIComponent(selectedApp.appId) + '?formFactor=Large');
      })
      .then(function (appDetail) {
        var navObjectItems = (appDetail.navItems || [])
          .filter(function (item) { return item.itemType === 'Entity' && item.objectApiName; })
          .map(function (item) { return { objectApiName: item.objectApiName, label: item.label, iconUrl: item.iconUrl, color: item.color }; });
        if (!navObjectItems.length) throw new Error('This Salesforce app has no object tabs.');
        return navObjectItems;
      })
      .catch(function (err) {
        // A real sign-in requirement is NOT a "fall back to Cases" situation - propagate it so
        // loadAppNavObjectTabs() can show a Sign in button and retry the WHOLE nav load afterward,
        // rather than getting stuck on a Cases-only placeholder even once a session exists.
        if (err.needsInteractiveSignIn) throw err;
        console.error('Could not load Salesforce app nav tabs, falling back to Cases only:', err);
        return [{ objectApiName: 'Case', label: 'Cases' }];
      });
  }

  function loadAppNavObjectTabs() {
    return Promise.all([fetchAppNavItems(), fetchPinnedTabs()])
      .then(function (results) {
        renderObjectTabs(results[0], results[1]);
      })
      .catch(function (err) {
        if (!err.needsInteractiveSignIn) throw err;
        statusEl.style.display = 'block';
        promptInteractiveSignIn(statusEl, 'Sign-in is needed to load your Salesforce data.', loadAppNavObjectTabs);
      });
  }

  // ---- "+" picker: pin any object from the navigation of apps this user is actually assigned to
  // (never every object in the org - see Teams_Pinned_Tab__c's own description for why) ----
  var navPickerCandidatesPromise = null; // lazy-loaded once per page session, on first "+" click

  // Scans every app /ui-api/apps returned for this user (already scoped by Salesforce itself to
  // apps this person can actually launch) and collects the union of their real object nav items -
  // "what this user actually has access to and sees under Navigation", not a global object list.
  function loadNavPickerCandidates() {
    if (navPickerCandidatesPromise) return navPickerCandidatesPromise;
    var appsPromise = allAppsCache ? Promise.resolve(allAppsCache)
      : sfGetWithRetry('/services/data/' + SF_API_VERSION + '/ui-api/apps?formFactor=Large').then(function (r) { return r.apps || []; });

    navPickerCandidatesPromise = appsPromise.then(function (apps) {
      return Promise.all(apps.map(function (a) {
        return sfGetWithRetry('/services/data/' + SF_API_VERSION + '/ui-api/apps/' + encodeURIComponent(a.appId) + '?formFactor=Large')
          .then(function (detail) { return detail.navItems || []; })
          .catch(function () { return []; }); // one broken/inaccessible app shouldn't block the rest
      }));
    }).then(function (navItemLists) {
      var seen = {};
      var candidates = [];
      navItemLists.forEach(function (items) {
        items.forEach(function (item) {
          if (item.itemType !== 'Entity' || !item.objectApiName || seen[item.objectApiName]) return;
          seen[item.objectApiName] = true;
          candidates.push({ objectApiName: item.objectApiName, label: item.label });
        });
      });
      candidates.sort(function (a, b) { return a.label.localeCompare(b.label); });
      return candidates;
    }).catch(function (err) {
      console.error('Could not load navigation picker candidates:', err);
      return [];
    });
    return navPickerCandidatesPromise;
  }

  function togglePinPicker(wrap) {
    var existing = wrap.querySelector('.nav-picker');
    if (existing) { existing.remove(); return; }
    // Only one picker open at a time.
    document.querySelectorAll('.nav-picker').forEach(function (el) { el.remove(); });

    var panel = document.createElement('div');
    panel.className = 'nav-picker';
    var search = document.createElement('input');
    search.type = 'text';
    search.className = 'nav-picker-search';
    search.placeholder = 'Search your Salesforce apps\\u2026';
    var list = document.createElement('div');
    list.className = 'nav-picker-list';
    list.innerHTML = '<div class="nav-picker-empty">Loading\\u2026</div>';
    panel.appendChild(search);
    panel.appendChild(list);
    wrap.appendChild(panel);
    positionPanel(wrap, panel);
    search.focus();

    var shownApiNames = {}; // exclude objects already on the tab row (app-nav or already pinned)
    Object.keys(allTabs).forEach(function (tabId) {
      if (allTabs[tabId].kind === 'list') shownApiNames[allTabs[tabId].objectApiName] = true;
    });

    function renderList(candidates, filter) {
      var lower = (filter || '').trim().toLowerCase();
      var matches = candidates.filter(function (c) {
        return !shownApiNames[c.objectApiName] && (!lower || c.label.toLowerCase().indexOf(lower) !== -1);
      });
      if (!matches.length) {
        list.innerHTML = '<div class="nav-picker-empty">No matching objects to pin.</div>';
        return;
      }
      list.innerHTML = '';
      matches.forEach(function (c) {
        var item = document.createElement('div');
        item.className = 'nav-picker-item';
        item.textContent = c.label;
        item.addEventListener('click', function () {
          panel.remove();
          pinTab(c.objectApiName, c.label);
        });
        list.appendChild(item);
      });
    }

    loadNavPickerCandidates().then(function (candidates) {
      renderList(candidates, search.value);
      search.addEventListener('input', function () { renderList(candidates, search.value); });
    });

    closeOnOutsideClick(wrap, panel);
  }

  function pinTab(objectApiName, label) {
    var nextSortOrder = Object.keys(pinnedTabIds).length + 1;
    createPinnedTab(objectApiName, label, nextSortOrder).then(function () {
      return refreshObjectTabs();
    }).catch(function (err) {
      console.error('Could not pin tab:', err);
    });
  }

  // Presentational only - decides pill styling for a value, columns themselves aren't hardcoded.
  function pillColor(value) {
    if (value === 'Closed') return { bg: '#DFF6DD', fg: '#0E700F' };
    if (value === 'New') return { bg: '#EFF6FC', fg: '#0F6CBD' };
    if (value === 'High') return { bg: '#FDE7E9', fg: '#C4314B' };
    if (value === 'Low') return { bg: '#F0F0F0', fg: '#616161' };
    return { bg: '#FFF4CE', fg: '#8A6D00' };
  }
  var PILL_COLUMNS = { Status: true, Priority: true };

  function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function ownerColumnName() {
    var col = allColumns.filter(function (c) { return /Owner/.test(c.apiName); })[0];
    return col ? col.apiName : null;
  }

  // Case has a real record detail page (recordPageUrl/openRecordTab); every other object doesn't
  // have one built yet (see header comment), so a row click there opens the record directly in
  // Salesforce instead of a broken custom page - a real fallback, not a placeholder no-op.
  function openRecordFor(objectApiName, id, label) {
    if (objectApiName === 'Case') {
      openRecordTab(id, label || null, objectApiName);
      return;
    }
    var url = (currentSessionInstanceUrl() || '') + '/' + id;
    if (window.microsoftTeams) {
      microsoftTeams.app.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  }
  function currentSessionInstanceUrl() {
    var session = loadSfSession();
    return session ? session.instanceUrl : null;
  }

  function render() {
    headerRow.innerHTML = '';
    bodyRows.innerHTML = '';

    allColumns.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.label;
      headerRow.appendChild(th);
    });
    headerRow.appendChild(document.createElement('th')); // trailing owner-avatar column, no header text

    var ownerCol = ownerColumnName();
    var objectApiName = activeObjectApiName;
    allRows.forEach(function (row) {
      var tr = document.createElement('tr');
      allColumns.forEach(function (col, colIndex) {
        var td = document.createElement('td');
        var value = row[col.apiName];
        if (PILL_COLUMNS[col.apiName] && value) {
          var p = pillColor(value);
          td.innerHTML = '<span class="pill" style="background:' + p.bg + ';color:' + p.fg + ';">' + escapeHtml(value) + '</span>';
        } else if (colIndex === 0 && row.__id) {
          var link = document.createElement('a');
          link.href = objectApiName === 'Case' ? recordPageUrl(row.__id) : ((currentSessionInstanceUrl() || '') + '/' + row.__id);
          link.style.fontWeight = '700';
          link.textContent = value == null ? '' : String(value);
          link.addEventListener('click', function (e) {
            // Ctrl/Cmd/middle-click still opens a real new browser tab, same as any link.
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;
            e.preventDefault();
            openRecordFor(objectApiName, row.__id, value == null ? '' : String(value));
          });
          td.appendChild(link);
        } else {
          td.textContent = value == null ? '' : String(value);
        }
        tr.appendChild(td);
      });
      var avatarTd = document.createElement('td');
      avatarTd.innerHTML = '<span class="avatar-sm">' + escapeHtml(initials(ownerCol ? row[ownerCol] : null)) + '</span>';
      tr.appendChild(avatarTd);
      bodyRows.appendChild(tr);
    });

    var objectLabel = (objectTabsMeta[objectApiName] && objectTabsMeta[objectApiName].label) || objectApiName;
    countLine.textContent = allRows.length + ' ' + objectLabel.toLowerCase() + ' shown';
  }

  function populatePicker(availableListViews, selected) {
    listViewPicker.innerHTML = '';
    (availableListViews || []).forEach(function (lv) {
      var option = document.createElement('option');
      option.value = lv.apiName;
      option.textContent = lv.label;
      if (lv.apiName === selected) option.selected = true;
      listViewPicker.appendChild(option);
    });
  }

  // Walks a dotted UI API field path (e.g. "Contact.Name") through a record's nested fields.
  function resolveDisplayValue(record, dottedApiName) {
    var parts = dottedApiName.split('.');
    var node = record;
    for (var i = 0; i < parts.length; i++) {
      if (!node || !node.fields || !node.fields[parts[i]]) return null;
      var field = node.fields[parts[i]];
      if (i === parts.length - 1) {
        return field.displayValue != null ? field.displayValue : field.value;
      }
      node = field.value; // descend into the related record for the next path segment
    }
    return null;
  }

  function queryAvailableListViews(objectApiName) {
    var safeObject = objectApiName.replace(/[^A-Za-z0-9_]/g, '');
    var soql = "SELECT DeveloperName, Name FROM ListView WHERE SobjectType = '" + safeObject + "' ORDER BY Name";
    return sfGetWithRetry('/services/data/' + SF_API_VERSION + '/query?q=' + encodeURIComponent(soql))
      .then(function (result) {
        return (result.records || []).map(function (r) { return { apiName: r.DeveloperName, label: r.Name }; });
      })
      .catch(function () { return []; }); // best-effort - the page still works with just the default list view
  }

  function showStatusWithRetry(message, objectApiName, listViewApiName, isError) {
    statusEl.className = 'status' + (isError ? ' error' : ''); // shared with salesforceTabRecordFull.js's .status/.status.error
    statusEl.textContent = '';
    statusEl.appendChild(document.createTextNode(message + ' '));
    var retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = 'Retry';
    retryBtn.className = 'btn-secondary'; // shared with salesforceTabRecordFull.js, not a one-off style
    retryBtn.addEventListener('click', function () { loadListView(objectApiName, listViewApiName); });
    statusEl.appendChild(retryBtn);
  }

  // objectApiName drives which object's list is shown (Case/Account/Contact/... - see
  // loadAppNavObjectTabs()); listViewApiName is that object's selected list view, or null to use
  // this object's default (Case's own "My Cases" list view for Case, else the universal "Recent"
  // list view every object has out of the box).
  function loadListView(objectApiName, listViewApiName) {
    var objectLabel = ((objectTabsMeta[objectApiName] && objectTabsMeta[objectApiName].label) || objectApiName).toLowerCase();
    statusEl.className = 'status'; // clear any error state left over from a previous failed attempt
    statusEl.style.display = 'block';
    statusEl.textContent = 'Loading ' + objectLabel + '\\u2026';
    casesCard.style.display = 'none';
    listViewLoadedFor = null; // this object's data is about to be replaced - not "loaded" again until it succeeds below

    var selected = listViewApiName || (objectApiName === 'Case' ? 'MyCases' : 'Recent');
    lastSelectedListView[objectApiName] = selected; // remembered even on failure, so Retry/next visit keeps the same choice
    var listViewPath = objectApiName + '/' + encodeURIComponent(selected);

    // Fallback for a rare stuck "Loading..." after the login popup closes (browser throttling / a
    // concurrent-login race, seen mainly in private windows) - surfaces an actionable Retry button
    // rather than leaving the person to guess that a reload might help.
    var settled = false;
    var slowTimer = setTimeout(function () {
      if (!settled) {
        showStatusWithRetry('This is taking longer than expected.', objectApiName, listViewApiName, false);
      }
    }, 20000);

    return Promise.all([
      sfGetWithRetry('/services/data/' + SF_API_VERSION + '/ui-api/list-info/' + listViewPath),
      sfGetWithRetry('/services/data/' + SF_API_VERSION + '/ui-api/list-records/' + listViewPath + '?pageSize=50'),
      queryAvailableListViews(objectApiName)
    ])
      .then(function (results) {
        settled = true;
        clearTimeout(slowTimer);
        if (objectApiName !== activeObjectApiName) return; // a different tab was clicked before this resolved - discard
        listViewLoadedFor = objectApiName; // this object's data is now what's actually in allRows/#bodyRows
        var listInfo = results[0];
        var listRecords = results[1];
        var availableListViews = results[2];

        allColumns = listInfo.displayColumns.map(function (c) { return { apiName: c.fieldApiName, label: c.label }; });
        var rawRecords = listRecords.records || [];
        allRows = rawRecords.map(function (rec) {
          var row = { __id: rec.fields.Id ? rec.fields.Id.value : null };
          allColumns.forEach(function (col) { row[col.apiName] = resolveDisplayValue(rec, col.apiName); });
          return row;
        });
        populatePicker(availableListViews, selected);

        if (!allRows.length) {
          statusEl.textContent = 'No records found.';
          return;
        }

        render();
        statusEl.style.display = 'none';
        casesCard.style.display = 'block';
      })
      .catch(function (err) {
        settled = true;
        clearTimeout(slowTimer);
        if (objectApiName !== activeObjectApiName) return;
        console.error('Failed to load ' + objectApiName + ' list:', err);
        if (err.needsInteractiveSignIn) {
          promptInteractiveSignIn(statusEl, 'Sign-in is needed to load ' + objectLabel + '.', function () {
            loadListView(objectApiName, listViewApiName);
          });
        } else {
          showStatusWithRetry('Could not load ' + objectLabel + ' right now.', objectApiName, listViewApiName, true);
        }
      });
  }

  listViewPicker.addEventListener('change', function () {
    loadListView(activeObjectApiName, listViewPicker.value);
  });

  // Object tabs (and the first one's list) always load first, deep link or not, so the tab row
  // behind a deep-linked record is never empty - a Case deep link then opens ON TOP of that as an
  // additional tab, exactly as it did back when "Cases" was the one fixed tab.
  if (window.microsoftTeams) {
    microsoftTeams.app.initialize().then(function () {
      microsoftTeams.app.notifySuccess();
      return microsoftTeams.app.getContext();
    }).then(function (context) {
      var subPageId = context && context.page && context.page.subPageId;
      return loadAppNavObjectTabs().then(function () {
        // Deep links are Case-only (see header comment) - label is a placeholder, the record
        // iframe shows the real one once loaded.
        if (subPageId) openRecordTab(subPageId, null, 'Case'); // only a bare id from a deep link - postMessage fills in the real title
      });
    }).catch(function (err) {
      console.error('Could not read Teams context, falling back to the object tabs:', err);
      loadAppNavObjectTabs();
    });
  } else {
    loadAppNavObjectTabs(); // not running inside Teams (e.g. local testing) - always show the tabs
  }
})();
</script>
</body>
</html>`;

app.http('salesforceTabHome', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'salesforceTabHome',
    handler: async () => {
        return {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: PAGE_HTML
        };
    }
});
