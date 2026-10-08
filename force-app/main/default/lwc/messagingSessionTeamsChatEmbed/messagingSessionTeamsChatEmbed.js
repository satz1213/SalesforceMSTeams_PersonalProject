import { LightningElement, api, wire } from "lwc";
import { getRecord, getFieldValue } from "lightning/uiRecordApi";
import { refreshApex } from "@salesforce/apex";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import LightningConfirm from "lightning/confirm";
import getEmbedSession from "@salesforce/apex/MessagingSessionTeamsChatController.getEmbedSession";
import getChatSession from "@salesforce/apex/MessagingSessionTeamsChatController.getChatSession";
import endChat from "@salesforce/apex/MessagingSessionTeamsChatController.endChat";
import { createSwarmHubConnection } from "c/caseSwarmChatSignalR";
import MS_TEAMS_CHAT_ID from "@salesforce/schema/MessagingSession.Teams_Chat_Id__c";
import MS_TEAMS_CHAT_URL from "@salesforce/schema/MessagingSession.Teams_Chat_Url__c";
import MS_TEAMS_BOT_SERVICE_URL from "@salesforce/schema/MessagingSession.Teams_Bot_Service_Url__c";
import MS_STATUS from "@salesforce/schema/MessagingSession.Status";

const FIELDS = [MS_TEAMS_CHAT_ID, MS_TEAMS_CHAT_URL, MS_TEAMS_BOT_SERVICE_URL, MS_STATUS];
const WAIT_POLL_INTERVAL_MS = 5000;
const WAIT_POLL_MAX_ATTEMPTS = 18; // ~90s - generous window for bot install's webhook round trip

/**
 * Local copy of caseSwarmChatCore/caseSwarmChatMessages.js's appendMessageRow - that file lives
 * inside the caseSwarmChatCore bundle (imported there via a relative path), not as its own
 * top-level LWC module, so it isn't importable as c/caseSwarmChatMessages from here.
 */
function appendMessageRow(knownIds, existingMessages, row) {
    const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
    const messages = Array.isArray(existingMessages) ? existingMessages : [];
    if (!row) {
        return { messages, knownIds: known, isNew: false };
    }
    const key = row.id || row.teamsMessageId;
    if (!key || known.has(key)) {
        return { messages, knownIds: known, isNew: false };
    }
    known.add(key);
    return { messages: [...messages, row], knownIds: known, isNew: true };
}

/**
 * In-Salesforce chat window for the plain Teams chat MessagingSessionTeamsChatQueueable creates
 * when an agent accepts a Messaging chat - full parity with caseSwarmChatCore's live SignalR mode
 * (history + send/receive), but deliberately without that component's Apex-poll/Azure-poll
 * fallback tiers: this feature already depends on SignalR being configured for the "chat ready"
 * signal, so a simple "can't connect" state is enough here rather than three delivery modes.
 *
 * Two distinct SignalR groups are used in sequence, each needing its own minted token (see
 * MessagingSessionTeamsChatController): this MessagingSession's Id while waiting for the chat to
 * be created (getEmbedSession), then the real Teams chatId once it exists (getChatSession) -
 * chatHistory/chatSend/negotiate/joinChat are reused completely unmodified from the Case Swarm
 * Chat bridge; they're already generic on whatever chatId/group is passed in.
 */
export default class MessagingSessionTeamsChatEmbed extends LightningElement {
    @api recordId;

    wiredRecord;
    waitingListening = false;
    waitHub;
    waitPollTimerId;
    waitPollAttempts = 0;
    waitTimedOut = false;

    chatSession;
    liveInitStarted = false;
    liveConnecting = false;
    liveConnected = false;
    liveError;
    liveHub;

    messages = [];
    knownMessageIds = new Set();
    draft = "";
    isLoadingHistory = false;
    isSending = false;
    isEndingChat = false;
    chatEnded = false;

