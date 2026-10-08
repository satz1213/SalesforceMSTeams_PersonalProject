/**
 * SignalR negotiate: returns Azure SignalR URL + access token for the LWC client.
 * Route must end in /negotiate (SignalR JS client / Azure Functions convention).
 * Auth: existing chat-bridge HMAC; userId header must match token payload.
 */
const { app } = require('@azure/functions');
const { validateBridgeToken, corsHeaders } = require('../bridgeAuth');
const { signalRConnectionInfo } = require('../signalrHub');

app.http('negotiate', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'negotiate',
    extraInputs: [signalRConnectionInfo],
    handler: async (request, context) => {
        const origin = request.headers.get('origin') || '';
        const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

        if (request.method === 'OPTIONS') {
            return { status: 204, headers };
        }

        if (!process.env.AzureSignalRConnectionString) {
            return {
                status: 503,
                headers,
                body: JSON.stringify({ error: 'AzureSignalRConnectionString is not configured' })
            };
        }

        const chatId = request.query.get('chatId') || '';
        const token = request.headers.get('x-chat-bridge-token') || request.query.get('token') || '';
        const headerUserId = request.headers.get('x-signalr-userid') || '';
        const secret = process.env.CHAT_BRIDGE_HMAC_SECRET;

        const auth = validateBridgeToken(token, chatId, secret);
        if (!auth.ok) {
            context.warn('negotiate auth failed:', auth.error);
            return { status: 401, headers, body: JSON.stringify({ error: auth.error }) };
        }
        if (!headerUserId || headerUserId !== auth.userId) {
            return { status: 401, headers, body: JSON.stringify({ error: 'userId mismatch' }) };
        }

        const connectionInfo = context.extraInputs.get(signalRConnectionInfo);
        return { status: 200, headers, body: JSON.stringify(connectionInfo) };
    }
});
