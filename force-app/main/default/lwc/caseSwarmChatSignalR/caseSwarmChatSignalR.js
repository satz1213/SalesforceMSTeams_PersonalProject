/**
 * Minimal Azure SignalR JSON-protocol client for Case Swarm Chat (Option D).
 *
 * Avoids @microsoft/signalr + loadScript: under LWS that path hangs or hits
 * require/AbortController/self issues. Negotiate stays on the Azure Function;
 * this module only opens the WebSocket and dispatches hub invocations.
 *
 * Protocol: https://github.com/dotnet/aspnetcore/blob/main/src/SignalR/docs/specs/HubProtocol.md
 */
const RECORD_SEP = '\x1e';
const NEW_MESSAGE_TARGET = 'newMessage';

/**
 * @param {string} negotiateUrl https URL from Azure SignalR connection info
 * @param {string} accessToken
 * @returns {string}
 */
export function buildSignalRWebSocketUrl(negotiateUrl, accessToken) {
    if (!negotiateUrl) {
        throw new Error('Missing SignalR negotiate url');
    }
    let wsUrl = String(negotiateUrl).replace(/^http/i, 'ws');
    if (accessToken) {
        wsUrl += (wsUrl.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + encodeURIComponent(accessToken);
    }
    return wsUrl;
}

/**
 * @typedef {object} SwarmHubHandlers
 * @property {(dto: object) => void} [onMessage]
 * @property {() => void} [onReconnecting]
 * @property {() => void} [onReconnected]
 * @property {() => void} [onClose]
 * @property {() => Promise<{ url: string, accessToken: string }>} refreshConnectionInfo
 */

/**
 * Create a reconnecting hub connection for swarmChat / newMessage.
 * @param {SwarmHubHandlers} handlers
 */
export function createSwarmHubConnection(handlers) {
    let ws = null;
    let stopped = false;
    let handshakeDone = false;
    let buffer = '';
    let reconnectAttempt = 0;
    let reconnectTimerId = null;
    let connectGeneration = 0;

    const reconnectDelays = [0, 2000, 5000, 10000, 30000];

    function clearReconnectTimer() {
        if (reconnectTimerId != null) {
            clearTimeout(reconnectTimerId);
            reconnectTimerId = null;
        }
    }

    function sendJson(obj) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return;
        }
        ws.send(JSON.stringify(obj) + RECORD_SEP);
    }

    function handleFrame(raw) {
        if (!raw) {
            if (!handshakeDone) {
                handshakeDone = true;
            }
            return;
        }
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!handshakeDone) {
            // First non-empty frame after open is handshake response (usually {}).
            handshakeDone = true;
            return;
        }
        const type = msg.type;
        if (type === 1 && msg.target === NEW_MESSAGE_TARGET && Array.isArray(msg.arguments)) {
            if (handlers.onMessage) {
                handlers.onMessage(msg.arguments[0]);
            }
            return;
        }
        if (type === 6) {
            // Ping → pong
            sendJson({ type: 6 });
            return;
        }
        if (type === 7) {
            // Close
            if (ws) {
                ws.close();
            }
        }
    }

    function onSocketMessage(event) {
        buffer += typeof event.data === 'string' ? event.data : '';
        let sep;
        while ((sep = buffer.indexOf(RECORD_SEP)) >= 0) {
            const raw = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 1);
            handleFrame(raw);
        }
    }

    function connectOnce(info) {
        const generation = ++connectGeneration;
        handshakeDone = false;
        buffer = '';

        return new Promise((resolve, reject) => {
            let settled = false;
            const wsUrl = buildSignalRWebSocketUrl(info.url, info.accessToken);
            let socket;
            try {
                socket = new WebSocket(wsUrl);
            } catch (e) {
                reject(e instanceof Error ? e : new Error(String(e)));
                return;
            }
            ws = socket;

            // eslint-disable-next-line @lwc/lwc/no-async-operation
            const openTimer = setTimeout(() => {
                if (settled || generation !== connectGeneration) {
                    return;
                }
                settled = true;
                try {
                    socket.close();
                } catch (e) {
                    // ignore
                }
                reject(new Error('SignalR WebSocket open timed out'));
            }, 15000);

            socket.onopen = () => {
                try {
                    socket.send('{"protocol":"json","version":1}' + RECORD_SEP);
                } catch (e) {
                    if (!settled && generation === connectGeneration) {
                        settled = true;
                        clearTimeout(openTimer);
                        reject(e instanceof Error ? e : new Error(String(e)));
                    }
                }
            };

            socket.onmessage = (event) => {
                onSocketMessage(event);
                if (!settled && handshakeDone && generation === connectGeneration) {
                    settled = true;
                    clearTimeout(openTimer);
                    reconnectAttempt = 0;
                    resolve();
                }
            };

            socket.onerror = () => {
                // onclose will follow; only reject if handshake never completed
            };

            socket.onclose = () => {
                clearTimeout(openTimer);
                if (generation !== connectGeneration) {
                    return;
                }
                if (!settled) {
                    settled = true;
                    reject(new Error('SignalR WebSocket closed before handshake'));
                    return;
                }
                ws = null;
                if (stopped) {
                    if (handlers.onClose) {
                        handlers.onClose();
                    }
                    return;
                }
                scheduleReconnect();
            };
        });
    }

    function scheduleReconnect() {
        if (stopped) {
            return;
        }
        if (handlers.onReconnecting) {
            handlers.onReconnecting();
        }
        const delay = reconnectDelays[Math.min(reconnectAttempt, reconnectDelays.length - 1)];
        reconnectAttempt += 1;
        clearReconnectTimer();
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        reconnectTimerId = setTimeout(() => {
            reconnectTimerId = null;
            if (stopped) {
                return;
            }
            handlers
                .refreshConnectionInfo()
                .then((info) => connectOnce(info))
                .then(() => {
                    if (handlers.onReconnected) {
                        handlers.onReconnected();
                    }
                })
                .catch(() => {
                    scheduleReconnect();
                });
        }, delay);
    }

    return {
        /**
         * @param {{ url: string, accessToken: string }} info
         * @returns {Promise<void>}
         */
        start(info) {
            stopped = false;
            return connectOnce(info);
        },
        stop() {
            stopped = true;
            clearReconnectTimer();
            connectGeneration += 1;
            const socket = ws;
            ws = null;
            if (socket) {
                try {
                    socket.close();
                } catch (e) {
                    // ignore
                }
            }
            return Promise.resolve();
        }
    };
}
