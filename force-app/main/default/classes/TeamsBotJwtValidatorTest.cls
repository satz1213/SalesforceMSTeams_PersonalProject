/**
 * Mints its own signed JWTs at test-run time (Crypto.sign) against a throwaway
 * RSA key pair, rather than hardcoding fixture tokens with a fixed expiry -
 * a hardcoded "valid" token eventually starts failing on its own once real
 * time passes it by. Same key pair/recipe as TeamsBotMessagingResourceTest.
 */
@IsTest
private class TeamsBotJwtValidatorTest {
    private static final String APP_ID = 'test-app-id-1234';
    private static final String KID = 'test-key-1';
    private static final String MODULUS = '8pfWlbBxTYvHXfkM4GbXjl640ctdwW_IfqR7tckY___v_m8DvWz8Y3cza9pYf0swb5UhdDDr48VRGeM4NeWo_ESuC63v3Hvsr6cyju1lAQeQYBEO91Mkg3fkcRreFqw6qkqdcL9V1V5b5BF4RrEGJJ10jfQBpVMRBYImBYcuYFgsberrbIgA_9AdfgywaWH-Q9zmfm-7GNb0tp0YvGl-0OKpcNTw9D5nGpyXGRhksF0mKpK3LxMQXqtsGtzv6HQkp1K7Z9h_ZoSiUrs8BGXdBZUqZRq_XzvFCyW0dVF4HpLBUL-RnlX1ZEW1-VxgDpNUKKNNBza-rJ4cW6mkfHfv1Q';
    private static final String EXPONENT = 'AQAB';
    private static final String PRIVATE_KEY_PKCS8_BASE64 = 'MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDyl9aVsHFNi8dd+QzgZteOXrjRy13Bb8h+pHu1yRj//+/+bwO9bPxjdzNr2lh/SzBvlSF0MOvjxVEZ4zg15aj8RK4Lre/ce+yvpzKO7WUBB5BgEQ73UySDd+RxGt4WrDqqSp1wv1XVXlvkEXhGsQYknXSN9AGlUxEFgiYFhy5gWCxt6utsiAD/0B1+DLBpYf5D3OZ+b7sY1vS2nRi8aX7Q4qlw1PD0PmcanJcZGGSwXSYqkrcvExBeq2wa3O/odCSnUrtn2H9mhKJSuzwEZd0FlSplGr9fO8ULJbR1UXgeksFQv5GeVfVkRbX5XGAOk1Qoo00HNr6snhxbqaR8d+/VAgMBAAECggEAXUUNhp3A4iykqTewwLIpnB5E9rw2vsFol3BL8/duOja/odYy3OiDHQbeaVAYiFBzPeNbal3Iw9jANrDKksZKszsAo5LrTp0CwgIJiTQyijPLSXQlieeYeUdmOCo5SwRKxeBMKeYWbSOLNuOUl7FGCFvVTSKMY3DNcY25apSvuvBL+cHCYYPCRpzMid7PH7VQw9OKDA4zDkmf48j21sh9Qrttg26uDIvRC4Wh9pFbPB865RqO6zrE44Rp/HUx7cWRyUEqzsCFloO/mCtZiYs3d+jwQo9EW9jluwvhis5VrMPiuJEBfR8smbCTaoqm0Jp6XVKuSsYRS2pb3Dcm0FRV/QKBgQD7nV/mkzmI6+gF8Q2vCNgqm3WHetExwB+MclJTStV9xeTwyqWFO/vUBU+aCivOW/KUf5xr3IVO0N6E9nnJuBPSLVAGo2M7fAMY48TdqRvgjw+1wIEpnADBb2JRp48QH0A4mBokYSnSyK0dksHZZmmNgTlyyH02RL0YAGCn+IK/LwKBgQD20jZDaTXiVjhDNh1snsN4L7spVUhJo4b+TfnZ5e/EqQBr3JwtlEuUlVwhzgTsGvJq2nxVhnQxRQrAYh4EW1E4BZvOPTxv8uekpIF92n5ztXpzYMmCoVrMdft7sEli5WN3Oz6tvjzPewWCQD0u2iMPg036QR5rm4u4tcJd7JAgOwKBgClqDtXh1698vNT1hz4PI51ntyGUiog4yjiQvJIvGBK6luM3R6U1aU7NjPuavvkZU0Uz9+gdBOgjIu0ZsJQOM1z9zlU5YWTyFYRsQQQHCKqegYR16gySO+Ga1sD/5mFN84EdL/ha8cpa83uRo0yIOclrwqvs6gcbq1AfB8m98q9LAoGAWDjA/o1fnjwVNijkkYuZ8J6W9mouQWv693DlqnXeotuJdARRqpUEAuL0IH0kE0R6e6kGogdCBs5XznYDpqkBOdX/X9NRg+490AKg6lwrsK4gS5c/z7pe2xAcyJQ1Vu0JBXgeqjmCQOMHEAxoEhQUThovyBB4kBvz8By/kZTZ2zsCgYAIdBo4FMszEWOeXNLxxmzH6UY27H6uQwZ9vXjHSQYJCXHrrQsQd1683rgpNuCJYWBKMQxxyqnP4QsgPct5RMLEDutzs9eRuuSHk8ano88CUhdxMpscnUtI7igZ0a+xJh2Ce1Zx0EBrHIyMKRTGIgrNcuFDIy1t1uvJCrcsC4ZZTA==';

