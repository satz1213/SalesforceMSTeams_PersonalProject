/**
 * Sibling of salesforceTabRecord.js (not an edit of it) - the "Lightning-style" record page:
 * Highlights Panel, Related Lists, Activity tab, Close Case, Update Reason, Schedule Expert Call.
 * The Talk to an Agent panel is copied verbatim from salesforceTabRecord.js, unchanged. Kept as a
 * fully separate file so either version can be deleted with zero risk to the other.
 *
 * Per-user, no run-as backend - all Salesforce data goes through sfCallWithRetry with the signed-in
 * person's own token (ported from the old salesforceCaseRecordFull.js, now unused/kept as a revert).
 */
const { app } = require('@azure/functions');

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Record (Lightning)</title>
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
  .section-title { font-size: 12px; font-weight: 700; color: #242424; padding: 9px 14px; border-bottom: 1px solid #F0F0F0; }
  .field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; padding: 12px 14px; }
  .field-label { font-size: 10px; color: #A19F9D; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }
  .field-value { font-size: 12px; color: #242424; word-break: break-word; }
  .btn-primary { background: #5B5FC7; color: #fff; border: none; border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(91,95,199,0.35); transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease; }
  .btn-primary:hover { background: #464775; box-shadow: 0 3px 8px rgba(70,71,117,0.35); }
  .btn-primary:active { transform: translateY(1px); box-shadow: 0 1px 2px rgba(70,71,117,0.3); }
  .btn-secondary { background: #fff; color: #5B5FC7; border: 1px solid #D9D9F7; border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgba(17,17,26,0.04); transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease; }
  .btn-secondary:hover { background: #F5F5FF; border-color: #B9BBF2; box-shadow: 0 3px 8px rgba(91,95,199,0.18); }
  .btn-secondary:active { transform: translateY(1px); }
  .btn-primary:disabled, .btn-secondary:disabled { background: #E1E1E1; color: #A19F9D; border-color: #E1E1E1; box-shadow: none; cursor: default; transform: none; }

  /* Highlights Panel fields (the object's Compact Layout). */
  .highlight-item { min-width: 100px; }
  .highlight-label { font-size: 10px; color: #A19F9D; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 2px; }
  .highlight-value { font-size: 12.5px; color: #242424; font-weight: 600; word-break: break-word; }

  /* Related list mini-tables - same th/td look as salesforceTabHome.js's list view table. */
  .related-list-card { margin-bottom: 16px; overflow-x: auto; }
  .related-list-table { width: 100%; border-collapse: collapse; }
  .related-list-table th { text-align: left; padding: 8px 16px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; color: #A19F9D; background: #FAFAFA; border-bottom: 1px solid #E1E1E1; white-space: nowrap; }
  .related-list-table td { padding: 8px 16px; font-size: 13px; border-bottom: 1px solid #F0F0F0; white-space: nowrap; }
  .related-list-table tr:last-child td { border-bottom: none; }
  .related-list-empty { padding: 14px 16px; font-size: 13px; color: #A19F9D; }

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
    padding: 12px 14px; border-bottom: 1px solid #E5E5E5;
  }
  .panel-header .dot { width: 8px; height: 8px; border-radius: 50%; background: #2ECC71; flex: none; }
  .panel-close { background: none; border: none; font-size: 18px; color: #616161; cursor: pointer; padding: 0 4px; }
  .panel-body { flex: 1; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; }
  .panel-body.chat-mode { padding: 0; }
  .panel-footer { flex: none; display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #E5E5E5; }
  .panel-footer button { flex: 1; }

  .field { width: 100%; text-align: left; margin-bottom: 8px; }
  .field label { display: block; font-size: 10.5px; font-weight: 600; color: #616161; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 3px; }
  .field input { width: 100%; box-sizing: border-box; padding: 6px 9px; border: 1px solid #D8D9DB; border-radius: 6px; font-size: 12.5px; font-family: inherit; }
  .field input:focus { outline: none; border-color: #5B5FC7; }
  .field select { width: 100%; box-sizing: border-box; padding: 6px 9px; border: 1px solid #D8D9DB; border-radius: 6px; font-size: 12.5px; font-family: inherit; background: #fff; }
  .field select:focus { outline: none; border-color: #5B5FC7; }
  /* Update Reason - a real modal popup (backdrop + centered card), not an inline panel. Reuses
     .panel-header/.panel-close (same header look as the Talk to an Agent/Ask AI side panels). */
  .reason-panel { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(36,36,36,0.45); z-index: 1000; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
  .reason-panel.open { display: flex; }
  .reason-panel .modal-card { background: #fff; border-radius: 8px; max-width: 340px; width: 100%; box-shadow: 0 8px 24px rgba(17,17,26,0.25); overflow: hidden; }
  .reason-panel .modal-card-body { padding: 16px; }
  .reason-panel .panel-actions { display: flex; gap: 8px; margin-top: 4px; }
  .reason-panel .panel-actions button { flex: 1; }
  .talk-btn { margin-top: 4px; padding: 7px 14px; border: none; border-radius: 999px; background: #5B5FC7; color: #fff; font-size: 12.5px; font-weight: 600; cursor: pointer; width: 100%; }
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

  /* ---- Redesigned header/tabs/actions layout ---- */
  .breadcrumb { font-size: 11px; margin-bottom: 8px; }
  .breadcrumb a { color: #5B5FC7; }
  .breadcrumb .sep { color: #A19F9D; margin: 0 4px; }
  .breadcrumb .current { color: #616161; }

  .record-header { padding: 12px 14px; margin-bottom: 12px; }
  .record-header-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .record-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .record-title-row h1 { margin: 0; font-size: 15px; font-weight: 700; }
  .open-in-sf { font-size: 11px; white-space: nowrap; flex: none; }
  .pill { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }

  .highlights-row { display: flex; flex-wrap: wrap; gap: 12px 22px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #F0F0F0; }
  .highlight-owner { display: flex; align-items: center; gap: 6px; }
  .avatar-md { width: 22px; height: 22px; border-radius: 50%; background: #5B5FC7; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; flex: none; }

  .tab-strip { display: flex; gap: 4px; border-bottom: 1px solid #E1E1E1; margin-bottom: 12px; }
  .rtab { padding: 7px 4px; font-size: 12px; font-weight: 600; color: #616161; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-family: inherit; margin-right: 16px; }
  .rtab.active { color: #242424; border-bottom-color: #5B5FC7; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }

  .activity-list { padding: 2px 0; }
  .activity-row { display: flex; gap: 10px; padding: 8px 14px; border-bottom: 1px solid #F0F0F0; }
  .activity-row:last-child { border-bottom: none; }
  .activity-kind { flex: none; font-size: 10px; font-weight: 700; color: #5B5FC7; text-transform: uppercase; width: 48px; }
  .activity-subject { font-size: 12px; color: #242424; }
  .activity-date { font-size: 10px; color: #A19F9D; margin-top: 1px; }

  .bottom-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

  /* Schedule Expert Call - shared status-line style, used inside #scheduleCallView */
  .expert-suggest-status { font-size: 12px; color: #616161; }
  .expert-suggest-status.error { color: #C0392B; }

  /* Schedule Expert Call - dedicated view */
  /* AI reasoning - a real card with a badge, not floating text. */
  .sc-reasoning-card { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; margin-top: 12px; background: #FAFAFF; border: 1px solid #E4E4F7; border-radius: 8px; }
  .sc-reasoning-badge { flex: none; width: 24px; height: 24px; border-radius: 50%; background: #5B5FC7; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 9.5px; font-weight: 700; margin-top: 1px; }
  .sc-reasoning-text { font-size: 12.5px; color: #333; line-height: 1.5; }

  .sc-options-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #A19F9D; margin-bottom: 8px; }

  /* Timeline: a continuous rail with a real card per row (not bare text on the line) - the
     top-ranked option gets a purple accent border + tint, everything else stays neutral. Day and
     time live together as one line inside the card (whatever the real slot text says), not split
     out into a separate header above it. */
  .sc-timeline { position: relative; padding-left: 30px; margin-top: 4px; }
  .sc-timeline::before { content: ''; position: absolute; left: 13px; top: 10px; bottom: 10px; width: 2px; background: #E1E1E1; }
  .sc-timeline-row { position: relative; display: flex; align-items: center; gap: 12px; padding: 10px 12px; margin-bottom: 10px; background: #fff; border: 1px solid #E1E1E1; border-radius: 8px; box-shadow: 0 1px 2px rgba(17,17,26,0.05); }
  .sc-timeline-row:last-child { margin-bottom: 0; }
  .sc-timeline-row.best { border-color: #5B5FC7; border-left-width: 3px; background: #FAFAFF; }
  .sc-timeline-dot { position: absolute; left: -22px; top: 50%; transform: translateY(-50%); width: 10px; height: 10px; border-radius: 50%; background: #fff; border: 2px solid #C7C7C7; box-sizing: border-box; }
  .sc-timeline-row.best .sc-timeline-dot { border-color: #5B5FC7; background: #5B5FC7; }
  .sc-timeline-text { flex: 1; min-width: 0; }
  .sc-timeline-who { font-size: 13px; font-weight: 700; color: #242424; }
  .sc-timeline-row.best .sc-timeline-who { color: #5B5FC7; }
  .sc-timeline-slot { font-size: 12px; color: #616161; margin-top: 1px; }
  .sc-timeline-row.best .sc-timeline-slot { color: #424242; }
  .sc-timeline-schedule-btn { flex: none; background: #5B5FC7; color: #fff; border: none; border-radius: 999px; padding: 5px 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; }
  .sc-timeline-schedule-btn:hover:not(:disabled) { background: #464775; }
  .sc-timeline-schedule-btn:disabled { background: #E1E1E1; color: #A19F9D; cursor: default; }
  .sc-timeline-row.best .sc-timeline-schedule-btn { background: #fff; color: #5B5FC7; border: 1px solid #5B5FC7; }
  .sc-timeline-row.best .sc-timeline-schedule-btn:hover:not(:disabled) { background: #F5F5FF; }

  #scConfirmation { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; margin-top: 4px; background: #F3FBF3; border: 1px solid #CFEBD1; border-radius: 8px; }
  .sc-confirm-badge { flex: none; width: 24px; height: 24px; border-radius: 50%; background: #0E700F; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; margin-top: 1px; }
  #scConfirmation .sc-confirm-title { font-size: 13px; font-weight: 700; color: #242424; margin-bottom: 4px; }
  #scConfirmation .sc-confirm-detail { font-size: 12.5px; color: #424242; }
  #scConfirmation .sc-confirm-note { font-size: 11px; color: #8A8A8A; margin-top: 6px; }

  /* Send Email - two-pane template browser + compose, styled like a real email client. */
  .email-layout { display: flex; gap: 14px; align-items: flex-start; }
  .email-templates-pane { flex: none; width: 240px; padding: 0; overflow: hidden; }
  .email-templates-header { font-size: 12px; font-weight: 700; padding: 12px 14px; border-bottom: 1px solid #F0F0F0; }
  .email-template-search { display: block; width: calc(100% - 24px); box-sizing: border-box; margin: 10px 12px 8px; padding: 6px 9px; border: 1px solid #D8D9DB; border-radius: 6px; font-size: 12px; font-family: inherit; }
  .email-template-list { max-height: 480px; overflow-y: auto; border-top: 1px solid #F5F5F5; }
  .email-template-item { padding: 9px 14px; border-bottom: 1px solid #F5F5F5; cursor: pointer; }
  .email-template-item:hover { background: #FAFAFF; }
  .email-template-item.active { background: #F0F0FF; border-left: 3px solid #5B5FC7; padding-left: 11px; }
  .email-template-item .name { font-size: 12.5px; font-weight: 600; color: #242424; }
  .email-template-item.none .name { font-style: italic; color: #616161; font-weight: 500; }
  .email-template-empty { padding: 14px; font-size: 12px; color: #A19F9D; }

  .email-compose-pane { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .email-compose-header { display: flex; align-items: baseline; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #F0F0F0; font-size: 13px; font-weight: 700; }
  .email-compose-template-label { font-size: 11px; color: #5B5FC7; font-weight: 600; }
  .email-compose-body { padding: 14px; display: flex; flex-direction: column; flex: 1; }
  .email-related-chip { display: inline-flex; gap: 6px; font-size: 12px; font-weight: 600; color: #424242; background: #F5F5F5; padding: 4px 10px; border-radius: 6px; }

  .email-merge-legend { margin-top: 12px; border-top: 1px solid #F0F0F0; padding-top: 10px; }
  .email-merge-legend-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #A19F9D; margin-bottom: 6px; }
  .email-merge-row { display: flex; gap: 8px; font-size: 11.5px; padding: 3px 0; }
  .email-merge-token { color: #5B5FC7; font-family: 'Courier New', monospace; flex: none; }
  .email-merge-value { color: #424242; word-break: break-word; }
  .email-merge-value.unresolved { color: #C0392B; font-style: italic; }
</style>
</head>
<body>
<div class="page-split" id="pageSplit">
  <div class="main-content" id="mainContent">
    <div style="max-width: 900px; margin: 0 auto;" id="recordViewWrap">

      <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
        <span id="copyLinkStatus" style="font-size: 12px; color: #616161;"></span>
        <button id="openSwarmChatBtn" class="btn-secondary" style="display:none;">Open swarm chat &#8599;</button>
        <button id="copyLinkBtn" class="btn-secondary">Copy link</button>
        <button id="updateReasonBtn" class="btn-secondary">Update Reason</button>
        <button id="askAiBtn" class="btn-secondary">Ask AI</button>
        <button id="talkToAgentBtn" class="btn-primary">Talk to an Agent</button>
      </div>

      <!-- Ported from salesforceTabRecord.js; calls the CaseReasonUpdateAuto flow. Backdrop click
           and the header's close button both dismiss it, same as the side panels' close button. -->
      <div class="reason-panel" id="reasonPanel">
        <div class="modal-card">
          <div class="panel-header">
            <span style="flex:1; font-weight:600; font-size: 13px;">Update Reason</span>
            <button class="panel-close" id="reasonModalCloseBtn" aria-label="Close">&times;</button>
          </div>
          <div class="modal-card-body">
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
        </div>
      </div>

      <div class="breadcrumb" id="breadcrumb" style="display:none;">
        <a href="#" id="breadcrumbCases">Cases</a><span class="sep">/</span><span class="current" id="breadcrumbCurrent"></span>
      </div>

      <div id="status" style="font-size: 13px; color: #616161;">Loading record&hellip;</div>

      <div class="card record-header" id="recordHeader" style="display:none;">
        <div class="record-header-top">
          <div class="record-title-row">
            <h1 id="recordLabel"></h1>
            <span class="pill" id="statusPill" style="display:none;"></span>
          </div>
          <a class="open-in-sf" id="openInSfLink" href="#" target="_blank" rel="noopener" style="display:none;">Open in Salesforce &#8599;</a>
        </div>
        <div class="highlights-row" id="highlightsRow"></div>
      </div>

      <div id="tabsWrap" style="display:none;">
        <div class="tab-strip" id="tabStrip">
          <button type="button" class="rtab active" data-tab="details">Details</button>
          <button type="button" class="rtab" data-tab="related">Related</button>
          <button type="button" class="rtab" data-tab="activity">Activity</button>
        </div>

        <div class="tab-panel active" id="tabPanelDetails">
          <div id="sections"></div>
        </div>
        <div class="tab-panel" id="tabPanelRelated">
          <div id="relatedLists"></div>
        </div>
        <div class="tab-panel" id="tabPanelActivity">
          <div class="card activity-list" id="activityList"></div>
        </div>

        <div class="bottom-actions" style="align-items:center;">
          <button id="closeCaseBtn" class="btn-primary">Close Case</button>
          <button id="scheduleExpertBtn" class="btn-secondary">Schedule Expert Call</button>
          <button id="sendEmailBtn" class="btn-secondary">Send Email</button>
          <span class="status" id="closeCaseStatus"></span>
        </div>
      </div>

    </div>

    <!-- Schedule Expert Call - dedicated sub-view, swaps in over #recordViewWrap. -->
    <div style="max-width: 900px; margin: 0 auto; display:none;" id="scheduleCallView">
      <div class="breadcrumb" style="display:block;">
        <a href="#" id="scBreadcrumbCases">Cases</a><span class="sep">/</span>
        <a href="#" id="scBreadcrumbCase"></a><span class="sep">/</span>
        <span class="current">Schedule Call</span>
      </div>

      <div class="card" style="padding: 14px 16px; margin-bottom: 16px;">
        <h1 style="margin:0 0 3px 0; font-size:16px; font-weight:700;">Schedule Expert Call</h1>
        <div id="scSubtitle" style="font-size:12px; color:#616161;"></div>
        <div id="scAiBannerText" class="sc-reasoning-card" style="display:none;">
          <span class="sc-reasoning-badge">AI</span>
          <span class="sc-reasoning-text"></span>
        </div>
      </div>

      <div id="scStatus" class="expert-suggest-status" style="margin-bottom: 10px;"></div>

      <div id="scOptionsSection" style="display:none;">
        <div class="sc-options-title">Suggested Times</div>
        <div id="scOptionsList" class="sc-timeline"></div>
      </div>

      <div id="scConfirmation" style="display:none;"></div>

      <div style="margin-top:16px;">
        <button id="scBackBtn" class="btn-secondary">View Case</button>
      </div>
    </div>

    <!-- Send Email - dedicated sub-view (not a docked side panel - a two-pane template browser +
         compose layout needs real width). Drafts a message and hands it to Outlook via a mailto:
         link; nothing is sent from here, no Graph/Salesforce email API, no attachments (a mailto:
         link cannot carry a file attachment - a browser/OS limit, not a scope choice), no
         "log as activity" (that implies a real EmailMessage record this prototype doesn't create). -->
    <div style="max-width: 1000px; margin: 0 auto; display:none;" id="emailView">
      <div class="breadcrumb" style="display:block;">
        <a href="#" id="emailBreadcrumbCases">Cases</a><span class="sep">/</span>
        <a href="#" id="emailBreadcrumbCase"></a><span class="sep">/</span>
        <span class="current">Send Email</span>
      </div>

      <div class="email-layout">
        <div class="card email-templates-pane">
          <div class="email-templates-header">Email Templates</div>
          <input id="emailTemplateSearch" type="text" class="email-template-search" placeholder="Search by name..." />
          <div id="emailTemplateList" class="email-template-list"></div>
        </div>

        <div class="card email-compose-pane">
          <div class="email-compose-header">
            <span>New Email</span>
            <span id="emailComposeTemplateLabel" class="email-compose-template-label"></span>
          </div>
          <div class="email-compose-body">
            <div class="field">
              <label>Related to</label>
              <div id="emailRelatedTo" class="email-related-chip"></div>
            </div>
            <div class="field">
              <label for="emailTo">To (Contact)</label>
              <input id="emailTo" type="text" placeholder="name@example.com" />
            </div>
            <div class="field">
              <label for="emailCc">Cc</label>
              <input id="emailCc" type="text" placeholder="name@example.com" />
            </div>
            <div class="field">
              <label for="emailSubject">Subject</label>
              <input id="emailSubject" type="text" />
            </div>
            <div class="field" style="flex: 1; display: flex; flex-direction: column; margin-bottom: 0;">
              <label for="emailBody">Message</label>
              <textarea id="emailBody" style="flex: 1; min-height: 130px; width: 100%; box-sizing: border-box; padding: 6px 9px; border: 1px solid #D8D9DB; border-radius: 6px; font-size: 12.5px; font-family: inherit; resize: vertical;"></textarea>
            </div>
            <div id="emailMergeLegend" class="email-merge-legend" style="display:none;">
              <div class="email-merge-legend-title">Merge fields in this template</div>
              <div id="emailMergeLegendRows"></div>
            </div>
          </div>
          <div class="panel-footer">
            <button id="emailSendBtn" class="talk-btn" type="button" style="margin-top: 0;">Open in Outlook</button>
            <button id="emailCancelBtn" class="btn-secondary" type="button">Cancel</button>
          </div>
          <div class="status" id="emailStatus" style="padding: 0 14px 12px;"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Talk to an Agent side panel: a docked flex sibling, not an overlay. -->
  <div class="side-panel-outer" id="sidePanelOuter">
    <div class="side-panel" id="sidePanel">
      <div class="panel-header">
        <span class="dot" id="panelDot" style="visibility: hidden;"></span>
        <span id="panelTitle" style="flex:1; font-weight:600; font-size: 13px;">Talk to an Agent</span>
        <button id="endChatBtn" class="end-chat-btn" style="display:none;">End Chat</button>
        <button class="panel-close" id="panelCloseBtn" aria-label="Close">&times;</button>
      </div>
      <div class="panel-body" id="panelBody">
        <!-- Filled by renderPreChatForm()/renderChatUi(). -->
      </div>
    </div>
  </div>

  <!-- Ask AI side panel - case summary + Expert__c Q&A, kept separate from the Talk to an Agent
       panel above (different backend, different lifecycle) though only one is ever open at once. -->
  <div class="side-panel-outer" id="aiPanelOuter">
    <div class="side-panel" id="aiPanel">
      <div class="panel-header">
        <span style="flex:1; font-weight:600; font-size: 13px;">&#129302; Ask AI</span>
        <button class="panel-close" id="aiPanelCloseBtn" aria-label="Close">&times;</button>
      </div>
      <div class="panel-body chat-mode" id="aiPanelBody">
        <div class="chat-messages" id="aiChatMessages"></div>
        <form class="chat-composer" id="aiChatComposer">
          <input id="aiChatInput" type="text" placeholder="Summarize this case, or ask about an expert..." autocomplete="off" />
          <button id="aiChatSendBtn" type="submit">Send</button>
        </form>
      </div>
    </div>
  </div>

</div>

<script src="https://res.cdn.office.net/teams-js/2.19.0/js/MicrosoftTeams.min.js" crossorigin="anonymous"></script>

<script>
(function () {
  var statusEl = document.getElementById('status');
  var recordViewWrapEl = document.getElementById('recordViewWrap');
  var sectionsEl = document.getElementById('sections');
  var relatedListsEl = document.getElementById('relatedLists');
  var recordLabelEl = document.getElementById('recordLabel');
  var breadcrumbEl = document.getElementById('breadcrumb');
  var breadcrumbCurrentEl = document.getElementById('breadcrumbCurrent');
  var breadcrumbCasesEl = document.getElementById('breadcrumbCases');
  var recordHeaderEl = document.getElementById('recordHeader');
  var statusPillEl = document.getElementById('statusPill');
  var openInSfLinkEl = document.getElementById('openInSfLink');
  var highlightsRowEl = document.getElementById('highlightsRow');
  var tabsWrapEl = document.getElementById('tabsWrap');
  var activityListEl = document.getElementById('activityList');
  var openSwarmChatBtn = document.getElementById('openSwarmChatBtn');

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  // Same pill-color mapping as salesforceTabHome.js's list view (copied, not shared).
  function pillColor(value) {
    if (value === 'Closed' || value === 'Closed - Completed') return { bg: '#DFF6DD', fg: '#0E700F' };
    if (value === 'New') return { bg: '#EFF6FC', fg: '#0F6CBD' };
    if (value === 'High' || value === 'Urgent') return { bg: '#FDE7E9', fg: '#C4314B' };
    if (value === 'Low') return { bg: '#F0F0F0', fg: '#616161' };
    return { bg: '#FFF4CE', fg: '#8A6D00' };
  }
  function setPill(el, value) {
    if (!value) { el.style.display = 'none'; return; }
    var c = pillColor(value);
    el.style.background = c.bg;
    el.style.color = c.fg;
    el.textContent = value;
    el.style.display = 'inline-flex';
  }

  function initials(name) {
    if (!name) return '?';
    var parts = name.trim().split(/\\s+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  // Title = highlights field 1, header pill = field 2 - both from the real Compact Layout, nothing hardcoded.
  function renderHeader(recordUrl, headerField) {
    if (headerField) setPill(statusPillEl, headerField.value);
    if (recordUrl) {
      openInSfLinkEl.href = recordUrl;
      openInSfLinkEl.style.display = 'inline-block';
    }
    recordHeaderEl.style.display = 'block';
  }

  // Only shown once a swarm chat/team actually exists and is usable (Swarm_Status__c 'Active' -
  // 'Provisioning'/'Failed'/blank all mean there's nothing real to open yet). Per CLAUDE.md,
  // Swarm_Team_Url__c is already a real, ready-to-open Teams URL (TeamsSwarmService.webUrlFor() for
  // Team swarms, Graph's own chat webUrl for Chat swarms) - never rebuilt here.
  var currentSwarmTeamUrl = null;
  function renderSwarmChatButton(teamUrl, status) {
    currentSwarmTeamUrl = (status === 'Active' && teamUrl) ? teamUrl : null;
    openSwarmChatBtn.style.display = currentSwarmTeamUrl ? 'inline-block' : 'none';
  }

  // Rest of the Compact Layout fields; an Owner-looking field gets an avatar.
  function renderHighlightsRow(highlights) {
    if (!highlights || !highlights.length) { highlightsRowEl.innerHTML = ''; return; }
    highlightsRowEl.innerHTML = highlights.map(function (f) {
      if (/Owner/.test(f.apiName) && f.value) {
        return '<div class="highlight-item highlight-owner"><span class="avatar-md">' + escapeHtml(initials(f.value)) + '</span>' +
          '<div><div class="highlight-label">' + escapeHtml(f.label) + '</div><div class="highlight-value">' + escapeHtml(f.value) + '</div></div></div>';
      }
      return '<div class="highlight-item"><div class="highlight-label">' + escapeHtml(f.label) + '</div>' +
        '<div class="highlight-value">' + escapeHtml(f.value || '\\u2014') + '</div></div>';
    }).join('');
  }

  function renderActivity(activities) {
    if (!activities || !activities.length) {
      activityListEl.innerHTML = '<div class="related-list-empty">No activity.</div>';
      return;
    }
    activityListEl.innerHTML = activities.map(function (a) {
      return '<div class="activity-row">' +
        '<div class="activity-kind">' + escapeHtml(a.kind || '') + '</div>' +
        '<div><div class="activity-subject">' + escapeHtml(a.subject || '(no subject)') +
        (a.status ? ' <span style="color:#A19F9D;font-size:11px;">&middot; ' + escapeHtml(a.status) + '</span>' : '') + '</div>' +
        '<div class="activity-date">' + escapeHtml(a.date || '') + '</div></div></div>';
    }).join('');
  }

  // Details / Related / Activity tab switcher - plain show/hide.
  document.getElementById('tabStrip').addEventListener('click', function (e) {
    var btn = e.target.closest('.rtab');
    if (!btn) return;
    document.querySelectorAll('.rtab').forEach(function (b) { b.classList.toggle('active', b === btn); });
    var target = btn.getAttribute('data-tab');
    document.getElementById('tabPanelDetails').classList.toggle('active', target === 'details');
    document.getElementById('tabPanelRelated').classList.toggle('active', target === 'related');
    document.getElementById('tabPanelActivity').classList.toggle('active', target === 'activity');
  });

  function renderRelatedLists(relatedLists) {
    relatedListsEl.innerHTML = '';
    (relatedLists || []).forEach(function (rl) {
      var card = document.createElement('div');
      card.className = 'card related-list-card';

      var title = document.createElement('div');
      title.className = 'section-title';
      title.textContent = rl.label + (rl.totalCount != null ? ' (' + rl.totalCount + ')' : '');
      card.appendChild(title);

      if (!rl.rows || !rl.rows.length) {
        var empty = document.createElement('div');
        empty.className = 'related-list-empty';
        empty.textContent = 'No records.';
        card.appendChild(empty);
      } else {
        var table = document.createElement('table');
        table.className = 'related-list-table';
        var headerRow = document.createElement('tr');
        rl.columns.forEach(function (col) {
          var th = document.createElement('th');
          th.textContent = col.label;
          headerRow.appendChild(th);
        });
        var thead = document.createElement('thead');
        thead.appendChild(headerRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        rl.rows.forEach(function (row) {
          var tr = document.createElement('tr');
          rl.columns.forEach(function (col) {
            var td = document.createElement('td');
            td.textContent = row[col.apiName] == null ? '' : String(row[col.apiName]);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        card.appendChild(table);
      }

      relatedListsEl.appendChild(card);
    });
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

    // Direct clipboard copy - microsoftTeams.pages.shareDeepLink() was tried first but proved
    // unreliable (can resolve "successfully" without actually copying anything).
    copyLinkToClipboardFallback();
  });

  // ---------------- Open swarm chat (deep-link into the REAL Teams chat, no rebuilt UI) ----------------
  // Per the plan's "Collaboration" section: once someone's already living in Teams via this tab,
  // there's no need to reproduce the caseSwarmChat*/SignalR bridge here - just hand off to the same
  // Teams client showing the actual swarm chat/Team. Same open pattern already used for mailto above.
  openSwarmChatBtn.addEventListener('click', function () {
    if (!currentSwarmTeamUrl) return;
    if (window.microsoftTeams) {
      microsoftTeams.app.openLink(currentSwarmTeamUrl);
    } else {
      window.open(currentSwarmTeamUrl, '_blank');
    }
  });

  // ---------------- Close Case (per-user session, same pattern as salesforceTabHome.js) ----------------
  // No popup login if a session is missing - just surfaces a message instead.
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

  var closeCaseBtn = document.getElementById('closeCaseBtn');
  var closeCaseStatusEl = document.getElementById('closeCaseStatus');

  closeCaseBtn.addEventListener('click', function () {
    if (!recordId || closeCaseBtn.disabled) return;
    closeCaseBtn.disabled = true;
    closeCaseBtn.textContent = 'Closing…';
    closeCaseStatusEl.className = 'status';
    closeCaseStatusEl.textContent = '';
    // "Closed" is a real picklist value (org also has "Closed - Completed"; using the plain one).
    sfCallWithRetry('PATCH', '/services/data/' + SF_API_VERSION + '/ui-api/records/' + encodeURIComponent(recordId), {
      fields: { Status: 'Closed' }
    })
      .then(function () {
        closeCaseBtn.textContent = 'Case closed';
        setPill(statusPillEl, 'Closed'); // instant top-badge feedback, no need to wait on the reload below
        // The Highlights row and the Details tab's own Status field are both built from
        // lastRecordData inside loadRecordData() - patching only the top pill (as this used to do)
        // left them showing the pre-close value until a manual reload. Same fix as Update Reason
        // already uses for exactly this reason.
        loadRecordData();
        notifyParentOfFieldChange({ Status: 'Closed' });
      })
      .catch(function (err) {
        closeCaseBtn.disabled = false;
        closeCaseBtn.textContent = 'Close Case';
        closeCaseStatusEl.className = 'status error';
        if (err.isNoSession) {
          closeCaseStatusEl.textContent = 'Open this record from the Cases list first to sign in.';
        } else {
          console.error('Failed to close case:', err);
          closeCaseStatusEl.textContent = 'Could not close the case right now.';
        }
      });
  });

  // Tells the parent tab (salesforceTabHome.js, same origin) that one or more fields on this
  // record just changed, so its own Cases list - still showing whatever it fetched when the tab
  // first opened - can patch the matching row and re-render immediately instead of the person
  // having to reload the whole page to see it. Same postMessage channel as the record-title
  // update; a real Salesforce write already happened by the time this is called, this is purely
  // about refreshing what the OTHER, already-loaded view shows.
  function notifyParentOfFieldChange(fields) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'salesforceRecordFieldsChanged', recordId: recordId, fields: fields }, window.location.origin);
      }
    } catch (e) {}
  }

  // "Cases" breadcrumb (both the main record view's and the Schedule Call sub-view's own copy of
  // it - see scBreadcrumbCases below) - was previously a dead href="#" link (the Cases list lives
  // in the parent Home tab, not in this iframe, so there was nothing for a plain link to navigate
  // to). Closes this record tab from the parent's side instead, same as clicking its own "x" would -
  // falls back to whichever list tab was open before, already-loaded, no refetch (see
  // salesforceTabHome.js's closeRecordTab/selectObjectTab).
  function closeThisRecordTab(e) {
    e.preventDefault();
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'salesforceCloseRecordTab', recordId: recordId }, window.location.origin);
      }
    } catch (e2) {}
  }
  breadcrumbCasesEl.addEventListener('click', closeThisRecordTab);

  // ---------------- Update Reason (ported from salesforceTabRecord.js) ----------------
  // Calls CaseReasonUpdateAuto (an Autolaunched flow) instead of the CaseReasonUpdate Screen Flow
  // it replaces - Screen Flows aren't reachable via the Invocable Actions REST API.
  var updateReasonBtn = document.getElementById('updateReasonBtn');
  var reasonPanel = document.getElementById('reasonPanel');
  var reasonSelect = document.getElementById('reasonSelect');
  var reasonSaveBtn = document.getElementById('reasonSaveBtn');
  var reasonCancelBtn = document.getElementById('reasonCancelBtn');
  var reasonModalCloseBtn = document.getElementById('reasonModalCloseBtn');
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

  function closeReasonModal() {
    reasonPanel.classList.remove('open');
  }
  reasonCancelBtn.addEventListener('click', closeReasonModal);
  reasonModalCloseBtn.addEventListener('click', closeReasonModal);
  reasonPanel.addEventListener('click', function (e) {
    if (e.target === reasonPanel) closeReasonModal(); // backdrop click, not a click inside the card
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
        loadRecordData(); // reflect the new value in the Details tab without a manual reload
        notifyParentOfFieldChange({ Reason__c: reasonSelect.value });
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

  // ---------------- Send Email (drafts via mailto:, Outlook or the default mail handler sends it) ----------------
  // No Graph Mail.Send scope, no Salesforce EmailMessage/quick action - this never actually sends
  // anything itself, it just hands a pre-filled draft to whatever mail app the person already
  // uses. No Attach (a mailto: link cannot carry a file attachment at all - a browser/OS limit,
  // not a scope choice) and no "log as activity" (that implies a real EmailMessage record this
  // prototype doesn't create). A dedicated view, not a docked panel, so the template browser and
  // compose form both get real width.
  var sendEmailBtn = document.getElementById('sendEmailBtn');
  var emailView = document.getElementById('emailView');
  var emailBreadcrumbCase = document.getElementById('emailBreadcrumbCase');
  var emailTemplateSearch = document.getElementById('emailTemplateSearch');
  var emailTemplateList = document.getElementById('emailTemplateList');
  var emailComposeTemplateLabel = document.getElementById('emailComposeTemplateLabel');
  var emailRelatedTo = document.getElementById('emailRelatedTo');
  var emailCancelBtn = document.getElementById('emailCancelBtn');
  var emailSendBtn = document.getElementById('emailSendBtn');
  var emailTo = document.getElementById('emailTo');
  var emailCc = document.getElementById('emailCc');
  var emailSubject = document.getElementById('emailSubject');
  var emailBody = document.getElementById('emailBody');
  var emailMergeLegend = document.getElementById('emailMergeLegend');
  var emailMergeLegendRows = document.getElementById('emailMergeLegendRows');
  var emailStatus = document.getElementById('emailStatus');
  var emailTemplatesCache = null; // fetched once, reused across view opens
  var emailContactIdCache; // undefined = not fetched yet; null = fetched, Case has no Contact
  var emailContactFieldsCache = {}; // contactId -> flat field map, fetched only when a template needs it
  var emailSelectedTemplateId = '';

  function closeEmailView() {
    emailView.style.display = 'none';
    recordViewWrapEl.style.display = 'block';
  }
  emailCancelBtn.addEventListener('click', closeEmailView);
  emailBreadcrumbCase.addEventListener('click', function (e) { e.preventDefault(); closeEmailView(); });

  function fetchEmailTemplates() {
    if (emailTemplatesCache) return Promise.resolve(emailTemplatesCache);
    return sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/query?q=' +
      encodeURIComponent('SELECT Id, Name FROM EmailTemplate WHERE IsActive = true ORDER BY Name LIMIT 200'))
      .then(function (result) {
        emailTemplatesCache = result.records || [];
        return emailTemplatesCache;
      });
  }

  // The Case's ContactId drives {!Contact.X} merge fields (name, email, etc.) - {!Case.X} fields
  // work from relatedRecordId alone, but a template can use either.
  function fetchCaseContactId() {
    if (emailContactIdCache !== undefined) return Promise.resolve(emailContactIdCache);
    var safeId = recordId.replace(/'/g, "\\\\'");
    return sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/query?q=' +
      encodeURIComponent("SELECT ContactId FROM Case WHERE Id = '" + safeId + "'"))
      .then(function (result) {
        emailContactIdCache = (result.records && result.records[0] && result.records[0].ContactId) || null;
        return emailContactIdCache;
      });
  }

  // Plain sobject GET returns every accessible field flat (no relationship traversal needed) -
  // enough to resolve {!Contact.X} tokens for the legend without knowing field names in advance.
  function fetchContactFields(contactId) {
    if (!contactId) return Promise.resolve({});
    if (emailContactFieldsCache[contactId]) return Promise.resolve(emailContactFieldsCache[contactId]);
    return sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/sobjects/Contact/' + encodeURIComponent(contactId))
      .then(function (rec) {
        emailContactFieldsCache[contactId] = rec || {};
        return emailContactFieldsCache[contactId];
      })
      .catch(function () { return {}; });
  }

  // Flattens the already-loaded Full Layout + highlights into one apiName -> value map, so the
  // merge-field legend can resolve {!Case.X} tokens without any extra query.
  function caseFieldMapFromLoadedData(data) {
    var map = {};
    (data && data.sections || []).forEach(function (section) {
      section.fields.forEach(function (f) { map[f.apiName] = f.value; });
    });
    (data && data.highlights || []).forEach(function (f) { if (map[f.apiName] === undefined) map[f.apiName] = f.value; });
    return map;
  }

  // Only Case.* and Contact.* tokens are resolved here (the two relevant types for a Case email,
  // using data already loaded or one small extra query) - the merged Subject/Body above are
  // already fully correct for every token type via Salesforce's own real merge engine
  // (CaseEmailTemplateRenderer); this legend is a supplementary, transparency-only display, so an
  // unresolved-here token (User./Organization./Sender.) just says so rather than guessing.
  function renderMergeLegend(rawSubject, rawBody, caseFieldMap, contactFieldMap) {
    var combined = (rawSubject || '') + ' ' + (rawBody || '');
    var tokens = combined.match(/\\{!\\s*[A-Za-z0-9_.]+\\s*\\}/g) || [];
    var seen = {};
    var rows = [];
    tokens.forEach(function (raw) {
      var inner = raw.replace(/[{!}]/g, '').trim();
      if (seen[inner]) return;
      seen[inner] = true;
      var dot = inner.indexOf('.');
      var obj = dot === -1 ? inner : inner.slice(0, dot);
      var field = dot === -1 ? '' : inner.slice(dot + 1);
      var value = null;
      var resolvable = false;
      if (obj === 'Case' && caseFieldMap && caseFieldMap[field] !== undefined && caseFieldMap[field] !== null) {
        value = caseFieldMap[field];
        resolvable = true;
      } else if (obj === 'Contact' && contactFieldMap && contactFieldMap[field] !== undefined && contactFieldMap[field] !== null) {
        value = contactFieldMap[field];
        resolvable = true;
      }
      rows.push({ token: inner, value: value, resolvable: resolvable });
    });

    if (!rows.length) {
      emailMergeLegend.style.display = 'none';
      return;
    }
    emailMergeLegendRows.innerHTML = rows.map(function (r) {
      return '<div class="email-merge-row">' +
        '<span class="email-merge-token">{!' + escapeHtml(r.token) + '}</span>' +
        '<span class="email-merge-value' + (r.resolvable ? '' : ' unresolved') + '">' +
        (r.resolvable ? escapeHtml(String(r.value)) : 'resolved in the message when sent') +
        '</span></div>';
    }).join('');
    emailMergeLegend.style.display = 'block';
  }

  function renderEmailTemplateList(filterText) {
    var filter = (filterText || '').trim().toLowerCase();
    var items = ['<div class="email-template-item none' + (!emailSelectedTemplateId ? ' active' : '') + '" data-id="">' +
      '<div class="name">No template - write your own</div></div>'];
    var matches = (emailTemplatesCache || [])
      .filter(function (t) { return !filter || t.Name.toLowerCase().indexOf(filter) !== -1; });
    matches.forEach(function (t) {
      items.push('<div class="email-template-item' + (t.Id === emailSelectedTemplateId ? ' active' : '') + '" data-id="' + t.Id + '">' +
        '<div class="name">' + escapeHtml(t.Name) + '</div></div>');
    });
    if (filter && !matches.length) {
      items.push('<div class="email-template-empty">No templates match "' + escapeHtml(filterText.trim()) + '".</div>');
    }
    emailTemplateList.innerHTML = items.join('');
  }

  emailTemplateSearch.addEventListener('input', function () {
    renderEmailTemplateList(emailTemplateSearch.value);
  });

  emailTemplateList.addEventListener('click', function (e) {
    var item = e.target.closest('.email-template-item');
    if (!item) return;
    selectEmailTemplate(item.getAttribute('data-id') || '');
  });

  function selectEmailTemplate(templateId) {
    emailSelectedTemplateId = templateId;
    renderEmailTemplateList(emailTemplateSearch.value);
    emailMergeLegend.style.display = 'none';
    if (!templateId) {
      emailComposeTemplateLabel.textContent = '';
      return; // "No template" - leave whatever is already typed alone
    }
    var templateMeta = (emailTemplatesCache || []).filter(function (t) { return t.Id === templateId; })[0];
    emailComposeTemplateLabel.textContent = templateMeta ? 'Template: ' + templateMeta.Name : '';
    emailStatus.className = 'status';
    emailStatus.textContent = 'Loading template&hellip;';

    fetchCaseContactId()
      .then(function (contactId) {
        var inputs = { templateId: templateId, relatedRecordId: recordId };
        if (contactId) inputs.targetObjectId = contactId;
        return Promise.all([
          sfCallWithRetry('POST', '/services/data/' + SF_API_VERSION + '/actions/custom/apex/CaseEmailTemplateRenderer', { inputs: [inputs] }),
          sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/query?q=' +
            encodeURIComponent("SELECT Subject, Body FROM EmailTemplate WHERE Id = '" + templateId.replace(/'/g, "\\\\'") + "'")),
          fetchContactFields(contactId)
        ]);
      })
      .then(function (results) {
        var renderResult = results[0];
        var rawTemplateResult = results[1];
        var contactFields = results[2];
        var outcome = renderResult && renderResult[0];
        if (!outcome || !outcome.isSuccess) {
          throw new Error((outcome && outcome.errors && outcome.errors[0] && outcome.errors[0].message) || 'Template render did not report success.');
        }
        emailSubject.value = (outcome.outputValues && outcome.outputValues.subject) || '';
        emailBody.value = (outcome.outputValues && outcome.outputValues.body) || '';
        emailStatus.textContent = '';

        var raw = rawTemplateResult.records && rawTemplateResult.records[0];
        if (raw) {
          renderMergeLegend(raw.Subject, raw.Body, caseFieldMapFromLoadedData(lastRecordData), contactFields);
        }
      })
      .catch(function (err) {
        emailStatus.className = 'status error';
        if (err.isNoSession) {
          emailStatus.textContent = 'Open this record from the Cases list first to sign in.';
        } else {
          console.error('Failed to render email template:', err);
          emailStatus.textContent = 'Could not load that template right now.';
        }
      });
  }

  sendEmailBtn.addEventListener('click', function () {
    if (!recordId) return;
    emailStatus.className = 'status';
    emailStatus.textContent = '';
    var data = lastRecordData || {};
    var titleValue = (data.highlights && data.highlights[0] && data.highlights[0].value) || data.recordLabel || recordId;
    var accountName = findFieldValueByLabel(data, 'account');
    emailBreadcrumbCase.textContent = titleValue;
    emailRelatedTo.textContent = 'Case ' + titleValue + (accountName ? ' \\u00b7 ' + accountName : '');
    emailTo.value = findFieldValueByLabel(data, 'email') || '';
    emailCc.value = '';
    emailSubject.value = 'Case ' + titleValue;
    emailBody.value = '';
    emailComposeTemplateLabel.textContent = '';
    emailMergeLegend.style.display = 'none';
    emailSelectedTemplateId = '';
    emailTemplateSearch.value = '';

    recordViewWrapEl.style.display = 'none';
    scheduleCallView.style.display = 'none';
    emailView.style.display = 'block';
    emailTo.focus();

    renderEmailTemplateList('');
    fetchEmailTemplates()
      .then(function () { renderEmailTemplateList(emailTemplateSearch.value); })
      .catch(function (err) { console.error('Failed to load email templates:', err); });
  });

  emailSendBtn.addEventListener('click', function () {
    if (!emailTo.value.trim()) {
      emailStatus.className = 'status error';
      emailStatus.textContent = 'Enter a To address first.';
      return;
    }
    var params = [];
    if (emailCc.value.trim()) params.push('cc=' + encodeURIComponent(emailCc.value.trim()));
    if (emailSubject.value.trim()) params.push('subject=' + encodeURIComponent(emailSubject.value.trim()));
    if (emailBody.value.trim()) params.push('body=' + encodeURIComponent(emailBody.value.trim()));
    var mailtoLink = 'mailto:' + encodeURIComponent(emailTo.value.trim()).replace(/%2C/g, ',') +
      (params.length ? '?' + params.join('&') : '');
    if (window.microsoftTeams) {
      microsoftTeams.app.openLink(mailtoLink);
    } else {
      window.location.href = mailtoLink;
    }
    closeEmailView();
  });

  // ---------------- Schedule Expert Call (dedicated view, AI suggestion prototype) ----------------
  // No real Graph Calendar integration (not yet granted - see the plan). "Scheduling" writes real
  // Case fields (Scheduled_Expert__c/Scheduled_Call_Slot__c) but never a real Teams meeting/invite.
  var scheduleExpertBtn = document.getElementById('scheduleExpertBtn');
  var scheduleCallView = document.getElementById('scheduleCallView');
  var scBreadcrumbCases = document.getElementById('scBreadcrumbCases');
  var scBreadcrumbCase = document.getElementById('scBreadcrumbCase');
  var scSubtitle = document.getElementById('scSubtitle');
  var scAiBannerText = document.getElementById('scAiBannerText');
  var scStatus = document.getElementById('scStatus');
  var scOptionsSection = document.getElementById('scOptionsSection');
  var scOptionsList = document.getElementById('scOptionsList');
  var scConfirmation = document.getElementById('scConfirmation');
  var scBackBtn = document.getElementById('scBackBtn');
  var lastRecordData = null; // set once loadRecordData's fetch resolves; read here for case context
  var expertsByName = {}; // populated per Schedule Call open - Salesforce Id + topic per expert name

  function buildCaseTextForAi(data) {
    var lines = [];
    lines.push((data.objectLabel || 'Case') + ': ' + (data.recordLabel || recordId));
    (data.sections || []).forEach(function (section) {
      section.fields.forEach(function (f) {
        if (f.value) lines.push(f.label + ': ' + f.value);
      });
    });
    return lines.join('\\n');
  }

  // Finds a loaded field by label (e.g. "Subject") instead of assuming one - null if not found.
  function findFieldValueByLabel(data, labelSubstr) {
    var re = new RegExp(labelSubstr, 'i');
    var found = null;
    (data && data.sections || []).forEach(function (section) {
      section.fields.forEach(function (f) {
        if (!found && f.value && re.test(f.label || '')) found = f.value;
      });
    });
    return found;
  }

  function roleForExpert(expert) {
    var firstTopic = ((expert && expert.topic) || '').split(',')[0].trim();
    return firstTopic ? firstTopic + ' SME' : 'Expert';
  }

  // The AI is told to echo an expert's name back verbatim (see salesforceExpertSuggest.js's system
  // prompt), but a model can still reformat it slightly - fall back to a trimmed/case-insensitive
  // match rather than silently losing the real Expert__c Id (and with it, Scheduled_Expert__c on
  // save) over something like different capitalization or a stray space.
  function findExpertByName(name) {
    if (!name) return {};
    if (expertsByName[name]) return expertsByName[name];
    var normalized = name.trim().toLowerCase();
    var key = Object.keys(expertsByName).filter(function (k) { return k.trim().toLowerCase() === normalized; })[0];
    return key ? expertsByName[key] : {};
  }

  function renderScOptions(options) {
    if (!options || !options.length) {
      scOptionsSection.style.display = 'none';
      scStatus.className = 'expert-suggest-status';
      scStatus.textContent = 'No good match found among the current prototype experts.';
      return;
    }
    scStatus.textContent = '';
    scOptionsSection.style.display = 'block';
    scOptionsList.innerHTML = '';
    options.forEach(function (opt, index) {
      var expert = findExpertByName(opt.name);
      var isBest = !!opt.isBestMatch || index === 0;

      var row = document.createElement('div');
      row.className = 'sc-timeline-row' + (isBest ? ' best' : '');
      row.innerHTML =
        '<span class="sc-timeline-dot"></span>' +
        '<span class="avatar-md">' + escapeHtml(initials(opt.name)) + '</span>' +
        '<div class="sc-timeline-text">' +
        '<div class="sc-timeline-who">' + escapeHtml(opt.name || 'Unknown') + ' &middot; ' + escapeHtml(roleForExpert(expert)) + '</div>' +
        '<div class="sc-timeline-slot">' + escapeHtml(opt.slot || '') + '</div>' +
        '</div>' +
        '<button type="button" class="sc-timeline-schedule-btn">Schedule</button>';
      row.querySelector('.sc-timeline-schedule-btn').addEventListener('click', function () { scheduleOption(opt, expert); });
      scOptionsList.appendChild(row);
    });
  }

  // ---- Real Outlook invite, via a deep link (no Graph Calendar permission needed - see the plan's
  // AI-agent-layer section for why a fully silent/server-side-created invite is deliberately NOT
  // built here instead: that needs Teams SSO + an On-Behalf-Of Graph token exchange +
  // Calendars.ReadWrite/OnlineMeetings.ReadWrite.All consent, a real tenant-admin decision outside
  // this app's own scope). Opens Outlook Web's own compose-event screen, pre-filled end to end -
  // subject, time, body, the expert as a required attendee (Outlook's calendar deep link DOES
  // support this via "to=", despite most public examples only showing subject/body/time - confirmed
  // live against the real endpoint, not assumed from docs) - and online=true pre-checks Outlook's
  // own "Teams meeting" toggle, so the invite carries a real Teams meeting link too. The agent only
  // has to review and hit Send; nothing is actually sent until they do. ----

  // Best-effort parse of a free-text slot into real start/end Date objects, so the invite links can
  // pre-fill an actual time instead of leaving it blank. Handles the two shapes actually seen:
  //  A) Expert__c.Available_Slots__c's own real convention - "Tue 9:00-9:30 AM ET" (3-letter weekday,
  //     no spaces around the dash, ONE trailing AM/PM shared by both times) - confirmed against the
  //     live data, not assumed; the original version of this parser only handled shape B below and
  //     silently failed on every real Expert__c record because of it.
  //  B) "Today, 2:00 PM - 2:30 PM CET" - kept as a fallback in case a slot is ever phrased this way.
  // Anything else (and any timezone abbreviation, which isn't reliably mappable to a real UTC
  // offset either way) falls back to no pre-filled time at all, rather than risk showing a WRONG
  // one. The parsed time is treated as the browser's own local time zone - a deliberate
  // simplification for this prototype, not real timezone-aware scheduling. A weekday slot resolves
  // to the NEXT occurrence of that weekday (today counts, even if that time of day has already
  // passed today - a known, simple-on-purpose rule, not calendar-aware).
  var WEEKDAY_ABBREVS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  function nextDateForWeekday(abbrev) {
    var target = WEEKDAY_ABBREVS[abbrev.toLowerCase()];
    if (target === undefined) return null;
    var d = new Date();
    d.setDate(d.getDate() + ((target - d.getDay() + 7) % 7));
    return d;
  }

  function parseSlotToDates(slot) {
    if (!slot) return null;
    var text = slot.trim();

    // Shape A: "Tue 9:00-9:30 AM ET" - one AM/PM shared by both times.
    var weekday = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\s+(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)/i.exec(text);
    if (weekday) {
      var weekdayBase = nextDateForWeekday(weekday[1]);
      if (!weekdayBase) return null;
      var sharedAmPm = weekday[6];
      function to24Shared(h, mm) {
        h = parseInt(h, 10) % 12;
        if (/pm/i.test(sharedAmPm)) h += 12;
        var d = new Date(weekdayBase);
        d.setHours(h, parseInt(mm, 10), 0, 0);
        return d;
      }
      return { start: to24Shared(weekday[2], weekday[3]), end: to24Shared(weekday[4], weekday[5]) };
    }

    // Shape B: "Today, 2:00 PM - 2:30 PM CET" - each time has its own AM/PM.
    var m = /^(Today|Tomorrow)\\s*,?\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)\\s*-\\s*(\\d{1,2}):(\\d{2})\\s*(AM|PM)/i.exec(text);
    if (m) {
      var base = new Date();
      if (/tomorrow/i.test(m[1])) base.setDate(base.getDate() + 1);
      function to24(h, mm, ap) {
        h = parseInt(h, 10) % 12;
        if (/pm/i.test(ap)) h += 12;
        var d = new Date(base);
        d.setHours(h, parseInt(mm, 10), 0, 0);
        return d;
      }
      return { start: to24(m[2], m[3], m[4]), end: to24(m[5], m[6], m[7]) };
    }

    return null;
  }

  // Local-time, no trailing "Z" - Outlook's compose link reads an unsuffixed datetime as the
  // viewer's own local time, which matches how parseSlotToDates() built it above.
  function formatForOutlookDeepLink(d) {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00';
  }

  function buildOutlookInviteUrl(opt, expert) {
    var caseLabel = (lastRecordData && lastRecordData.recordLabel) || recordId;
    var subject = 'Expert call: ' + (opt.name || 'Expert') + ' - ' + caseLabel;
    var bodyLines = [
      'Case: ' + caseLabel,
      'Expert: ' + (opt.name || '') + (expert.email ? ' (' + expert.email + ')' : ''),
      'Slot: ' + (opt.slot || '')
    ];
    if (!expert.email) {
      bodyLines.push('', 'This expert has no email on file - add their real address as an attendee before sending.');
    }
    var params = [
      'path=/calendar/action/compose',
      'rru=addevent',
      'subject=' + encodeURIComponent(subject),
      // online=true turns this into a real Teams meeting too (Outlook's own "Teams meeting" toggle,
      // pre-checked) - a genuine Teams meeting link on the invite, with no Graph Calendar
      // integration of our own needed.
      'online=true',
      'body=' + encodeURIComponent(bodyLines.join('\\n'))
    ];
    if (expert.email) params.push('to=' + encodeURIComponent(expert.email));
    var dates = parseSlotToDates(opt.slot);
    if (dates) {
      params.push('startdt=' + encodeURIComponent(formatForOutlookDeepLink(dates.start)));
      params.push('enddt=' + encodeURIComponent(formatForOutlookDeepLink(dates.end)));
    }
    return 'https://outlook.office.com/calendar/deeplink/compose?' + params.join('&');
  }

  function scheduleOption(opt, expert) {
    Array.prototype.forEach.call(scOptionsList.querySelectorAll('.sc-timeline-schedule-btn'), function (b) { b.disabled = true; });
    scStatus.className = 'expert-suggest-status';
    scStatus.textContent = 'Scheduling&hellip;';

    var fields = { Scheduled_Call_Slot__c: opt.slot || '' };
    if (expert.id) fields.Scheduled_Expert__c = expert.id;

    sfCallWithRetry('PATCH', '/services/data/' + SF_API_VERSION + '/ui-api/records/' + encodeURIComponent(recordId), { fields: fields })
      .then(function () {
        scStatus.textContent = '';
        scOptionsSection.style.display = 'none';
        scConfirmation.style.display = 'flex';
        // No separate "Create Teams meeting" button to click - scheduling IS creating the meeting,
        // one action, not two. The Outlook fallback link only appears afterward, and only if the
        // Graph creation itself didn't succeed - see createGraphCalendarInvite()'s catch below.
        scConfirmation.innerHTML =
          '<span class="sc-confirm-badge">&#10003;</span>' +
          '<div>' +
          '<div class="sc-confirm-title">Call scheduled</div>' +
          '<div class="sc-confirm-detail">' + escapeHtml(opt.name || 'Expert') + ' &middot; ' + escapeHtml(opt.slot || '') + '</div>' +
          '<div class="expert-suggest-status sc-graph-status" style="margin-top:6px;">Creating the Teams meeting…</div>' +
          '</div>';
        createGraphCalendarInvite(opt, expert, scConfirmation.querySelector('.sc-graph-status'));
      })
      .catch(function (err) {
        Array.prototype.forEach.call(scOptionsList.querySelectorAll('.sc-timeline-schedule-btn'), function (b) { b.disabled = false; });
        scStatus.className = 'expert-suggest-status error';
        scStatus.textContent = err.isNoSession
          ? 'Open this record from the Cases list first to sign in.'
          : 'Could not save the scheduled call right now.';
      });
  }

  // Appends a small "Open Outlook invite instead" recovery link right after the status element -
  // only ever shown when the automatic Graph creation below didn't succeed, never up front, so the
  // normal happy path stays a single click with nothing extra to decide between.
  function appendOutlookFallback(statusEl, opt, expert) {
    var fallback = document.createElement('button');
    fallback.type = 'button';
    fallback.className = 'btn-secondary';
    fallback.style.marginTop = '6px';
    fallback.textContent = 'Open Outlook invite instead';
    fallback.addEventListener('click', function () {
      var url = buildOutlookInviteUrl(opt, expert);
      if (window.microsoftTeams) {
        microsoftTeams.app.openLink(url);
      } else {
        window.open(url, '_blank');
      }
    });
    statusEl.parentNode.insertBefore(fallback, statusEl.nextSibling);
  }

  // Real, sent-for-real Teams meeting + calendar invite via salesforceCreateCalendarInvite.js (see
  // that file's header for the full auth chain and the two Entra setup steps it needs) - runs
  // automatically right after scheduling, no separate button/click of its own. Needs an exact
  // start/end time - unlike the Outlook deep link fallback, Graph's event API has no "leave the time
  // blank, let the person fill it in" option, so an unparseable slot stops here (with the fallback
  // offered instead) rather than a silent wrong-time guess.
  function createGraphCalendarInvite(opt, expert, statusEl) {
    if (!window.microsoftTeams || !microsoftTeams.authentication || !microsoftTeams.authentication.getAuthToken) {
      statusEl.className = 'expert-suggest-status error sc-graph-status';
      statusEl.textContent = 'Teams sign-in is not available in this context.';
      appendOutlookFallback(statusEl, opt, expert);
      return;
    }
    var dates = parseSlotToDates(opt.slot);
    if (!dates) {
      statusEl.className = 'expert-suggest-status error sc-graph-status';
      statusEl.textContent = 'Could not read an exact time from "' + (opt.slot || '') + '" - try the Outlook invite instead, or a slot in the "Today/Tomorrow, H:MM AM/PM - H:MM AM/PM" format.';
      appendOutlookFallback(statusEl, opt, expert);
      return;
    }
    if (!expert.email) {
      statusEl.className = 'expert-suggest-status error sc-graph-status';
      statusEl.textContent = 'This expert has no email on file to invite.';
      return;
    }

    statusEl.className = 'expert-suggest-status sc-graph-status';
    statusEl.textContent = 'Getting Teams sign-in…';

    var caseLabel = (lastRecordData && lastRecordData.recordLabel) || recordId;
    var timeZone = (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

    microsoftTeams.authentication.getAuthToken()
      .then(function (ssoToken) {
        statusEl.textContent = 'Creating the meeting…';
        return fetch('/api/salesforceCreateCalendarInvite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ssoToken: ssoToken,
            subject: 'Expert call: ' + (opt.name || 'Expert') + ' - ' + caseLabel,
            startIso: formatForOutlookDeepLink(dates.start),
            endIso: formatForOutlookDeepLink(dates.end),
            timeZone: timeZone,
            attendeeEmail: expert.email,
            bodyText: 'Case: ' + caseLabel + '\\nExpert: ' + (opt.name || '') + '\\nSlot: ' + (opt.slot || '')
          })
        });
      })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok) throw new Error((body && body.error) || 'Request failed: ' + res.status);
          return body;
        });
      })
      .then(function (result) {
        statusEl.className = 'expert-suggest-status sc-graph-status';
        statusEl.innerHTML = 'Meeting created and invite sent.' +
          (result.joinUrl ? ' <a href="' + escapeHtml(result.joinUrl) + '" target="_blank" rel="noopener">Join Teams meeting</a>' : '') +
          (result.webLink ? ' &middot; <a href="' + escapeHtml(result.webLink) + '" target="_blank" rel="noopener">View in Outlook</a>' : '');
      })
      .catch(function (err) {
        statusEl.className = 'expert-suggest-status error sc-graph-status';
        statusEl.textContent = (err && err.message) || 'Could not create the calendar invite right now.';
        appendOutlookFallback(statusEl, opt, expert);
      });
  }

  function loadScheduleSuggestions() {
    scStatus.className = 'expert-suggest-status';
    scStatus.textContent = 'Finding the right expert&hellip;';
    scOptionsSection.style.display = 'none';
    scAiBannerText.style.display = 'none';
    scConfirmation.style.display = 'none';

    sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/query?q=' +
      encodeURIComponent('SELECT Id, Name, Email__c, Topic__c, Bio__c, Available_Slots__c FROM Expert__c LIMIT 50'))
      .then(function (result) {
        expertsByName = {};
        var experts = (result.records || []).map(function (r) {
          expertsByName[r.Name] = { id: r.Id, topic: r.Topic__c, email: r.Email__c };
          return { name: r.Name, topic: r.Topic__c, bio: r.Bio__c, slots: r.Available_Slots__c };
        });
        if (!experts.length) {
          throw Object.assign(new Error('No experts configured.'), { isNoExperts: true });
        }
        var caseText = buildCaseTextForAi(lastRecordData || { recordLabel: recordId, sections: [] });
        return fetch('/api/salesforceExpertSuggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseText: caseText, experts: experts })
        }).then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) throw new Error((body && body.error) || 'Request failed: ' + res.status);
            return body;
          });
        });
      })
      .then(function (body) {
        if (body.summary) {
          scAiBannerText.querySelector('.sc-reasoning-text').textContent = body.summary;
          scAiBannerText.style.display = 'flex';
        }
        renderScOptions(body.options);
      })
      .catch(function (err) {
        scOptionsSection.style.display = 'none';
        scStatus.className = 'expert-suggest-status error';
        if (err.isNoSession) {
          scStatus.textContent = 'Open this record from the Cases list first to sign in.';
        } else if (err.isNoExperts) {
          scStatus.textContent = 'No prototype experts are configured yet (Expert__c has no records).';
        } else {
          console.error('Failed to get expert suggestions:', err);
          scStatus.textContent = 'Could not get a suggestion right now.';
        }
      });
  }

  function openScheduleCallView() {
    emailView.style.display = 'none'; // only one dedicated view open at a time
    recordViewWrapEl.style.display = 'none';
    scheduleCallView.style.display = 'block';
    var titleValue = (lastRecordData && lastRecordData.highlights && lastRecordData.highlights[0] && lastRecordData.highlights[0].value) || recordId;
    var subject = findFieldValueByLabel(lastRecordData, 'subject');
    scBreadcrumbCase.textContent = titleValue;
    scSubtitle.textContent = subject ? (titleValue + ' \\u00b7 ' + subject) : titleValue;
    loadScheduleSuggestions();
  }

  function closeScheduleCallView() {
    scheduleCallView.style.display = 'none';
    recordViewWrapEl.style.display = 'block';
  }

  scheduleExpertBtn.addEventListener('click', function () {
    if (!recordId) return;
    openScheduleCallView();
  });
  scBackBtn.addEventListener('click', closeScheduleCallView);
  scBreadcrumbCase.addEventListener('click', function (e) { e.preventDefault(); closeScheduleCallView(); });
  // "Cases" (the first breadcrumb crumb, not "<Case Number>" above) goes all the way back to the
  // list, same fix/reasoning as the main record view's own "Cases" breadcrumb - was dead (href="#",
  // no handler) until now.
  scBreadcrumbCases.addEventListener('click', closeThisRecordTab);

  // ---------------- Ask AI (case summary + Expert__c Q&A, via salesforceAiChat.js) ----------------
  // Same per-user Expert__c fetch as Schedule Expert Call, plus the already-loaded case data
  // (buildCaseTextForAi) - both sent as context on every turn since the relay itself is stateless.
  var askAiBtn = document.getElementById('askAiBtn');
  var aiPanelOuter = document.getElementById('aiPanelOuter');
  var aiPanelCloseBtn = document.getElementById('aiPanelCloseBtn');
  var aiChatMessages = document.getElementById('aiChatMessages');
  var aiChatInput = document.getElementById('aiChatInput');
  var aiChatSendBtn = document.getElementById('aiChatSendBtn');
  var aiConversation = []; // {role, content} turns sent so far this session
  var aiExpertsCache = null; // fetched once, reused across turns in this panel session

  function appendAiBubble(kind, text) {
    var el = document.createElement('div');
    el.className = 'bubble ' + kind;
    el.textContent = text;
    aiChatMessages.appendChild(el);
    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
    return el;
  }

  function openAiPanel() {
    closePanel(); // only one docked panel open at a time
    aiPanelOuter.classList.add('open');
    if (!aiChatMessages.children.length) {
      appendAiBubble('system', 'Ask me to summarize this case, or find the right expert - e.g. "who should handle a billing issue?"');
    }
    aiChatInput.focus();
  }
  function closeAiPanel() {
    aiPanelOuter.classList.remove('open');
  }
  askAiBtn.addEventListener('click', openAiPanel);
  aiPanelCloseBtn.addEventListener('click', closeAiPanel);

  function fetchAiExperts() {
    if (aiExpertsCache) return Promise.resolve(aiExpertsCache);
    return sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/query?q=' +
      encodeURIComponent('SELECT Id, Name, Topic__c, Bio__c, Available_Slots__c FROM Expert__c LIMIT 50'))
      .then(function (result) {
        aiExpertsCache = (result.records || []).map(function (r) {
          return { name: r.Name, topic: r.Topic__c, bio: r.Bio__c, slots: r.Available_Slots__c };
        });
        return aiExpertsCache;
      });
  }

  document.getElementById('aiChatComposer').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = aiChatInput.value.trim();
    if (!text) return;
    aiChatInput.value = '';
    appendAiBubble('me', text);
    aiConversation.push({ role: 'user', content: text });
    aiChatInput.disabled = true;
    aiChatSendBtn.disabled = true;

    fetchAiExperts()
      .then(function (experts) {
        var caseText = buildCaseTextForAi(lastRecordData || { recordLabel: recordId, sections: [] });
        return fetch('/api/salesforceAiChat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ caseText: caseText, experts: experts, history: aiConversation })
        }).then(function (res) {
          return res.json().then(function (respBody) {
            if (!res.ok) throw new Error((respBody && respBody.error) || 'Request failed: ' + res.status);
            return respBody;
          });
        });
      })
      .then(function (respBody) {
        aiConversation.push({ role: 'assistant', content: respBody.reply });
        appendAiBubble('agent', respBody.reply);
      })
      .catch(function (err) {
        if (err.isNoSession) {
          appendAiBubble('system', 'Open this record from the Cases list first to sign in.');
        } else {
          console.error('Ask AI failed:', err);
          appendAiBubble('system', 'Could not get a response right now.');
        }
      })
      .then(function () {
        aiChatInput.disabled = false;
        aiChatSendBtn.disabled = false;
        aiChatInput.focus();
      });
  });

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

  // ---------------- Record data (per-user - no more run-as backend) ----------------
  // Ported from salesforceCaseRecordFull.js (the old run-as-user backend) - now runs entirely
  // on the signed-in person's own Salesforce access.
  var MAX_RELATED_LISTS = 8; // defensive cap - Case has 6 today, most objects have far fewer
  var RELATED_LIST_PAGE_SIZE = 10;

  // Lookup fields (OwnerId, AccountId) resolve via the standard Xxx/XxxId<->Xxx__r/Xxx__c naming.
  function relationshipNameFor(apiName) {
    if (apiName.indexOf('__c', apiName.length - 3) !== -1) return apiName.slice(0, -3) + '__r';
    if (apiName.indexOf('Id', apiName.length - 2) !== -1 && apiName.length > 2) return apiName.slice(0, -2);
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

  function resolveDisplayValue(record, dottedApiName) {
    var parts = dottedApiName.split('.');
    var node = record;
    for (var i = 0; i < parts.length; i++) {
      if (!node || !node.fields || !node.fields[parts[i]]) return null;
      if (i === parts.length - 1) return resolveFieldValue(node, parts[i]);
      node = node.fields[parts[i]].value; // descend into the related record for the next segment
    }
    return null;
  }

  function extractFields(layoutView, record) {
    var fields = [];
    layoutView.sections.forEach(function (section) {
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
    });
    return fields;
  }

  function fetchRelatedLists(objectApiName, recId) {
    return sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/ui-api/related-list-info/' +
      encodeURIComponent(objectApiName))
      .catch(function () { return null; }) // best-effort - the page still works with just the sections/highlights
      .then(function (summary) {
        if (!summary) return [];
        var candidates = (summary.relatedLists || [])
          .filter(function (r) { return r.uiApiEnabledLayout !== false; })
          .slice(0, MAX_RELATED_LISTS);

        return Promise.all(candidates.map(function (rl) {
          return Promise.all([
            sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/ui-api/related-list-info/' +
              encodeURIComponent(objectApiName) + '/' + encodeURIComponent(rl.relatedListId)),
            sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/ui-api/related-list-records/' +
              encodeURIComponent(recId) + '/' + encodeURIComponent(rl.relatedListId) +
              '?pageSize=' + RELATED_LIST_PAGE_SIZE)
          ]).then(function (results) {
            var info = results[0];
            var records = results[1];
            var columns = (info.displayColumns || []).map(function (c) {
              return { apiName: c.fieldApiName, label: c.label };
            });
            var rows = (records.records || []).map(function (rec) {
              var row = { __id: rec.fields.Id ? rec.fields.Id.value : null };
              columns.forEach(function (col) { row[col.apiName] = resolveDisplayValue(rec, col.apiName); });
              return row;
            });
            return { relatedListId: rl.relatedListId, label: rl.label, columns: columns, rows: rows, totalCount: records.count };
          }).catch(function () { return null; }); // this one related list failed - skip it, don't fail the whole page
        }));
      })
      .then(function (results) {
        return (results || []).filter(Boolean).filter(function (rl) { return rl.columns.length > 0; });
      });
  }

  // Activity tab = Task/Event queried directly by WhatId (Case has no Activities related list).
  function fetchActivities(recId) {
    var safeId = recId.replace(/'/g, "\\\\'");
    var taskSoql = "SELECT Id, Subject, ActivityDate, Status, TaskSubtype FROM Task " +
      "WHERE WhatId = '" + safeId + "' ORDER BY ActivityDate DESC NULLS LAST LIMIT 20";
    var eventSoql = "SELECT Id, Subject, ActivityDate, ActivityDateTime FROM Event " +
      "WHERE WhatId = '" + safeId + "' ORDER BY ActivityDate DESC NULLS LAST LIMIT 20";
    return Promise.all([
      sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/query?q=' + encodeURIComponent(taskSoql)),
      sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/query?q=' + encodeURIComponent(eventSoql))
    ]).then(function (results) {
      var taskResult = results[0];
      var eventResult = results[1];
      var tasks = (taskResult.records || []).map(function (r) {
        return { id: r.Id, kind: r.TaskSubtype || 'Task', subject: r.Subject, date: r.ActivityDate, status: r.Status };
      });
      var events = (eventResult.records || []).map(function (r) {
        return { id: r.Id, kind: 'Event', subject: r.Subject, date: r.ActivityDate || r.ActivityDateTime, status: null };
      });
      return tasks.concat(events).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    }).catch(function () { return []; }); // best-effort - an empty Activity tab is a legitimate real state, not an error
  }

  // Swarm_Team_Url__c/Swarm_Status__c aren't on the Full/Compact layout, so record-ui never returns
  // them - a small separate fields= fetch, same best-effort pattern as fetchActivities above. Not
  // every case has been swarmed, and this permission set may not even grant these fields yet on a
  // fresh org - either way, a missing/blocked value just means the button below stays hidden.
  function fetchSwarmInfo(recId) {
    return sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/ui-api/records/' +
      encodeURIComponent(recId) + '?fields=Case.Swarm_Team_Url__c,Case.Swarm_Status__c')
      .then(function (record) {
        return {
          teamUrl: record.fields.Swarm_Team_Url__c && record.fields.Swarm_Team_Url__c.value,
          status: record.fields.Swarm_Status__c && record.fields.Swarm_Status__c.value
        };
      })
      .catch(function () { return null; });
  }

  function loadRecordData() {
    sfCallWithRetry('GET', '/services/data/' + SF_API_VERSION + '/ui-api/record-ui/' +
      encodeURIComponent(recordId) + '?layoutTypes=Full,Compact&modes=View')
      .then(function (recordUi) {
        var record = recordUi.records[recordId];
        var objectApiName = record.apiName;
        var objectInfo = recordUi.objectInfos[objectApiName];
        var recordTypeId = record.recordTypeInfo
          ? record.recordTypeInfo.recordTypeId
          : Object.keys(recordUi.layouts[objectApiName])[0];
        var layoutsForType = recordUi.layouts[objectApiName][recordTypeId];

        var allHighlights = extractFields(layoutsForType.Compact.View, record);

        var sections = layoutsForType.Full.View.sections.map(function (section) {
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

        var session = loadSfSession(); // re-read after sfCallWithRetry's possible silent refresh, for instanceUrl
        var recordLabel = record.fields.Name
          ? record.fields.Name.value
          : (record.fields.CaseNumber ? record.fields.CaseNumber.value : recordId);
        // Salesforce can't be iframed, so "Open in Salesforce" is a real new-tab link.
        var recordUrl = (session ? session.instanceUrl : SF_LOGIN_DOMAIN) + '/lightning/r/' +
          encodeURIComponent(objectApiName) + '/' + encodeURIComponent(recordId) + '/view';

        return Promise.all([
          fetchRelatedLists(objectApiName, recordId),
          fetchActivities(recordId),
          fetchSwarmInfo(recordId)
        ]).then(function (results) {
          return {
            recordId: recordId,
            objectLabel: objectInfo.label,
            recordLabel: recordLabel,
            highlights: allHighlights,
            sections: sections,
            relatedLists: results[0],
            activities: results[1],
            swarmTeamUrl: results[2] && results[2].teamUrl,
            swarmStatus: results[2] && results[2].status,
            recordUrl: recordUrl
          };
        });
      })
      .then(function (data) {
        lastRecordData = data; // read by the Schedule Expert Call handler for AI prompt context
        var allHighlights = data.highlights || [];
        // Title = highlights field 1, falls back to recordLabel if Compact Layout is empty.
        var titleValue = (allHighlights[0] && allHighlights[0].value) || data.recordLabel || recordId;
        recordLabelEl.textContent = titleValue;
        recordLabelForChat = (data.objectLabel ? (data.objectLabel + ' ') : '') + titleValue;

        breadcrumbCurrentEl.textContent = titleValue;
        breadcrumbEl.style.display = 'block';

        // Tells the parent tab (salesforceTabHome.js, same origin) this record's real title, so a
        // tab opened from a Teams deep link (which only ever starts with a bare record id) can
        // swap its placeholder for the actual Case Number instead of showing the id forever.
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage({ type: 'salesforceRecordTitle', recordId: recordId, title: titleValue }, window.location.origin);
          }
        } catch (e) {}

        renderHeader(data.recordUrl, allHighlights[1]);
        renderHighlightsRow(allHighlights.slice(2));
        renderActivity(data.activities);
        renderSwarmChatButton(data.swarmTeamUrl, data.swarmStatus);

        sectionsEl.innerHTML = ''; // loadRecordData() re-runs after Update Reason saves - clear the previous render first
        (data.sections || []).forEach(function (section) {
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

        renderRelatedLists(data.relatedLists);
        tabsWrapEl.style.display = 'block';

        statusEl.style.display = 'none';
      })
      .catch(function (err) {
        if (err.isNoSession) {
          statusEl.textContent = 'Open this record from the Cases list first to sign in.';
        } else {
          console.error('Failed to load record:', err);
          statusEl.textContent = 'Could not load this record right now.';
        }
      });
  }

  if (!recordId) {
    statusEl.textContent = 'No record id was provided.';
  } else {
    loadRecordData();
  }

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
    closeAiPanel(); // only one docked panel open at a time
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

app.http('salesforceTabRecordFull', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'salesforceTabRecordFull',
    handler: async () => {
        return {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
            body: PAGE_HTML
        };
    }
});
