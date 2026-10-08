import { LightningElement, api, wire } from "lwc";
import {
  getRecord,
  getFieldValue,
  notifyRecordUpdateAvailable
} from "lightning/uiRecordApi";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import {
  publish,
  subscribe,
  unsubscribe,
  MessageContext,
  APPLICATION_SCOPE
} from "lightning/messageService";
import CASE_SWARM_REFRESH from "@salesforce/messageChannel/CaseSwarmRefresh__c";
import listStoredMessages from "@salesforce/apex/TeamsSwarmChatController.listStoredMessages";
import syncMessages from "@salesforce/apex/TeamsSwarmChatController.syncMessages";
import sendMessage from "@salesforce/apex/TeamsSwarmChatController.sendMessage";
import getChatBridgeSession from "@salesforce/apex/TeamsSwarmChatController.getChatBridgeSession";
import endChat from "@salesforce/apex/TeamsSwarmChatController.endChat";
import LightningConfirm from "lightning/confirm";
import {
  recordHistoryPoll,
  recordSend,
  recordRateLimited,
  recordApexFallback,
  getUsageSnapshot,
  clearUsage
} from "c/swarmUsageTracker";
import { appendMessageRow, shouldSkipPolling } from "./caseSwarmChatMessages";
import { createSwarmHubConnection } from "c/caseSwarmChatSignalR";
import CASE_SWARM_STATUS from "@salesforce/schema/Case.Swarm_Status__c";
import CASE_SWARM_TYPE from "@salesforce/schema/Case.Swarm_Type__c";
import CASE_SWARM_TEAM_ID from "@salesforce/schema/Case.Swarm_Team_Id__c";
import CASE_SWARM_TEAM_URL from "@salesforce/schema/Case.Swarm_Team_Url__c";
import CASE_SWARM_BOT_URL from "@salesforce/schema/Case.Swarm_Bot_Service_Url__c";

const CASE_FIELDS = [
  CASE_SWARM_STATUS,
  CASE_SWARM_TYPE,
  CASE_SWARM_TEAM_ID,
  CASE_SWARM_TEAM_URL,
  CASE_SWARM_BOT_URL
];

/** Apex Graph poll interval when Azure bridge is off (revert path). */
const APEX_SYNC_INTERVAL_MS = 5000;
/**
 * LWC → Azure history poll (not an Apex callout). Graph's chat-message list endpoint throttles
 * at 10 requests/10s per app/tenant, shared across every open widget - 2s let a single tab eat
 * half that budget alone (confirmed live: "API calls quota exceeded! 10Per10Secs"). 5s keeps one
 * widget to 2 of the 10, leaving headroom for several concurrently-open chats.
 */
const AZURE_POLL_INTERVAL_MS = 5000;
/** After a 429 from Graph, back off this many extra poll ticks before resuming normal cadence. */
const RATE_LIMIT_BACKOFF_TICKS = 4;
/**
 * HubConnection.start can hang; overall ceiling across negotiate/connect/join.
 */
const SIGNALR_OVERALL_TIMEOUT_MS = 25000;
/**
 * Per-stage ceiling for bridgeToken/negotiate/hubStart/joinGroup.
 */
const SIGNALR_STAGE_TIMEOUT_MS = 15000;
/** When SignalR drops, wait this long before starting Azure history poll fallback. */
const SIGNALR_DISCONNECT_FALLBACK_MS = 10000;
const RECORD_REFRESH_MS = 3000;
const RECORD_REFRESH_MAX_MS = 120000;

/**
 * Shared chat body. Chat enablement comes from LDS getRecord (updates live after
 * Case Swarm starts) — not from cacheable Apex — so no page refresh is required.
 *
 * Live mode is chosen by Teams_Bot_Config via getChatBridgeSession:
 * - Azure off → Apex syncMessages polling
 * - Azure on, SignalR off → Azure chatHistory/chatSend poll
 * - Azure + SignalR on → one-shot history + SignalR push (poll only on disconnect fallback)
 *
 * Swarm_Message__c transcript is created when the agent clicks End Chat (not per live message).
 */
export default class CaseSwarmChatCore extends LightningElement {
  @api recordId;
  @api compact = false;
  @api hideIntro = false;
  /**
   * When true (floating widget), hide disabled/waiting UI until chat is fully ready
   * so users never see "awaiting" then a refresh into the real chat.
   */
  @api hideUntilReady = false;
  /** Parent (card/widget) can host End Chat; hide the toolbar copy to avoid duplicates. */
  @api hideEndChatButton = false;

