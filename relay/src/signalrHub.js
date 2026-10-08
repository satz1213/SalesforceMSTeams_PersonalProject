/**
 * Shared Azure SignalR bindings + message DTO helpers for Option D push.
 * Hub name must match negotiate / joinChat / message broadcasts.
 */
const { input, output } = require('@azure/functions');

const HUB_NAME = 'swarmChat';
const CONNECTION_STRING_SETTING = 'AzureSignalRConnectionString';
const NEW_MESSAGE_TARGET = 'newMessage';

/** SignalR connection-info input for negotiate (userId from request header after HMAC auth). */
const signalRConnectionInfo = input.generic({
    type: 'signalRConnectionInfo',
    name: 'connectionInfo',
    hubName: HUB_NAME,
    connectionStringSetting: CONNECTION_STRING_SETTING,
    userId: '{headers.x-signalr-userid}'
});

/** SignalR messages / group actions output. */
const signalROutput = output.generic({
    type: 'signalR',
    name: 'signalRMessages',
    hubName: HUB_NAME,
    connectionStringSetting: CONNECTION_STRING_SETTING
});

/**
 * Map a Bot Framework activity to the same DTO shape as Graph chatHistory.
 * @param {object} activity
 * @returns {object|null}
 */
function mapActivityToMessageDto(activity) {
    if (!activity || activity.type !== 'message') {
        return null;
    }
    const chatId = activity.conversation && activity.conversation.id;
    const text = extractActivityText(activity);
    if (!chatId || !text) {
        return null;
    }

    const from = activity.from || {};
    const role = String(from.role || '').toLowerCase();
    const isBot = role === 'bot' || role === 'application';
    const id = activity.id ? String(activity.id) : `bf:${Date.now()}`;

    return {
        id,
        teamsMessageId: id,
        body: text,
        senderDisplayName: from.name || (isBot ? 'Agent' : 'Teams'),
        direction: isBot ? 'Outbound' : 'Inbound',
        sentAt: activity.timestamp || new Date().toISOString(),
        chatId
    };
}

/**
 * Teams often sends plain text in activity.text; sometimes only HTML in attachments.
 * @param {object} activity
 * @returns {string}
 */
function extractActivityText(activity) {
    const direct = (activity.text || '').trim();
    if (direct) {
        return direct;
    }
    const attachments = Array.isArray(activity.attachments) ? activity.attachments : [];
    for (const att of attachments) {
        if (!att) {
            continue;
        }
        const ct = String(att.contentType || '').toLowerCase();
        if (ct === 'text/plain' && typeof att.content === 'string' && att.content.trim()) {
            return att.content.trim();
        }
        if (ct === 'text/html' && typeof att.content === 'string' && att.content.trim()) {
            return stripHtml(att.content).trim();
        }
    }
    return '';
}

function stripHtml(html) {
    return String(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"');
}

/**
 * Build a SignalR send-to-group payload for newMessage.
 * @param {string} chatId
 * @param {object} dto
 */
function newMessageToGroup(chatId, dto) {
    return {
        target: NEW_MESSAGE_TARGET,
        arguments: [dto],
        groupName: chatId
    };
}

/**
 * Build a SignalR AddToGroup action for a user.
 * @param {string} userId
 * @param {string} chatId
 */
function addUserToGroup(userId, chatId) {
    return {
        userId,
        groupName: chatId,
        action: 'add'
    };
}

module.exports = {
    HUB_NAME,
    CONNECTION_STRING_SETTING,
    NEW_MESSAGE_TARGET,
    signalRConnectionInfo,
    signalROutput,
    mapActivityToMessageDto,
    newMessageToGroup,
    addUserToGroup
};
