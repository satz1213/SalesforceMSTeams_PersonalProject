/**
 * HMAC session tokens minted by Salesforce getChatBridgeSession.
 * Payload format: chatId|userId|expEpochSeconds
 * Header/query: base64url(payload) + '.' + base64url(hmacSha256)
 */
const crypto = require('crypto');

function base64UrlEncode(buf) {
    return Buffer.from(buf)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64UrlDecode(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
    return Buffer.from(padded, 'base64').toString('utf8');
}

function validateBridgeToken(token, expectedChatId, secret) {
    if (!token || !secret) {
        return { ok: false, error: 'Missing token or secret' };
    }
    const parts = String(token).split('.');
    if (parts.length !== 2) {
        return { ok: false, error: 'Malformed token' };
    }
    const [payloadB64, sigB64] = parts;
    let payload;
    try {
        payload = base64UrlDecode(payloadB64);
    } catch (e) {
        return { ok: false, error: 'Invalid payload encoding' };
    }

    const expectedSig = base64UrlEncode(crypto.createHmac('sha256', secret).update(payload, 'utf8').digest());
    if (sigB64 !== expectedSig) {
        return { ok: false, error: 'Bad signature' };
    }

    const [chatId, userId, expStr] = payload.split('|');
    const exp = parseInt(expStr, 10);
    if (!chatId || !userId || !Number.isFinite(exp)) {
        return { ok: false, error: 'Invalid payload fields' };
    }
    if (expectedChatId && chatId !== expectedChatId) {
        return { ok: false, error: 'chatId mismatch' };
    }
    if (Date.now() / 1000 > exp) {
        return { ok: false, error: 'Token expired' };
    }
    return { ok: true, chatId, userId, exp };
}

function corsHeaders(origin) {
    const allowed = process.env.CHAT_BRIDGE_CORS_ORIGINS || '*';
    const allowOrigin = allowed === '*' ? '*' : allowed.split(',').map((s) => s.trim()).includes(origin) ? origin : allowed.split(',')[0].trim();
    return {
        'Access-Control-Allow-Origin': allowOrigin || '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Chat-Bridge-Token, x-signalr-userid',
        'Access-Control-Max-Age': '86400'
    };
}

module.exports = { validateBridgeToken, base64UrlEncode, corsHeaders };
