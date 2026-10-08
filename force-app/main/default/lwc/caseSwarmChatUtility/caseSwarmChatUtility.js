import { LightningElement, wire, track } from 'lwc';
import { NavigationMixin, CurrentPageReference } from 'lightning/navigation';
import { subscribe, unsubscribe, MessageContext, APPLICATION_SCOPE } from 'lightning/messageService';
import {
    EnclosingUtilityId,
    updateUtility,
    onUtilityClick,
    getUtilityInfo
} from 'lightning/platformUtilityBarApi';
import CASE_SWARM_REFRESH from '@salesforce/messageChannel/CaseSwarmRefresh__c';
import listActiveChatSwarms from '@salesforce/apex/TeamsSwarmChatController.listActiveChatSwarms';
import getActiveChatSwarm from '@salesforce/apex/TeamsSwarmChatController.getActiveChatSwarm';
import { createMultiCaseWatcher } from './caseSwarmChatUtilityWatch';

const BASE_UTILITY_LABEL = 'Swarm Chat';
const ATTENTION_PULSE_MS = 900;
const UNREAD_STORAGE_KEY = 'caseSwarmUtilityUnread';
const EXTRA_STORAGE_KEY = 'caseSwarmUtilityExtraCases';
/** Retries after Chat swarm start while bot install / list visibility catches up. */
const AUTOLOAD_RETRY_MS = [0, 1500, 4000, 10000, 20000];

/**
 * Omni-style Console utility: list of Active Chat swarm Cases.
 * Click opens the Case; respond in the Case page chat UI.
 * Background SignalR watches listed chats and pulses the utility on inbound.
 * New Chat swarms auto-appear when caseSwarm publishes swarmStarted.
 */
export default class CaseSwarmChatUtility extends NavigationMixin(LightningElement) {
    @track rows = [];
    pageCaseId = null;
    manualCaseId = '';
    statusMessage = 'Loading active Chat swarms…';
    listenStatus = '';
    isLoading = false;
    subscription;
    messageContext;
    utilityId;
    _utilityClickRegistered = false;
    _watcher;
    _attentionPulseTimerId;
    _attentionPulseOn = false;
    /** @type {Record<string, number>} */
    _unreadByCaseId = {};
    /** Cases forced into the inbox (manual add or auto-load on swarm start). */
    _extraCaseIds = new Set();
    /** @type {Map<string, number[]>} caseId -> timeout ids for autoload retries */
    _autoloadTimersByCase = new Map();

    @wire(EnclosingUtilityId)
    wiredUtilityId(value) {
        this.utilityId = value;
        this.registerUtilityClickHandler();
    }

    @wire(MessageContext)
    wiredMessageContext(value) {
        this.messageContext = value;
        this.subscribeToSwarmRefresh();
    }

    @wire(CurrentPageReference)
    wiredPageRef(pageRef) {
        const fromPage = pageRef?.attributes?.recordId;
        const objectApi = pageRef?.attributes?.objectApiName;
        if (fromPage && (objectApi === 'Case' || String(fromPage).startsWith('500'))) {
            this.pageCaseId = fromPage;
            if (!this.manualCaseId) {
                this.manualCaseId = fromPage;
            }
            return;
        }
        this.pageCaseId = null;
    }

    connectedCallback() {
        this._unreadByCaseId = this.readUnreadMap();
        this._extraCaseIds = this.readExtraCaseIds();
        this._watcher = createMultiCaseWatcher({
            onInbound: (dto, caseId) => this.handleInbound(dto, caseId),
            onStatus: (msg) => {
                this.listenStatus = msg || '';
            }
        });
        this.refreshInbox();
    }

    disconnectedCallback() {
        if (this.subscription) {
            unsubscribe(this.subscription);
            this.subscription = null;
        }
        this.clearAllAutoloadTimers();
        this.stopAttentionPulse();
        if (this._watcher) {
            this._watcher.stop();
            this._watcher = null;
        }
    }

    get hasRows() {
        return this.rows.length > 0;
    }

    get displayStatus() {
        return this.statusMessage;
    }

    get totalUnread() {
        return Object.values(this._unreadByCaseId).reduce((sum, n) => sum + (n || 0), 0);
    }

