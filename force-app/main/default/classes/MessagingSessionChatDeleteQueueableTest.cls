@IsTest
private class MessagingSessionChatDeleteQueueableTest {
    private class DeleteSucceedsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            System.assertEquals('DELETE', req.getMethod());
            HttpResponse res = new HttpResponse();
            res.setStatusCode(204);
            return res;
        }
    }

    private class DeleteFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(403);
            res.setBody('{"error":{"message":"Insufficient privileges"}}');
            return res;
        }
    }

    @IsTest
    static void executeSucceedsSilently() {
        Test.setMock(HttpCalloutMock.class, new DeleteSucceedsMock());

        Test.startTest();
        new MessagingSessionChatDeleteQueueable(UserInfo.getUserId(), '19:msgchat-delete@thread.v2').execute(null);
        Test.stopTest();
        // No exception escaping execute() is the pass condition here.
    }

    @IsTest
    static void executeFailureIsSwallowed() {
        Test.setMock(HttpCalloutMock.class, new DeleteFailsMock());

        Test.startTest();
        new MessagingSessionChatDeleteQueueable(UserInfo.getUserId(), '19:msgchat-delete@thread.v2').execute(null);
        Test.stopTest();
        // Best-effort by design (see class doc comment) - a Graph failure must not throw out of execute().
    }
}
