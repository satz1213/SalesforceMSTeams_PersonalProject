/**
 * Multi-Case SignalR watch for the Omni-style utility inbox.
 * One hub connection; joinChat per Case (HMAC token is chatId-scoped).
 */
import { createSwarmHubConnection } from 'c/caseSwarmChatSignalR';
import getChatBridgeSession from '@salesforce/apex/TeamsSwarmChatController.getChatBridgeSession';

/**
 * @typedef {object} WatchCase
 * @property {string} caseId
 * @property {string} chatId
 */

/**
 * @param {object} opts
 * @param {WatchCase[]} opts.cases
 * @param {(dto: object, caseId: string) => void} opts.onInbound
 * @param {(status: string) => void} [opts.onStatus]
 */
export function createMultiCaseWatcher(opts) {
    const onInbound = opts.onInbound;
    const onStatus = opts.onStatus || (() => {});
    /** @type {Map<string, object>} chatId -> session */
    let sessionsByChatId = new Map();
    /** @type {Map<string, string>} chatId -> caseId (first Case wins for routing) */
    let caseIdByChatId = new Map();
    /** @type {Map<string, string[]>} chatId -> all Case Ids sharing that Teams chat */
    let caseIdsByChatId = new Map();
    let hub = null;
    let primarySession = null;
    let stopped = true;
    let startGeneration = 0;

    function setStatus(msg) {
        try {
            onStatus(msg);
        } catch (e) {
            // ignore
        }
    }

    function negotiate(session) {
        const url =
            `${session.azureBaseUrl}${session.negotiatePath || '/api/negotiate'}` +
            `?chatId=${encodeURIComponent(session.chatId)}`;
        return fetch(url, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'X-Chat-Bridge-Token': session.token,
                'x-signalr-userid': session.userId || ''
            }
        }).then((res) => {
            if (!res.ok) {
                return res.json().catch(() => ({})).then((errBody) => {
                    throw new Error(errBody.error || `negotiate ${res.status}`);
                });
            }
            return res.json();
        });
    }

    function joinChat(session) {
        const url = `${session.azureBaseUrl}${session.joinPath || '/api/joinChat'}`;
        return fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-Chat-Bridge-Token': session.token
            },
            body: JSON.stringify({ chatId: session.chatId })
        }).then((res) => {
            if (!res.ok) {
                throw new Error(`joinChat ${res.status}`);
            }
            return res.json();
        });
    }

    function joinAll() {
        const joins = [];
        sessionsByChatId.forEach((session) => {
            joins.push(
                joinChat(session).catch((err) => {
                    setStatus(`Join failed for a chat: ${err?.message || err}`);
                })
            );
        });
        return Promise.all(joins);
    }

    function handleMessage(dto) {
        if (!dto || dto.direction === 'Outbound') {
            return;
        }
        const chatId = dto.chatId;
        if (!chatId) {
            return;
        }
        const caseIds = caseIdsByChatId.get(chatId);
        if (!caseIds || !caseIds.length) {
            return;
        }
        caseIds.forEach((caseId) => onInbound(dto, caseId));
    }

    function loadSessions(cases) {
        const list = Array.isArray(cases) ? cases : [];
        const nextSessions = new Map();
        const nextCaseMap = new Map();
        const nextCaseIdsMap = new Map();
        const tasks = list
            .filter((c) => c?.caseId && c?.chatId)
            .map((c) =>
                getChatBridgeSession({ caseId: c.caseId })
                    .then((session) => {
                        if (!session?.useAzureBridge || !session?.useSignalR || !session?.token) {
                            return;
                        }
                        const cid = session.chatId;
                        nextSessions.set(cid, session);
                        if (!nextCaseMap.has(cid)) {
                            nextCaseMap.set(cid, c.caseId);
                        }
                        const bucket = nextCaseIdsMap.get(cid) || [];
                        if (!bucket.includes(c.caseId)) {
                            bucket.push(c.caseId);
                        }
                        nextCaseIdsMap.set(cid, bucket);
                        if (!primarySession) {
                            primarySession = session;
                        }
                    })
                    .catch(() => {})
            );
        return Promise.all(tasks).then(() => {
            sessionsByChatId = nextSessions;
            caseIdByChatId = nextCaseMap;
            caseIdsByChatId = nextCaseIdsMap;
            if (!primarySession && nextSessions.size) {
                primarySession = nextSessions.values().next().value;
            }
        });
    }

    function refreshConnectionInfo() {
        if (!primarySession?.chatId) {
            return Promise.reject(new Error('No primary session'));
        }
        return getChatBridgeSession({ caseId: caseIdByChatId.get(primarySession.chatId) }).then(
            (session) => {
                if (!session?.token) {
                    throw new Error('Session refresh failed');
                }
                primarySession = session;
                sessionsByChatId.set(session.chatId, session);
                return negotiate(session);
            }
        );
    }

    return {
        /**
         * @param {WatchCase[]} cases
         */
        start(cases) {
            stopped = false;
            const generation = ++startGeneration;
            primarySession = null;
            setStatus('Connecting…');
            return loadSessions(cases)
                .then(() => {
                    if (stopped || generation !== startGeneration) {
                        return null;
                    }
                    if (!primarySession) {
                        setStatus('Live alerts need Azure SignalR (enable Use_Azure_SignalR__c).');
                        return null;
                    }
                    hub = createSwarmHubConnection({
                        onMessage: handleMessage,
                        onReconnecting: () => setStatus('Reconnecting…'),
                        onReconnected: () => {
                            setStatus('Listening');
                            joinAll();
                        },
                        onClose: () => setStatus('Disconnected'),
                        refreshConnectionInfo
                    });
                    return negotiate(primarySession).then((info) => {
                        if (stopped || generation !== startGeneration) {
                            return null;
                        }
                        return hub.start(info).then(() => joinAll());
                    });
                })
                .then(() => {
                    if (stopped || generation !== startGeneration) {
                        return;
                    }
                    if (sessionsByChatId.size) {
                        setStatus(`Listening to ${sessionsByChatId.size} chat(s)`);
                    }
                })
                .catch((err) => {
                    setStatus(err?.message || 'SignalR watch failed');
                });
        },
        stop() {
            stopped = true;
            startGeneration += 1;
            const current = hub;
            hub = null;
            sessionsByChatId = new Map();
            caseIdByChatId = new Map();
            caseIdsByChatId = new Map();
            primarySession = null;
            if (current) {
                return current.stop();
            }
            return Promise.resolve();
        }
    };
}
