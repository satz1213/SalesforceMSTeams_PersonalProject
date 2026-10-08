/**
 * Serves the "Search" tab embedded inside salesforceTabHome.js (same iframe-tab-strip mechanism
 * salesforceTabRecordFull.js already uses for opened Case records - see openRecordTab() there).
 * Not a standalone Teams static tab: like salesforceTabRecordFull.js, it relies on the session
 * salesforceTabHome.js's own PKCE popup login already put in localStorage rather than running its
 * own login flow - if that's missing, it just says so instead of duplicating ~250 lines of PKCE/
 * popup code a third time.
 *
 * SOSL, one query across a fixed, hand-picked set of objects (Case/Account/Contact/Opportunity/
 * Lead) with reasonable display fields per object - not the user's live nav like
 * salesforceTabHome.js's object tabs are. Making this fully metadata-driven (walk the user's own
 * nav, describe() each object for its real name field) is a real future improvement, not built now
 * - same "good enough first pass, revisit if it matters" call this project already made for
 * TeamsSwarmController.searchUsers()'s plain substring search.
 *
 * A result click never renders a record page itself - it postMessages the parent (salesforceTabHome.js,
 * same origin) to open/activate that record's existing tab via openRecordTab(), for anything
 * salesforceTabRecordFull.js supports (Case today); everything else opens directly in Salesforce in
 * a new tab, same fallback salesforceTabHome.js's own row click already uses for non-Case objects.
 */
