/**
 * Token Exchange Handler for "Salesforce in Teams" - lets salesforceTabHome.js log in silently via
 * Teams SSO (microsoftTeams.authentication.getAuthToken()) instead of the OAuth 2.0 Authorization
 * Code + PKCE popup it uses today. Salesforce's OAuth 2.0 Token Exchange flow hands this handler
 * the raw Azure AD access token the Teams tab already holds, and does NOT pre-validate it - this
 * class is the entire security boundary between an arbitrary caller and a real Salesforce session,
 * so - same discipline as TeamsBotJwtValidator.cls elsewhere in this project - it does full
 * RS256/JWKS signature verification plus issuer/audience/expiry checks itself, not a best-effort
 * shortcut.
 *
 * Deliberately self-contained rather than reusing TeamsBotJwtValidator.cls: that class validates a
 * different issuer (Bot Framework) for a different feature (Case Swarm), and this project's
 * explicit convention is to copy a proven pattern across features rather than couple them (see
 * CLAUDE.md's "three separate, non-overlapping" boundary and salesforceAuthCallback.js's own
 * "copied, not shared" constants).
 *
 * Identity resolution reuses the exact same convention as AzureAdSsoRegistrationHandler.cls (the
 * separate SSO-login-page Auth Provider, also part of this feature): match on
 * Azure_AD_Email_Id__c, never auto-provision - every real user here already exists in Salesforce.
 *
 * SETUP - confirmed working end-to-end against a real Teams SSO token (2026-09-26):
 * - Azure AD app "Salesforce In Teams SSO" exposes an API at the Application ID URI below, with
 *   "accessTokenAcceptedVersion": 2 set (v2.0 issuer format) and the two well-known Teams client
 *   ids (desktop/mobile, web) pre-authorized on its access_as_user scope.
 * - The Application ID URI's domain portion MUST match the actual hostname the Teams tab is served
 *   from (case-swarm-relay-...azurewebsites.net) - a bare "api://<client-id>" URI with no domain
 *   fails with "App resource defined in manifest and iframe origin do not match".
 * - login.microsoftonline.com needs a Remote Site Setting (Azure_AD_JWKS) or fetchPublicKey()'s
 *   callout is blocked outright ("Unauthorized endpoint") - easy to miss, since TeamsBotJwtValidator
 *   elsewhere in this project already has its own (Bot_Framework_Keys) for a different domain.
 * - A real token's "aud" claim is the bare Client ID, not the Application ID URI - both are still
 *   accepted below since Microsoft's own behavior here isn't publicly documented as guaranteed.
 * - The External Client App's Permitted Users must be "Admin approved users are pre-authorized"
 *   (with a Permission Set granting access, assigned to every real user) - Token Exchange is a
 *   non-interactive flow, and Salesforce's AllSelfAuthorized policy has no interactive moment for
 *   a person to grant that self-authorization the way the PKCE popup flow's login screen does.
 *   Confirmed via the exact error this produces otherwise: OAuth invalid_grant "user hasn't
 *   approved this consumer" - the same failure JWT Bearer flow hits without a prior
 *   refresh_token-scoped approval on file.
 */