  draft = "";
  messages = [];
  isLoading = false;
  isSending = false;
  isSyncing = false;
  isEndingChat = false;
  syncIntervalId;
  recordRefreshIntervalId;
  recordRefreshStartedAt;
  subscription;
  messageContext;
  wiredCaseResult;
  _lastChatEnabled;
  _lastBotReady;
  _knownMessageIds = new Set();
  _messageBaselineReady = false;
  _rateLimitBackoffTicks = 0;

  /** @type {object|null} */
  bridgeSession = null;
  useAzureBridge = false;
  useSignalR = false;
  /** Reactive for UI badge — true only while HubConnection is Connected. */
  signalRConnected = false;
  /** lastError / reconnecting hint for the badge */
  signalRStatusDetail = "";

  _hubConnection;
  _signalRFallbackTimerId;
  _signalRStarting = false;
  /** Scroll chat pane to latest after the next render (load / receive / send). */
  _scrollToLatestPending = false;

  @wire(MessageContext)
  wiredMessageContext(value) {
    this.messageContext = value;
    this.subscribeToSwarmRefresh();
  }

  @wire(getRecord, { recordId: "$recordId", fields: CASE_FIELDS })
  wiredCase(result) {
    this.wiredCaseResult = result;
    this.evaluateChatState();
  }

  renderedCallback() {
    if (!this._scrollToLatestPending) {
      return;
    }
    this._scrollToLatestPending = false;
    this.scrollChatToLatest();
  }

  /**
   * Keep the newest message in view after load, receive, or send.
   */
  requestScrollToLatest() {
    this._scrollToLatestPending = true;
  }

  scrollChatToLatest() {
    const end = this.template.querySelector('[data-id="chat-pane-end"]');
    if (end && typeof end.scrollIntoView === "function") {
      end.scrollIntoView({ block: "end", behavior: "auto" });
      return;
    }
    const pane = this.template.querySelector('[data-id="chat-pane"]');
    if (pane) {
      pane.scrollTop = pane.scrollHeight;
    }
  }

  disconnectedCallback() {
    this.stopSignalR();
    this.stopPolling();
    this.stopRecordRefreshPolling();
    if (this.subscription) {
      unsubscribe(this.subscription);
      this.subscription = null;
    }
  }

  subscribeToSwarmRefresh() {
    if (this.subscription || !this.messageContext) {
      return;
    }
    this.subscription = subscribe(
      this.messageContext,
      CASE_SWARM_REFRESH,
      (message) => this.handleSwarmRefreshMessage(message),
      { scope: APPLICATION_SCOPE }
    );
  }

  handleSwarmRefreshMessage(message) {
    if (!message?.recordId || message.recordId !== this.recordId) {
      return;
    }
    // caseSwarm is a sibling LWC, not a parent/child - under Lightning Web Security, separate
    // component trees can't rely on sharing plain JS module state (confirmed live: reading
    // swarmUsageTracker from caseSwarm came back empty even though this component had been
    // incrementing it the whole session). Respond over the message channel instead, since
    // that's this component's own copy of the tracker, where the real counts actually live.
    if (message.action === "requestUsageSummary") {
      if (this.messageContext) {
        publish(this.messageContext, CASE_SWARM_REFRESH, {
          recordId: this.recordId,
          action: "usageSummaryResponse",
          usage: getUsageSnapshot(this.recordId)
        });
      }
      return;
    }
    if (message.action === "swarmReset") {
      clearUsage(this.recordId);
      this.stopSignalR();
      this.stopPolling();
      this.messages = [];
      this._knownMessageIds = new Set();
      this._messageBaselineReady = false;
      this.bridgeSession = null;
      this.useAzureBridge = false;
      this.useSignalR = false;
      this.signalRConnected = false;
      this.refreshState();
      return;
    }
    if (message.action === "swarmStarted" && message.swarmType === "Chat") {
      this.startRecordRefreshPolling();
    }
    this.refreshState();
  }

  @api
  refreshState() {
    if (!this.recordId) {
      return Promise.resolve();
    }
    return notifyRecordUpdateAvailable([{ recordId: this.recordId }]).catch(
      () => {}
    );
  }