    @wire(getRecord, { recordId: "$recordId", fields: FIELDS })
    wiredRecordHandler(value) {
        this.wiredRecord = value;
        if (value.data) {
            if (this.chatExists) {
                this.stopWaitPoll();
            }
            this.maybeStartWaiting();
            this.maybeStartLiveChat();
        }
    }

    disconnectedCallback() {
        this.stopWaitHub();
        this.stopWaitPoll();
        this.stopLiveHub();
    }

    get teamsChatUrl() {
        return getFieldValue(this.wiredRecord?.data, MS_TEAMS_CHAT_URL);
    }

    get teamsChatId() {
        return getFieldValue(this.wiredRecord?.data, MS_TEAMS_CHAT_ID);
    }

    get serviceUrl() {
        return getFieldValue(this.wiredRecord?.data, MS_TEAMS_BOT_SERVICE_URL);
    }

    get status() {
        return getFieldValue(this.wiredRecord?.data, MS_STATUS);
    }

    get chatExists() {
        return !this.chatEnded && !!this.teamsChatId;
    }

    get chatPending() {
        return !this.chatEnded && this.status === "Active" && !this.chatExists;
    }

    get liveReady() {
        return !!this.chatSession?.chatReady;
    }

    get isEndChatDisabled() {
        return !this.liveReady || this.isEndingChat;
    }

    get hasMessages() {
        return this.messages.length > 0;
    }

    get formattedMessages() {
        return this.messages.map((m, index) => {
            const inbound = m.direction !== "Outbound";
            return {
                key: m.id || m.teamsMessageId || String(index),
                rowClass: inbound ? "row row_inbound" : "row row_outbound",
                bubbleClass: inbound ? "bubble bubble_inbound" : "bubble bubble_outbound",
                metaLabel: m.senderDisplayName || (inbound ? "Customer" : "Agent"),
                body: m.body
            };
        });
    }

    get isComposerDisabled() {
        return !this.liveReady || this.isSending;
    }

    get isSendDisabled() {
        return this.isComposerDisabled || !this.draft?.trim();
    }

    // ---- Phase 1: wait for the chat to be created (SignalR group = this MessagingSession's Id) ----

    maybeStartWaiting() {
        if (this.waitingListening || this.chatExists || this.status !== "Active") {
            return;
        }
        this.waitingListening = true;
        this.startWaitPoll();

        getEmbedSession({ messagingSessionId: this.recordId })
            .then((session) => {
                if (!session?.useSignalR) {
                    return null;
                }
                return this.fetchNegotiate(session).then((info) => {
                    const hub = createSwarmHubConnection({
                        onMessage: () => this.maybeStartLiveChat(),
                        refreshConnectionInfo: () => this.fetchNegotiate(session)
                    });
                    this.waitHub = hub;
                    return hub.start(info).then(() => this.joinGroup(session, this.recordId));
                });
            })
            .catch((error) => {
                // The bounded poll below is the real fallback here, not just a comment: this push
                // depends on bot install's webhook succeeding (see TeamsBotMessagingResource's
                // signalMessagingSessionChatReady doc comment), and a WebSocket can fail silently
                // for plenty of reasons unrelated to that. Without the poll, any connect failure
                // here left the component spinning on "Setting up..." forever - confirmed live.
                // eslint-disable-next-line no-console
                console.warn("messagingSessionTeamsChatEmbed: waiting-phase SignalR failed", error);
            });
    }

    stopWaitHub() {
        if (this.waitHub) {
            this.waitHub.stop();
            this.waitHub = null;
        }
    }