const { app } = require('@azure/functions');

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Search</title>
<style>
  html, body {
    height: 100%;
    margin: 0;
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    color: #242424;
    background: #F5F5F5;
  }
  a { color: #5B5FC7; text-decoration: none; }
  a:hover { color: #464775; text-decoration: underline; }
  .card { background: #FFFFFF; border: 1px solid #E1E1E1; border-radius: 8px; }
  /* Shared with salesforceTabHome.js/salesforceTabRecordFull.js - same values verbatim. */
  .btn-primary { background: #5B5FC7; color: #fff; border: none; border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(91,95,199,0.35); transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease; }
  .btn-primary:hover { background: #464775; box-shadow: 0 3px 8px rgba(70,71,117,0.35); }
  .btn-primary:active { transform: translateY(1px); box-shadow: 0 1px 2px rgba(70,71,117,0.3); }
  .btn-primary:disabled { background: #E1E1E1; color: #A19F9D; border-color: #E1E1E1; box-shadow: none; cursor: default; transform: none; }
  .status { font-size: 0.8rem; color: #8A8A8A; min-height: 1em; }
  .status.error { color: #C0392B; }
  .pill { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #F0F0F0; color: #616161; }

  .search-wrap { max-width: 720px; margin: 0 auto; padding: 20px 24px; box-sizing: border-box; }
  .search-box { display: flex; gap: 8px; margin-bottom: 16px; }
  .search-input { flex: 1; font-size: 15px; padding: 9px 14px; border: 1px solid #D1D1D1; border-radius: 6px; color: #242424; }
  .search-input:focus { outline: none; border-color: #5B5FC7; box-shadow: 0 0 0 2px rgba(91,95,199,0.15); }

  .result-group { margin-bottom: 16px; }
  .result-group-heading { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #A19F9D; font-weight: 700; padding: 0 4px 6px; }
  .result-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #F0F0F0; cursor: pointer; background: none; border-left: none; border-right: none; border-top: none; width: 100%; text-align: left; font-family: inherit; }
  .result-row:last-child { border-bottom: none; }
  .result-row:hover { background: #FAFAFA; }
  .result-icon { width: 28px; height: 28px; border-radius: 6px; flex: none; display: inline-flex; align-items: center; justify-content: center; background: #8A8886; color: #fff; font-size: 12px; font-weight: 700; }
  .result-title { font-size: 13.5px; font-weight: 600; color: #242424; }
  .result-subtitle { font-size: 12px; color: #616161; margin-top: 1px; }

  .search-empty { text-align: center; color: #A19F9D; font-size: 13px; padding: 40px 0; }
</style>
</head>
<body>
<div class="search-wrap">
  <div class="search-box">
    <input type="text" id="searchInput" class="search-input" placeholder="Search Cases, Accounts, Contacts, Opportunities, Leads&hellip;" autocomplete="off" />
  </div>
  <div class="status" id="status"></div>
  <div id="results"></div>
</div>

<script src="https://res.cdn.office.net/teams-js/2.19.0/js/MicrosoftTeams.min.js" crossorigin="anonymous"></script>

<script>
(function () {
  var searchInput = document.getElementById('searchInput');
  var statusEl = document.getElementById('status');
  var resultsEl = document.getElementById('results');

  if (window.microsoftTeams) {
    microsoftTeams.app.initialize().then(function () { microsoftTeams.app.notifySuccess(); }).catch(function () {});
  }

  // ---------------- Session (must match salesforceTabHome.js/salesforceTabRecordFull.js exactly - same storage) ----------------
  var SF_LOGIN_DOMAIN = 'https://mylightningapp-dev-dev-ed.my.salesforce.com';
  var SF_CLIENT_ID = '3MVG9G9pzCUSkzZsud2BdW9TWBEoplncNXHW02MLEybqDY0coXFBNmBujduJ2Du59lbZXigmCVI4V91wkBg0q';
  var SF_API_VERSION = 'v61.0';
  var SF_SESSION_KEY = 'sfUserSession';

  function loadSfSession() {
    try {
      var raw = localStorage.getItem(SF_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveSfSession(session) {
    try { localStorage.setItem(SF_SESSION_KEY, JSON.stringify(session)); } catch (e) {}
  }

  function sfCall(session, method, path) {
    return fetch(session.instanceUrl + path, {
      method: method,
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
        if (!res.ok) throw new Error((data && data.error_description) || 'Salesforce token refresh failed.');
        return data;
      });
    });
  }

  function sfCallWithRetry(method, path) {
    var session = loadSfSession();
    if (!session || !session.accessToken) {
      var noSession = new Error('No Salesforce session found.');
      noSession.isNoSession = true;
      return Promise.reject(noSession);
    }
    return sfCall(session, method, path).catch(function (err) {
      if (!err.isAuthError || !session.refreshToken) throw err;
      return refreshAccessToken(session.refreshToken).then(function (tokenResponse) {
        var refreshed = {
          accessToken: tokenResponse.access_token,
          refreshToken: session.refreshToken,
          instanceUrl: tokenResponse.instance_url || session.instanceUrl
        };
        saveSfSession(refreshed);
        return sfCall(refreshed, method, path);
      });
    });
  }

  // ---------------- SOSL search across a fixed set of objects (see file header comment) ----------------
  // RETURNING field lists are display fields only - never used for anything but rendering a row.
  var SEARCH_OBJECTS = [
    { objectApiName: 'Case', label: 'Cases', color: '#0176D3', fields: ['Id', 'CaseNumber', 'Subject', 'Status'],
      title: function (r) { return r.CaseNumber; }, subtitle: function (r) { return r.Subject || r.Status || ''; } },
    { objectApiName: 'Account', label: 'Accounts', color: '#9602C7', fields: ['Id', 'Name'],
      title: function (r) { return r.Name; }, subtitle: function () { return ''; } },
    { objectApiName: 'Contact', label: 'Contacts', color: '#048A75', fields: ['Id', 'Name', 'Email'],
      title: function (r) { return r.Name; }, subtitle: function (r) { return r.Email || ''; } },
    { objectApiName: 'Opportunity', label: 'Opportunities', color: '#38A35A', fields: ['Id', 'Name', 'StageName'],
      title: function (r) { return r.Name; }, subtitle: function (r) { return r.StageName || ''; } },
    { objectApiName: 'Lead', label: 'Leads', color: '#DD7A01', fields: ['Id', 'Name', 'Company'],
      title: function (r) { return r.Name; }, subtitle: function (r) { return r.Company || ''; } }
  ];
  var RESULTS_PER_OBJECT = 8;
  var MIN_TERM_LENGTH = 2;
  var DEBOUNCE_MS = 350;

  // Escapes SOSL's reserved characters in a FIND{} term - without this, a term containing e.g. "?"
  // or "(" is a malformed query, not just a query with no results.
  function escapeSosl(term) {
    return term.replace(/([?&|!{}\\[\\]()^~*:"'+-])/g, '\\\\$1');
  }

  function buildSoslQuery(term) {
    var returning = SEARCH_OBJECTS.map(function (o) {
      return o.objectApiName + '(' + o.fields.join(', ') + ' LIMIT ' + RESULTS_PER_OBJECT + ')';
    }).join(', ');
    return 'FIND {' + escapeSosl(term) + '*} IN ALL FIELDS RETURNING ' + returning;
  }

  function letterIcon(label) {
    return (label || '?').trim().charAt(0).toUpperCase();
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function recordUrlFor(objectApiName, id) {
    var session = loadSfSession();
    var base = session ? session.instanceUrl : SF_LOGIN_DOMAIN;
    return base + '/lightning/r/' + encodeURIComponent(objectApiName) + '/' + encodeURIComponent(id) + '/view';
  }

  // Case opens as a tab in the parent (salesforceTabHome.js) via the same postMessage channel it
  // already listens on for salesforceRecordTitle/salesforceRecordFieldsChanged - everything else
  // doesn't have a dedicated page built yet, so it opens directly in Salesforce, same fallback
  // salesforceTabHome.js's own row click already uses for non-Case objects.
  function openResult(objectApiName, id, label) {
    if (objectApiName === 'Case') {
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: 'salesforceOpenRecord', recordId: id, label: label, objectApiName: objectApiName }, window.location.origin);
          return;
        }
      } catch (e) {}
    }
    var url = recordUrlFor(objectApiName, id);
    if (window.microsoftTeams) {
      microsoftTeams.app.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  }

  function renderResults(groups) {
    resultsEl.innerHTML = '';
    var anyResults = groups.some(function (g) { return g.rows.length > 0; });
    if (!anyResults) {
      resultsEl.innerHTML = '<div class="search-empty">No results.</div>';
      return;
    }
    groups.forEach(function (group) {
      if (!group.rows.length) return;
      var wrap = document.createElement('div');
      wrap.className = 'result-group';

      var heading = document.createElement('div');
      heading.className = 'result-group-heading';
      heading.textContent = group.config.label;
      wrap.appendChild(heading);

      var card = document.createElement('div');
      card.className = 'card';
      group.rows.forEach(function (row) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'result-row';

        var icon = document.createElement('span');
        icon.className = 'result-icon';
        icon.style.background = group.config.color;
        icon.textContent = letterIcon(group.config.label);
        btn.appendChild(icon);

        var text = document.createElement('div');
        text.innerHTML =
          '<div class="result-title">' + escapeHtml(group.config.title(row)) + '</div>' +
          '<div class="result-subtitle">' + escapeHtml(group.config.subtitle(row)) + '</div>';
        btn.appendChild(text);

        btn.addEventListener('click', function () {
          openResult(group.config.objectApiName, row.Id, group.config.title(row));
        });
        card.appendChild(btn);
      });
      wrap.appendChild(card);
      resultsEl.appendChild(wrap);
    });
  }

  var searchSeq = 0; // guards against an older, slower search response overwriting a newer one
  function runSearch(term) {
    var mySeq = ++searchSeq;
    statusEl.className = 'status';
    statusEl.textContent = 'Searching\\u2026';
    resultsEl.innerHTML = '';

    sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/search/?q=' + encodeURIComponent(buildSoslQuery(term)))
      .then(function (data) {
        if (mySeq !== searchSeq) return; // a newer search already started - discard this result
        var byObject = {};
        (data.searchRecords || []).forEach(function (r) {
          var type = r.attributes && r.attributes.type;
          if (!byObject[type]) byObject[type] = [];
          byObject[type].push(r);
        });
        var groups = SEARCH_OBJECTS.map(function (config) {
          return { config: config, rows: byObject[config.objectApiName] || [] };
        });
        statusEl.textContent = '';
        renderResults(groups);
      })
      .catch(function (err) {
        if (mySeq !== searchSeq) return;
        if (err.isNoSession) {
          statusEl.className = 'status error';
          statusEl.textContent = 'Open the Cases tab first to sign in.';
        } else {
          console.error('Search failed:', err);
          statusEl.className = 'status error';
          statusEl.textContent = 'Could not search right now.';
        }
      });
  }

  var debounceTimer = null;
  searchInput.addEventListener('input', function () {
    var term = searchInput.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (term.length < MIN_TERM_LENGTH) {
      resultsEl.innerHTML = '';
      statusEl.textContent = '';
      return;
    }
    debounceTimer = setTimeout(function () { runSearch(term); }, DEBOUNCE_MS);
  });

  // "See all results" / Enter from the header's own inline search box (salesforceTabHome.js) lands
  // here with the term already typed - pre-fill and run it immediately instead of an empty box.
  var initialQuery = new URLSearchParams(window.location.search).get('q');
  if (initialQuery && initialQuery.trim().length >= MIN_TERM_LENGTH) {
    searchInput.value = initialQuery;
    runSearch(initialQuery.trim());
  }

  // Covers the case where the Search tab was already open when a new header search was submitted -
  // the ?q= param only applies on a fresh load, so the already-open tab needs this instead.
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'salesforceRunSearch') return;
    var term = String(e.data.term || '').trim();
    if (term.length < MIN_TERM_LENGTH) return;
    searchInput.value = term;
    runSearch(term);
  });

  searchInput.focus();
})();
</script>
</body>
</html>`;

app.http('salesforceTabSearch', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async () => {
    return {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: PAGE_HTML
    };
  }
});
