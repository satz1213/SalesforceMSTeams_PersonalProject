@IsTest
private class MessagingSessionTeamsChatHandlerTest {
    private class ChatCreationSucceedsMock implements HttpCalloutMock {
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

    private class NoCalloutAllowedMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assert(false, 'No callout should have been made: ' + req.getEndpoint());
            return new HttpResponse();
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
            Status = 'Waiting'
        );
        insert session;
        return session.Id;
    }

    @IsTest
    static void acceptingChatEnqueuesChatCreation() {
        List<Id> userIds = createAgentAndCustomerUsers();
        if (userIds == null) {
            return; // No second Standard user available in this org to exercise this test with.
        }
        Id sessionId = createMessagingSession();
        Test.setMock(HttpCalloutMock.class, new ChatCreationSucceedsMock());

        MessagingSession previous = new MessagingSession(Id = sessionId, Status = 'Waiting');
        MessagingSession justAccepted = new MessagingSession(
            Id = sessionId,
            Status = 'Active',
            OwnerId = userIds[0],
            User__c = userIds[1],
            Teams_Chat_Id__c = null
        );

        Test.startTest();
        MessagingSessionTeamsChatHandler.handleAfterUpdate(
            new List<MessagingSession>{ justAccepted },
            new Map<Id, MessagingSession>{ sessionId => previous }
        );
        Test.stopTest();

        MessagingSession updated = [SELECT Teams_Chat_Id__c FROM MessagingSession WHERE Id = :sessionId];
        System.assertEquals('19:msgchat-1@thread.v2', updated.Teams_Chat_Id__c);
    }

    @IsTest
    static void alreadyHasChatIdIsIdempotent() {
        Id sessionId = createMessagingSession();
        Test.setMock(HttpCalloutMock.class, new NoCalloutAllowedMock());

        MessagingSession previous = new MessagingSession(Id = sessionId, Status = 'Paused');
        MessagingSession reactivated = new MessagingSession(
            Id = sessionId,
            Status = 'Active',
            OwnerId = UserInfo.getUserId(),
            User__c = UserInfo.getUserId(),
            Teams_Chat_Id__c = '19:already-exists@thread.v2'
        );

        Test.startTest();
        MessagingSessionTeamsChatHandler.handleAfterUpdate(
            new List<MessagingSession>{ reactivated },
            new Map<Id, MessagingSession>{ sessionId => previous }
        );
        Test.stopTest();
        // NoCalloutAllowedMock would have failed the test if a callout was attempted.
    }

    @IsTest
    static void ownerStillAQueueIsSkipped() {
        Id sessionId = createMessagingSession();
        Test.setMock(HttpCalloutMock.class, new NoCalloutAllowedMock());

        List<Group> queues = [SELECT Id FROM Group WHERE Type = 'Queue' LIMIT 1];
        Id queueId = queues.isEmpty() ? null : queues[0].Id;
        if (queueId == null) {
            return; // No queue available in this org to exercise this branch with.
        }

        MessagingSession previous = new MessagingSession(Id = sessionId, Status = 'Waiting');
        MessagingSession stillQueued = new MessagingSession(
            Id = sessionId,
            Status = 'Active',
            OwnerId = queueId,
            User__c = UserInfo.getUserId(),
            Teams_Chat_Id__c = null
        );

        Test.startTest();
        MessagingSessionTeamsChatHandler.handleAfterUpdate(
            new List<MessagingSession>{ stillQueued },
            new Map<Id, MessagingSession>{ sessionId => previous }
        );
        Test.stopTest();
    }

    @IsTest
    static void blankUserFieldIsSkipped() {
        Id sessionId = createMessagingSession();
        Test.setMock(HttpCalloutMock.class, new NoCalloutAllowedMock());

        MessagingSession previous = new MessagingSession(Id = sessionId, Status = 'Waiting');
        MessagingSession noCustomer = new MessagingSession(
            Id = sessionId,
            Status = 'Active',
            OwnerId = UserInfo.getUserId(),
            User__c = null,
            Teams_Chat_Id__c = null
        );

        Test.startTest();
        MessagingSessionTeamsChatHandler.handleAfterUpdate(
            new List<MessagingSession>{ noCustomer },
            new Map<Id, MessagingSession>{ sessionId => previous }
        );
        Test.stopTest();
    }
}