  startRecordRefreshPolling() {
    this.stopRecordRefreshPolling();
    this.recordRefreshStartedAt = Date.now();
    this.refreshState();
    this.recordRefreshIntervalId = setInterval(() => {
      if (
        this.chatEnabled ||
        Date.now() - this.recordRefreshStartedAt > RECORD_REFRESH_MAX_MS
      ) {
        this.stopRecordRefreshPolling();
        return;
      }
      this.refreshState();
    }, RECORD_REFRESH_MS);
  }

  stopRecordRefreshPolling() {
    if (this.recordRefreshIntervalId) {
      clearInterval(this.recordRefreshIntervalId);
      this.recordRefreshIntervalId = undefined;
    }
  }

  evaluateChatState() {
    const enabled = this.chatEnabled;
    const botReady = this.botReady;

    if (enabled && this._lastChatEnabled !== true) {
      this.dispatchEvent(new CustomEvent("chatenabled"));
      this.stopRecordRefreshPolling();
      this.loadAndSync();
    } else if (!enabled) {
      this.stopSignalR();
      this.stopPolling();
      this.bridgeSession = null;
      this.useAzureBridge = false;
      this.useSignalR = false;
    }

    if (this.isActiveChatMissingBot && this._lastBotReady !== false) {
      this.startRecordRefreshPolling();
    }

    this._lastChatEnabled = enabled;
    this._lastBotReady = botReady;
  }

  get swarmStatus() {
    return getFieldValue(this.wiredCaseResult?.data, CASE_SWARM_STATUS);
  }

  get swarmType() {
    return getFieldValue(this.wiredCaseResult?.data, CASE_SWARM_TYPE);
  }

  get chatId() {
    return getFieldValue(this.wiredCaseResult?.data, CASE_SWARM_TEAM_ID);
  }

  get teamUrl() {
    return getFieldValue(this.wiredCaseResult?.data, CASE_SWARM_TEAM_URL);
  }

  get botServiceUrl() {
    return getFieldValue(this.wiredCaseResult?.data, CASE_SWARM_BOT_URL);
  }

  get botReady() {
    return !!this.botServiceUrl;
  }

  get isActiveChatMissingBot() {
    return (
      this.swarmStatus === "Active" &&
      this.swarmType === "Chat" &&
      !!this.chatId &&
      !this.botReady
    );
  }

  get chatEnabled() {
    return (
      this.swarmStatus === "Active" &&
      this.swarmType === "Chat" &&
      !!this.chatId &&
      this.botReady
    );
  }

  get disabledReason() {
    if (!this.recordId) {
      return "No Case selected.";
    }
    if (this.wiredCaseResult?.error) {
      return "Could not load Case swarm fields.";
    }
    if (this.swarmStatus !== "Active") {
      return "Swarm is not active yet.";
    }
    if (this.swarmType !== "Chat") {
      return "Chat bridge is available for Chat swarms only. Use Open in Teams for Team swarms.";
    }
    if (!this.chatId) {
      return "This case has no Teams chat id.";
    }
    if (!this.botReady) {
      return "Waiting for the Teams bot to join this chat. Open the chat in Teams, wait for the case card, and this panel will unlock automatically.";
    }
    return "Chat is not available for this case.";
  }

  get hasMessages() {
    return this.messages.length > 0;
  }

  get isComposerDisabled() {
    return this.isSending || this.isEndingChat || !this.chatEnabled;
  }

  get isSendDisabled() {
    return this.isComposerDisabled || !this.draft?.trim();
  }

  get isEndChatDisabled() {
    return (
      this.isEndingChat || this.isSyncing || this.isSending || !this.chatEnabled
    );
  }

  get showEndChatButton() {
    return this.chatEnabled && !this.hideEndChatButton;
  }

  /**
   * Parents (Case Swarm Chat card / widget) can trigger transcript save.
   */
  @api
  endChat() {
    return this.handleEndChat();
  }

  get chatPaneClass() {
    return this.compact ? "chat-pane chat-pane_compact" : "chat-pane";
  }

  get showIntro() {
    return this.chatEnabled && !this.hideIntro;
  }

  get liveModeLabel() {
    if (this.useSignalR && this.signalRConnected) {
      return "Live: SignalR push";
    }
    if (this.useSignalR && !this.signalRConnected) {
      return this.signalRStatusDetail
        ? `SignalR: ${this.signalRStatusDetail}`
        : "SignalR: connecting / poll fallback";
    }
    if (this.useAzureBridge) {
      return "Live: Azure poll (~5s)";
    }
    return "Live: Apex poll (~5s)";
  }

