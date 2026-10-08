/**
 * Add the authenticated Salesforce user to the SignalR group for a Teams chatId.
 * Called by the LWC after HubConnection.start().
 */
const { app } = require('@azure/functions');
const { validateBridgeToken, corsHeaders } = require('../bridgeAuth');
const { signalROutput, addUserToGroup } = require('../signalrHub');

app.http('joinChat', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'joinChat',
    extraOutputs: [signalROutput],
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

        let payload;
        try {
            payload = await request.json();
        } catch (e) {
            return { status: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
        }

        const chatId = payload.chatId || '';
        const token = request.headers.get('x-chat-bridge-token') || payload.token || '';
        const secret = process.env.CHAT_BRIDGE_HMAC_SECRET;

        const auth = validateBridgeToken(token, chatId, secret);
        if (!auth.ok) {
            context.warn('joinChat auth failed:', auth.error);
            return { status: 401, headers, body: JSON.stringify({ error: auth.error }) };
        }

        context.extraOutputs.set(signalROutput, addUserToGroup(auth.userId, chatId));
        return { status: 200, headers, body: JSON.stringify({ ok: true, chatId }) };
    }
});