    private class JwksMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody(
                JSON.serialize(
                    new Map<String, Object>{
                        'keys' => new List<Object>{ new Map<String, Object>{ 'kty' => 'RSA', 'use' => 'sig', 'kid' => KID, 'n' => MODULUS, 'e' => EXPONENT } }
                    }
                )
            );
            return res;
        }
    }

    private class JwksMissingKeyMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(200);
            res.setHeader('Content-Type', 'application/json');
            res.setBody(JSON.serialize(new Map<String, Object>{ 'keys' => new List<Object>() }));
            return res;
        }
    }

    private static String signedJwt(Map<String, Object> claimOverrides) {
        Long now = Datetime.now().getTime() / 1000;
        Map<String, Object> payload = new Map<String, Object>{ 'iss' => 'https://api.botframework.com', 'aud' => APP_ID, 'exp' => now + 3600, 'nbf' => now - 60 };
        payload.putAll(claimOverrides);

        String headerB64 = base64Url(Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'alg' => 'RS256', 'typ' => 'JWT', 'kid' => KID })));
        String payloadB64 = base64Url(Blob.valueOf(JSON.serialize(payload)));
        String signingInput = headerB64 + '.' + payloadB64;

        Blob privateKey = EncodingUtil.base64Decode(PRIVATE_KEY_PKCS8_BASE64);
        Blob signature = Crypto.sign('RSA-SHA256', Blob.valueOf(signingInput), privateKey);

        return signingInput + '.' + base64Url(signature);
    }

    private static String tamperedJwt() {
        String jwt = signedJwt(new Map<String, Object>());
        List<String> segments = jwt.split('\\.');
        String sig = segments[2];
        Integer mid = sig.length() / 2;
        String flippedChar = sig.substring(mid, mid + 1) == 'A' ? 'B' : 'A';
        String tamperedSig = sig.substring(0, mid) + flippedChar + sig.substring(mid + 1);
        return segments[0] + '.' + segments[1] + '.' + tamperedSig;
    }

    private static String base64Url(Blob value) {
        return EncodingUtil.base64Encode(value).replace('+', '-').replace('/', '_').replace('=', '');
    }

    @IsTest
    static void validTokenReturnsClaims() {
        Test.setMock(HttpCalloutMock.class, new JwksMock());

        Test.startTest();
        Map<String, Object> claims = TeamsBotJwtValidator.validate('Bearer ' + signedJwt(new Map<String, Object>()), APP_ID);
        Test.stopTest();

        System.assertEquals('https://api.botframework.com', claims.get('iss'));
        System.assertEquals(APP_ID, claims.get('aud'));
    }

    @IsTest
    static void tamperedPayloadFailsSignatureCheck() {
        Test.setMock(HttpCalloutMock.class, new JwksMock());

        Test.startTest();
        try {
            TeamsBotJwtValidator.validate('Bearer ' + tamperedJwt(), APP_ID);
            System.assert(false, 'Expected TeamsBotAuthException');
        } catch (TeamsBotJwtValidator.TeamsBotAuthException e) {
            System.assert(e.getMessage().contains('signature'));
        }
        Test.stopTest();
    }

    @IsTest
    static void expiredTokenIsRejected() {
        Test.setMock(HttpCalloutMock.class, new JwksMock());
        Long now = Datetime.now().getTime() / 1000;
        String expiredJwt = signedJwt(new Map<String, Object>{ 'exp' => now - 3600, 'nbf' => now - 7200 });

        Test.startTest();
        try {
            TeamsBotJwtValidator.validate('Bearer ' + expiredJwt, APP_ID);
            System.assert(false, 'Expected TeamsBotAuthException');
        } catch (TeamsBotJwtValidator.TeamsBotAuthException e) {
            System.assert(e.getMessage().contains('expired'));
        }
        Test.stopTest();
    }

    @IsTest
    static void wrongAudienceIsRejected() {
        Test.setMock(HttpCalloutMock.class, new JwksMock());

        Test.startTest();
        try {
            TeamsBotJwtValidator.validate('Bearer ' + signedJwt(new Map<String, Object>()), 'some-other-app-id');
            System.assert(false, 'Expected TeamsBotAuthException');
        } catch (TeamsBotJwtValidator.TeamsBotAuthException e) {
            System.assert(e.getMessage().contains('audience'));
        }
        Test.stopTest();
    }

    @IsTest
    static void unknownKeyIdIsRejected() {
        Test.setMock(HttpCalloutMock.class, new JwksMissingKeyMock());

        Test.startTest();
        try {
            TeamsBotJwtValidator.validate('Bearer ' + signedJwt(new Map<String, Object>()), APP_ID);
            System.assert(false, 'Expected TeamsBotAuthException');
        } catch (TeamsBotJwtValidator.TeamsBotAuthException e) {
            System.assert(e.getMessage().contains('No matching signing key'));
        }
        Test.stopTest();
    }

    @IsTest
    static void malformedTokenIsRejected() {
        Test.startTest();
        try {
            TeamsBotJwtValidator.validate('Bearer not-a-jwt', APP_ID);
            System.assert(false, 'Expected TeamsBotAuthException');
        } catch (TeamsBotJwtValidator.TeamsBotAuthException e) {
            System.assert(e.getMessage().contains('Malformed'));
        }
        Test.stopTest();
    }

    @IsTest
    static void blankAuthorizationHeaderIsRejected() {
        Test.startTest();
        try {
            TeamsBotJwtValidator.validate('', APP_ID);
            System.assert(false, 'Expected TeamsBotAuthException');
        } catch (TeamsBotJwtValidator.TeamsBotAuthException e) {
            System.assert(e.getMessage().contains('Missing'));
        }
        Test.stopTest();
    }
}