  get liveModeClass() {
    if (this.useSignalR && this.signalRConnected) {
      return "live-mode live-mode_push";
    }
    if (this.useSignalR) {
      return "live-mode live-mode_warn";
    }
    return "live-mode live-mode_poll";
  }

  get introText() {
    if (this.useSignalR && this.signalRConnected) {
      return "Messages arrive instantly via Azure SignalR. Outbound posts are sent by the Teams bot and prefixed with your name.";
    }
    if (this.useSignalR) {
      return "SignalR is not connected yet — falling back to Azure history poll every few seconds until the push connection recovers.";
    }
    if (this.useAzureBridge) {
      return "Messages sync from Teams every few seconds (Azure → Graph). Outbound messages are posted by the Teams bot and prefixed with your name.";
    }
    return "Messages sync from Teams every few seconds (Apex → Graph). Outbound messages are posted by the Teams bot and prefixed with your name.";
  }

  get showBody() {
    if (!this.hideUntilReady) {
      return true;
    }
    return this.chatEnabled;
  }

  get formattedMessages() {
    return this.messages.map((m) => {
      const outbound = m.direction === "Outbound";
      return {
        ...m,
        key: m.id || m.teamsMessageId,
        bubbleClass: outbound
          ? "bubble bubble_outbound"
          : "bubble bubble_inbound",
        rowClass: outbound ? "row row_outbound" : "row row_inbound",
        metaLabel: outbound
          ? `You${m.sentAt ? " · " + this.formatTime(m.sentAt) : ""}`
          : `${m.senderDisplayName || "Teams"}${m.sentAt ? " · " + this.formatTime(m.sentAt) : ""}`
      };
    });
  }

  formatTime(value) {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }

  startPolling() {
    if (this.syncIntervalId) {
      return;
    }
    // SignalR mode: no continuous Graph poll while the hub is connected (push is primary).
    if (shouldSkipPolling(this.useSignalR, this.signalRConnected)) {
      return;
    }
    const intervalMs = this.useAzureBridge
      ? AZURE_POLL_INTERVAL_MS
      : APEX_SYNC_INTERVAL_MS;
    // Intentional live-sync timer (Azure/Apex poll fallback).
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.syncIntervalId = setInterval(() => {
      if (this._rateLimitBackoffTicks > 0) {
        this._rateLimitBackoffTicks -= 1;
        return;
      }
      this.syncQuietly();
    }, intervalMs);
  }

