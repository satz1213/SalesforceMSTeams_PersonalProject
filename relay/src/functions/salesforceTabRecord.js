/**
 * Serves a single record's detail view: fetches its real Page Layout (per-user, no run-as
 * backend) and renders it as a two-column field grid per section. Linked from
 * salesforceTabHome.js's list view.
 *
 * Also has a "Talk to an Agent" button (a new conversation each time, session key namespaced per
 * record id) using the same Custom Client REST API pattern as talkToAgentTab.js, copied not
 * shared. routingAttributes must be repeated on the first message with isNewMessagingSession:
 * true, or caseId/name never reach Salesforce - found by testing, undocumented.
 */
const { app } = require('@azure/functions');

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Record</title>
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
  .section-title { font-size: 13px; font-weight: 700; color: #242424; padding: 12px 16px; border-bottom: 1px solid #F0F0F0; }
  .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; padding: 16px; }
  .field-label { font-size: 11px; color: #A19F9D; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 3px; }
  .field-value { font-size: 13px; color: #242424; word-break: break-word; }
  .btn-primary { background: #5B5FC7; color: #fff; border: none; border-radius: 999px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-primary:hover { background: #464775; }
  .btn-secondary { background: #fff; color: #5B5FC7; border: 1px solid #D1D1D1; border-radius: 999px; padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
  .btn-secondary:hover { background: #F5F5FF; }

  /* Split layout: main record content + docked side panel, side by side, both independently
     scrollable. The panel is a normal flex sibling (not position:fixed/overlay) so opening it
     resizes the main content instead of covering it - both stay visible and usable at once. */
  .page-split { display: flex; height: 100%; overflow: hidden; }
  .main-content { flex: 1 1 auto; min-width: 0; height: 100%; overflow-y: auto; background: #F5F5F5; padding: 20px 24px; box-sizing: border-box; }
  .side-panel-outer {
    flex: none; width: 0; height: 100%; overflow: hidden;
    border-left: 0 solid #E1E1E1; transition: width 0.2s ease;
  }
  .side-panel-outer.open { width: 380px; max-width: 92vw; border-left-width: 1px; }
  .side-panel {
    width: 380px; max-width: 92vw; height: 100%;
    background: #FAFAFA;
    display: flex; flex-direction: column;
  }
  .panel-header {
    flex: none; display: flex; align-items: center; gap: 10px;
    padding: 14px 16px; border-bottom: 1px solid #E5E5E5;
  }
  .panel-header .dot { width: 8px; height: 8px; border-radius: 50%; background: #2ECC71; flex: none; }
  .panel-close { background: none; border: none; font-size: 18px; color: #616161; cursor: pointer; padding: 0 4px; }
  .panel-body { flex: 1; overflow-y: auto; padding: 20px 16px; display: flex; flex-direction: column; }
  .panel-body.chat-mode { padding: 0; }

  .field { width: 100%; text-align: left; margin-bottom: 12px; }
  .field label { display: block; font-size: 0.78rem; font-weight: 600; color: #424242; margin-bottom: 4px; }
  .field input { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #D8D9DB; border-radius: 8px; font-size: 0.88rem; font-family: inherit; }
  .field input:focus { outline: none; border-color: #5B5FC7; }
  .talk-btn { margin-top: 6px; padding: 11px 20px; border: none; border-radius: 999px; background: #5B5FC7; color: #fff; font-size: 0.9rem; font-weight: 600; cursor: pointer; width: 100%; }
  .talk-btn:hover:not(:disabled) { background: #464775; }
  .talk-btn:disabled { background: #C9C9C9; cursor: default; }
  .status { font-size: 0.8rem; color: #8A8A8A; min-height: 1em; }
  .status.error { color: #C0392B; }

  .chat-messages { flex: 1; width: 100%; overflow-y: auto; padding: 16px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; }
  .bubble { max-width: 85%; padding: 9px 13px; border-radius: 14px; font-size: 0.85rem; line-height: 1.4; word-wrap: break-word; white-space: pre-wrap; }
  .bubble.me { align-self: flex-end; background: #5B5FC7; color: #fff; border-bottom-right-radius: 4px; }
  .bubble.agent { align-self: flex-start; background: #F0F1F2; color: #242424; border-bottom-left-radius: 4px; }
  .bubble.system { align-self: center; background: transparent; color: #8A8A8A; font-size: 0.74rem; max-width: 100%; text-align: center; }
  .chat-composer { flex: none; display: flex; gap: 8px; padding: 10px; border-top: 1px solid #E5E5E5; box-sizing: border-box; }
  .chat-composer input { flex: 1; padding: 9px 13px; border: 1px solid #D8D9DB; border-radius: 999px; font-size: 0.85rem; font-family: inherit; }
  .chat-composer input:focus { outline: none; border-color: #5B5FC7; }
  .chat-composer button { padding: 9px 16px; border: none; border-radius: 999px; background: #5B5FC7; color: #fff; font-weight: 600; cursor: pointer; }
  .chat-composer button:disabled { background: #C9C9C9; cursor: default; }
  .end-chat-btn { flex: none; padding: 5px 12px; border: 1px solid #D8D9DB; border-radius: 999px; background: #fff; color: #C0392B; font-size: 0.76rem; font-weight: 600; cursor: pointer; }
  .end-chat-btn:hover { background: #FBEEEC; }
  .end-chat-btn:disabled { color: #B5B5B5; cursor: default; background: #fff; }

  /* Update Reason panel - a small inline card, not a modal/side-panel, since it's a single field. */
  .field select { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #D8D9DB; border-radius: 8px; font-size: 0.88rem; font-family: inherit; background: #fff; }
  .field select:focus { outline: none; border-color: #5B5FC7; }
  .reason-panel { display: none; background: #FAFAFA; border: 1px solid #E5E5E5; border-radius: 8px; padding: 16px; margin-bottom: 16px; max-width: 340px; }
  .reason-panel.open { display: block; }
  .reason-panel .panel-actions { display: flex; gap: 8px; margin-top: 4px; }
  .reason-panel .panel-actions button { flex: 1; }
</style>
</head>
<body>
<div class="page-split" id="pageSplit">
  <div class="main-content" id="mainContent">
    <div style="max-width: 900px; margin: 0 auto;">

      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 12px;">
        <span id="copyLinkStatus" style="font-size: 12px; color: #616161;"></span>
        <button id="copyLinkBtn" class="btn-secondary">&#128279; Copy link</button>
        <button id="updateReasonBtn" class="btn-secondary">&#9998; Update Reason</button>
        <button id="talkToAgentBtn" class="btn-primary">&#128172; Talk to an Agent</button>
      </div>

      <div style="display:flex; align-items:center; gap:10px; margin-bottom: 18px;">
        <span id="objectLabel" style="font-size: 12px; color: #616161;">&hellip;</span>
        <h1 id="recordLabel" style="margin: 0; font-size: 20px; font-weight: 700;">Loading&hellip;</h1>
      </div>

      <!-- Replaces the CaseReasonUpdate Screen Flow's action - see updateReasonBtn's handler below. -->
      <div class="reason-panel" id="reasonPanel">
        <div class="field">
          <label for="reasonSelect">Reason</label>
          <select id="reasonSelect"></select>
        </div>
        <div class="panel-actions">
          <button id="reasonSaveBtn" class="talk-btn" type="button">Save</button>
          <button id="reasonCancelBtn" class="btn-secondary" type="button" style="flex:1;">Cancel</button>
        </div>
        <div class="status" id="reasonStatus"></div>
      </div>

      <div id="status" style="font-size: 13px; color: #616161;">Loading record&hellip;</div>
      <div id="sections"></div>
    </div>
  </div>

  <!-- Talk to an Agent side panel: a docked flex sibling, not an overlay. -->
  <div class="side-panel-outer" id="sidePanelOuter">
    <div class="side-panel" id="sidePanel">
      <div class="panel-header">
        <span class="dot" id="panelDot" style="visibility: hidden;"></span>
        <span id="panelTitle" style="flex:1; font-weight:600; font-size: 0.92rem;">Talk to an Agent</span>
        <button id="endChatBtn" class="end-chat-btn" style="display:none;">End Chat</button>
        <button class="panel-close" id="panelCloseBtn" aria-label="Close">&times;</button>
      </div>
      <div class="panel-body" id="panelBody">
        <!-- Filled by renderPreChatForm()/renderChatUi(). -->
      </div>
    </div>
  </div>
</div>

<script src="https://res.cdn.office.net/teams-js/2.19.0/js/MicrosoftTeams.min.js" crossorigin="anonymous"></script>

<script>
(function () {
  var statusEl = document.getElementById('status');
  var sectionsEl = document.getElementById('sections');
  var objectLabelEl = document.getElementById('objectLabel');
  var recordLabelEl = document.getElementById('recordLabel');

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  var params = new URLSearchParams(window.location.search);
  var recordId = params.get('id');
  var recordLabelForChat = recordId; // refined once the record loads

  // ---------------- Copy link to this case (Teams deep link) ----------------
  // Must match teamsapp-salesforce/manifest.json's id/staticTabs entry.
  var TEAMS_APP_ID = '3aed85f6-5208-454a-8c48-9ad5fbd14057';
  var TEAMS_ENTITY_ID = 'myCases';

  function buildDeepLink(id) {
    return 'https://teams.microsoft.com/l/entity/' + TEAMS_APP_ID + '/' + TEAMS_ENTITY_ID +
      '?context=' + encodeURIComponent(JSON.stringify({ subEntityId: id }));
  }

  var copyLinkBtn = document.getElementById('copyLinkBtn');
  var copyLinkStatus = document.getElementById('copyLinkStatus');

  function showCopyLinkStatus(text) {
    copyLinkStatus.textContent = text;
    setTimeout(function () { copyLinkStatus.textContent = ''; }, 2500);
  }

  function copyLinkToClipboardFallback() {
    var link = buildDeepLink(recordId);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link)
        .then(function () { showCopyLinkStatus('Link copied'); })
        .catch(function () {
          console.log('Deep link:', link);
          showCopyLinkStatus('See console for link');
        });
    } else {
      console.log('Deep link:', link);
      showCopyLinkStatus('See console for link');
    }
  }

  copyLinkBtn.addEventListener('click', function () {
    if (!recordId) return;

    // Direct clipboard copy - microsoftTeams.pages.shareDeepLink() proved unreliable, dropped.
    copyLinkToClipboardFallback();
  });

  // ---------------- Salesforce per-user session ----------------
  // Must be defined before loadRecordData() below (which runs at page load and needs it).
  // Same localStorage key as salesforceTabHome.js; no popup login if a session is missing.
  var SF_LOGIN_DOMAIN = 'https://mylightningapp-dev-dev-ed.my.salesforce.com';
  var SF_CLIENT_ID = '3MVG9G9pzCUSkzZsud2BdW9TWBEoplncNXHW02MLEybqDY0coXFBNmBujduJ2Du59lbZXigmCVI4V91wkBg0q';
  var SF_API_VERSION = 'v61.0';
  var SF_SESSION_KEY = 'sfUserSession'; // must match salesforceTabHome.js exactly - same storage

  function loadSfSession() {
    try {
      var raw = localStorage.getItem(SF_SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveSfSession(session) {
    try { localStorage.setItem(SF_SESSION_KEY, JSON.stringify(session)); } catch (e) {}
  }

  function sfCall(session, method, path, body) {
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

  // Tries a silent refresh on a 401; rejects with isNoSession if nothing is stored.
  function sfCallWithRetry(method, path, body) {
    var session = loadSfSession();
    if (!session || !session.accessToken) {
      var noSession = new Error('No Salesforce session found.');
      noSession.isNoSession = true;
      return Promise.reject(noSession);
    }
    return sfCall(session, method, path, body).catch(function (err) {
      if (!err.isAuthError || !session.refreshToken) throw err;
      return refreshAccessToken(session.refreshToken).then(function (tokenResponse) {
        var refreshed = {
          accessToken: tokenResponse.access_token,
          refreshToken: session.refreshToken,
          instanceUrl: tokenResponse.instance_url || session.instanceUrl
        };
        saveSfSession(refreshed);
        return sfCall(refreshed, method, path, body);
      });
    });
  }

  // ---------------- Field-value resolution (ported from the retired salesforceCaseRecord.js) ----------------
  // Lookup fields (OwnerId, AccountId) resolve via the standard Xxx/XxxId<->Xxx__r/Xxx__c naming.
  function relationshipNameFor(apiName) {
    if (apiName.slice(-3) === '__c') return apiName.slice(0, -3) + '__r';
    if (apiName.slice(-2) === 'Id' && apiName.length > 2) return apiName.slice(0, -2);
    return null;
  }

  function resolveFieldValue(record, apiName) {
    var fieldData = record.fields[apiName];
    if (!fieldData) return null;
    if (fieldData.displayValue != null) return fieldData.displayValue;
    var relName = relationshipNameFor(apiName);
    var rel = relName && record.fields[relName];
    if (rel) {
      if (rel.displayValue != null) return rel.displayValue;
      var nameField = rel.value && rel.value.fields && rel.value.fields.Name;
      if (nameField) return nameField.displayValue != null ? nameField.displayValue : nameField.value;
    }
    return fieldData.value;
  }

  // ---------------- Teams identity prefill for the pre-chat form ----------------
  // Reads the signed-in Teams user's name/UPN via the Teams JS SDK context, no Graph call.
  var teamsUser = { firstName: '', lastName: '', email: '' };

  function applyTeamsPrefill() {
    var firstEl = document.getElementById('pcFirst');
    var lastEl = document.getElementById('pcLast');
    var emailEl = document.getElementById('pcEmail');
    if (firstEl && !firstEl.value) firstEl.value = teamsUser.firstName;
    if (lastEl && !lastEl.value) lastEl.value = teamsUser.lastName;
    if (emailEl && !emailEl.value) emailEl.value = teamsUser.email;
  }

  if (window.microsoftTeams) {
    microsoftTeams.app.initialize().then(function () {
      microsoftTeams.app.notifySuccess();
      return microsoftTeams.app.getContext();
    }).then(function (context) {
      var user = context && context.user;
      if (!user) return;
      var fullName = (user.displayName || '').trim();
      var parts = fullName ? fullName.split(/\\s+/) : [];
      teamsUser.firstName = parts[0] || '';
      teamsUser.lastName = parts.slice(1).join(' ');
      teamsUser.email = user.userPrincipalName || user.loginHint || '';
      applyTeamsPrefill(); // fills in the pre-chat form if it's already rendered by now
    }).catch(function (err) {
      console.error('Could not read Teams user context:', err);
    });
  }

  // Named function so it can be re-called after Update Reason saves. Calls UI API directly -
  // no more run-as-user backend (salesforceCaseRecord.js is retired from this page).
  function loadRecordData() {
    if (!recordId) {
      statusEl.textContent = 'No record id was provided.';
      return;
    }
    statusEl.style.display = 'block';
    statusEl.textContent = 'Loading record…';
    sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/ui-api/record-ui/' + encodeURIComponent(recordId) + '?layoutTypes=Full&modes=View')
      .then(function (recordUi) {
        var record = recordUi.records[recordId];
        var objectApiName = record.apiName;
        var objectInfo = recordUi.objectInfos[objectApiName];
        var recordTypeId = record.recordTypeInfo
          ? record.recordTypeInfo.recordTypeId
          : Object.keys(recordUi.layouts[objectApiName])[0];
        var fullLayout = recordUi.layouts[objectApiName][recordTypeId].Full.View;

        var sections = fullLayout.sections.map(function (section) {
          var fields = [];
          section.layoutRows.forEach(function (row) {
            row.layoutItems.forEach(function (item) {
              var component = item.layoutComponents && item.layoutComponents[0];
              if (!component || component.componentType !== 'Field' || !component.apiName) return;
              fields.push({
                apiName: component.apiName,
                label: item.label || component.label,
                value: resolveFieldValue(record, component.apiName)
              });
            });
          });
          return { heading: section.heading, fields: fields };
        }).filter(function (section) { return section.fields.length > 0; });

        var recordLabel = record.fields.Name
          ? record.fields.Name.value
          : (record.fields.CaseNumber ? record.fields.CaseNumber.value : recordId);

        objectLabelEl.textContent = objectInfo.label || '';
        recordLabelEl.textContent = recordLabel || recordId;
        recordLabelForChat = (objectInfo.label ? (objectInfo.label + ' ') : '') + (recordLabel || recordId);

        sectionsEl.innerHTML = '';
        sections.forEach(function (section) {
          var card = document.createElement('div');
          card.className = 'card';
          card.style.marginBottom = '16px';

          var title = document.createElement('div');
          title.className = 'section-title';
          title.textContent = section.heading || '';
          card.appendChild(title);

          var grid = document.createElement('div');
          grid.className = 'field-grid';
          section.fields.forEach(function (f) {
            var wrap = document.createElement('div');
            wrap.innerHTML =
              '<div class="field-label">' + escapeHtml(f.label) + '</div>' +
              '<div class="field-value">' + escapeHtml(f.value || '\\u2014') + '</div>';
            grid.appendChild(wrap);
          });
          card.appendChild(grid);

          sectionsEl.appendChild(card);
        });

        statusEl.style.display = 'none';
      })
      .catch(function (err) {
        console.error('Failed to load record:', err);
        if (err.isNoSession) {
          statusEl.textContent = 'Open this record from the Cases list first to sign in.';
        } else {
          statusEl.textContent = 'Could not load this record right now.';
        }
      });
  }
  loadRecordData();

  // ---------------- Update Reason (replaces the CaseReasonUpdate Screen Flow's action) ----------------
  // Screen Flows aren't reachable via the Invocable Actions REST API, so reasonSaveBtn calls
  // CaseReasonUpdateAuto - an Autolaunched twin of that flow's logic - instead.
  var updateReasonBtn = document.getElementById('updateReasonBtn');
  var reasonPanel = document.getElementById('reasonPanel');
  var reasonSelect = document.getElementById('reasonSelect');
  var reasonSaveBtn = document.getElementById('reasonSaveBtn');
  var reasonCancelBtn = document.getElementById('reasonCancelBtn');
  var reasonStatus = document.getElementById('reasonStatus');
  var reasonPicklistLoaded = false;

  function setReasonStatus(text, isError) {
    reasonStatus.className = isError ? 'status error' : 'status';
    reasonStatus.textContent = text;
  }

  function reasonNoSessionMessage() {
    setReasonStatus('Open this record from the Cases list first to sign in.', true);
  }

  // Picklist values read live from Case.Reason__c's own describe, never hardcoded.
  function loadReasonPicklist() {
    reasonSelect.innerHTML = '<option>Loading…</option>';
    return sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/sobjects/Case/describe')
      .then(function (describe) {
        var field = (describe.fields || []).filter(function (f) { return f.name === 'Reason__c'; })[0];
        var values = field ? field.picklistValues.filter(function (v) { return v.active; }) : [];
        reasonSelect.innerHTML = '';
        values.forEach(function (v) {
          var opt = document.createElement('option');
          opt.value = v.value;
          opt.textContent = v.label || v.value;
          reasonSelect.appendChild(opt);
        });
        reasonPicklistLoaded = true;
      });
  }

  updateReasonBtn.addEventListener('click', function () {
    if (!recordId) return;
    reasonPanel.classList.add('open');
    setReasonStatus('');
    if (!reasonPicklistLoaded) {
      loadReasonPicklist().catch(function (err) {
        reasonSelect.innerHTML = '';
        if (err.isNoSession) {
          reasonNoSessionMessage();
        } else {
          console.error('Failed to load Reason picklist:', err);
          setReasonStatus('Could not load Reason values right now.', true);
        }
      });
    }
  });

  reasonCancelBtn.addEventListener('click', function () {
    reasonPanel.classList.remove('open');
  });

  reasonSaveBtn.addEventListener('click', function () {
    if (!recordId || !reasonSelect.value) return;
    reasonSaveBtn.disabled = true;
    setReasonStatus('Saving…');
    sfCallWithRetry('POST', '/services/data/' + SF_API_VERSION + '/actions/custom/flow/CaseReasonUpdateAuto', {
      inputs: [{ recordId: recordId, reason: reasonSelect.value }]
    })
      .then(function (result) {
        var outcome = result && result[0];
        if (!outcome || !outcome.isSuccess) {
          throw new Error((outcome && outcome.errors && outcome.errors[0] && outcome.errors[0].message) || 'Flow did not report success.');
        }
        reasonSaveBtn.disabled = false;
        setReasonStatus('Saved.');
        setTimeout(function () { reasonPanel.classList.remove('open'); }, 900);
        loadRecordData(); // reflect the new value in the sections below without a manual reload
      })
      .catch(function (err) {
        reasonSaveBtn.disabled = false;
        if (err.isNoSession) {
          reasonNoSessionMessage();
        } else {
          console.error('Failed to update Reason:', err);
          setReasonStatus('Could not save right now.', true);
        }
      });
  });

  // ---------------- Talk to an Agent side panel ----------------
  var ORG_ID = '00D2v000001e1KA';
  var ES_DEVELOPER_NAME = 'MIAW_Custom_Client';
  var SCRT2_URL = 'https://mylightningapp-dev-dev-ed.my.salesforce-scrt.com';

  var sidePanelOuter = document.getElementById('sidePanelOuter');
  var panelBody = document.getElementById('panelBody');
  var panelDot = document.getElementById('panelDot');
  var panelTitle = document.getElementById('panelTitle');
  var endChatBtn = document.getElementById('endChatBtn');

  var accessToken = null;
  var conversationId = null;
  var knownAgents = {};
  var conversationEnded = false;
  var chatMessages = null;
  var chatInput = null;
  var chatSendBtn = null;

  var SESSION_STORAGE_KEY = 'caseChatSession_' + (recordId || 'unknown');

  function saveSession() {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ accessToken: accessToken, conversationId: conversationId }));
    } catch (e) {}
  }
  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch (e) {}
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function openPanel() {
    if (conversationEnded) resetPanelForNewConversation(); // start fresh, don't show the ended screen
    sidePanelOuter.classList.add('open');
  }
  function closePanel() {
    sidePanelOuter.classList.remove('open');
  }

  function resetPanelForNewConversation() {
    conversationEnded = false;
    accessToken = null;
    conversationId = null;
    knownAgents = {};
    sseRetryCount = 0;
    chatMessages = null;
    chatInput = null;
    chatSendBtn = null;
    panelDot.style.visibility = 'hidden';
    panelTitle.textContent = 'Talk to an Agent';
    endChatBtn.style.display = 'none';
    endChatBtn.disabled = false;
    endChatBtn.textContent = 'End Chat';
    renderPreChatForm();
  }

  document.getElementById('talkToAgentBtn').addEventListener('click', openPanel);
  document.getElementById('panelCloseBtn').addEventListener('click', closePanel);

  function renderPreChatForm() {
    panelBody.classList.remove('chat-mode');
    panelBody.innerHTML =
      '<div class="field"><label for="pcFirst">First name</label><input id="pcFirst" type="text" autocomplete="given-name" /></div>' +
      '<div class="field"><label for="pcLast">Last name</label><input id="pcLast" type="text" autocomplete="family-name" /></div>' +
      '<div class="field"><label for="pcEmail">Email</label><input id="pcEmail" type="email" autocomplete="email" /></div>' +
      '<button id="pcSubmit" class="talk-btn">Start Conversation</button>' +
      '<div class="status" id="pcStatus"></div>';
    applyTeamsPrefill(); // covers the case where Teams context already resolved before this render
    document.getElementById('pcSubmit').addEventListener('click', function () {
      var firstName = document.getElementById('pcFirst').value.trim();
      var lastName = document.getElementById('pcLast').value.trim();
      var email = document.getElementById('pcEmail').value.trim();
      var statusNode = document.getElementById('pcStatus');
      if (!firstName || !email) {
        statusNode.className = 'status error';
        statusNode.textContent = 'First name and email are required.';
        return;
      }
      statusNode.className = 'status';
      statusNode.textContent = 'Connecting...';
      startConversation(firstName, lastName, email);
    });
  }

  function renderChatUi() {
    panelBody.classList.add('chat-mode');
    panelBody.innerHTML =
      '<div class="chat-messages" id="chatMessages"></div>' +
      '<form class="chat-composer" id="chatComposer">' +
      '<input id="chatInput" type="text" placeholder="Type a message..." autocomplete="off" disabled />' +
      '<button id="chatSendBtn" type="submit" disabled>Send</button>' +
      '</form>';
    chatMessages = document.getElementById('chatMessages');
    chatInput = document.getElementById('chatInput');
    chatSendBtn = document.getElementById('chatSendBtn');

    document.getElementById('chatComposer').addEventListener('submit', function (e) {
      e.preventDefault();
      var text = chatInput.value.trim();
      if (!text || !accessToken || !conversationId) return;
      chatInput.value = '';
      appendBubble('me', text);
      postMessage(text);
    });
  }

  function appendBubble(kind, text) {
    if (!chatMessages) return;
    var el = document.createElement('div');
    el.className = 'bubble ' + kind;
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return el;
  }

  // opts.isNewMessagingSession/routingAttributes are only passed on the automated first message -
  // required there or caseId/name never reach the MessagingSession (found by testing).
  function postMessage(text, opts) {
    var body = {
      message: { id: uuid(), messageType: 'StaticContentMessage', staticContent: { formatType: 'Text', text: text } },
      esDeveloperName: ES_DEVELOPER_NAME,
      isNewMessagingSession: !!(opts && opts.isNewMessagingSession)
    };
    if (opts && opts.routingAttributes) {
      body.routingAttributes = opts.routingAttributes;
    }
    fetch(SCRT2_URL + '/iamessage/api/v2/conversation/' + conversationId + '/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify(body)
    }).catch(function (err) { console.error('Failed to send message:', err); });
  }

  function startConversation(firstName, lastName, email) {
    var routingAttributes; // shared with the first postMessage() call once conversationId exists
    fetch(SCRT2_URL + '/iamessage/api/v2/authorization/unauthenticated/access-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: ORG_ID, esDeveloperName: ES_DEVELOPER_NAME, capabilitiesVersion: '1', platform: 'Web' })
    })
      .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
      .then(function (result) {
        console.log('access-token response:', result.body);
        if (!result.ok || !result.body || !result.body.accessToken) throw new Error('No access token in response');
        accessToken = result.body.accessToken;
        conversationId = uuid();

        routingAttributes = {
          // _firstName/_lastName/_email are the 4 reserved, underscore-prefixed pre-chat keys.
          _firstName: firstName,
          _lastName: lastName,
          _email: email,
          // Plain keys below are this channel's own custom parameters.
          email: email,
          recordId: recordId,
          recordContext: recordLabelForChat,
          caseId: recordId // maps to MessagingSession.CaseId via the Messaging_Routing flow
        };
        console.log('create-conversation routingAttributes:', routingAttributes);

        return fetch(SCRT2_URL + '/iamessage/api/v2/conversation', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
          body: JSON.stringify({
            conversationId: conversationId,
            esDeveloperName: ES_DEVELOPER_NAME,
            language: 'en_US',
            routingAttributes: routingAttributes
          })
        });
      })
      .then(function (res) {
        return res.text().then(function (text) {
          console.log('create-conversation status:', res.status, 'body:', text);
          if (!res.ok) throw new Error('Failed to create conversation (status ' + res.status + ')');
        });
      })
      .then(function () {
        saveSession();
        renderChatUi();
        panelDot.style.visibility = 'visible';
        panelTitle.textContent = 'Live Chat';
        endChatBtn.style.display = 'inline-block';
        appendBubble('system', 'Conversation started. An agent will join shortly.');
        chatInput.disabled = false;
        chatSendBtn.disabled = false;
        chatInput.focus();
        // Sent silently to trigger routing; the matching bubble shows later once an agent joins.
        postMessage('Hi, I need some help.', { isNewMessagingSession: true, routingAttributes: routingAttributes });
        connectEventStream();
      })
      .catch(function (err) {
        console.error('Failed to start conversation:', err);
        var statusNode = document.getElementById('pcStatus');
        if (statusNode) {
          statusNode.className = 'status error';
          statusNode.textContent = 'Could not connect right now. Please try again.';
        }
      });
  }

  var sseRetryCount = 0;
  var SSE_MAX_RETRIES = 8;
  var SSE_BASE_DELAY_MS = 2000;
  var SSE_MAX_DELAY_MS = 60000;

  function connectEventStream() {
    if (conversationEnded) return;
    fetch(SCRT2_URL + '/eventrouter/v1/sse', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + accessToken, Accept: 'text/event-stream', 'X-Org-Id': ORG_ID }
    })
      .then(function (res) {
        if (!res.ok || !res.body) throw new Error('SSE connect failed (status ' + res.status + ')');
        sseRetryCount = 0;
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function pump() {
          if (conversationEnded) {
            reader.cancel().catch(function () {});
            return;
          }
          return reader.read().then(function (result) {
            if (result.done) {
              if (conversationEnded) return;
              scheduleSseRetry('SSE stream closed');
              return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            var parts = buffer.split('\\n\\n');
            buffer = parts.pop();
            parts.forEach(handleSseFrame);
            return pump();
          });
        }
        return pump();
      })
      .catch(function (err) {
        if (conversationEnded) return;
        scheduleSseRetry('SSE connection error: ' + err);
      });
  }

  function scheduleSseRetry(reason) {
    sseRetryCount++;
    if (sseRetryCount > SSE_MAX_RETRIES) {
      console.error(reason + ' - giving up after ' + SSE_MAX_RETRIES + ' attempts.');
      appendBubble('system', 'Lost connection to the chat. Please reopen this panel to reconnect.');
      return;
    }
    var delay = Math.min(SSE_BASE_DELAY_MS * Math.pow(2, sseRetryCount - 1), SSE_MAX_DELAY_MS);
    console.log(reason + ', retrying in ' + delay + 'ms (attempt ' + sseRetryCount + '/' + SSE_MAX_RETRIES + ')');
    setTimeout(connectEventStream, delay);
  }

  function endConversation() {
    if (!accessToken || !conversationId || conversationEnded) return;
    endChatBtn.disabled = true;
    endChatBtn.textContent = 'Ending...';

    fetch(SCRT2_URL + '/iamessage/api/v2/conversation/' + conversationId + '?esDeveloperName=' + encodeURIComponent(ES_DEVELOPER_NAME), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + accessToken, 'X-Org-Id': ORG_ID }
    })
      .then(function (res) { return res.text().then(function (body) { console.log('close-conversation status:', res.status, 'body:', body); }); })
      .catch(function (err) { console.error('Failed to close conversation:', err); })
      .then(function () {
        conversationEnded = true;
        clearSession();
        appendBubble('system', 'You ended the conversation.');
        if (chatInput) chatInput.disabled = true;
        if (chatSendBtn) chatSendBtn.disabled = true;
        endChatBtn.textContent = 'Chat ended';
      });
  }
  // One click, no confirm() - Teams iframes block native confirm dialogs.
  endChatBtn.addEventListener('click', function () {
    if (conversationEnded) return;
    endConversation();
  });

  function handleSseFrame(frame) {
    var eventType = null;
    var dataLines = [];
    frame.split('\\n').forEach(function (line) {
      if (line.indexOf('event:') === 0) eventType = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
    });
    if (!dataLines.length) return;
    var raw = dataLines.join('\\n');
    console.log('SSE event:', eventType, raw);
    var payload;
    try { payload = JSON.parse(raw); } catch (e) { return; }

    var entry = payload && payload.conversationEntry;
    var sender = entry && entry.sender;
    var entryPayload = entry && entry.entryPayload ? JSON.parse(entry.entryPayload) : null;

    if (eventType === 'CONVERSATION_MESSAGE') {
      var text = entryPayload && entryPayload.abstractMessage && entryPayload.abstractMessage.staticContent
        ? entryPayload.abstractMessage.staticContent.text
        : null;
      if (text && sender && sender.role && sender.role !== 'EndUser') {
        appendBubble('agent', text);
      }
    } else if (eventType === 'CONVERSATION_CLOSE_CONVERSATION' || eventType === 'CONVERSATION_ROUTING_RESULT_FAILED') {
      handleConversationEndedByServer('This conversation has ended.');
    } else if (eventType === 'CONVERSATION_PARTICIPANT_CHANGED' && entryPayload && entryPayload.entries) {
      entryPayload.entries.forEach(function (e) {
        if (!e.participant || e.participant.role !== 'Agent') return;
        if (e.operation === 'add') {
          var subject = e.participant.subject;
          if (subject && !knownAgents[subject]) {
            knownAgents[subject] = true;
            appendBubble('system', (e.displayName || 'An agent') + ' joined the conversation.');
            appendBubble('me', 'Hi, I need some help.'); // display-only; already sent silently earlier
          }
        } else if (e.operation === 'remove') {
          handleConversationEndedByServer('The agent ended this conversation.');
        }
      });
    }
  }

  function handleConversationEndedByServer(message) {
    if (conversationEnded) return;
    conversationEnded = true;
    clearSession();
    appendBubble('system', message);
    if (chatInput) chatInput.disabled = true;
    if (chatSendBtn) chatSendBtn.disabled = true;
    endChatBtn.disabled = true;
    endChatBtn.textContent = 'Chat ended';
  }

  // Resume an open conversation on reload - keyed per record id.
  (function tryResumeSession() {
    var saved = loadSession();
    if (!saved || !saved.accessToken || !saved.conversationId) {
      renderPreChatForm();
      return;
    }
    accessToken = saved.accessToken;
    conversationId = saved.conversationId;
    renderChatUi();
    panelDot.style.visibility = 'visible';
    panelTitle.textContent = 'Live Chat';
    endChatBtn.style.display = 'inline-block';
    appendBubble('system', 'Resuming your conversation...');
    chatInput.disabled = false;
    chatSendBtn.disabled = false;
    connectEventStream();
  })();
})();
</script>
</body>
</html>`;

app.http('salesforceTabRecord', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'salesforceTabRecord',
    handler: async () => {
        return {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: PAGE_HTML
        };
    }
});
