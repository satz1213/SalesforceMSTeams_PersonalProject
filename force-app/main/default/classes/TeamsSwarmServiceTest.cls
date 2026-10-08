@IsTest
private class TeamsSwarmServiceTest {
    private class GraphCalloutMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');

            if (req.getEndpoint().endsWith('/v1.0/groups') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"group-123"}');
            } else if (req.getEndpoint().contains('/team') && req.getMethod() == 'PUT') {
                res.setStatusCode(202);
                res.setBody('{}');
            } else if (req.getEndpoint().endsWith('/v1.0/$batch') && req.getMethod() == 'POST') {
                res.setStatusCode(200);
                res.setBody('{"responses":[{"id":"1","status":204},{"id":"2","status":204}]}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    private class TeamNotReadyMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(404);
            res.setBody('{"error":{"message":"Not found"}}');
            return res;
        }
    }

    private class TeamAlreadyExistsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(409);
            res.setBody('{"error":{"message":"Team already exists"}}');
            return res;
        }
    }

    private class CreateChatMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(201);
            res.setBody('{"id":"19:chat-123@thread.v2","webUrl":"https://teams.microsoft.com/l/chat/19%3Achat-123%40thread.v2/0?tenantId=tenant-1"}');
            return res;
        }
    }

    private class InstallBotAppMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assert(req.getEndpoint().endsWith('/v1.0/chats/19:chat-123@thread.v2/installedApps'), req.getEndpoint());
            System.assert(req.getBody().contains('consentedPermissionSet'), req.getBody());
            System.assert(req.getBody().contains('ChatMessage.Read.Chat'), req.getBody());
            HttpResponse res = new HttpResponse();
            res.setStatusCode(201);
            res.setBody('{}');
            return res;
        }
    }

    private class InstallBotAppAlreadyInstalledMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(409);
            res.setBody('{"error":{"message":"already installed"}}');
            return res;
        }
    }

    private class GroupCreateFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(403);
            res.setBody('{"error":{"message":"Insufficient privileges"}}');
            return res;
        }
    }

    private class BatchPartialFailureMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().endsWith('/v1.0/groups') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"group-123"}');
            } else if (req.getEndpoint().contains('/team') && req.getMethod() == 'PUT') {
                res.setStatusCode(201);
                res.setBody('{}');
            } else if (req.getEndpoint().endsWith('/v1.0/$batch')) {
                res.setStatusCode(200);
                res.setBody('{"responses":[{"id":"1","status":204},{"id":"2","status":400}]}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    @IsTest
    static void createGroupHappyPathReturnsGroupId() {
        Test.setMock(HttpCalloutMock.class, new GraphCalloutMock());

        Test.startTest();
        String groupId = TeamsSwarmService.createGroup('00001234', 'Sample case', 'aad-owner');
        Test.stopTest();

        System.assertEquals('group-123', groupId);
    }

    @IsTest
    static void createGroupFailsThrows() {
        Test.setMock(HttpCalloutMock.class, new GroupCreateFailsMock());

        Test.startTest();
        try {
            TeamsSwarmService.createGroup('00001234', 'Sample case', 'aad-owner');
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('403'));
        }
        Test.stopTest();
    }

    @IsTest
    static void enableTeamReturnsTrueOnSuccess() {
        Test.setMock(HttpCalloutMock.class, new GraphCalloutMock());

        Test.startTest();
        Boolean ready = TeamsSwarmService.enableTeam('group-123');
        Test.stopTest();

        System.assert(ready);
    }

    @IsTest
    static void enableTeamReturnsTrueWhenAlreadyExists() {
        Test.setMock(HttpCalloutMock.class, new TeamAlreadyExistsMock());

        Test.startTest();
        Boolean ready = TeamsSwarmService.enableTeam('group-123');
        Test.stopTest();

        System.assert(ready);
    }

    @IsTest
    static void enableTeamReturnsFalseWhenNotYetPropagated() {
        Test.setMock(HttpCalloutMock.class, new TeamNotReadyMock());

        Test.startTest();
        Boolean ready = TeamsSwarmService.enableTeam('group-123');
        Test.stopTest();

        System.assert(!ready);
    }

    @IsTest
    static void addMembersBatchPartialFailureThrows() {
        Test.setMock(HttpCalloutMock.class, new BatchPartialFailureMock());

        Test.startTest();
        try {
            TeamsSwarmService.addMembers('group-123', new List<String>{ 'aad-1', 'aad-2' });
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('request 2'));
        }
        Test.stopTest();
    }

    @IsTest
    static void addMembersNoMembersSkipsCallout() {
        Test.startTest();
        TeamsSwarmService.addMembers('group-123', new List<String>());
        Test.stopTest();
    }

    @IsTest
    static void webUrlForBuildsDeepLink() {
        String url = TeamsSwarmService.webUrlFor('group-123');
        System.assert(url.contains('group-123'));
    }

    @IsTest
    static void createChatHappyPathReturnsChatIdAndWebUrl() {
        Test.setMock(HttpCalloutMock.class, new CreateChatMock());

        Test.startTest();
        TeamsSwarmService.ChatResult result = TeamsSwarmService.createChat('00001234', 'Sample case', 'aad-owner', new List<String>{ 'aad-owner', 'aad-1' });
        Test.stopTest();

        System.assertEquals('19:chat-123@thread.v2', result.chatId);
        System.assert(result.webUrl.contains('chat-123'));
    }

    private class CaptureTopicMock implements HttpCalloutMock {
        public String capturedBody;
        public HttpResponse respond(HttpRequest req) {
            capturedBody = req.getBody();
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(201);
            res.setBody('{"id":"19:chat-123@thread.v2","webUrl":"https://teams.microsoft.com/l/chat/19%3Achat-123%40thread.v2/0"}');
            return res;
        }
    }

    @IsTest
    static void createChatFourArgOverloadStillPrefixesCaseSwarmTopic() {
        CaptureTopicMock mock = new CaptureTopicMock();
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        TeamsSwarmService.createChat('00001234', 'Sample case', 'aad-owner', new List<String>{ 'aad-owner' });
        Test.stopTest();

        System.assert(mock.capturedBody.contains('Case Swarm - 00001234 - Sample case'), mock.capturedBody);
    }

    @IsTest
    static void createChatThreeArgOverloadUsesTopicAsIs() {
        CaptureTopicMock mock = new CaptureTopicMock();
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        TeamsSwarmService.ChatResult result = TeamsSwarmService.createChat('Messaging Chat - abc123', 'aad-owner', new List<String>{ 'aad-owner' });
        Test.stopTest();

        System.assert(mock.capturedBody.contains('Messaging Chat - abc123'), mock.capturedBody);
        System.assert(!mock.capturedBody.contains('Case Swarm'), mock.capturedBody);
        System.assertEquals('19:chat-123@thread.v2', result.chatId);
    }

    @IsTest
    static void createChatFailsThrows() {
        Test.setMock(HttpCalloutMock.class, new GroupCreateFailsMock());

        Test.startTest();
        try {
            TeamsSwarmService.createChat('00001234', 'Sample case', 'aad-owner', new List<String>{ 'aad-owner' });
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('403'));
        }
        Test.stopTest();
    }

    @IsTest
    static void addChatMembersBatchPartialFailureThrows() {
        Test.setMock(HttpCalloutMock.class, new BatchPartialFailureMock());

        Test.startTest();
        try {
            TeamsSwarmService.addChatMembers('19:chat-123@thread.v2', new List<String>{ 'aad-1', 'aad-2' });
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('request 2'));
        }
        Test.stopTest();
    }

    @IsTest
    static void addChatMembersNoMembersSkipsCallout() {
        Test.startTest();
        TeamsSwarmService.addChatMembers('19:chat-123@thread.v2', new List<String>());
        Test.stopTest();
    }

    @IsTest
    static void installBotAppHappyPathSucceeds() {
        Test.setMock(HttpCalloutMock.class, new InstallBotAppMock());

        Test.startTest();
        TeamsSwarmService.installBotApp('19:chat-123@thread.v2', 'catalog-app-1');
        Test.stopTest();
    }

    @IsTest
    static void installBotAppAlreadyInstalledSucceeds() {
        Test.setMock(HttpCalloutMock.class, new InstallBotAppAlreadyInstalledMock());

        Test.startTest();
        TeamsSwarmService.installBotApp('19:chat-123@thread.v2', 'catalog-app-1');
        Test.stopTest();
    }

    @IsTest
    static void installBotAppMissingCatalogIdThrows() {
        Test.startTest();
        try {
            TeamsSwarmService.installBotApp('19:chat-123@thread.v2', null);
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('Teams_App_Catalog_Id__c'));
        }
        Test.stopTest();
    }

    @IsTest
    static void installBotAppFailureThrows() {
        Test.setMock(HttpCalloutMock.class, new GroupCreateFailsMock());

        Test.startTest();
        try {
            TeamsSwarmService.installBotApp('19:chat-123@thread.v2', 'catalog-app-1');
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('403'));
        }
        Test.stopTest();
    }

    private class SendChatMessageMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assert(req.getEndpoint().contains('/messages'), req.getEndpoint());
            System.assertEquals('POST', req.getMethod());
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(201);
            res.setBody(
                '{"id":"msg-1","createdDateTime":"2024-06-01T10:00:00.000Z","body":{"contentType":"text","content":"Hi"},"from":{"application":{"displayName":"App"}}}'
            );
            return res;
        }
    }

    private class ListChatMessagesMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assert(req.getEndpoint().contains('/messages?$top='), req.getEndpoint());
            System.assertEquals('GET', req.getMethod());
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(200);
            res.setBody(
                '{"value":[{"id":"msg-1","createdDateTime":"2024-06-01T10:00:00.000Z","body":{"contentType":"html","content":"<div>Hi</div>"},"from":{"user":{"displayName":"Ada"}}}]}'
            );
            return res;
        }
    }

    @IsTest
    static void sendChatMessageHappyPath() {
        Test.setMock(HttpCalloutMock.class, new SendChatMessageMock());

        Test.startTest();
        TeamsSwarmService.ChatMessageResult result = TeamsSwarmService.sendChatMessage('19:chat-123@thread.v2', 'Hi');
        Test.stopTest();

        System.assertEquals('msg-1', result.id);
        System.assertEquals('Hi', result.body);
    }

    @IsTest
    static void listChatMessagesHappyPathStripsHtml() {
        Test.setMock(HttpCalloutMock.class, new ListChatMessagesMock());

        Test.startTest();
        List<TeamsSwarmService.ChatMessageResult> results = TeamsSwarmService.listChatMessages('19:chat-123@thread.v2', 20);
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals('Hi', results[0].body);
        System.assertEquals('Ada', results[0].senderDisplayName);
    }

    @IsTest
    static void sendChatMessageBlankThrows() {
        try {
            TeamsSwarmService.sendChatMessage('19:chat-123@thread.v2', '  ');
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('content'));
        }
    }

    private class ListGroupMembersMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assert(req.getEndpoint().contains('/v1.0/groups/group-123/members'), req.getEndpoint());
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(200);
            res.setBody('{"value":[{"id":"aad-obj-1","displayName":"Ada Lovelace","mail":"ada@example.com","userPrincipalName":"ada@example.com"}]}');
            return res;
        }
    }

    @IsTest
    static void listGroupMembersHappyPathReturnsMembers() {
        Test.setMock(HttpCalloutMock.class, new ListGroupMembersMock());

        Test.startTest();
        List<TeamsSwarmService.MemberInfo> members = TeamsSwarmService.listGroupMembers('group-123');
        Test.stopTest();

        System.assertEquals(1, members.size());
        System.assertEquals('aad-obj-1', members[0].removalId);
        System.assertEquals('ada@example.com', members[0].email);
        System.assertEquals(false, members[0].isOwner);
    }

    @IsTest
    static void removeGroupMemberBlankIdThrows() {
        Test.startTest();
        try {
            TeamsSwarmService.removeGroupMember('group-123', null);
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('object id'));
        }
        Test.stopTest();
    }

    private class RemoveMemberSucceedsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assertEquals('DELETE', req.getMethod());
            HttpResponse res = new HttpResponse();
            res.setStatusCode(204);
            return res;
        }
    }

    @IsTest
    static void removeGroupMemberCalloutSucceeds() {
        Test.setMock(HttpCalloutMock.class, new RemoveMemberSucceedsMock());

        Test.startTest();
        TeamsSwarmService.removeGroupMember('group-123', 'aad-obj-1');
        Test.stopTest();
    }

    private class ListChatMembersMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assert(req.getEndpoint().endsWith('/v1.0/chats/19:chat-123@thread.v2/members'), req.getEndpoint());
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            res.setStatusCode(200);
            res.setBody('{"value":[' +
                '{"id":"membership-owner","displayName":"Case Owner","email":"owner@example.com","roles":["owner"]},' +
                '{"id":"membership-guest","displayName":"Ada Lovelace","email":"ada@example.com","roles":["guest"]}' +
                ']}');
            return res;
        }
    }

    @IsTest
    static void listChatMembersHappyPathFlagsOwner() {
        Test.setMock(HttpCalloutMock.class, new ListChatMembersMock());

        Test.startTest();
        List<TeamsSwarmService.MemberInfo> members = TeamsSwarmService.listChatMembers('19:chat-123@thread.v2');
        Test.stopTest();

        System.assertEquals(2, members.size());
        System.assertEquals(true, members[0].isOwner);
        System.assertEquals(false, members[1].isOwner);
        System.assertEquals('membership-guest', members[1].removalId);
    }

    @IsTest
    static void removeChatMemberBlankMembershipIdThrows() {
        Test.startTest();
        try {
            TeamsSwarmService.removeChatMember('19:chat-123@thread.v2', null);
            System.assert(false, 'Expected TeamsSwarmException');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            System.assert(e.getMessage().contains('membership id'));
        }
        Test.stopTest();
    }

    @IsTest
    static void removeChatMemberAlreadyGoneSucceeds() {
        Test.setMock(HttpCalloutMock.class, new TeamNotReadyMock());

        Test.startTest();
        TeamsSwarmService.removeChatMember('19:chat-123@thread.v2', 'membership-guest');
        Test.stopTest();
    }
}
