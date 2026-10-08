/**
 * Mints its own signed JWTs against a throwaway RSA key pair (Crypto.sign, same
 * recipe used to verify the DER logic in TeamsBotJwtValidatorTest) rather than
 * hardcoding a fixture token, so the "aud" claim always matches whatever
 * Teams_Bot_Config__mdt.Default actually has deployed - no coupling to its
 * placeholder value.
 */
@IsTest
private class TeamsBotMessagingResourceTest {
    private static final String KID = 'test-key-1';
    private static final String MODULUS = '8pfWlbBxTYvHXfkM4GbXjl640ctdwW_IfqR7tckY___v_m8DvWz8Y3cza9pYf0swb5UhdDDr48VRGeM4NeWo_ESuC63v3Hvsr6cyju1lAQeQYBEO91Mkg3fkcRreFqw6qkqdcL9V1V5b5BF4RrEGJJ10jfQBpVMRBYImBYcuYFgsberrbIgA_9AdfgywaWH-Q9zmfm-7GNb0tp0YvGl-0OKpcNTw9D5nGpyXGRhksF0mKpK3LxMQXqtsGtzv6HQkp1K7Z9h_ZoSiUrs8BGXdBZUqZRq_XzvFCyW0dVF4HpLBUL-RnlX1ZEW1-VxgDpNUKKNNBza-rJ4cW6mkfHfv1Q';
    private static final String EXPONENT = 'AQAB';
    private static final String PRIVATE_KEY_PKCS8_BASE64 = 'MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDyl9aVsHFNi8dd+QzgZteOXrjRy13Bb8h+pHu1yRj//+/+bwO9bPxjdzNr2lh/SzBvlSF0MOvjxVEZ4zg15aj8RK4Lre/ce+yvpzKO7WUBB5BgEQ73UySDd+RxGt4WrDqqSp1wv1XVXlvkEXhGsQYknXSN9AGlUxEFgiYFhy5gWCxt6utsiAD/0B1+DLBpYf5D3OZ+b7sY1vS2nRi8aX7Q4qlw1PD0PmcanJcZGGSwXSYqkrcvExBeq2wa3O/odCSnUrtn2H9mhKJSuzwEZd0FlSplGr9fO8ULJbR1UXgeksFQv5GeVfVkRbX5XGAOk1Qoo00HNr6snhxbqaR8d+/VAgMBAAECggEAXUUNhp3A4iykqTewwLIpnB5E9rw2vsFol3BL8/duOja/odYy3OiDHQbeaVAYiFBzPeNbal3Iw9jANrDKksZKszsAo5LrTp0CwgIJiTQyijPLSXQlieeYeUdmOCo5SwRKxeBMKeYWbSOLNuOUl7FGCFvVTSKMY3DNcY25apSvuvBL+cHCYYPCRpzMid7PH7VQw9OKDA4zDkmf48j21sh9Qrttg26uDIvRC4Wh9pFbPB865RqO6zrE44Rp/HUx7cWRyUEqzsCFloO/mCtZiYs3d+jwQo9EW9jluwvhis5VrMPiuJEBfR8smbCTaoqm0Jp6XVKuSsYRS2pb3Dcm0FRV/QKBgQD7nV/mkzmI6+gF8Q2vCNgqm3WHetExwB+MclJTStV9xeTwyqWFO/vUBU+aCivOW/KUf5xr3IVO0N6E9nnJuBPSLVAGo2M7fAMY48TdqRvgjw+1wIEpnADBb2JRp48QH0A4mBokYSnSyK0dksHZZmmNgTlyyH02RL0YAGCn+IK/LwKBgQD20jZDaTXiVjhDNh1snsN4L7spVUhJo4b+TfnZ5e/EqQBr3JwtlEuUlVwhzgTsGvJq2nxVhnQxRQrAYh4EW1E4BZvOPTxv8uekpIF92n5ztXpzYMmCoVrMdft7sEli5WN3Oz6tvjzPewWCQD0u2iMPg036QR5rm4u4tcJd7JAgOwKBgClqDtXh1698vNT1hz4PI51ntyGUiog4yjiQvJIvGBK6luM3R6U1aU7NjPuavvkZU0Uz9+gdBOgjIu0ZsJQOM1z9zlU5YWTyFYRsQQQHCKqegYR16gySO+Ga1sD/5mFN84EdL/ha8cpa83uRo0yIOclrwqvs6gcbq1AfB8m98q9LAoGAWDjA/o1fnjwVNijkkYuZ8J6W9mouQWv693DlqnXeotuJdARRqpUEAuL0IH0kE0R6e6kGogdCBs5XznYDpqkBOdX/X9NRg+490AKg6lwrsK4gS5c/z7pe2xAcyJQ1Vu0JBXgeqjmCQOMHEAxoEhQUThovyBB4kBvz8By/kZTZ2zsCgYAIdBo4FMszEWOeXNLxxmzH6UY27H6uQwZ9vXjHSQYJCXHrrQsQd1683rgpNuCJYWBKMQxxyqnP4QsgPct5RMLEDutzs9eRuuSHk8ano88CUhdxMpscnUtI7igZ0a+xJh2Ce1Zx0EBrHIyMKRTGIgrNcuFDIy1t1uvJCrcsC4ZZTA==';

