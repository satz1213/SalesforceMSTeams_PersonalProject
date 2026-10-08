/**
 * App-only Graph helpers for listing chat messages (stateless history proxy).
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

async function getGraphAccessToken() {
    const now = Date.now();
    if (cachedToken && now < cachedTokenExpiresAt - 60000) {
        return cachedToken;
    }

    const tenantId = process.env.GRAPH_TENANT_ID;
    const clientId = process.env.GRAPH_CLIENT_ID;
    const clientSecret = process.env.GRAPH_CLIENT_SECRET;
    if (!tenantId || !clientId || !clientSecret) {
        throw new Error('GRAPH_TENANT_ID, GRAPH_CLIENT_ID, and GRAPH_CLIENT_SECRET must be set');
    }

    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default'
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
        throw new Error(`Graph token failed: ${res.statusCode} ${res.body}`);
    }
    const parsed = JSON.parse(res.body);
    cachedToken = parsed.access_token;
    cachedTokenExpiresAt = now + (parsed.expires_in || 3600) * 1000;
    return cachedToken;
}

function stripHtml(html) {
    if (!html) {
        return '';
    }
    return String(html)
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .trim();
}

function mapGraphMessage(raw) {
    const bodyObj = raw.body || {};
    const body = stripHtml(bodyObj.content || '');
    const from = raw.from || {};
    let senderDisplayName = null;
    let senderEmail = null;
    if (from.user) {
        senderDisplayName = from.user.displayName || null;
    } else if (from.application) {
        senderDisplayName = from.application.displayName || null;
        senderEmail = 'application';
    }
    return {
        id: raw.id,
        teamsMessageId: raw.id,
        body,
        senderDisplayName,
        senderEmail,
        direction: senderEmail === 'application' ? 'Outbound' : 'Inbound',
        sentAt: raw.createdDateTime || null
    };
}

async function listChatMessages(chatId, top = 50) {
    const token = await getGraphAccessToken();
    const pageSize = Math.min(Math.max(top || 50, 1), 50);
    const encodedId = encodeURIComponent(chatId);
    const res = await httpsJson(
        'GET',
        `https://graph.microsoft.com/v1.0/chats/${encodedId}/messages?$top=${pageSize}`,
        { Authorization: `Bearer ${token}` }
    );
    if (res.statusCode !== 200) {
        const err = new Error(`listChatMessages failed: ${res.statusCode} ${res.body}`);
        err.statusCode = res.statusCode;
        throw err;
    }
    const parsed = JSON.parse(res.body);
    const values = Array.isArray(parsed.value) ? parsed.value : [];
    // Graph returns newest first; UI wants chronological ascending.
    return values
        .map(mapGraphMessage)
        .filter((m) => m.id && m.body)
        .reverse();
}

module.exports = { listChatMessages, stripHtml };
