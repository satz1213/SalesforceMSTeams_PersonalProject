import { buildSignalRWebSocketUrl } from '../caseSwarmChatSignalR';

describe('caseSwarmChatSignalR', () => {
    it('converts https negotiate url to wss and appends access_token', () => {
        const url = buildSignalRWebSocketUrl(
            'https://case-swarm-signalr.service.signalr.net/client/?hub=swarmChat',
            'tok&en'
        );
        expect(url).toBe(
            'wss://case-swarm-signalr.service.signalr.net/client/?hub=swarmChat&access_token=tok%26en'
        );
    });

    it('uses ? when negotiate url has no query', () => {
        const url = buildSignalRWebSocketUrl('https://example.service.signalr.net/client/', 'abc');
        expect(url).toBe('wss://example.service.signalr.net/client/?access_token=abc');
    });

    it('throws when url missing', () => {
        expect(() => buildSignalRWebSocketUrl('', 'x')).toThrow(/Missing SignalR/);
    });
});
