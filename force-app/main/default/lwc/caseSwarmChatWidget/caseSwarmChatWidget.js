import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue, notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { subscribe, unsubscribe, MessageContext, APPLICATION_SCOPE } from 'lightning/messageService';
import CASE_SWARM_REFRESH from '@salesforce/messageChannel/CaseSwarmRefresh__c';
import CASE_SWARM_STATUS from '@salesforce/schema/Case.Swarm_Status__c';
import CASE_SWARM_TYPE from '@salesforce/schema/Case.Swarm_Type__c';
import CASE_SWARM_TEAM_ID from '@salesforce/schema/Case.Swarm_Team_Id__c';
import CASE_SWARM_BOT_URL from '@salesforce/schema/Case.Swarm_Bot_Service_Url__c';

const CASE_FIELDS = [CASE_SWARM_STATUS, CASE_SWARM_TYPE, CASE_SWARM_TEAM_ID, CASE_SWARM_BOT_URL];

const TITLE_BLINK_INTERVAL_MS = 1000;
const FAVICON_BADGE_SIZE = 32;

/**
 * Floating chatbot widget. Stays collapsed until chat is ready.
 * When closed, highlights the launcher if a new Teams (Inbound) message arrives.
 * If the browser tab itself isn't visible when that happens, also blinks the tab
 * title and swaps the favicon for a badge, since the launcher highlight alone is
 * only useful if the agent is already looking at this page.
 */
export default class CaseSwarmChatWidget extends LightningElement {
    @api recordId;

    isOpen = false;
    userCollapsed = false;
    hasUnread = false;
    unreadCount = 0;
    subscription;
    messageContext;
    _openedForChatId;
    _originalTitle;
    _originalFaviconHref;
    _faviconEl;
    _titleBlinkIntervalId;
    _titleBlinkOn = false;
    _visibilityChangeHandler;

    connectedCallback() {
        this.captureOriginalTabState();
        this._visibilityChangeHandler = () => this.handleVisibilityChange();
        document.addEventListener('visibilitychange', this._visibilityChangeHandler);
    }

    @wire(MessageContext)
    wiredMessageContext(value) {
        this.messageContext = value;
        this.subscribeToSwarmRefresh();
    }

    @wire(getRecord, { recordId: '$recordId', fields: CASE_FIELDS })
    wiredCase({ data }) {
        if (!data) {
            return;
        }
        this.tryOpenWhenReady(data);
    }