    /**
     * Bounded getRecord refresh, independent of whether the SignalR push above ever arrives -
     * covers both "the push never fired" (bot install still pending/failed) and "the push fired
     * but this WebSocket never connected". Stops itself once the chat shows up; if it exhausts,
     * the template falls back to a manual "Refresh" button rather than spinning forever.
     */
    startWaitPoll() {
        this.waitPollAttempts = 0;
        this.waitTimedOut = false;
        this.clearWaitPollTimer();
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this.waitPollTimerId = setInterval(() => {
            this.waitPollAttempts += 1;
            if (this.chatExists) {
                this.stopWaitPoll();
                return;
            }
            if (this.waitPollAttempts >= WAIT_POLL_MAX_ATTEMPTS) {
                this.waitTimedOut = true;
                this.stopWaitPoll();
                return;
            }
            refreshApex(this.wiredRecord).catch(() => {
                // Transient refresh failure - next tick tries again.
            });
        }, WAIT_POLL_INTERVAL_MS);
    }

    stopWaitPoll() {
        this.clearWaitPollTimer();
    }

    clearWaitPollTimer() {
        if (this.waitPollTimerId) {
            clearInterval(this.waitPollTimerId);
            this.waitPollTimerId = null;
        }
    }

    handleManualRefresh() {
        this.waitTimedOut = false;
        refreshApex(this.wiredRecord).catch(() => {
            this.waitTimedOut = true;
        });
    }

    // ---- Phase 2: chat exists - load history, allow send, listen live on the real chatId group ----

    maybeStartLiveChat() {
        if (this.liveInitStarted || !this.chatExists || !this.serviceUrl) {
            return;
        }
        this.liveInitStarted = true;
        this.stopWaitHub();

        getChatSession({ messagingSessionId: this.recordId })
            .then((session) => {
                this.chatSession = session;
                if (!session?.chatReady) {
                    return null;
                }
                return this.loadHistory(session).then(() => this.startLiveHub(session));
            })
            .catch((error) => {
                this.liveError = error?.body?.message || error?.message || "Could not start live chat.";
            });
    }

    loadHistory(session) {
        this.isLoadingHistory = true;
        const url = `${session.azureBaseUrl}${session.historyPath}?chatId=${encodeURIComponent(session.chatId)}`;
        return fetch(url, {
            method: "GET",
            headers: { Accept: "application/json", "X-Chat-Bridge-Token": session.token }
        })
            .then((res) => {
                if (!res.ok) {
                    throw new Error(`chatHistory ${res.status}`);
                }
                return res.json();
            })
            .then((data) => {
                const rows = data?.messages || [];
                let knownIds = new Set();
                let messages = [];
                rows.forEach((row) => {
                    const merged = appendMessageRow(knownIds, messages, row);
                    knownIds = merged.knownIds;
                    messages = merged.messages;
                });
                this.knownMessageIds = knownIds;
                this.messages = messages;
            })
            .catch((error) => {
                this.liveError = "Could not load chat history.";
                // eslint-disable-next-line no-console
                console.warn("messagingSessionTeamsChatEmbed: chatHistory failed", error);
            })
            .finally(() => {
                this.isLoadingHistory = false;
            });
    }

    startLiveHub(session) {
        this.liveConnecting = true;
        return this.fetchNegotiate(session)
            .then((info) => {
                const hub = createSwarmHubConnection({
                    onMessage: (dto) => this.handleIncomingMessage(dto),
                    onReconnecting: () => {
                        this.liveConnected = false;
                    },
                    onReconnected: () => {
                        this.liveConnected = true;
                    },
                    onClose: () => {
                        this.liveConnected = false;
                    },
                    refreshConnectionInfo: () => this.fetchNegotiate(session)
                });
                this.liveHub = hub;
                return hub.start(info).then(() => this.joinGroup(session, session.chatId));
            })
            .then(() => {
                this.liveConnected = true;
                this.liveError = null;
            })
            .catch((error) => {
                // Simple failure state, by design: history + send still work via plain REST calls
                // to the relay above; only the live push is unavailable.
                this.liveConnected = false;
                this.liveError = "Live updates unavailable - refresh to see new messages.";
                // eslint-disable-next-line no-console
                console.warn("messagingSessionTeamsChatEmbed: live SignalR failed", error);
            })
            .finally(() => {
                this.liveConnecting = false;
            });
    }

