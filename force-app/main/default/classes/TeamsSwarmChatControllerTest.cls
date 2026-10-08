@IsTest
private class TeamsSwarmChatControllerTest {
    private static final String CHAT_ID = '19:chat-123@thread.v2';

    @TestSetup
    static void setup() {
        insert new Case(
            Subject = 'Chat bridge case',
            Status = 'New',
            Origin = 'Web',
            Swarm_Status__c = 'Active',
            Swarm_Type__c = 'Chat',
            Swarm_Team_Id__c = CHAT_ID,
            Swarm_Team_Url__c = 'https://teams.microsoft.com/l/chat/19%3Achat-123%40thread.v2/0',
            Swarm_Bot_Service_Url__c = 'https://smba.trafficmanager.net/amer/'
        );
    }

    private class ChatGraphMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');

            if (req.getEndpoint().contains('/activities') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"activity-out-1"}');
            } else if (req.getEndpoint().contains('/messages') && req.getMethod() == 'GET') {
                res.setStatusCode(200);
                res.setBody(
                    '{"value":[' +
                        '{"id":"msg-in-1","createdDateTime":"2024-06-01T09:00:00.000Z","body":{"contentType":"html","content":"<p>Hello from Teams</p>"},"from":{"user":{"displayName":"SME User"}}},' +
                        '{"id":"msg-bot-1","createdDateTime":"2024-06-01T10:00:00.000Z","body":{"contentType":"text","content":"Agent: Hello from SF"},"from":{"application":{"displayName":"Case Swarm App"}}}' +
                        ']}'
                );
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    private class GraphFailMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(403);
            res.setBody('{"error":{"message":"Forbidden"}}');
            return res;
        }
    }

    @IsTest
    static void getChatStateEnabledForActiveChat() {
        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        TeamsSwarmChatController.ChatState state = TeamsSwarmChatController.getChatState(c.Id);
        Test.stopTest();

        System.assertEquals(true, state.chatEnabled);
        System.assertEquals(CHAT_ID, state.chatId);
        System.assertEquals('Chat', state.swarmType);
    }

    @IsTest
    static void listActiveChatSwarmsReturnsActiveChatCases() {
        Case c = [SELECT Id, CaseNumber FROM Case LIMIT 1];

        Test.startTest();
        List<TeamsSwarmChatController.ActiveSwarmItem> items = TeamsSwarmChatController.listActiveChatSwarms();
        TeamsSwarmChatController.ActiveSwarmItem one = TeamsSwarmChatController.getActiveChatSwarm(c.Id);
        Test.stopTest();

        System.assertEquals(1, items.size());
        System.assertEquals(c.Id, items[0].caseId);
        System.assertEquals(c.CaseNumber, items[0].caseNumber);
        System.assertEquals(CHAT_ID, items[0].chatId);
        System.assertEquals(true, items[0].botReady);
        System.assertEquals(c.Id, one.caseId);
        System.assertEquals(c.CaseNumber, one.caseNumber);
    }

    @IsTest
    static void getChatStateDisabledForTeamSwarm() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Type__c = 'Team';
        update c;

        Test.startTest();
        TeamsSwarmChatController.ChatState state = TeamsSwarmChatController.getChatState(c.Id);
        Test.stopTest();

        System.assertEquals(false, state.chatEnabled);
        System.assert(state.reason.contains('Chat swarms only'));
    }

    @IsTest
    static void sendMessagePostsAndStoresOutbound() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new ChatGraphMock());

        Test.startTest();
        List<TeamsSwarmChatController.MessageDto> messages = TeamsSwarmChatController.sendMessage(c.Id, 'Hello from SF');
        Test.stopTest();

        System.assertEquals(1, messages.size());
        System.assertEquals('Outbound', messages[0].direction);
        System.assertEquals('bot:activity-out-1', messages[0].teamsMessageId);
        System.assertEquals(UserInfo.getUserId(), messages[0].postedByUserId);
        System.assertEquals('Hello from SF', messages[0].body);
    }

    @IsTest
    static void sendMessageWithoutBotServiceUrlThrows() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Bot_Service_Url__c = null;
        update c;

        try {
            TeamsSwarmChatController.sendMessage(c.Id, 'Hello');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('bot') || e.getMessage().contains('Script-thrown'));
        }
    }

    @IsTest
    static void syncMessagesUpsertsInboundAndSkipsApplicationMessages() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        insert new Swarm_Message__c(
            Case__c = c.Id,
            Teams_Message_Id__c = 'bot:activity-out-1',
            Chat_Id__c = CHAT_ID,
            Body__c = 'Hello from SF',
            Direction__c = 'Outbound',
            Posted_By_User__c = UserInfo.getUserId(),
            Sent_At__c = Datetime.newInstanceGmt(2024, 6, 1, 10, 0, 0),
            Sender_Display_Name__c = UserInfo.getName()
        );

        Test.setMock(HttpCalloutMock.class, new ChatGraphMock());

        Test.startTest();
        List<TeamsSwarmChatController.MessageDto> messages = TeamsSwarmChatController.syncMessages(c.Id);
        Test.stopTest();

        System.assertEquals(2, messages.size());
        Map<String, TeamsSwarmChatController.MessageDto> byId = new Map<String, TeamsSwarmChatController.MessageDto>();
        for (TeamsSwarmChatController.MessageDto dto : messages) {
            byId.put(dto.teamsMessageId, dto);
        }
        System.assertEquals('Inbound', byId.get('msg-in-1').direction);
        System.assertEquals('Hello from Teams', byId.get('msg-in-1').body);
        System.assertEquals('Outbound', byId.get('bot:activity-out-1').direction);
        System.assertEquals(UserInfo.getUserId(), byId.get('bot:activity-out-1').postedByUserId);
    }

    @IsTest
    static void sendMessageEmptyThrows() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        try {
            TeamsSwarmChatController.sendMessage(c.Id, '  ');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('empty') || e.getMessage().contains('Script-thrown'));
        }
    }

    @IsTest
    static void syncMessagesGraphFailureThrows() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new GraphFailMock());

        try {
            Test.startTest();
            TeamsSwarmChatController.syncMessages(c.Id);
            Test.stopTest();
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('sync') || e.getMessage().contains('Script-thrown'));
        }
    }

    @IsTest
    static void listStoredMessagesReturnsOrderedRows() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        insert new List<Swarm_Message__c>{
            new Swarm_Message__c(
                Case__c = c.Id,
                Teams_Message_Id__c = 'a',
                Body__c = 'First',
                Direction__c = 'Inbound',
                Sent_At__c = Datetime.newInstanceGmt(2024, 6, 1, 9, 0, 0)
            ),
            new Swarm_Message__c(
                Case__c = c.Id,
                Teams_Message_Id__c = 'b',
                Body__c = 'Second',
                Direction__c = 'Outbound',
                Sent_At__c = Datetime.newInstanceGmt(2024, 6, 1, 10, 0, 0),
                Posted_By_User__c = UserInfo.getUserId()
            )
        };

        Test.startTest();
        List<TeamsSwarmChatController.MessageDto> messages = TeamsSwarmChatController.listStoredMessages(c.Id);
        Test.stopTest();

        System.assertEquals(2, messages.size());
        System.assertEquals('First', messages[0].body);
        System.assertEquals('Second', messages[1].body);
    }

    @IsTest
    static void persistTranscriptUpsertsByTeamsMessageId() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        List<TeamsSwarmChatController.PersistMessageInput> batch = new List<TeamsSwarmChatController.PersistMessageInput>();
        TeamsSwarmChatController.PersistMessageInput inbound = new TeamsSwarmChatController.PersistMessageInput();
        inbound.teamsMessageId = 'graph-in-1';
        inbound.body = 'Hello from Teams';
        inbound.senderDisplayName = 'SME';
        inbound.direction = 'Inbound';
        inbound.sentAt = '2024-06-01T09:00:00.000Z';
        batch.add(inbound);

        TeamsSwarmChatController.PersistMessageInput outbound = new TeamsSwarmChatController.PersistMessageInput();
        outbound.teamsMessageId = 'graph-out-1';
        outbound.body = 'Reply from agent';
        outbound.senderDisplayName = 'Case Swarm';
        outbound.direction = 'Outbound';
        outbound.sentAt = '2024-06-01T10:00:00.000Z';
        batch.add(outbound);

        Test.startTest();
        Integer first = TeamsSwarmChatController.persistTranscript(c.Id, batch);
        Integer second = TeamsSwarmChatController.persistTranscript(c.Id, batch);
        Test.stopTest();

        System.assertEquals(2, first);
        System.assertEquals(2, second);
        System.assertEquals(2, [SELECT COUNT() FROM Swarm_Message__c WHERE Case__c = :c.Id]);
    }

    @IsTest
    static void endChatSavesTranscriptAndClearsSwarmFields() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        List<TeamsSwarmChatController.PersistMessageInput> batch = new List<TeamsSwarmChatController.PersistMessageInput>();
        TeamsSwarmChatController.PersistMessageInput inbound = new TeamsSwarmChatController.PersistMessageInput();
        inbound.teamsMessageId = 'end-chat-in-1';
        inbound.body = 'Keep this transcript';
        inbound.direction = 'Inbound';
        inbound.sentAt = '2024-06-01T09:00:00.000Z';
        batch.add(inbound);

        Test.startTest();
        TeamsSwarmChatController.EndChatResult result = TeamsSwarmChatController.endChat(c.Id, batch);
        Test.stopTest();

        System.assertEquals(1, result.savedCount);
        System.assertEquals(true, result.swarmCleared);
        System.assertEquals(1, [SELECT COUNT() FROM Swarm_Message__c WHERE Case__c = :c.Id]);

        // Whether the Teams chat gets deleted is org config, so assert against the same
        // CMDT the controller reads rather than a hard-coded expectation.
        Boolean deleteEnabled = Teams_Bot_Config__mdt.getInstance('Default')?.Delete_Teams_Chat_On_End__c == true;
        System.assertEquals(deleteEnabled, result.chatDeleteRequested);

        Case cleared = [
            SELECT Swarm_Status__c, Swarm_Type__c, Swarm_Team_Id__c, Swarm_Bot_Service_Url__c, Swarm_Team_Url__c
            FROM Case
            WHERE Id = :c.Id
        ];
        System.assertEquals(null, cleared.Swarm_Status__c);
        System.assertEquals(null, cleared.Swarm_Type__c);
        System.assertEquals(null, cleared.Swarm_Team_Id__c);
        System.assertEquals(null, cleared.Swarm_Bot_Service_Url__c);
        System.assertEquals(null, cleared.Swarm_Team_Url__c);
    }

    @IsTest
    static void endChatSaveTranscriptIncludesApplicationOutbound() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new ChatGraphMock());

        Test.startTest();
        List<TeamsSwarmChatController.MessageDto> messages = TeamsSwarmChatController.endChatSaveTranscript(c.Id);
        Test.stopTest();

        System.assert(messages.size() >= 2, 'Expected inbound + bot outbound in transcript');
        Set<String> directions = new Set<String>();
        for (TeamsSwarmChatController.MessageDto m : messages) {
            directions.add(m.direction);
        }
        System.assert(directions.contains('Inbound'));
        System.assert(directions.contains('Outbound'));
    }

    /**
     * Adapts its expectations to whatever this org's Teams_Bot_Config__mdt.Default actually has
     * configured, rather than hard-coding an assumption about it (Custom Metadata can't be
     * overridden per-test, and this org's live value can legitimately differ from a fresh org's
     * defaults - e.g. after manually enabling the Azure bridge for other testing).
     */
    @IsTest
    static void getChatBridgeSessionReflectsCurrentCmdtConfig() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
        Boolean bridgeConfigured = config != null
            && config.Use_Azure_Chat_Bridge__c == true
            && String.isNotBlank(config.Chat_Bridge_Azure_Base_Url__c)
            && String.isNotBlank(config.Chat_Bridge_HMAC_Secret__c);

        Test.startTest();
        TeamsSwarmChatController.ChatBridgeSession session = TeamsSwarmChatController.getChatBridgeSession(c.Id);
        Test.stopTest();

        System.assertEquals('/api/negotiate', session.negotiatePath);
        System.assertEquals('/api/joinChat', session.joinPath);
        System.assertEquals(UserInfo.getUserId(), session.userId);
        System.assertEquals(UserInfo.getName(), session.senderName);
        System.assertEquals(bridgeConfigured, session.useAzureBridge);
        if (!bridgeConfigured) {
            System.assertEquals(false, session.useSignalR);
            System.assertNotEquals(null, session.reason);
        }
    }

    @IsTest
    static void mintBridgeTokenProducesTwoPartHmacFormat() {
        Test.startTest();
        TeamsSwarmChatController.BridgeToken token = TeamsSwarmChatController.mintBridgeToken('group-key-1', 'user-1', 'shared-secret');
        Test.stopTest();

        System.assertNotEquals(null, token.token);
        List<String> parts = token.token.split('\\.');
        System.assertEquals(2, parts.size(), token.token);
        System.assert(token.expiresAt > Datetime.now().getTime() / 1000);
    }
}