global class SalesforceInTeamsTokenExchangeHandler extends Auth.Oauth2TokenExchangeHandler {

    public class TokenValidationException extends Exception {}

    private static final String TENANT_ID = '80040ab0-138a-4eaa-8a1c-68e4f0465151';
    private static final String JWKS_URL = 'https://login.microsoftonline.com/' + TENANT_ID + '/discovery/v2.0/keys';
    private static final String EXPECTED_ISSUER = 'https://login.microsoftonline.com/' + TENANT_ID + '/v2.0';

    // Real values from the "Salesforce In Teams SSO" Azure AD app registration's "Expose an API"
    // step - see this class's header comment for the exact requirements these must satisfy.
    private static final Set<String> EXPECTED_AUDIENCES = new Set<String>{
        'api://case-swarm-relay-sfchatsync-h9hbhzf9eagdbkd6.canadacentral-01.azurewebsites.net/b186fa34-7fdf-48be-80c3-7e736eb501b3', // Application ID URI
        'b186fa34-7fdf-48be-80c3-7e736eb501b3' // Client ID - confirmed this is what a real token's "aud" actually carries
    };

    private static final String RSA_ENCRYPTION_ALGORITHM_ID_HEX = '300d06092a864886f70d0101010500';
    private static final String HEX_DIGITS = '0123456789abcdef';

    global override Auth.TokenValidationResult validateIncomingToken(
        String appDeveloperName,
        Auth.IntegratingAppType appType,
        String incomingToken,
        Auth.OAuth2TokenExchangeType tokenType
    ) {
        try {
            Map<String, Object> claims = validateAndDecode(incomingToken);
            String email = coalesce(
                (String) claims.get('preferred_username'),
                (String) claims.get('upn'),
                (String) claims.get('email')
            );
            String name = (String) claims.get('name');
            String oid = (String) claims.get('oid');

            Auth.UserData userData = new Auth.UserData(
                oid, // identifier
                null, // firstName
                null, // lastName
                name, // fullName
                email, // email
                null, // link
                email, // username - resolved to a real Salesforce User in getUserForTokenSubject
                'en_US', // locale
                'AzureADTeamsSso', // provider
                null, // siteLoginUrl
                new Map<String, String>() // attributeMap
            );
            return new Auth.TokenValidationResult(true, null, userData, incomingToken, tokenType, null);
        } catch (Exception e) {
            return new Auth.TokenValidationResult(false);
        }
    }

    global override User getUserForTokenSubject(
        Id networkId,
        Auth.TokenValidationResult result,
        Boolean canCreateUser,
        String appDeveloperName,
        Auth.IntegratingAppType appType
    ) {
        if (result == null || result.getUserData() == null) return null;

        String identifier = result.getUserData().email;
        if (String.isBlank(identifier)) identifier = result.getUserData().username;
        if (String.isBlank(identifier)) return null;

        List<User> matches = [
            SELECT Id
            FROM User
            WHERE Azure_AD_Email_Id__c = :identifier AND IsActive = true
            LIMIT 1
        ];
        return matches.isEmpty() ? null : matches[0];
    }

    private static String coalesce(String a, String b, String c) {
        if (String.isNotBlank(a)) return a;
        if (String.isNotBlank(b)) return b;
        return c;
    }

    // ---------------- JWT/JWKS validation ----------------
    // Mirrors TeamsBotJwtValidator.cls's proven pattern (copied rather than shared - see header
    // comment), pointed at Microsoft identity platform's tenant JWKS instead of Bot Framework's.

    private static Map<String, Object> validateAndDecode(String jwt) {
        if (String.isBlank(jwt)) throw new TokenValidationException('Missing token.');
        List<String> segments = jwt.split('\\.');
        if (segments.size() != 3) throw new TokenValidationException('Malformed token.');

        Map<String, Object> header = (Map<String, Object>) JSON.deserializeUntyped(base64UrlDecodeToString(segments[0]));
        Map<String, Object> payload = (Map<String, Object>) JSON.deserializeUntyped(base64UrlDecodeToString(segments[1]));
        Blob signature = base64UrlDecode(segments[2]);
        Blob signingInput = Blob.valueOf(segments[0] + '.' + segments[1]);

        String kid = (String) header.get('kid');
        if (String.isBlank(kid)) throw new TokenValidationException('Token is missing a key id.');

        Blob publicKey = fetchPublicKey(kid);
        if (!Crypto.verify('RSA-SHA256', signingInput, signature, publicKey)) {
            throw new TokenValidationException('Token signature is invalid.');
        }

        validateClaims(payload);
        return payload;
    }

    private static void validateClaims(Map<String, Object> payload) {
        String issuer = (String) payload.get('iss');
        if (issuer != EXPECTED_ISSUER) {
            throw new TokenValidationException('Unexpected token issuer: ' + issuer);
        }

        String audience = (String) payload.get('aud');
        if (String.isBlank(audience) || !EXPECTED_AUDIENCES.contains(audience)) {
            throw new TokenValidationException('Unexpected token audience: ' + audience);
        }

        Long nowEpochSeconds = Datetime.now().getTime() / 1000;
        Long exp = toLong(payload.get('exp'));
        Long nbf = toLong(payload.get('nbf'));

        if (exp == null || nowEpochSeconds >= exp) {
            throw new TokenValidationException('Token has expired.');
        }
        if (nbf != null && nowEpochSeconds < nbf) {
            throw new TokenValidationException('Token is not yet valid.');
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
            throw new TokenValidationException('Could not retrieve Azure AD signing keys: ' + res.getStatusCode());
        }

        Map<String, Object> jwks = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        for (Object keyObj : (List<Object>) jwks.get('keys')) {
            Map<String, Object> key = (Map<String, Object>) keyObj;
            if (kid.equals((String) key.get('kid'))) {
                return rsaPublicKeyFromModulusAndExponent((String) key.get('n'), (String) key.get('e'));
            }
        }
        throw new TokenValidationException('No matching signing key found for kid ' + kid);
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
