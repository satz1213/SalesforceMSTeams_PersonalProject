@IsTest
private class TeamsSwarmChatDeleteQueueableTest {
  private class DeleteMock implements HttpCalloutMock {
    private final Integer status;

    private DeleteMock(Integer status) {
      this.status = status;
    }

    public HttpResponse respond(HttpRequest req) {
      HttpResponse res = new HttpResponse();
      res.setHeader('Content-Type', 'application/json');
      res.setStatusCode(status);
      res.setBody(
        status == 204
          ? ''
          : '{"error":{"code":"Forbidden","message":"Missing Chat.ManageDeletion.All"}}'
      );
      return res;
    }
  }

  private static Id createCase() {
    Case c = new Case(
      Subject = 'Chat delete test case',
      Status = 'New',
      Origin = 'Web',
      Swarm_Chat_Delete_Error__c = 'stale error from a previous attempt'
    );
    insert c;
    return c.Id;
  }

  @IsTest
  static void executeSuccessClearsDeleteError() {
    Id caseId = createCase();
    Test.setMock(HttpCalloutMock.class, new DeleteMock(204));

    Test.startTest();
    new TeamsSwarmChatDeleteQueueable(caseId, '19:chat-id@thread.v2')
      .execute(null);
    Test.stopTest();

    Case updated = [
      SELECT Swarm_Chat_Delete_Error__c
      FROM Case
      WHERE Id = :caseId
    ];
    System.assertEquals(null, updated.Swarm_Chat_Delete_Error__c);
  }

  @IsTest
  static void executeAlreadyDeletedChatIsTreatedAsSuccess() {
    Id caseId = createCase();
    Test.setMock(HttpCalloutMock.class, new DeleteMock(404));

    Test.startTest();
    new TeamsSwarmChatDeleteQueueable(caseId, '19:chat-id@thread.v2')
      .execute(null);
    Test.stopTest();

    Case updated = [
      SELECT Swarm_Chat_Delete_Error__c
      FROM Case
      WHERE Id = :caseId
    ];
    System.assertEquals(null, updated.Swarm_Chat_Delete_Error__c);
  }

  @IsTest
  static void executeFailureRecordsErrorWithoutThrowing() {
    Id caseId = createCase();
    Test.setMock(HttpCalloutMock.class, new DeleteMock(403));

    Test.startTest();
    new TeamsSwarmChatDeleteQueueable(caseId, '19:chat-id@thread.v2')
      .execute(null);
    Test.stopTest();

    Case updated = [
      SELECT Swarm_Chat_Delete_Error__c
      FROM Case
      WHERE Id = :caseId
    ];
    System.assert(
      updated.Swarm_Chat_Delete_Error__c != null &&
      updated.Swarm_Chat_Delete_Error__c.contains('403'),
      'Expected the Graph failure to be recorded on the Case: ' +
      updated.Swarm_Chat_Delete_Error__c
    );
  }

  @IsTest
  static void executeBlankChatIdRecordsError() {
    Id caseId = createCase();
    Test.setMock(HttpCalloutMock.class, new DeleteMock(204));

    Test.startTest();
    new TeamsSwarmChatDeleteQueueable(caseId, null).execute(null);
    Test.stopTest();

    Case updated = [
      SELECT Swarm_Chat_Delete_Error__c
      FROM Case
      WHERE Id = :caseId
    ];
    System.assert(
      updated.Swarm_Chat_Delete_Error__c != null,
      'Expected a missing chat id to be recorded, not silently ignored.'
    );
  }
}
