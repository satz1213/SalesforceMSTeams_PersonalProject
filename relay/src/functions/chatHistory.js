/**
 * Stateless chat history proxy: LWC → Azure → Microsoft Graph.
 * Does not persist messages; Teams is the source of truth.
 */
const { app } = require('@azure/functions');
const { validateBridgeToken, corsHeaders } = require('../bridgeAuth');
const { listChatMessages } = require('../graphChat');

app.http('chatHistory', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const origin = request.headers.get('origin') || '';
        const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

        if (request.method === 'OPTIONS') {
            return { status: 204, headers };
        }

        const chatId = request.query.get('chatId') || '';
        const token = request.headers.get('x-chat-bridge-token') || request.query.get('token') || '';
        const secret = process.env.CHAT_BRIDGE_HMAC_SECRET;

        const auth = validateBridgeToken(token, chatId, secret);
        if (!auth.ok) {
            context.warn('chatHistory auth failed:', auth.error);
            return { status: 401, headers, body: JSON.stringify({ error: auth.error }) };
        }

        try {
            const messages = await listChatMessages(chatId, 50);
            return { status: 200, headers, body: JSON.stringify({ messages }) };
        } catch (err) {
            context.error('chatHistory failed:', err);
            // Surface Graph's own throttling distinctly so the LWC can back off instead of
            // retrying immediately into the same 10-requests/10s wall.
            if (err.statusCode === 429) {
                return { status: 429, headers, body: JSON.stringify({ error: 'Rate limited by Graph' }) };
            }
            return { status: 502, headers, body: JSON.stringify({ error: 'Failed to list chat messages' }) };
        }
    }
});