    subscribeToSwarmRefresh() {
        if (this.subscription || !this.messageContext) {
            return;
        }
        try {
            this.subscription = subscribe(
                this.messageContext,
                CASE_SWARM_REFRESH,
                (message) => this.handleSwarmRefreshMessage(message),
                { scope: APPLICATION_SCOPE }
            );
        } catch (e) {
            // Keep utility usable.
        }
    }

    handleSwarmRefreshMessage(message) {
        if (!message?.recordId || !String(message.recordId).startsWith('500')) {
            return;
        }
        if (message.action === 'swarmStarted' && message.swarmType === 'Chat') {
            this.autoloadCaseFromSwarmStart(message.recordId);
            return;
        }
        if (message.action === 'swarmReset') {
            this.clearAutoloadTimers(message.recordId);
            this.clearCaseUnread(message.recordId);
            this._extraCaseIds.delete(message.recordId);
            this.persistExtraCaseIds();
            this.refreshInbox();
            return;
        }
        // Bot may have joined / fields updated — refresh known rows and pending autoloads.
        if (
            this.rows.some((r) => r.caseId === message.recordId) ||
            this._extraCaseIds.has(message.recordId)
        ) {
            this.refreshInbox();
        }
    }

    /**
     * When a Chat swarm is started on a Case page, add it to the utility inbox immediately
     * and retry until the Case is visible and (ideally) bot-ready for SignalR.
     */
    autoloadCaseFromSwarmStart(caseId) {
        if (!caseId) {
            return;
        }
        this._extraCaseIds.add(caseId);
        this.persistExtraCaseIds();
        this.statusMessage = 'New Chat swarm started — adding Case to inbox…';
        this.pulseNewSwarmAttention();
        this.clearAutoloadTimers(caseId);

        const timers = AUTOLOAD_RETRY_MS.map((delay) =>
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            setTimeout(() => {
                this.refreshInbox().then(() => {
                    const row = this.rows.find((r) => r.caseId === caseId);
                    if (row?.botReady) {
                        this.clearAutoloadTimers(caseId);
                        this.statusMessage = `Case ${row.caseNumber} loaded. Click it to open and reply.`;
                    } else if (row) {
                        this.statusMessage = `Case ${row.caseNumber} loaded — waiting for Teams bot before live alerts.`;
                    }
                });
            }, delay)
        );
        this._autoloadTimersByCase.set(caseId, timers);
    }

    clearAutoloadTimers(caseId) {
        const timers = this._autoloadTimersByCase.get(caseId);
        if (timers) {
            timers.forEach((id) => clearTimeout(id));
            this._autoloadTimersByCase.delete(caseId);
        }
    }

    clearAllAutoloadTimers() {
        this._autoloadTimersByCase.forEach((timers) => {
            timers.forEach((id) => clearTimeout(id));
        });
        this._autoloadTimersByCase.clear();
    }