    disconnectedCallback() {
        if (this.subscription) {
            unsubscribe(this.subscription);
            this.subscription = null;
        }
        this.stopAttentionSignal();
        if (this._visibilityChangeHandler) {
            document.removeEventListener('visibilitychange', this._visibilityChangeHandler);
            this._visibilityChangeHandler = undefined;
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
        notifyRecordUpdateAvailable([{ recordId: this.recordId }]).catch(() => {});
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        setTimeout(() => {
            const core = this.template.querySelector('c-case-swarm-chat-core');
            if (core) {
                core.refreshState();
            }
        }, 0);
    }

    tryOpenWhenReady(data) {
        if (this.userCollapsed) {
            return;
        }
        const status = getFieldValue(data, CASE_SWARM_STATUS);
        const type = getFieldValue(data, CASE_SWARM_TYPE);
        const chatId = getFieldValue(data, CASE_SWARM_TEAM_ID);
        const botUrl = getFieldValue(data, CASE_SWARM_BOT_URL);

        const ready = status === 'Active' && type === 'Chat' && !!chatId && !!botUrl;
        if (ready && this._openedForChatId !== chatId) {
            this._openedForChatId = chatId;
            this.isOpen = true;
            this.clearUnread();
        }
    }

    get panelClass() {
        return this.isOpen ? 'widget-panel widget-panel_open' : 'widget-panel';
    }

    get panelAriaHidden() {
        return !this.isOpen;
    }

    get launcherClass() {
        return this.hasUnread && !this.isOpen ? 'widget-launcher widget-launcher_unread' : 'widget-launcher';
    }

    get launcherLabel() {
        if (this.hasUnread && !this.isOpen) {
            return `Open swarm chat (${this.unreadCount} new)`;
        }
        return this.isOpen ? 'Close swarm chat' : 'Open swarm chat';
    }

    get launcherIcon() {
        return this.isOpen ? 'utility:close' : 'utility:chat';
    }

    get showUnreadBadge() {
        return this.hasUnread && !this.isOpen && this.unreadCount > 0;
    }

    get unreadBadgeLabel() {
        return this.unreadCount > 9 ? '9+' : String(this.unreadCount);
    }

    clearUnread() {
        this.hasUnread = false;
        this.unreadCount = 0;
        this.stopAttentionSignal();
    }

    handleToggle() {
        this.isOpen = !this.isOpen;
        this.userCollapsed = !this.isOpen;
        if (this.isOpen) {
            this.clearUnread();
            notifyRecordUpdateAvailable([{ recordId: this.recordId }]).catch(() => {});
        }
    }

    handleChatEnabled() {
        if (!this.userCollapsed) {
            this.isOpen = true;
            this.clearUnread();
        }
    }

    handleMinimize() {
        this.isOpen = false;
        this.userCollapsed = true;
    }

    handleEndChat() {
        const core = this.template.querySelector('c-case-swarm-chat-core');
        if (core && typeof core.endChat === 'function') {
            core.endChat();
        }
    }

    handleInboundMessage(event) {
        if (this.isOpen) {
            return;
        }
        const added = event.detail?.count || 1;
        this.unreadCount += added;
        this.hasUnread = true;
        if (document.hidden) {
            this.startAttentionSignal();
        }
    }

    handleVisibilityChange() {
        if (!document.hidden) {
            this.stopAttentionSignal();
        }
    }

    captureOriginalTabState() {
        if (this._originalTitle === undefined) {
            this._originalTitle = document.title;
        }
        if (!this._faviconEl) {
            // Page-level <link>, not a shadow-DOM element - this.template.querySelector can't reach it.
            // eslint-disable-next-line @lwc/lwc/no-document-query
            this._faviconEl = document.querySelector("link[rel~='icon']");
        }
        if (this._faviconEl && this._originalFaviconHref === undefined) {
            this._originalFaviconHref = this._faviconEl.href;
        }
    }

    startAttentionSignal() {
        this.captureOriginalTabState();
        this.startTitleBlink();
        this.setBadgeFavicon();
    }

    stopAttentionSignal() {
        this.stopTitleBlink();
        this.restoreFavicon();
    }

    startTitleBlink() {
        if (this._titleBlinkIntervalId || this._originalTitle === undefined) {
            return;
        }
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._titleBlinkIntervalId = setInterval(() => {
            this._titleBlinkOn = !this._titleBlinkOn;
            document.title = this._titleBlinkOn ? `(${this.unreadCount}) New message` : this._originalTitle;
        }, TITLE_BLINK_INTERVAL_MS);
    }

    stopTitleBlink() {
        if (this._titleBlinkIntervalId) {
            clearInterval(this._titleBlinkIntervalId);
            this._titleBlinkIntervalId = undefined;
        }
        this._titleBlinkOn = false;
        if (this._originalTitle !== undefined) {
            document.title = this._originalTitle;
        }
    }

    setBadgeFavicon() {
        if (!this._faviconEl) {
            return;
        }
        try {
            const dataUrl = this.buildBadgeFaviconDataUrl();
            if (dataUrl) {
                this._faviconEl.href = dataUrl;
            }
        } catch {
            // Favicon badge is a nice-to-have on top of the title blink; never let it break the widget.
        }
    }

    restoreFavicon() {
        if (this._faviconEl && this._originalFaviconHref !== undefined) {
            this._faviconEl.href = this._originalFaviconHref;
        }
    }

    /**
     * Draws a standalone red dot + count (no dependency on the current favicon image),
     * which avoids tainting the canvas with a cross-origin image just to overlay a badge.
     */
    buildBadgeFaviconDataUrl() {
        const canvas = document.createElement('canvas');
        canvas.width = FAVICON_BADGE_SIZE;
        canvas.height = FAVICON_BADGE_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }
        const radius = FAVICON_BADGE_SIZE / 2;
        ctx.beginPath();
        ctx.arc(radius, radius, radius, 0, Math.PI * 2);
        ctx.fillStyle = '#EA001E';
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const label = this.unreadCount > 9 ? '9+' : String(this.unreadCount);
        ctx.fillText(label, radius, radius + 1);
        return canvas.toDataURL('image/png');
    }
}
