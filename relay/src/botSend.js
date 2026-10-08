/**
 * Posts chat activities via Bot Framework Connector API.
 * Agent messages use Teams channelData.onBehalfOf so the bubble shows
 * "{agent} via {bot}" instead of only the bot name + a "Name: …" body prefix.
 */
const https = require('https');

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function httpsJson(method, urlString, headers, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method,
            headers: { ...headers }
        };
        const req = https.request(options, (response) => {
            let data = '';
            response.on('data', (chunk) => (data += chunk));
            response.on('end', () => {
                resolve({ statusCode: response.statusCode, body: data });
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

async function getBotAccessToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExpiresAt - 60000) {
        return cachedToken;
    }

    const clientId = process.env.MICROSOFT_APP_ID;
    const clientSecret = process.env.MICROSOFT_APP_PASSWORD;
    // The shared login.microsoftonline.com/botframework.com authority only resolves
    // multi-tenant app registrations. A single-tenant bot app (the common case, especially
    // when reusing the same registration as the Graph app) must request its token from its
    // own tenant instead - confirmed live via AADSTS700016 ("app not found in the directory").
    const tenantId = process.env.MICROSOFT_APP_TENANT_ID || process.env.GRAPH_TENANT_ID;
    if (!clientId || !clientSecret || !tenantId) {
        throw new Error('MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD, and MICROSOFT_APP_TENANT_ID (or GRAPH_TENANT_ID) must be set');
    }

    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://api.botframework.com/.default'
    }).toString();

    const res = await httpsJson(
        'POST',
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(params)
        },
        params
    );

    if (res.statusCode !== 200) {
        throw new Error(`Bot token failed: ${res.statusCode} ${res.body}`);
    }
    const parsed = JSON.parse(res.body);
    cachedToken = parsed.access_token;
    cachedTokenExpiresAt = now + (parsed.expires_in || 3600) * 1000;
    return cachedToken;
}

function normalizeServiceUrl(serviceUrl) {
    return String(serviceUrl || '').replace(/\/+$/, '');
}

async function postActivity(serviceUrl, conversationId, activity) {
    const token = await getBotAccessToken();
    const base = normalizeServiceUrl(serviceUrl);
    const path = `${base}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
    const body = JSON.stringify(activity);

    const res = await httpsJson(
        'POST',
        path,
        {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body)
        },
        body
    );

    if (res.statusCode !== 200 && res.statusCode !== 201) {
        throw new Error(`postActivity failed: ${res.statusCode} ${res.body}`);
    }
    const parsed = JSON.parse(res.body || '{}');
    return parsed.id || null;
}

async function sendText(serviceUrl, conversationId, text) {
    if (!text || !String(text).trim()) {
        throw new Error('Message text is required');
    }
    return postActivity(serviceUrl, conversationId, { type: 'message', text: String(text) });
}

/**
 * Posts an agent message into Teams as a normal bot text message (not an Adaptive Card).
 * Name is a bold markdown line so SMEs still see who sent it under "Case Swarm".
 * onBehalfOf is best-effort when Entra object id is present ("Name via Case Swarm").
 *
 * @param {string} serviceUrl
 * @param {string} conversationId
 * @param {string} text plain message body (no name prefix)
 * @param {{ senderName?: string, senderAadObjectId?: string }} [attribution]
 */
async function sendAgentMessage(serviceUrl, conversationId, text, attribution = {}) {
    if (!text || !String(text).trim()) {
        throw new Error('Message text is required');
    }
    const senderName = String(attribution.senderName || 'Agent').trim() || 'Agent';
    const message = String(text).trim();
    const aadObjectId = String(attribution.senderAadObjectId || '')
        .trim()
        .replace(/^\{|\}$/g, '');

    // Escape markdown emphasis chars in the display name only.
    const safeName = senderName.replace(/([\\*_`])/g, '\\$1');
    const activity = {
        type: 'message',
        textFormat: 'markdown',
        text: `**${safeName}:** ${message}`
    };

    if (aadObjectId) {
        activity.channelData = {
            onBehalfOf: [
                {
                    itemId: 0,
                    mentionType: 'person',
                    mri: `8:orgid:${aadObjectId}`,
                    displayName: senderName
                }
            ]
        };
    }

    return postActivity(serviceUrl, conversationId, activity);
}

module.exports = { sendText, sendAgentMessage };
