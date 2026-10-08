@IsTest
private class MessagingSessionTeamsChatControllerTest {
    /**
     * Adapts its expectations to whatever this org's Teams_Bot_Config__mdt.Default actually has
     * configured, rather than hard-coding an assumed value - Custom Metadata can't be overridden
     * per-test, and its live value can legitimately differ across orgs/environments.
     */
    @IsTest
    static void getEmbedSessionReflectsCurrentCmdtConfig() {
        Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
        Id fakeSessionId = UserInfo.getUserId(); // getEmbedSession never queries this - any valid Id works.

        Test.startTest();
        MessagingSessionTeamsChatController.EmbedSession session = MessagingSessionTeamsChatController.getEmbedSession(fakeSessionId);
        Test.stopTest();

        System.assertEquals('/api/negotiate', session.negotiatePath);
        System.assertEquals('/api/joinChat', session.joinPath);
        System.assertEquals(UserInfo.getUserId(), session.userId);

        Boolean expectEnabled = config != null
            && config.Use_Azure_SignalR__c == true
            && String.isNotBlank(config.Chat_Bridge_Azure_Base_Url__c)
            && String.isNotBlank(config.Chat_Bridge_HMAC_Secret__c);

        System.assertEquals(expectEnabled, session.useSignalR);
        if (expectEnabled) {
            System.assertNotEquals(null, session.token);
            System.assertNotEquals(null, session.tokenExpiresAt);
            System.assertNotEquals(null, session.azureBaseUrl);
        } else {
            System.assertNotEquals(null, session.reason);
        }
    }

    private static Id createMessagingSession(String chatId, String serviceUrl) {
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
            Teams_Bot_Service_Url__c = serviceUrl
        );
        insert session;
        return session.Id;
    }

    @IsTest
    static void getChatSessionNotReadyWhenChatFieldsBlank() {
        Id sessionId = createMessagingSession(null, null);

        Test.startTest();
        MessagingSessionTeamsChatController.ChatSession session = MessagingSessionTeamsChatController.getChatSession(sessionId);
        Test.stopTest();

        System.assertEquals(false, session.chatReady);
        System.assertNotEquals(null, session.reason);
    }

    /**
     * Adapts its expectations to whatever this org's Teams_Bot_Config__mdt.Default actually has
     * configured, same reasoning as getEmbedSessionReflectsCurrentCmdtConfig above.
     */
    @IsTest
    static void getChatSessionReflectsCurrentCmdtConfigWhenChatReady() {
        Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
        Id sessionId = createMessagingSession('19:msgchat-session-test@thread.v2', 'https://smba.trafficmanager.net/amer/');

        Test.startTest();
        MessagingSessionTeamsChatController.ChatSession session = MessagingSessionTeamsChatController.getChatSession(sessionId);
        Test.stopTest();

        System.assertEquals('/api/chatHistory', session.historyPath);
        System.assertEquals('/api/chatSend', session.sendPath);
        System.assertEquals('/api/negotiate', session.negotiatePath);
        System.assertEquals('/api/joinChat', session.joinPath);
        System.assertEquals(UserInfo.getUserId(), session.userId);
        System.assertEquals(UserInfo.getName(), session.senderName);

        Boolean expectEnabled = config != null
            && config.Use_Azure_SignalR__c == true
            && String.isNotBlank(config.Chat_Bridge_Azure_Base_Url__c)
            && String.isNotBlank(config.Chat_Bridge_HMAC_Secret__c);

        System.assertEquals(expectEnabled, session.chatReady);
        if (expectEnabled) {
            System.assertEquals('19:msgchat-session-test@thread.v2', session.chatId);
            System.assertEquals('https://smba.trafficmanager.net/amer/', session.serviceUrl);
            System.assertNotEquals(null, session.token);
        } else {
            System.assertNotEquals(null, session.reason);
        }
    }

    private class EndChatMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().contains('/messages?$top=') && req.getMethod() == 'GET') {
                res.setStatusCode(200);
                res.setBody(
                    '{"value":[' +
                        '{"id":"msg-1","createdDateTime":"2024-06-01T10:00:00.000Z","body":{"contentType":"text","content":"Hi there"},"from":{"user":{"displayName":"Ada"}}},' +
                        '{"id":"msg-2","createdDateTime":"2024-06-01T10:01:00.000Z","body":{"contentType":"text","content":"Hello"},"from":{"application":{"displayName":"Case Swarm App"}}}' +
                        ']}'
                );
            } else if (req.getMethod() == 'DELETE') {
                res.setStatusCode(204);
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    @IsTest
    static void endChatNoTeamsChatThrowsAuraHandledException() {
        Id sessionId = createMessagingSession(null, null);

        Test.startTest();
        try {
            MessagingSessionTeamsChatController.endChat(sessionId);
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void endChatArchivesTranscriptAndClearsTeamsFields() {
        Id sessionId = createMessagingSession('19:msgchat-endtest@thread.v2', 'https://smba.trafficmanager.net/amer/');
        Test.setMock(HttpCalloutMock.class, new EndChatMock());

        Test.startTest();
        MessagingSessionTeamsChatController.EndChatResult result = MessagingSessionTeamsChatController.endChat(sessionId);
        Test.stopTest();

        System.assertEquals(2, result.savedCount);

        List<Swarm_Message__c> saved = [
            SELECT Direction__c, Body__c
            FROM Swarm_Message__c
            WHERE Messaging_Session__c = :sessionId
            ORDER BY Sent_At__c ASC
        ];
        System.assertEquals(2, saved.size());
        System.assertEquals('Inbound', saved[0].Direction__c);
        System.assertEquals('Outbound', saved[1].Direction__c);

        MessagingSession updated = [
            SELECT Teams_Chat_Id__c, Teams_Chat_Url__c, Teams_Bot_Service_Url__c
            FROM MessagingSession
            WHERE Id = :sessionId
        ];
        System.assertEquals(null, updated.Teams_Chat_Id__c);
        System.assertEquals(null, updated.Teams_Chat_Url__c);
        System.assertEquals(null, updated.Teams_Bot_Service_Url__c);
    }
}
