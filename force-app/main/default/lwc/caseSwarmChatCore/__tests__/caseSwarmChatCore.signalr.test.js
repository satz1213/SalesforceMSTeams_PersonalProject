import { appendMessageRow, shouldSkipPolling } from '../caseSwarmChatMessages';

describe('caseSwarmChatMessages', () => {
    it('appendMessageRow dedupes by id', () => {
        const known = new Set();
        const first = appendMessageRow(known, [], {
            id: 'm1',
            body: 'hello',
            direction: 'Inbound'
        });
        const second = appendMessageRow(first.knownIds, first.messages, {
            id: 'm1',
            body: 'hello',
            direction: 'Inbound'
        });

        expect(first.isNew).toBe(true);
        expect(first.isInbound).toBe(true);
        expect(first.messages).toHaveLength(1);
        expect(second.isNew).toBe(false);
        expect(second.messages).toHaveLength(1);
    });

    it('shouldSkipPolling when SignalR is connected', () => {
        expect(shouldSkipPolling(true, true)).toBe(true);
        expect(shouldSkipPolling(true, false)).toBe(false);
        expect(shouldSkipPolling(false, true)).toBe(false);
    });
});