    stopLiveHub() {
        if (this.liveHub) {
            this.liveHub.stop();
            this.liveHub = null;
        }
    }

    handleIncomingMessage(dto) {
        const merged = appendMessageRow(this.knownMessageIds, this.messages, dto);
        this.knownMessageIds = merged.knownIds;
        if (merged.isNew) {
            this.messages = merged.messages;
        }
    }

    // ---- Shared negotiate/join helpers (identical shape to caseSwarmChatCore's) ----

    fetchNegotiate(session) {
        const url =
            `${session.azureBaseUrl}${session.negotiatePath}` +
            `?chatId=${encodeURIComponent(session.chatId || this.recordId)}`;
        return fetch(url, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "X-Chat-Bridge-Token": session.token,
                "x-signalr-userid": session.userId || ""
            }
        }).then((res) => {
            if (!res.ok) {
                throw new Error(`negotiate ${res.status}`);
            }
            return res.json();
        });
    }

    joinGroup(session, groupKey) {
        const url = `${session.azureBaseUrl}${session.joinPath}`;
        return fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-Chat-Bridge-Token": session.token
            },
            body: JSON.stringify({ chatId: groupKey })
        }).then((res) => {
            if (!res.ok) {
                throw new Error(`joinChat ${res.status}`);
            }
        });
    }

    // ---- Composer ----

    handleDraftChange(event) {
        this.draft = event.target.value;
    }

    handleComposerKeydown(event) {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            this.handleSend();
        }
    }

    handleSend() {
        const body = this.draft?.trim();
        if (!body || !this.chatSession?.chatReady) {
            return;
        }
        this.isSending = true;
        const session = this.chatSession;
        const url = `${session.azureBaseUrl}${session.sendPath}`;

        fetch(url, {
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
                senderName: session.senderName,
                senderAadObjectId: session.senderAadObjectId
            })
        })
            .then((res) => {
                if (!res.ok) {
                    throw new Error(`chatSend ${res.status}`);
                }
                return res.json();
            })
            .then((dto) => {
                this.draft = "";
                // SignalR echo (when connected) covers the live update too; appendMessageRow
                // dedupes by id so this optimistic append never double-shows the same message.
                this.handleIncomingMessage(dto);
            })
            .catch((error) => {
                this.liveError = "Could not send message.";
                // eslint-disable-next-line no-console
                console.warn("messagingSessionTeamsChatEmbed: chatSend failed", error);
            })
            .finally(() => {
                this.isSending = false;
            });
    }

    handleOpenTeams() {
        if (this.teamsChatUrl) {
            window.open(this.teamsChatUrl, "_blank", "noopener,noreferrer");
        }
    }

    // ---- End Chat: archive to Swarm_Message__c, clear Teams fields, best-effort delete ----

    async handleEndChat() {
        if (this.isEndChatDisabled) {
            return;
        }

        const confirmed = await LightningConfirm.open({
            message:
                "This saves the Teams conversation as Swarm Message records on this session and deletes the chat in Microsoft Teams for everyone in it.",
            label: "End Chat",
            theme: "warning"
        });
        if (!confirmed) {
            return;
        }

        this.isEndingChat = true;
        endChat({ messagingSessionId: this.recordId })
            .then(() => {
                this.stopWaitHub();
                this.stopWaitPoll();
                this.stopLiveHub();
                this.chatSession = null;
                this.messages = [];
                this.knownMessageIds = new Set();
                this.chatEnded = true;
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: "Chat ended",
                        message: "The Teams conversation was saved and the chat was deleted.",
                        variant: "success"
                    })
                );
            })
            .catch((error) => {
                const message = error?.body?.message || error?.message || "Unknown error";
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: "Could not end chat",
                        message,
                        variant: "error"
                    })
                );
            })
            .finally(() => {
                this.isEndingChat = false;
            });
    }
}
