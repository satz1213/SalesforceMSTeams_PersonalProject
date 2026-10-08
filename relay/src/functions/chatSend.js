/**
 * Stateless chat send proxy: LWC → Azure → Bot Framework Connector.
 * After a successful Bot post, echoes the Outbound DTO to SignalR (Option D).
 */
const { app } = require('@azure/functions');
const { validateBridgeToken, corsHeaders } = require('../bridgeAuth');
const { sendAgentMessage } = require('../botSend');
const { signalROutput, newMessageToGroup } = require('../signalrHub');

app.http('chatSend', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    extraOutputs: [signalROutput],
    handler: async (request, context) => {
        const origin = request.headers.get('origin') || '';
        const headers = { ...corsHeaders(origin), 'Content-Type': 'application/json' };

        if (request.method === 'OPTIONS') {
            return { status: 204, headers };
        }

        let payload;
        try {
            payload = await request.json();
        } catch (e) {
            return { status: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
        }

        const chatId = payload.chatId || '';
        const serviceUrl = payload.serviceUrl || '';
        const body = (payload.body || '').trim();
        const senderName = (payload.senderName || 'Agent').trim();
        const senderAadObjectId = (payload.senderAadObjectId || '').trim();
        const token = request.headers.get('x-chat-bridge-token') || payload.token || '';
        const secret = process.env.CHAT_BRIDGE_HMAC_SECRET;

        const auth = validateBridgeToken(token, chatId, secret);
        if (!auth.ok) {
            context.warn('chatSend auth failed:', auth.error);
            return { status: 401, headers, body: JSON.stringify({ error: auth.error }) };
        }

        if (!serviceUrl || !body) {
            return { status: 400, headers, body: JSON.stringify({ error: 'serviceUrl and body are required' }) };
        }

        try {
            // Body is plain text; Teams shows "{senderName} via Case Swarm" via onBehalfOf.
            // senderAadObjectId (User.Azure_AD_Object_Id__c) builds MRI — no Graph lookup.
            const activityId = await sendAgentMessage(serviceUrl, chatId, body, {
                senderName,
                senderAadObjectId
            });
            const dto = {
                id: activityId ? `bot:${activityId}` : `local:${Date.now()}`,
                teamsMessageId: activityId ? `bot:${activityId}` : null,
                body,
                senderDisplayName: senderName,
                direction: 'Outbound',
                sentAt: new Date().toISOString(),
                chatId
            };

            if (process.env.AzureSignalRConnectionString) {
                try {
                    context.extraOutputs.set(signalROutput, newMessageToGroup(chatId, dto));
                } catch (pushErr) {
                    context.warn('SignalR echo skipped after chatSend:', pushErr);
                }
            }

            return {
                status: 200,
                headers,
                body: JSON.stringify(dto)
            };
        } catch (err) {
            context.error('chatSend failed:', err);
            return { status: 502, headers, body: JSON.stringify({ error: 'Failed to send message' }) };
        }
    }
});
