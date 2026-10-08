/**
 * Relay between Bot Framework and TeamsBotMessagingResource.
 *
 * Why this exists: Salesforce's REST dispatcher intercepts any standard
 * "Authorization" header on a /services/apexrest/ request and tries to
 * validate it as a Salesforce session token - so a foreign token there (Bot
 * Framework's JWT) gets a platform-level 401 before Apex ever runs. Rather
 * than fight that, this relay authenticates to Salesforce itself (OAuth 2.0
 * Client Credentials against a Connected App - see README.md 6g) and puts
 * *that* token in Authorization, where Salesforce expects it. Bot Framework's
 * JWT still travels in a separate header (X-Bot-Framework-Authorization) -
 * that's what TeamsBotJwtValidator actually checks; the Salesforce session
 * only proves this relay is a legitimate integration, not who's really on
 * the other end of any given call.
 *
 * Authenticating this way runs Apex as a real internal Salesforce user
 * instead of an anonymous Site Guest User, which sidesteps "Secure guest
 * user record access" - Salesforce's hard restriction on Case visibility for
 * Guest Users that held even from enqueued async Apex a guest context ran.
 *
 * Card install / Adaptive Card invoke still forward to Apex. Plain chat
 * "message" activities are acknowledged here and fan out to Azure SignalR
 * (Option D) so the LWC can render live without Graph polling or per-message
 * Salesforce Daily REST API hits.
 *
 * Node.js v4 programming model (Azure Functions).
 */
const { app } = require('@azure/functions');
const https = require('https');
const { signalROutput, mapActivityToMessageDto, newMessageToGroup } = require('../signalrHub');

const SALESFORCE_ENDPOINT = process.env.SALESFORCE_MESSAGING_ENDPOINT;
const SALESFORCE_LOGIN_URL = process.env.SALESFORCE_LOGIN_URL;
const SALESFORCE_CLIENT_ID = process.env.SALESFORCE_CLIENT_ID;
const SALESFORCE_CLIENT_SECRET = process.env.SALESFORCE_CLIENT_SECRET;

app.http('teamsBotRelay', {
    methods: ['POST'],
    authLevel: 'anonymous',
    extraOutputs: [signalROutput],
    handler: async (request, context) => {
        if (!SALESFORCE_ENDPOINT || !SALESFORCE_LOGIN_URL || !SALESFORCE_CLIENT_ID || !SALESFORCE_CLIENT_SECRET) {
            context.error('One or more SALESFORCE_* app settings are not configured.');
            return { status: 500 };
        }

        const botFrameworkAuthHeader = request.headers.get('authorization') || '';
        const body = await request.text();

        let activity = null;
        let activityType = null;
        try {
            activity = JSON.parse(body || '{}');
            activityType = activity.type || null;
        } catch (e) {
            // Forward unparseable bodies to Salesforce for its own 400 handling.
        }

        // Live chat messages: push to SignalR group (chatId), never call Salesforce.
        if (activityType === 'message') {
            try {
                const dto = mapActivityToMessageDto(activity);
                if (!dto) {
                    context.warn(
                        'SignalR push skipped: no text/chatId on message activity',
                        activity && activity.id,
                        activity && activity.conversation && activity.conversation.id
                    );
                } else if (dto.direction === 'Outbound') {
                    // chatSend already SignalR-echoed agent outbound; bot activity round-trip
                    // would push again under a different id and duplicate in the LWC.
                    context.log('SignalR push skipped: outbound bot activity', dto.id);
                } else if (!process.env.AzureSignalRConnectionString) {
                    context.warn('SignalR push skipped: AzureSignalRConnectionString missing');
                } else {
                    context.log('SignalR push newMessage', dto.chatId, dto.id);
                    context.extraOutputs.set(signalROutput, newMessageToGroup(dto.chatId, dto));
                }
            } catch (err) {
                context.warn('SignalR push skipped for message activity:', err);
            }
            return { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' };
        }

        try {
            const accessToken = await getSalesforceAccessToken();
            const salesforceResponse = await forward(body, accessToken, botFrameworkAuthHeader);

            // Case-less MessagingSession chats (see TeamsBotMessagingResource.handleBotInstalled):
            // Salesforce is the one that knows which record this conversationId belongs to, so it
            // signals readiness back in its response body rather than this relay guessing at it.
            try {
                const parsed = salesforceResponse.body ? JSON.parse(salesforceResponse.body) : null;
                if (parsed && parsed.signalRGroup && process.env.AzureSignalRConnectionString) {
                    context.log('SignalR push chatReady', parsed.signalRGroup);
                    context.extraOutputs.set(
                        signalROutput,
                        newMessageToGroup(parsed.signalRGroup, {
                            teamsChatId: parsed.teamsChatId,
                            teamsChatUrl: parsed.teamsChatUrl
                        })
                    );
                }
            } catch (e) {
                // Not JSON, or no signal present - the normal case for every other activity type.
            }

            return {
                status: salesforceResponse.statusCode,
                headers: { 'Content-Type': 'application/json' },
                body: salesforceResponse.body
            };
        } catch (err) {
            context.error('Failed to reach Salesforce:', err);
            return { status: 502 };
        }
    }
});

function getSalesforceAccessToken() {
    return new Promise((resolve, reject) => {
        const url = new URL(SALESFORCE_LOGIN_URL);
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: SALESFORCE_CLIENT_ID,
            client_secret: SALESFORCE_CLIENT_SECRET
        }).toString();

        const options = {
            hostname: url.hostname,
            path: '/services/oauth2/token',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(params)
            }
        };

        const req = https.request(options, (response) => {
            let data = '';
            response.on('data', (chunk) => (data += chunk));
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Salesforce token request failed: ${response.statusCode} ${data}`));
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed.access_token) {
                        reject(new Error(`Salesforce token response had no access_token: ${data}`));
                        return;
                    }
                    resolve(parsed.access_token);
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);
        req.write(params);
        req.end();
    });
}

function forward(body, accessToken, botFrameworkAuthHeader) {
    return new Promise((resolve, reject) => {
        const url = new URL(SALESFORCE_ENDPOINT);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                Authorization: `Bearer ${accessToken}`,
                'X-Bot-Framework-Authorization': botFrameworkAuthHeader
            }
        };

        const req = https.request(options, (response) => {
            let data = '';
            response.on('data', (chunk) => (data += chunk));
            response.on('end', () => resolve({ statusCode: response.statusCode, body: data }));
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}
