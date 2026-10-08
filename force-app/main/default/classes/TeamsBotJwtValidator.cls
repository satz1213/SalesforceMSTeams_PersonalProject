/**
 * Validates the bearer token Bot Framework attaches to every call to the bot's
 * messaging endpoint (TeamsBotMessagingResource). This is the ONLY auth check
 * on that endpoint - it's a Salesforce Site Guest User REST resource with no
 * Salesforce session, so an unvalidated request must be treated as untrusted,
 * not best-effort.
 *
 * Apex has no JWT/JOSE library, so this hand-rolls the RS256 check: fetch
 * Bot Framework's JWKS, rebuild the matching key as a DER SubjectPublicKeyInfo
 * blob (the format Crypto.verify requires), verify the signature, then check
 * iss/aud/exp/nbf. See https://login.botframework.com/v1/.well-known/openidconfiguration
 * for the (stable) jwks_uri this hardcodes rather than doing a discovery hop.
 */
public with sharing class TeamsBotJwtValidator {
    public class TeamsBotAuthException extends Exception {
    }

    private static final String JWKS_URL = 'https://login.botframework.com/v1/.well-known/keys';
    private static final String EXPECTED_ISSUER = 'https://api.botframework.com';
    private static final String RSA_ENCRYPTION_ALGORITHM_ID_HEX = '300d06092a864886f70d0101010500';
    private static final String HEX_DIGITS = '0123456789abcdef';

    /**
     * Returns the decoded claims on success. Throws TeamsBotAuthException on any
     * failure - callers must not proceed to act on the request if this throws.
     */
    public static Map<String, Object> validate(String authorizationHeader, String expectedAppId) {
        if (String.isBlank(authorizationHeader)) {
            throw new TeamsBotAuthException('Missing Authorization header.');
        }
        String jwt = authorizationHeader.startsWith('Bearer ') ? authorizationHeader.substring(7) : authorizationHeader;

        List<String> segments = jwt.split('\\.');
        if (segments.size() != 3) {
            throw new TeamsBotAuthException('Malformed bot framework token.');
        }

        Map<String, Object> header = (Map<String, Object>) JSON.deserializeUntyped(base64UrlDecodeToString(segments[0]));
        Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(base64UrlDecodeToString(segments[1]));
        Blob signature = base64UrlDecode(segments[2]);
        Blob signingInput = Blob.valueOf(segments[0] + '.' + segments[1]);

        String kid = (String) header.get('kid');
        if (String.isBlank(kid)) {
            throw new TeamsBotAuthException('Bot framework token is missing a key id.');
        }

        Blob publicKey = fetchPublicKey(kid);
        if (!Crypto.verify('RSA-SHA256', signingInput, signature, publicKey)) {
            throw new TeamsBotAuthException('Bot framework token signature is invalid.');
        }

        validateClaims(payload, expectedAppId);
        return payload;
    }

    private static void validateClaims(Map<String, Object> payload, String expectedAppId) {
        String issuer = (String) payload.get('iss');
        if (issuer != EXPECTED_ISSUER) {
            throw new TeamsBotAuthException('Unexpected token issuer: ' + issuer);
        }

        String audience = (String) payload.get('aud');
        if (String.isBlank(expectedAppId) || audience != expectedAppId) {
            throw new TeamsBotAuthException('Token audience does not match this bot.');
        }

        Long nowEpochSeconds = Datetime.now().getTime() / 1000;
        Long exp = toLong(payload.get('exp'));
        Long nbf = toLong(payload.get('nbf'));

        if (exp == null || nowEpochSeconds >= exp) {
            throw new TeamsBotAuthException('Bot framework token has expired.');
        }
        if (nbf != null && nowEpochSeconds < nbf) {
            throw new TeamsBotAuthException('Bot framework token is not yet valid.');
        }
    }

    private static Long toLong(Object value) {
        return value == null ? null : Long.valueOf(String.valueOf(value));
    }

    private static Blob fetchPublicKey(String kid) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(JWKS_URL);
        req.setMethod('GET');
        req.setTimeout(15000);
        HttpResponse res = new Http().send(req);

        if (res.getStatusCode() != 200) {
            throw new TeamsBotAuthException('Could not retrieve Bot Framework signing keys: ' + res.getStatusCode());
        }

        Map<String, Object> jwks = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        for (Object keyObj : (List<Object>) jwks.get('keys')) {
            Map<String, Object> key = (Map<String, Object>) keyObj;
            if (kid.equals((String) key.get('kid'))) {
                return rsaPublicKeyFromModulusAndExponent((String) key.get('n'), (String) key.get('e'));
            }
        }
        throw new TeamsBotAuthException('No matching signing key found for kid ' + kid);
    }

    /** Builds a DER X.509 SubjectPublicKeyInfo blob from a JWK's base64url n/e - the form Crypto.verify requires. */
    private static Blob rsaPublicKeyFromModulusAndExponent(String modulusB64Url, String exponentB64Url) {
        String modulusHex = derInteger(EncodingUtil.convertToHex(base64UrlDecode(modulusB64Url)));
        String exponentHex = derInteger(EncodingUtil.convertToHex(base64UrlDecode(exponentB64Url)));

        String rsaPublicKeyHex = derSequence(modulusHex + exponentHex);
        String bitStringHex = '03' + derLengthHex(rsaPublicKeyHex.length() / 2 + 1) + '00' + rsaPublicKeyHex;
        String spkiHex = derSequence(RSA_ENCRYPTION_ALGORITHM_ID_HEX + bitStringHex);

        return EncodingUtil.convertFromHex(spkiHex);
    }

    private static String derSequence(String contentHex) {
        return '30' + derLengthHex(contentHex.length() / 2) + contentHex;
    }

    /** Two's-complement DER INTEGER: prepend a 00 byte when the high bit is set, or an unsigned magnitude reads back negative. */
    private static String derInteger(String magnitudeHex) {
        if (magnitudeHex.length() > 0 && hexByteToInt(magnitudeHex.substring(0, 2)) >= 128) {
            magnitudeHex = '00' + magnitudeHex;
        }
        return '02' + derLengthHex(magnitudeHex.length() / 2) + magnitudeHex;
    }

    private static String derLengthHex(Integer byteLength) {
        if (byteLength < 128) {
            return intToHexByte(byteLength);
        }
        String lengthHex = '';
        Integer remaining = byteLength;
        while (remaining > 0) {
            lengthHex = intToHexByte(Math.mod(remaining, 256)) + lengthHex;
            remaining = remaining / 256;
        }
        return intToHexByte(128 + lengthHex.length() / 2) + lengthHex;
    }

    private static Integer hexByteToInt(String hexPair) {
        String lower = hexPair.toLowerCase();
        return HEX_DIGITS.indexOf(lower.substring(0, 1)) * 16 + HEX_DIGITS.indexOf(lower.substring(1, 2));
    }

    private static String intToHexByte(Integer value) {
        Integer high = value / 16;
        Integer low = Math.mod(value, 16);
        return HEX_DIGITS.substring(high, high + 1) + HEX_DIGITS.substring(low, low + 1);
    }

    private static Blob base64UrlDecode(String value) {
        String standard = value.replace('-', '+').replace('_', '/');
        Integer padding = Math.mod(4 - Math.mod(standard.length(), 4), 4);
        standard += '='.repeat(padding);
        return EncodingUtil.base64Decode(standard);
    }

    private static String base64UrlDecodeToString(String value) {
        return base64UrlDecode(value).toString();
    }
}
