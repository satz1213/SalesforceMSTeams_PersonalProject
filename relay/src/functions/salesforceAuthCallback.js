/**
 * Popup redirect target for the per-user Salesforce OAuth login (Authorization Code + PKCE).
 * salesforceTabHome.js opens Salesforce's login page in a real popup (iframes get blocked by
 * clickjacking headers); this page is that popup's callback URL.
 *
 * The code-for-token exchange happens HERE, not back in salesforceTabHome.js, even though that
 * means duplicating its SF_LOGIN_DOMAIN/SF_CLIENT_ID/etc. constants (copied, not shared, per this
 * project's convention). Reported live: after the popup closes, the opener tab would sometimes
 * come back with "Could not load cases right now," fixed only by a manual reload - consistent
 * with the already-suspected cause (browsers throttle a backgrounded tab's JS while a popup has
 * focus), just landing as a real failure instead of only sluggishness. The popup itself has
 * foreground focus the whole time, so it exchanges the code and saves the session to localStorage
 * (same-origin, shared with the opener) directly, then only signals success/failure - the opener
 * tab, on resuming, just re-reads the already-saved session instead of doing its own network call
 * at the exact moment it's most likely to still be throttled.
 */
const { app } = require('@azure/functions');

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Signing in</title>
<style>
  html, body { height: 100%; margin: 0; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
  body { display: flex; align-items: center; justify-content: center; color: #616161; font-size: 14px; text-align: center; padding: 0 20px; box-sizing: border-box; }
</style>
</head>
<body>
<div id="status">Signing in&hellip;</div>

<script src="https://res.cdn.office.net/teams-js/2.19.0/js/MicrosoftTeams.min.js" crossorigin="anonymous"></script>
<script>
(function () {
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  var error = params.get('error');
  var errorDescription = params.get('error_description');
  var statusEl = document.getElementById('status');

  // Copied from salesforceTabHome.js, not shared/imported - must match exactly for the token
  // exchange to work and for SF_SESSION_KEY to land where the opener tab looks for it.
  var SF_LOGIN_DOMAIN = 'https://mylightningapp-dev-dev-ed.my.salesforce.com';
  var SF_CLIENT_ID = '3MVG9G9pzCUSkzZsud2BdW9TWBEoplncNXHW02MLEybqDY0coXFBNmBujduJ2Du59lbZXigmCVI4V91wkBg0q';
  var SF_REDIRECT_URI = 'https://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net/api/salesforceAuthCallback';
  var SF_SESSION_KEY = 'sfUserSession';
  var SF_PKCE_VERIFIER_KEY = 'sfPkceVerifier';

  function exchangeCodeForToken(authCode, verifier) {
    var body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', authCode);
    body.set('client_id', SF_CLIENT_ID);
    body.set('redirect_uri', SF_REDIRECT_URI);
    body.set('code_verifier', verifier);
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

  if (!window.microsoftTeams) {
    // Opened outside Teams - nothing to hand back to.
    statusEl.textContent = error ? ('Sign-in failed: ' + (errorDescription || error)) : 'Signed in - you can close this window.';
    return;
  }

  microsoftTeams.app.initialize().then(function () {
    if (error) {
      microsoftTeams.authentication.notifyFailure(errorDescription || error);
      return;
    }
    if (!code) {
      microsoftTeams.authentication.notifyFailure('No authorization code was returned.');
      return;
    }
    var verifier;
    try { verifier = localStorage.getItem(SF_PKCE_VERIFIER_KEY); } catch (e) {}
    if (!verifier) {
      microsoftTeams.authentication.notifyFailure('Missing PKCE verifier - sign-in must be retried from the tab.');
      return;
    }
    exchangeCodeForToken(code, verifier).then(function (tokenResponse) {
      var session = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        instanceUrl: tokenResponse.instance_url
      };
      // Also try localStorage - harmless, and still helps in contexts where the popup and the
      // opener genuinely share storage (e.g. the Teams desktop client). But it is NOT relied on:
      // in a browser with third-party/storage partitioning active (Chrome enables this by default
      // in Incognito, ahead of general rollout), this popup's storage is a real top-level
      // navigation to this origin, while the opener tab is this same origin loaded inside an
      // iframe under teams.microsoft.com - two different partitions under that scheme, so the
      // opener can save nothing here to read back. The authoritative handoff is the session
      // itself, passed straight through notifySuccess()'s result string, which travels over
      // Teams' own postMessage-based bridge rather than through any browser storage API.
      try {
        localStorage.setItem(SF_SESSION_KEY, JSON.stringify(session));
        localStorage.removeItem(SF_PKCE_VERIFIER_KEY);
      } catch (e) {}
      microsoftTeams.authentication.notifySuccess(JSON.stringify(session));
    }).catch(function (err) {
      microsoftTeams.authentication.notifyFailure(err.message || 'Token exchange failed.');
    });
  }).catch(function () {
    statusEl.textContent = 'Sign-in could not complete. Please close this window and try again.';
  });
})();
</script>
</body>
</html>`;

app.http('salesforceAuthCallback', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'salesforceAuthCallback',
    handler: async () => {
        return {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: PAGE_HTML
        };
    }
});
