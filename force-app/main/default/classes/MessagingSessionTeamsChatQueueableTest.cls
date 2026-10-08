@IsTest
private class MessagingSessionTeamsChatQueueableTest {
    private class CreateChatAndInstallSucceedsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().endsWith('/v1.0/chats') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"19:msgchat-1@thread.v2","webUrl":"https://teams.microsoft.com/l/chat/19%3Amsgchat-1%40thread.v2/0"}');
            } else if (req.getEndpoint().endsWith('/installedApps')) {
                res.setStatusCode(201);
                res.setBody('{}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    private class CreateChatSucceedsBotInstallFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().endsWith('/v1.0/chats') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"19:msgchat-1@thread.v2","webUrl":"https://teams.microsoft.com/l/chat/19%3Amsgchat-1%40thread.v2/0"}');
            } else if (req.getEndpoint().endsWith('/installedApps')) {
                res.setStatusCode(404);
                res.setBody('{"error":{"message":"catalog app not found"}}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    private class CreateChatFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(403);
            res.setBody('{"error":{"message":"Insufficient privileges"}}');
            return res;
        }
    }

    private class NoCalloutAllowedMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assert(false, 'No callout should have been made: ' + req.getEndpoint());
            return new HttpResponse();
        }
    }

    private class CaptureChatBodyMock implements HttpCalloutMock {
        public String capturedChatBody;
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().endsWith('/v1.0/chats') && req.getMethod() == 'POST') {
                capturedChatBody = req.getBody();
                res.setStatusCode(201);
                res.setBody('{"id":"19:msgchat-1@thread.v2","webUrl":"https://teams.microsoft.com/l/chat/19%3Amsgchat-1%40thread.v2/0"}');
            } else if (req.getEndpoint().endsWith('/installedApps')) {
                res.setStatusCode(201);
                res.setBody('{}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    private static List<Id> createAgentAndCustomerUsers() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'agent@example.com';
        update runningUser;

        List<User> otherUsers = [
            SELECT Id
            FROM User
            WHERE IsActive = true AND UserType = 'Standard' AND Id != :UserInfo.getUserId()
            LIMIT 1
        ];
        if (otherUsers.isEmpty()) {
            return null;
        }
        otherUsers[0].Azure_AD_Email_Id__c = 'customer@example.com';
        update otherUsers[0];

        return new List<Id>{ UserInfo.getUserId(), otherUsers[0].Id };
    }

    private static Id createMessagingSession() {
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
            Status = 'Active'
        );
        insert session;
        return session.Id;
    }

    @IsTest
    static void createChatAndInstallBotSucceedsWritesFields() {
        List<Id> userIds = createAgentAndCustomerUsers();
        if (userIds == null) {
            return; // No second Standard user available in this org to exercise this test with.
        }
        Id sessionId = createMessagingSession();
        Test.setMock(HttpCalloutMock.class, new CreateChatAndInstallSucceedsMock());

        Test.startTest();
        new MessagingSessionTeamsChatQueueable(sessionId, userIds[0], userIds[1]).execute(null);
        Test.stopTest();

        MessagingSession updated = [SELECT Teams_Chat_Id__c, Teams_Chat_Url__c FROM MessagingSession WHERE Id = :sessionId];
        System.assertEquals('19:msgchat-1@thread.v2', updated.Teams_Chat_Id__c);
        System.assert(updated.Teams_Chat_Url__c.contains('msgchat-1'));
    }

    @IsTest
    static void botInstallFailureStillWritesChatFields() {
        List<Id> userIds = createAgentAndCustomerUsers();
        if (userIds == null) {
            return;
        }
        Id sessionId = createMessagingSession();
        Test.setMock(HttpCalloutMock.class, new CreateChatSucceedsBotInstallFailsMock());

        Test.startTest();
        new MessagingSessionTeamsChatQueueable(sessionId, userIds[0], userIds[1]).execute(null);
        Test.stopTest();

        MessagingSession updated = [SELECT Teams_Chat_Id__c, Teams_Chat_Url__c FROM MessagingSession WHERE Id = :sessionId];
        System.assertEquals('19:msgchat-1@thread.v2', updated.Teams_Chat_Id__c);
    }

    @IsTest
    static void createChatFailureLeavesFieldsBlank() {
        List<Id> userIds = createAgentAndCustomerUsers();
        if (userIds == null) {
            return;
        }
        Id sessionId = createMessagingSession();
        Test.setMock(HttpCalloutMock.class, new CreateChatFailsMock());

        Test.startTest();
        new MessagingSessionTeamsChatQueueable(sessionId, userIds[0], userIds[1]).execute(null);
        Test.stopTest();

        MessagingSession updated = [SELECT Teams_Chat_Id__c, Teams_Chat_Url__c FROM MessagingSession WHERE Id = :sessionId];
        System.assertEquals(null, updated.Teams_Chat_Id__c);
        System.assertEquals(null, updated.Teams_Chat_Url__c);
    }

    @IsTest
    static void blankAzureEmailSkipsWithNoCallout() {
        Id sessionId = createMessagingSession();
        // Explicitly cleared rather than assumed blank - this real user may already have a real
        // Azure_AD_Email_Id__c value persisted outside of any test transaction (e.g. from manual
        // swarm testing in this org), so the guard must be forced, not relied on as a default.
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = null;
        update runningUser;
        Test.setMock(HttpCalloutMock.class, new NoCalloutAllowedMock());

        Test.startTest();
        new MessagingSessionTeamsChatQueueable(sessionId, UserInfo.getUserId(), UserInfo.getUserId()).execute(null);
        Test.stopTest();

        MessagingSession updated = [SELECT Teams_Chat_Id__c FROM MessagingSession WHERE Id = :sessionId];
        System.assertEquals(null, updated.Teams_Chat_Id__c);
    }

    @IsTest
    static void sameAgentAndCustomerIdentityCreatesSingleMemberChat() {
        Id sessionId = createMessagingSession();
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'solo-tester@example.com';
        update runningUser;
        CaptureChatBodyMock mock = new CaptureChatBodyMock();
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        new MessagingSessionTeamsChatQueueable(sessionId, UserInfo.getUserId(), UserInfo.getUserId()).execute(null);
        Test.stopTest();

        MessagingSession updated = [SELECT Teams_Chat_Id__c FROM MessagingSession WHERE Id = :sessionId];
        System.assertEquals('19:msgchat-1@thread.v2', updated.Teams_Chat_Id__c);

        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(mock.capturedChatBody);
        List<Object> members = (List<Object>) body.get('members');
        System.assertEquals(1, members.size(), mock.capturedChatBody);
    }
}