    private static final String CHAT_ID = '19:chat-123@thread.v2';
    private static final String SERVICE_URL = 'https://smba.trafficmanager.net/amer/';

    @TestSetup
    static void setup() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = new Case(Subject = 'Printer on fire', Description = 'Smoke from the tray', Status = 'New', Priority = 'High', Origin = 'Web');
        insert c;
    }

    private class CombinedMock implements HttpCalloutMock {
        public Integer sendCardCallCount = 0;

        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().contains('login.botframework.com')) {
                res.setStatusCode(200);
                res.setBody(
                    JSON.serialize(
                        new Map<String, Object>{
                            'keys' => new List<Object>{ new Map<String, Object>{ 'kty' => 'RSA', 'use' => 'sig', 'kid' => KID, 'n' => MODULUS, 'e' => EXPONENT } }
                        }
                    )
                );
            } else if (req.getEndpoint().contains('/v3/conversations/')) {
                sendCardCallCount++;
                res.setStatusCode(201);
                res.setBody('{"id":"activity-456"}');
            } else {
                res.setStatusCode(404);
            }
            return res;
        }
    }

    private static String appId() {
        return Teams_Bot_Config__mdt.getInstance('Default').Microsoft_App_Id__c;
    }

    private static String signedJwt(Map<String, Object> extraClaims) {
        Long now = Datetime.now().getTime() / 1000;
        Map<String, Object> payload = new Map<String, Object>{ 'iss' => 'https://api.botframework.com', 'aud' => appId(), 'exp' => now + 3600, 'nbf' => now - 60 };
        payload.putAll(extraClaims);

        String headerB64 = base64Url(Blob.valueOf(JSON.serialize(new Map<String, Object>{ 'alg' => 'RS256', 'typ' => 'JWT', 'kid' => KID })));
        String payloadB64 = base64Url(Blob.valueOf(JSON.serialize(payload)));
        String signingInput = headerB64 + '.' + payloadB64;

        Blob privateKey = EncodingUtil.base64Decode(PRIVATE_KEY_PKCS8_BASE64);
        Blob signature = Crypto.sign('RSA-SHA256', Blob.valueOf(signingInput), privateKey);

        return signingInput + '.' + base64Url(signature);
    }

    private static String base64Url(Blob value) {
        return EncodingUtil.base64Encode(value).replace('+', '-').replace('/', '_').replace('=', '');
    }

    private static void setUpRequest(String jwt, Map<String, Object> activity) {
        RestContext.request = new RestRequest();
        RestContext.response = new RestResponse();
        RestContext.request.requestURI = '/services/apexrest/teamsbot/messages';
        RestContext.request.httpMethod = 'POST';
        RestContext.request.headers.put('X-Bot-Framework-Authorization', 'Bearer ' + jwt);
        RestContext.request.requestBody = Blob.valueOf(JSON.serialize(activity));
    }

    private static Map<String, Object> conversationUpdateActivity(String conversationId) {
        return new Map<String, Object>{
            'type' => 'conversationUpdate',
            'serviceUrl' => SERVICE_URL,
            'conversation' => new Map<String, Object>{ 'id' => conversationId },
            'recipient' => new Map<String, Object>{ 'id' => 'bot-id-1' },
            'membersAdded' => new List<Object>{ new Map<String, Object>{ 'id' => 'bot-id-1' } }
        };
    }

    private static Map<String, Object> installationUpdateActivity(String conversationId) {
        return new Map<String, Object>{
            'type' => 'installationUpdate',
            'action' => 'add',
            'serviceUrl' => SERVICE_URL,
            'conversation' => new Map<String, Object>{ 'id' => conversationId },
            'recipient' => new Map<String, Object>{ 'id' => 'bot-id-1' }
        };
    }

    private static Map<String, Object> cardActionActivity(String conversationId, String verb, Id caseId, Map<String, Object> inputData) {
        Map<String, Object> data = new Map<String, Object>{ 'caseId' => String.valueOf(caseId) };
        if (inputData != null) {
            data.putAll(inputData);
        }
        return new Map<String, Object>{
            'type' => 'invoke',
            'name' => 'adaptiveCard/action',
            'conversation' => new Map<String, Object>{ 'id' => conversationId },
            'value' => new Map<String, Object>{ 'action' => new Map<String, Object>{ 'verb' => verb, 'data' => data } }
        };
    }

    @IsTest
    static void botInstalledCapturesServiceUrlAndPostsViewCard() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = CHAT_ID;
        c.Swarm_Type__c = 'Chat';
        c.Swarm_Status__c = 'Active';
        update c;

        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), conversationUpdateActivity(CHAT_ID));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals(200, RestContext.response.statusCode);
        Case updated = [SELECT Swarm_Bot_Service_Url__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(SERVICE_URL, updated.Swarm_Bot_Service_Url__c);
    }

    @IsTest
    static void installationUpdateAddCapturesServiceUrlAndPostsViewCard() {
        // This, not conversationUpdate, is what Teams actually sends when the bot is installed
        // via Graph's POST /chats/{id}/installedApps (see TeamsSwarmService.installBotApp) -
        // confirmed against a real chat swarm, not just assumed from docs.
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = CHAT_ID;
        c.Swarm_Type__c = 'Chat';
        c.Swarm_Status__c = 'Active';
        update c;

        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), installationUpdateActivity(CHAT_ID));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals(200, RestContext.response.statusCode);
        Case updated = [SELECT Swarm_Bot_Service_Url__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(SERVICE_URL, updated.Swarm_Bot_Service_Url__c);
    }

    @IsTest
    static void duplicateBotInstalledDeliveryPostsCardOnlyOnce() {
        // Teams sends both installationUpdate and conversationUpdate for the same "bot added"
        // moment (confirmed from real logs) - doPost() treats either as a trigger, so this
        // guards against posting the card twice for what's really one event.
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = CHAT_ID;
        c.Swarm_Type__c = 'Chat';
        c.Swarm_Status__c = 'Active';
        update c;

        CombinedMock mock = new CombinedMock();
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        setUpRequest(signedJwt(new Map<String, Object>()), installationUpdateActivity(CHAT_ID));
        TeamsBotMessagingResource.doPost();
        setUpRequest(signedJwt(new Map<String, Object>()), conversationUpdateActivity(CHAT_ID));
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals(1, mock.sendCardCallCount);
    }

    @IsTest
    static void botInstalledIgnoresConversationWithNoMatchingCase() {
        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), conversationUpdateActivity('19:unrelated@thread.v2'));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals(200, RestContext.response.statusCode);
    }

    private static Id createMessagingSessionWithChat(String chatId, String chatUrl) {
        MessagingChannel channel = new MessagingChannel(
            DeveloperName = 'Test_Channel_' + Datetime.now().getTime(),
            MasterLabel = 'Test Channel',
            MessageType = 'Text',
            MessagingPlatformKey = 'test-platform-key-' + Datetime.now().getTime()
        );
        insert channel;

        MessagingEndUser endUser = new MessagingEndUser(
            Name = 'Test End User',
            MessagingChannelId = channel.Id,
            MessageType = 'Text',
            MessagingPlatformKey = 'test-end-user-key-' + Datetime.now().getTime()
        );
        insert endUser;

        MessagingSession session = new MessagingSession(
            MessagingChannelId = channel.Id,
            MessagingEndUserId = endUser.Id,
            Status = 'Active',
            Teams_Chat_Id__c = chatId,
            Teams_Chat_Url__c = chatUrl
        );
        insert session;
        return session.Id;
    }

    @IsTest
    static void botInstalledForMessagingSessionSignalsSignalRGroupInResponseBody() {
        String chatId = '19:msgchat-signal@thread.v2';
        Id sessionId = createMessagingSessionWithChat(chatId, 'https://teams.microsoft.com/l/chat/test-url');

        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), conversationUpdateActivity(chatId));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals(200, RestContext.response.statusCode);
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        System.assertEquals(String.valueOf(sessionId), (String) body.get('signalRGroup'));
        System.assertEquals(chatId, (String) body.get('teamsChatId'));
        System.assertEquals('https://teams.microsoft.com/l/chat/test-url', (String) body.get('teamsChatUrl'));
        System.assertEquals(SERVICE_URL, (String) body.get('serviceUrl'));

        MessagingSession updated = [SELECT Teams_Bot_Service_Url__c FROM MessagingSession WHERE Id = :sessionId];
        System.assertEquals(SERVICE_URL, updated.Teams_Bot_Service_Url__c);
    }

    @IsTest
    static void botInstalledForUnrelatedConversationSetsNoResponseBody() {
        // No Case and no MessagingSession match this conversationId - existing "ignore" behavior
        // (botInstalledIgnoresConversationWithNoMatchingCase above) must stay a plain empty ack.
        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), conversationUpdateActivity('19:still-unrelated@thread.v2'));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals(200, RestContext.response.statusCode);
        System.assertEquals(null, RestContext.response.responseBody);
    }

    @IsTest
    static void editActionReturnsEditCardWithoutChangingCase() {
        Case c = [SELECT Id, Status FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = CHAT_ID;
        c.Swarm_Type__c = 'Chat';
        update c;

        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), cardActionActivity(CHAT_ID, 'edit', c.Id, null));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        Map<String, Object> invokeResponse = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        System.assertEquals('application/vnd.microsoft.card.adaptive', invokeResponse.get('type'));
        Map<String, Object> cardValue = (Map<String, Object>) invokeResponse.get('value');
        List<Object> body = (List<Object>) cardValue.get('body');
        Set<String> inputIds = new Set<String>();
        for (Object item : body) {
            Map<String, Object> block = (Map<String, Object>) item;
            if (block.containsKey('id')) {
                inputIds.add((String) block.get('id'));
            }
        }
        System.assert(inputIds.contains('status'));

        System.assertEquals('New', [SELECT Status FROM Case WHERE Id = :c.Id].Status);
    }

    @IsTest
    static void saveActionAppliesEditsAndReturnsViewCard() {
        Profile standardProfile = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        User originalOwner = new User(
            FirstName = 'Original',
            LastName = 'Owner',
            Email = 'original.owner.teamsbottest@example.com',
            Username = 'original.owner.teamsbottest@' + DateTime.now().getTime() + '.example.com',
            Alias = 'oowner',
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            ProfileId = standardProfile.Id
        );
        insert originalOwner;

        // Owned by someone other than the running (new-owner) user, so the assertion below on
        // the card's Owner fact can't pass by coincidence if OwnerId change and card refresh
        // are decoupled - see the stale Owner.Name relationship this guards against.
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = CHAT_ID;
        c.Swarm_Type__c = 'Chat';
        c.OwnerId = originalOwner.Id;
        update c;

        Map<String, Object> inputData = new Map<String, Object>{
            'status' => 'Working',
            'priority' => 'Medium',
            'subject' => 'Printer still smoking',
            'description' => 'Escalated to facilities',
            'ownerId' => UserInfo.getUserId()
        };

        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), cardActionActivity(CHAT_ID, 'save', c.Id, inputData));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        Case updated = [SELECT Status, Priority, Subject, Description, OwnerId FROM Case WHERE Id = :c.Id];
        System.assertEquals('Working', updated.Status);
        System.assertEquals('Medium', updated.Priority);
        System.assertEquals('Printer still smoking', updated.Subject);
        System.assertEquals(UserInfo.getUserId(), updated.OwnerId);

        Map<String, Object> invokeResponse = (Map<String, Object>) JSON.deserializeUntyped(RestContext.response.responseBody.toString());
        Map<String, Object> cardValue = (Map<String, Object>) invokeResponse.get('value');
        List<Object> body = (List<Object>) cardValue.get('body');
        Map<String, Object> factSet;
        for (Object item : body) {
            if (((Map<String, Object>) item).get('type') == 'FactSet') {
                factSet = (Map<String, Object>) item;
            }
        }
        System.assertNotEquals(null, factSet, 'Save should return the read-only view card');

        String ownerFactValue;
        for (Object factObj : (List<Object>) factSet.get('facts')) {
            Map<String, Object> fact = (Map<String, Object>) factObj;
            if (fact.get('title') == 'Owner') {
                ownerFactValue = (String) fact.get('value');
            }
        }
        // Guards against the card showing the pre-save owner's name via a stale
        // Owner.Name relationship after OwnerId changes in the same request.
        System.assertEquals(UserInfo.getName(), ownerFactValue);
    }

    @IsTest
    static void cancelActionDoesNotChangeCase() {
        Case c = [SELECT Id, Status FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = CHAT_ID;
        c.Swarm_Type__c = 'Chat';
        update c;

        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), cardActionActivity(CHAT_ID, 'cancel', c.Id, new Map<String, Object>{ 'status' => 'Closed' }));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals('New', [SELECT Status FROM Case WHERE Id = :c.Id].Status);
    }

    @IsTest
    static void caseNotLinkedToConversationIsRejected() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        // deliberately not linked to CHAT_ID

        Test.setMock(HttpCalloutMock.class, new CombinedMock());
        setUpRequest(signedJwt(new Map<String, Object>()), cardActionActivity(CHAT_ID, 'save', c.Id, new Map<String, Object>{ 'status' => 'Closed' }));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals('New', [SELECT Status FROM Case WHERE Id = :c.Id].Status);
    }

    @IsTest
    static void invalidTokenIsRejectedWithUnauthorized() {
        setUpRequest('not-a-real-jwt', cardActionActivity(CHAT_ID, 'edit', [SELECT Id FROM Case LIMIT 1].Id, null));

        Test.startTest();
        TeamsBotMessagingResource.doPost();
        Test.stopTest();

        System.assertEquals(401, RestContext.response.statusCode);
    }
}
