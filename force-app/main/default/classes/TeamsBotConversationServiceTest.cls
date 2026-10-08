@IsTest
private class TeamsBotConversationServiceTest {
    private class SendCardMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assertEquals('POST', req.getMethod());
            System.assert(req.getEndpoint().endsWith('/v3/conversations/19%3Achat-123%40thread.v2/activities'), req.getEndpoint());

            HttpResponse res = new HttpResponse();
            res.setStatusCode(201);
            res.setHeader('Content-Type', 'application/json');
            res.setBody('{"id":"activity-456"}');
            return res;
        }
    }

    private class SendCardFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(403);
            res.setBody('{"error":"insufficient privileges"}');
            return res;
        }
    }

    @IsTest
    static void sendCardHappyPathReturnsActivityId() {
        Test.setMock(HttpCalloutMock.class, new SendCardMock());

        Test.startTest();
        String activityId = TeamsBotConversationService.sendCard(
            'https://smba.trafficmanager.net/amer/',
            '19:chat-123@thread.v2',
            new Map<String, Object>{ 'type' => 'AdaptiveCard' }
        );
        Test.stopTest();

        System.assertEquals('activity-456', activityId);
    }

    @IsTest
    static void sendTextHappyPathReturnsActivityId() {
        Test.setMock(HttpCalloutMock.class, new SendCardMock());

        Test.startTest();
        String activityId = TeamsBotConversationService.sendText(
            'https://smba.trafficmanager.net/amer/',
            '19:chat-123@thread.v2',
            'Hello from Salesforce'
        );
        Test.stopTest();

        System.assertEquals('activity-456', activityId);
    }

    @IsTest
    static void sendAgentTextIncludesOnBehalfOf() {
        Test.setMock(HttpCalloutMock.class, new SendCardMock());

        Test.startTest();
        String activityId = TeamsBotConversationService.sendAgentText(
            'https://smba.trafficmanager.net/amer/',
            '19:chat-123@thread.v2',
            'Hello from Salesforce',
            'Ada Lovelace',
            '11111111-2222-3333-4444-555555555555'
        );
        Test.stopTest();

        System.assertEquals('activity-456', activityId);
    }

    @IsTest
    static void sendTextBlankThrows() {
        try {
            TeamsBotConversationService.sendText('https://smba.trafficmanager.net/amer/', '19:chat-123@thread.v2', '  ');
            System.assert(false, 'Expected TeamsBotConversationException');
        } catch (TeamsBotConversationService.TeamsBotConversationException e) {
            System.assert(e.getMessage().contains('text'));
        }
    }

    @IsTest
    static void sendCardFailureThrows() {
        Test.setMock(HttpCalloutMock.class, new SendCardFailsMock());

        Test.startTest();
        try {
            TeamsBotConversationService.sendCard('https://smba.trafficmanager.net/amer/', '19:chat-123@thread.v2', new Map<String, Object>{ 'type' => 'AdaptiveCard' });
            System.assert(false, 'Expected TeamsBotConversationException');
        } catch (TeamsBotConversationService.TeamsBotConversationException e) {
            System.assert(e.getMessage().contains('403'));
        }
        Test.stopTest();
    }

    @IsTest
    static void unexpectedServiceUrlHostThrowsBeforeCallout() {
        Test.startTest();
        try {
            TeamsBotConversationService.sendCard('https://someothertenant.example.com/', '19:chat-123@thread.v2', new Map<String, Object>{ 'type' => 'AdaptiveCard' });
            System.assert(false, 'Expected TeamsBotConversationException');
        } catch (TeamsBotConversationService.TeamsBotConversationException e) {
            System.assert(e.getMessage().contains('Unexpected Bot Framework serviceUrl host'));
        }
        Test.stopTest();
    }
}
