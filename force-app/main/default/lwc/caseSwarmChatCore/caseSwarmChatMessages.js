/**
 * Pure helpers for chat message list merges (poll replace + SignalR push append).
 */

/**
 * @param {Set<string>} knownIds
 * @param {Array} existingMessages
 * @param {object} row
 * @returns {{ messages: Array, knownIds: Set<string>, isNew: boolean, isInbound: boolean }}
 */
export function appendMessageRow(knownIds, existingMessages, row) {
    const known = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
    const messages = Array.isArray(existingMessages) ? existingMessages : [];
    if (!row) {
        return { messages, knownIds: known, isNew: false, isInbound: false };
    }
    const key = row.id || row.teamsMessageId;
    if (!key || known.has(key)) {
        return { messages, knownIds: known, isNew: false, isInbound: false };
    }
    known.add(key);
    return {
        messages: [...messages, row],
        knownIds: known,
        isNew: true,
        isInbound: row.direction === 'Inbound'
    };
}

/**
 * When SignalR is connected, skip continuous Graph/Apex history polling — push is primary.
 * Poll resumes only on disconnect fallback.
 * @param {Boolean} useSignalR
 * @param {Boolean} signalRConnected
 * @returns {Boolean}
 */
export function shouldSkipPolling(useSignalR, signalRConnected) {
    return !!(useSignalR && signalRConnected);
}