    /** Short highlight so agents notice a new swarm even with 0 unread. */
    pulseNewSwarmAttention() {
        if (!this.utilityId) {
            return;
        }
        try {
            const result = updateUtility(this.utilityId, {
                label: `${BASE_UTILITY_LABEL} · new`,
                highlighted: true,
                iconVariant: 'success'
            });
            if (result && typeof result.then === 'function') {
                result.catch(() => {});
            }
        } catch (e) {
            // ignore
        }
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            if (this.totalUnread > 0) {
                this.applyUtilityAttention();
            } else {
                this.clearUtilityHighlight();
            }
        }, 4000);
    }

    handleManualIdChange(event) {
        this.manualCaseId = (event.target.value || '').trim();
    }

    handleRefresh() {
        this.refreshInbox();
    }

    handleAddCurrentCase() {
        const id = this.pageCaseId || (this.manualCaseId || '').trim();
        if (!id || !id.startsWith('500')) {
            this.statusMessage = 'Open a Case or paste a Case Id (starts with 500).';
            return;
        }
        this._extraCaseIds.add(id);
        this.persistExtraCaseIds();
        this.manualCaseId = id;
        this.refreshInbox();
    }

    handleAddManualId() {
        const id = (this.manualCaseId || '').trim();
        if (!id) {
            this.statusMessage = 'Paste a Case Id (starts with 500).';
            return;
        }
        if (!id.startsWith('500') || id.length < 15) {
            this.statusMessage = 'That does not look like a Case Id.';
            return;
        }
        this._extraCaseIds.add(id);
        this.persistExtraCaseIds();
        this.refreshInbox();
    }

    handleOpenCase(event) {
        const caseId = event.currentTarget?.dataset?.caseId;
        if (!caseId) {
            return;
        }
        this.clearCaseUnread(caseId);
        this.applyUtilityAttention();
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: {
                recordId: caseId,
                objectApiName: 'Case',
                actionName: 'view'
            }
        });
    }

    refreshInbox() {
        this.isLoading = true;
        return listActiveChatSwarms()
            .then((items) => this.mergeExtraCases(items || []))
            .then((merged) => {
                this.rows = merged.map((item) => this.toRow(item));
                if (!this._autoloadTimersByCase.size) {
                    this.statusMessage =
                        this.rows.length === 0
                            ? 'No Active Chat swarms visible. Start a Chat swarm or add a Case Id.'
                            : `${this.rows.length} Active Chat swarm(s). Click a Case to open and reply.`;
                }
                return this.restartWatcher();
            })
            .catch((err) => {
                this.statusMessage = err?.body?.message || err?.message || 'Could not load swarms.';
            })
            .finally(() => {
                this.isLoading = false;
            });
    }

    /**
     * Ensure auto-loaded / manually added Cases appear even if not in the shared list yet.
     * Keep extras across transient misses (bot still installing); drop only on definitive inactive.
     */
    mergeExtraCases(items) {
        const byId = new Map();
        (items || []).forEach((item) => {
            if (item?.caseId) {
                byId.set(item.caseId, item);
            }
        });
        const missing = [...this._extraCaseIds].filter((id) => !byId.has(id));
        if (!missing.length) {
            this.persistExtraCaseIds();
            return Promise.resolve([...byId.values()]);
        }
        return Promise.all(
            missing.map((caseId) =>
                getActiveChatSwarm({ caseId })
                    .then((item) => ({ caseId, item, ok: true }))
                    .catch(() => ({ caseId, item: null, ok: false }))
            )
        ).then((results) => {
            results.forEach(({ caseId, item, ok }) => {
                if (item) {
                    byId.set(item.caseId, item);
                    return;
                }
                // Definitive null from Apex (not an Active Chat) — stop tracking.
                // Network/Apex errors (ok=false) keep the extra for a later retry.
                if (ok) {
                    this._extraCaseIds.delete(caseId);
                    this.clearAutoloadTimers(caseId);
                }
            });
            this.persistExtraCaseIds();
            return [...byId.values()];
        });
    }

    toRow(item) {
        const unread = this._unreadByCaseId[item.caseId] || 0;
        const numberLabel = item.caseNumber || item.caseId;
        return {
            caseId: item.caseId,
            caseNumber: numberLabel,
            subject: item.subject || '',
            chatId: item.chatId,
            botReady: !!item.botReady,
            unread,
            hasUnread: unread > 0,
            unreadLabel: unread > 9 ? '9+' : String(unread),
            unreadAria: unread > 0 ? `Unread ${unread > 9 ? '9+' : unread}` : '',
            rowClass: unread > 0 ? 'swarm-row swarm-row_unread' : 'swarm-row',
            title: item.subject ? `${numberLabel} — ${item.subject}` : numberLabel
        };
    }

    restartWatcher() {
        if (!this._watcher) {
            return Promise.resolve();
        }
        return this._watcher.stop().then(() => {
            const watchCases = this.rows
                .filter((r) => r.chatId && r.botReady)
                .map((r) => ({ caseId: r.caseId, chatId: r.chatId }));
            if (!watchCases.length) {
                this.listenStatus = 'No bot-ready chats to listen to yet.';
                return null;
            }
            return this._watcher.start(watchCases);
        });
    }

    handleInbound(_dto, caseId) {
        const next = (this._unreadByCaseId[caseId] || 0) + 1;
        this._unreadByCaseId = { ...this._unreadByCaseId, [caseId]: next };
        this.persistUnreadMap();
        this.rows = this.rows.map((r) =>
            this.toRow({
                caseId: r.caseId,
                caseNumber: r.caseNumber,
                subject: r.subject,
                chatId: r.chatId,
                botReady: r.botReady
            })
        );
        this.applyUtilityAttention();
    }

    clearCaseUnread(caseId) {
        if (!caseId || !this._unreadByCaseId[caseId]) {
            this.applyUtilityAttention();
            return;
        }
        const next = { ...this._unreadByCaseId };
        delete next[caseId];
        this._unreadByCaseId = next;
        this.persistUnreadMap();
        this.rows = this.rows.map((r) =>
            this.toRow({
                caseId: r.caseId,
                caseNumber: r.caseNumber,
                subject: r.subject,
                chatId: r.chatId,
                botReady: r.botReady
            })
        );
        this.applyUtilityAttention();
    }

    readUnreadMap() {
        try {
            const raw = sessionStorage.getItem(UNREAD_STORAGE_KEY);
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    persistUnreadMap() {
        try {
            sessionStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify(this._unreadByCaseId || {}));
        } catch (e) {
            // ignore quota / private mode
        }
    }

    readExtraCaseIds() {
        try {
            const raw = sessionStorage.getItem(EXTRA_STORAGE_KEY);
            if (!raw) {
                return new Set();
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return new Set();
            }
            return new Set(parsed.filter((id) => id && String(id).startsWith('500')));
        } catch (e) {
            return new Set();
        }
    }

    persistExtraCaseIds() {
        try {
            sessionStorage.setItem(EXTRA_STORAGE_KEY, JSON.stringify([...this._extraCaseIds]));
        } catch (e) {
            // ignore
        }
    }

    registerUtilityClickHandler() {
        if (!this.utilityId || this._utilityClickRegistered) {
            return;
        }
        try {
            const result = onUtilityClick(this.utilityId, () => {
                this.syncPanelOpenState();
            });
            if (result && typeof result.then === 'function') {
                result.catch(() => {});
            }
            this._utilityClickRegistered = true;
        } catch (e) {
            // ignore
        }
    }

    syncPanelOpenState() {
        if (!this.utilityId) {
            return;
        }
        try {
            const result = getUtilityInfo(this.utilityId);
            if (result && typeof result.then === 'function') {
                result.catch(() => {});
            }
        } catch (e) {
            // ignore
        }
    }

    applyUtilityAttention() {
        const total = this.totalUnread;
        if (total <= 0) {
            this.clearUtilityHighlight();
            return;
        }
        this.pushUtilityHighlight(true, total);
        this.startAttentionPulse();
    }

    startAttentionPulse() {
        if (this._attentionPulseTimerId) {
            return;
        }
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._attentionPulseTimerId = setInterval(() => {
            if (this.totalUnread <= 0) {
                this.clearUtilityHighlight();
                return;
            }
            this._attentionPulseOn = !this._attentionPulseOn;
            this.pushUtilityHighlight(this._attentionPulseOn, this.totalUnread);
        }, ATTENTION_PULSE_MS);
    }

    stopAttentionPulse() {
        if (this._attentionPulseTimerId) {
            clearInterval(this._attentionPulseTimerId);
            this._attentionPulseTimerId = undefined;
        }
        this._attentionPulseOn = false;
    }

    pushUtilityHighlight(highlighted, total) {
        if (!this.utilityId) {
            return;
        }
        const count = total == null ? this.totalUnread : total;
        const label =
            count > 0
                ? count > 9
                    ? `${BASE_UTILITY_LABEL} (9+)`
                    : `${BASE_UTILITY_LABEL} (${count})`
                : BASE_UTILITY_LABEL;
        try {
            const attrs = highlighted
                ? { label, highlighted: true, iconVariant: 'warning' }
                : { label, highlighted: false };
            const result = updateUtility(this.utilityId, attrs);
            if (result && typeof result.then === 'function') {
                result.catch(() => {});
            }
        } catch (e) {
            // ignore
        }
    }

    clearUtilityHighlight() {
        this.stopAttentionPulse();
        if (!this.utilityId) {
            return;
        }
        try {
            const result = updateUtility(this.utilityId, {
                label: BASE_UTILITY_LABEL,
                highlighted: false
            });
            if (result && typeof result.then === 'function') {
                result.catch(() => {});
            }
        } catch (e) {
            // ignore
        }
    }
}