  stopPolling() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = undefined;
    }
  }

  restartPolling() {
    this.stopPolling();
    this.startPolling();
  }

  loadAndSync() {
    if (!this.recordId) {
      return;
    }
    this.isLoading = true;
    this._messageBaselineReady = false;
    this._knownMessageIds = new Set();

    getChatBridgeSession({ caseId: this.recordId })
      .then((session) => {
        this.bridgeSession = session;
        this.useAzureBridge = !!session?.useAzureBridge;
        this.useSignalR = !!(session?.useAzureBridge && session?.useSignalR);

        if (this.useSignalR) {
          this.stopPolling();
          return this.syncQuietly().then(() => this.startSignalR());
        }

        this.stopSignalR();
        this.restartPolling();

        if (this.useAzureBridge) {
          return this.syncQuietly();
        }
        return listStoredMessages({ caseId: this.recordId }).then((rows) => {
          this.applyMessages(rows || [], false);
          return this.syncQuietly();
        });
      })
      .catch((error) => {
        this.useAzureBridge = false;
        this.useSignalR = false;
        this.bridgeSession = null;
        this.stopSignalR();
        this.restartPolling();
        return listStoredMessages({ caseId: this.recordId })
          .then((rows) => {
            this.applyMessages(rows || [], false);
            return this.syncQuietly();
          })
          .catch((inner) =>
            this.showError("Could not load messages", inner || error)
          );
      })
      .finally(() => {
        this.isLoading = false;
      });
  }

  syncQuietly() {
    if (
      !this.chatEnabled ||
      !this.recordId ||
      this.isSyncing ||
      this.isSending
    ) {
      return Promise.resolve();
    }
    this.isSyncing = true;

    const work = this.useAzureBridge
      ? this.fetchAzureHistory()
      : this.fetchApexSync();

    return work
      .then((rows) => {
        this.applyMessages(rows || [], true);
      })
      .catch(() => {
        // Quiet poll failures.
      })
      .finally(() => {
        this.isSyncing = false;
      });
  }

  fetchApexSync() {
    recordApexFallback(this.recordId);
    return syncMessages({ caseId: this.recordId });
  }

  ensureBridgeToken() {
    const session = this.bridgeSession;
    if (!session?.useAzureBridge) {
      return Promise.resolve(null);
    }
    const nowSec = Date.now() / 1000;
    if (
      session.token &&
      session.tokenExpiresAt &&
      session.tokenExpiresAt - nowSec > 120
    ) {
      return Promise.resolve(session);
    }
    return getChatBridgeSession({ caseId: this.recordId }).then((next) => {
      this.bridgeSession = next;
      this.useAzureBridge = !!next?.useAzureBridge;
      this.useSignalR = !!(next?.useAzureBridge && next?.useSignalR);
      if (!this.useAzureBridge) {
        this.stopSignalR();
        this.restartPolling();
      }
      return next?.useAzureBridge ? next : null;
    });
  }

  fetchAzureHistory() {
    return this.ensureBridgeToken().then((session) => {
      if (!session) {
        return this.fetchApexSync();
      }
      const url =
        `${session.azureBaseUrl}${session.historyPath || "/api/chatHistory"}` +
        `?chatId=${encodeURIComponent(session.chatId)}`;
      return fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Chat-Bridge-Token": session.token
        }
      })
        .then((res) => {
          if (res.status === 429) {
            this._rateLimitBackoffTicks = RATE_LIMIT_BACKOFF_TICKS;
            recordRateLimited(this.recordId);
          }
          if (!res.ok) {
            throw new Error(`chatHistory ${res.status}`);
          }
          recordHistoryPoll(this.recordId);
          return res.json();
        })
        .then((data) => {
          const rows = (data.messages || []).map((m) => ({
            id: m.id || m.teamsMessageId,
            teamsMessageId: m.teamsMessageId || m.id,
            body: m.body,
            senderDisplayName: m.senderDisplayName,
            senderAadEmail: m.senderAadEmail || m.senderEmail || null,
            direction: m.direction || "Inbound",
            sentAt: m.sentAt
          }));
          return rows;
        });
    });
  }

  fetchNegotiate(session) {
    const url =
      `${session.azureBaseUrl}${session.negotiatePath || "/api/negotiate"}` +
      `?chatId=${encodeURIComponent(session.chatId)}`;
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-Chat-Bridge-Token": session.token,
        "x-signalr-userid": session.userId || ""
      }
    }).then((res) => {
      if (!res.ok) {
        return res
          .json()
          .catch(() => ({}))
          .then((errBody) => {
            throw new Error(errBody.error || `negotiate ${res.status}`);
          });
      }
      return res.json();
    });
  }

  refreshSignalRConnectionInfo() {
    return this.ensureBridgeToken().then((session) => {
      if (!session) {
        throw new Error("Bridge session expired");
      }
      return this.fetchNegotiate(session);
    });
  }

  joinSignalRGroup() {
    return this.ensureBridgeToken().then((session) => {
      if (!session) {
        return null;
      }
      const url = `${session.azureBaseUrl}${session.joinPath || "/api/joinChat"}`;
      return fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Chat-Bridge-Token": session.token
        },
        body: JSON.stringify({ chatId: session.chatId })
      }).then((res) => {
        if (!res.ok) {
          throw new Error(`joinChat ${res.status}`);
        }
        return res.json();
      });
    });
  }

  /**
   * Tags a rejection with which SignalR startup stage produced it. Logged once, by the
   * single catch in startSignalR() - not here too, to avoid double-logging the same failure.
   */
  tagSignalRStage(promise, stage) {
    return promise.catch((err) => {
      const tagged =
        err instanceof Error
          ? err
          : new Error(
              `${stage}: rejected with no error detail (${String(err)})`
            );
      tagged.stage = stage;
      throw tagged;
    });
  }

  boundStage(promiseFactoryResult, stage) {
    return this.tagSignalRStage(
      this.raceWithTimeout(
        promiseFactoryResult,
        SIGNALR_STAGE_TIMEOUT_MS,
        stage
      ),
      stage
    );
  }

  raceWithTimeout(promise, ms, stage) {
    return new Promise((resolve, reject) => {
      let settled = false;
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      const timerId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        const err = new Error(`${stage} timed out after ${ms}ms`);
        err.stage = stage;
        reject(err);
      }, ms);
      promise.then(
        (val) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timerId);
          resolve(val);
        },
        (err) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timerId);
          reject(err);
        }
      );
    });
  }

  startSignalR() {
    if (!this.useSignalR || this._signalRStarting || this._hubConnection) {
      return Promise.resolve();
    }
    this._signalRStarting = true;

    // Native WebSocket SignalR client (no loadScript / @microsoft/signalr). LWS repeatedly
    // hung or failed loading the static-resource browser bundle.
    const attempt = this.boundStage(this.ensureBridgeToken(), "bridgeToken")
      .then((session) => {
        if (!session) {
          throw new Error("No bridge session for SignalR");
        }
        return this.boundStage(this.fetchNegotiate(session), "negotiate").then(
          (info) => info
        );
      })
      .then((info) => {
        if (!info || !info.url || !info.accessToken) {
          throw new Error("negotiate returned no url/accessToken");
        }
        const hub = createSwarmHubConnection({
          onMessage: (dto) => this.handlePushedMessage(dto),
          onReconnecting: () => {
            this.signalRConnected = false;
            this.signalRStatusDetail = "reconnecting — poll fallback soon";
            this.scheduleSignalRFallback();
          },
          onReconnected: () => {
            this.signalRConnected = true;
            this.signalRStatusDetail = "";
            this.clearSignalRFallback();
            this.stopPolling();
            this.joinSignalRGroup()
              .then(() => this.syncQuietly())
              .catch(() => {});
          },
          onClose: () => {
            this.signalRConnected = false;
            this.signalRStatusDetail = "disconnected — using poll";
            this._hubConnection = null;
            this.scheduleSignalRFallback();
          },
          refreshConnectionInfo: () => this.refreshSignalRConnectionInfo()
        });
        this._hubConnection = hub;
        return this.boundStage(hub.start(info), "hubStart");
      })
      .then(() => {
        this.signalRConnected = true;
        this.signalRStatusDetail = "";
        this.clearSignalRFallback();
        this.stopPolling();
        return this.tagSignalRStage(this.joinSignalRGroup(), "joinGroup");
      });

    return this.raceWithTimeout(attempt, SIGNALR_OVERALL_TIMEOUT_MS, "overall")
      .catch((err) => {
        const stageTag = err && err.stage ? ` [${err.stage}]` : "";
        const detail =
          ((err && err.message) || "connection failed (see console)") +
          stageTag;
        console.error(
          "SignalR start failed; using Azure poll fallback. Raw error:",
          err
        );
        this.signalRConnected = false;
        this.signalRStatusDetail = detail.slice(0, 80);
        const hub = this._hubConnection;
        this._hubConnection = null;
        if (hub && typeof hub.stop === "function") {
          try {
            hub.stop();
          } catch {
            // ignore
          }
        }
        this.restartPolling();
      })
      .finally(() => {
        this._signalRStarting = false;
      });
  }

  stopSignalR() {
    this.clearSignalRFallback();
    this.signalRConnected = false;
    this.signalRStatusDetail = "";
    const hub = this._hubConnection;
    this._hubConnection = null;
    if (hub && typeof hub.stop === "function") {
      return hub.stop().catch(() => {});
    }
    return Promise.resolve();
  }

  scheduleSignalRFallback() {
    if (!this.useSignalR) {
      return;
    }
    if (this._signalRFallbackTimerId) {
      return;
    }
    // Intentional reconnect fallback timer (same pattern as poll intervals).
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this._signalRFallbackTimerId = setTimeout(() => {
      this._signalRFallbackTimerId = undefined;
      if (!this.signalRConnected && this.chatEnabled) {
        this.startPolling();
      }
    }, SIGNALR_DISCONNECT_FALLBACK_MS);
  }

  clearSignalRFallback() {
    if (this._signalRFallbackTimerId) {
      clearTimeout(this._signalRFallbackTimerId);
      this._signalRFallbackTimerId = undefined;
    }
  }

  handlePushedMessage(dto) {
    if (!dto || !dto.body) {
      return;
    }
    const expectedChatId = this.bridgeSession?.chatId || this.chatId;
    if (expectedChatId && dto.chatId && dto.chatId !== expectedChatId) {
      return;
    }
    this.appendPushedMessage(
      {
        id: dto.id || dto.teamsMessageId,
        teamsMessageId: dto.teamsMessageId || dto.id,
        body: dto.body,
        senderDisplayName: dto.senderDisplayName,
        direction: dto.direction || "Inbound",
        sentAt: dto.sentAt || new Date().toISOString()
      },
      true
    );
  }

  /**
   * Incremental append for SignalR push (does not replace the full list).
   * @param {object} row message DTO
   * @param {Boolean} notifyInbound
   */
  appendPushedMessage(row, notifyInbound) {
    if (!row) {
      return;
    }
    if (!this._messageBaselineReady) {
      this._knownMessageIds = new Set();
      this.messages = [];
      this._messageBaselineReady = true;
    }
    const result = appendMessageRow(this._knownMessageIds, this.messages, row);
    this._knownMessageIds = result.knownIds;
    this.messages = result.messages;
    if (result.isNew) {
      this.requestScrollToLatest();
    }

    if (notifyInbound && result.isNew && result.isInbound) {
      this.dispatchEvent(
        new CustomEvent("inboundmessage", {
          detail: {
            count: 1,
            latestBody: row.body,
            latestSender: row.senderDisplayName
          }
        })
      );
    }
  }

  /**
   * @param {Array} rows message DTOs
   * @param {Boolean} notifyInbound when true, fire event for new Inbound rows not seen before
   */
  applyMessages(rows, notifyInbound) {
    const next = rows || [];
    if (!this._messageBaselineReady) {
      this._knownMessageIds = new Set(
        next.map((m) => m.id || m.teamsMessageId).filter(Boolean)
      );
      this.messages = next;
      this._messageBaselineReady = true;
      this.requestScrollToLatest();
      return;
    }

    const newInbound = [];
    let addedAny = false;
    for (const m of next) {
      const key = m.id || m.teamsMessageId;
      if (!key || this._knownMessageIds.has(key)) {
        continue;
      }
      this._knownMessageIds.add(key);
      addedAny = true;
      if (m.direction === "Inbound") {
        newInbound.push(m);
      }
    }
    this.messages = next;
    if (addedAny) {
      this.requestScrollToLatest();
    }

    if (notifyInbound && newInbound.length > 0) {
      this.dispatchEvent(
        new CustomEvent("inboundmessage", {
          detail: {
            count: newInbound.length,
            latestBody: newInbound[newInbound.length - 1].body,
            latestSender: newInbound[newInbound.length - 1].senderDisplayName
          }
        })
      );
    }
  }

  handleDraftChange(event) {
    this.draft = event.target.value;
  }

  handleSend() {
    const body = this.draft?.trim();
    if (!body || !this.recordId) {
      return;
    }
    this.isSending = true;

    let sendPromise;
    if (this.useAzureBridge) {
      sendPromise = this.sendViaAzure(body);
    } else {
      recordApexFallback(this.recordId);
      sendPromise = sendMessage({ caseId: this.recordId, body });
    }

    sendPromise
      .then((result) => {
        // Apex sendMessage returns the stored message list; Azure send appends inside sendViaAzure.
        if (Array.isArray(result)) {
          this.applyMessages(result, false);
        }
        this.draft = "";
        // SignalR echo covers live update; avoid an extra Graph history call.
        if (
          this.useAzureBridge &&
          !(this.useSignalR && this.signalRConnected)
        ) {
          return this.syncQuietly();
        }
        return null;
      })
      .catch((error) => this.showError("Could not send message", error))
      .finally(() => {
        this.isSending = false;
      });
  }

  sendViaAzure(body) {
    return this.ensureBridgeToken().then((session) => {
      if (!session) {
        recordApexFallback(this.recordId);
        return sendMessage({ caseId: this.recordId, body });
      }
      const url = `${session.azureBaseUrl}${session.sendPath || "/api/chatSend"}`;
      return fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Chat-Bridge-Token": session.token
        },
        body: JSON.stringify({
          chatId: session.chatId,
          serviceUrl: session.serviceUrl,
          body,
          senderName: session.senderName || "Agent",
          senderAadObjectId: session.senderAadObjectId || null
        })
      })
        .then((res) => {
          if (!res.ok) {
            return res
              .json()
              .catch(() => ({}))
              .then((errBody) => {
                throw new Error(errBody.error || `chatSend ${res.status}`);
              });
          }
          recordSend(this.recordId);
          return res.json();
        })
        .then((created) => {
          // Append by id (deduped). Do NOT rebuild [...messages, created] — if the
          // SignalR chatSend echo already landed, that spread would duplicate the row
          // and applyMessages would replace the list with both copies.
          this.appendPushedMessage(
            {
              id: created.id || created.teamsMessageId,
              teamsMessageId: created.teamsMessageId || created.id,
              body: created.body || body,
              senderDisplayName:
                created.senderDisplayName || session.senderName,
              direction: "Outbound",
              sentAt: created.sentAt || new Date().toISOString()
            },
            false
          );
        });
    });
  }

  handleSyncNow() {
    if (!this.recordId) {
      return;
    }
    this.isSyncing = true;
    this.refreshState()
      .then(() =>
        this.useAzureBridge
          ? this.fetchAzureHistory()
          : syncMessages({ caseId: this.recordId })
      )
      .then((rows) => {
        this.applyMessages(rows || [], true);
      })
      .catch((error) => this.showError("Could not sync messages", error))
      .finally(() => {
        this.isSyncing = false;
      });
  }

  handleEndChat() {
    if (!this.recordId || this.isEndChatDisabled) {
      return;
    }

    LightningConfirm.open({
      message:
        "This saves the Teams conversation as Swarm Message records on the Case, clears swarm fields so the Case is ready for a new swarm, and deletes the chat in Microsoft Teams for everyone in it.",
      label: "End Chat",
      theme: "warning"
    })
      .then((confirmed) => {
        if (!confirmed) {
          return null;
        }
        this.isEndingChat = true;

        const buildPayload = (rows) =>
          (rows || [])
            .filter((m) => {
              const id = m.teamsMessageId || m.id;
              const body = typeof m.body === "string" ? m.body.trim() : m.body;
              return id && body;
            })
            .map((m) => ({
              teamsMessageId: String(m.teamsMessageId || m.id),
              body: String(m.body).trim(),
              senderDisplayName: m.senderDisplayName || null,
              senderAadEmail: m.senderAadEmail || m.senderEmail || null,
              direction: m.direction || "Inbound",
              postedByUserId: m.postedByUserId || null,
              sentAt: m.sentAt ? String(m.sentAt) : null
            }));

        // Apex endChat always Graph-pulls first; LWC payload is a merge/fallback.
        return this.refreshState().then(() => {
          const memory = this.messages || [];
          if (this.useAzureBridge) {
            return this.fetchAzureHistory()
              .catch(() => [])
              .then((rows) => {
                const byId = new Map();
                [...(rows || []), ...memory].forEach((m) => {
                  const key = m.teamsMessageId || m.id;
                  if (key) {
                    byId.set(String(key), m);
                  }
                });
                const source = byId.size ? Array.from(byId.values()) : memory;
                if (source.length) {
                  this.applyMessages(source, false);
                }
                return endChat({
                  caseId: this.recordId,
                  messages: buildPayload(source)
                });
              });
          }
          return endChat({
            caseId: this.recordId,
            messages: buildPayload(memory)
          });
        });
      })
      .then((result) => {
        if (result == null) {
          return;
        }
        const savedCount = result.savedCount || 0;
        const chatDeleteSuffix = result.chatDeleteRequested
          ? " The Teams chat is being deleted."
          : "";
        this.stopSignalR();
        this.stopPolling();
        this.messages = [];
        this._knownMessageIds = new Set();
        this._messageBaselineReady = false;
        this.bridgeSession = null;
        this.useAzureBridge = false;
        this.useSignalR = false;
        this.signalRConnected = false;
        clearUsage(this.recordId);

        if (this.messageContext) {
          publish(this.messageContext, CASE_SWARM_REFRESH, {
            recordId: this.recordId,
            action: "swarmReset"
          });
        }

        return this.refreshState().then(() => {
          this.dispatchEvent(
            new ShowToastEvent({
              title: "Chat ended",
              message:
                savedCount === 0
                  ? `Swarm fields cleared. No messages were available to save.${chatDeleteSuffix}`
                  : `Saved ${savedCount} message(s) to the Case transcript and cleared swarm fields.${chatDeleteSuffix}`,
              variant: savedCount === 0 ? "warning" : "success"
            })
          );
        });
      })
      .catch((error) => this.showError("Could not end chat", error))
      .finally(() => {
        this.isEndingChat = false;
      });
  }

  handleOpenTeams() {
    if (this.teamUrl) {
      window.open(this.teamUrl, "_blank", "noopener,noreferrer");
    }
  }

  handleComposerKeydown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.handleSend();
    }
  }

  showError(title, error) {
    const message = error?.body?.message || error?.message || "Unknown error";
    this.dispatchEvent(
      new ShowToastEvent({
        title,
        message,
        variant: "error"
      })
    );
  }
}
