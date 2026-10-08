@IsTest
private class TeamsSwarmProvisionQueueableTest {
    private class TeamReadyMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().contains('/team')) {
                res.setStatusCode(202);
                res.setBody('{}');
            } else if (req.getEndpoint().endsWith('/v1.0/$batch')) {
                res.setStatusCode(200);
                res.setBody('{"responses":[{"id":"1","status":204}]}');
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

    private class AddMembersFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().contains('/team')) {
                res.setStatusCode(202);
                res.setBody('{}');
            } else if (req.getEndpoint().endsWith('/v1.0/$batch')) {
                res.setStatusCode(200);
                res.setBody('{"responses":[{"id":"1","status":400}]}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    private static Id createCase() {
        Case c = new Case(Subject = 'Queueable test case', Status = 'New', Origin = 'Web', Swarm_Status__c = 'Provisioning');
        insert c;
        return c.Id;
    }

    @IsTest
    static void executeTeamReadyMarksCaseActive() {
        Id caseId = createCase();
        Test.setMock(HttpCalloutMock.class, new TeamReadyMock());

        Test.startTest();
        new TeamsSwarmProvisionQueueable(caseId, 'group-123', new List<String>{ 'aad-1' }, TeamsSwarmProvisionScheduler.MAX_ATTEMPTS).execute(null);
        Test.stopTest();

        Case updated = [SELECT Swarm_Status__c FROM Case WHERE Id = :caseId];
        System.assertEquals('Active', updated.Swarm_Status__c);
    }

    @IsTest
    static void executeTeamNotReadyWithAttemptsRemainingReschedulesWithoutFailing() {
        Id caseId = createCase();
        Test.setMock(HttpCalloutMock.class, new TeamNotReadyMock());

        // Test.startTest() is needed so the callout below isn't blocked by the
        // uncommitted insert above. Deliberately no matching Test.stopTest(): that would
        // drain the newly-scheduled retry job, cascading past the single hop this test
        // is isolating.
        Test.startTest();
        new TeamsSwarmProvisionQueueable(caseId, 'group-123', new List<String>{ 'aad-1' }, 3).execute(null);

        Case updated = [SELECT Swarm_Status__c FROM Case WHERE Id = :caseId];
        System.assertEquals('Provisioning', updated.Swarm_Status__c);

        List<CronTrigger> jobs = [SELECT Id FROM CronTrigger WHERE CronJobDetail.Name LIKE 'TeamsSwarmRetry-group-123-2-%'];
        System.assert(!jobs.isEmpty());
    }

    @IsTest
    static void executeTeamNotReadyLastAttemptMarksFailed() {
        Id caseId = createCase();
        Test.setMock(HttpCalloutMock.class, new TeamNotReadyMock());

        Test.startTest();
        new TeamsSwarmProvisionQueueable(caseId, 'group-123', new List<String>{ 'aad-1' }, 1).execute(null);
        Test.stopTest();

        Case updated = [SELECT Swarm_Status__c FROM Case WHERE Id = :caseId];
        System.assertEquals('Failed', updated.Swarm_Status__c);
    }

    @IsTest
    static void executeAddMembersFailureMarksFailed() {
        Id caseId = createCase();
        Test.setMock(HttpCalloutMock.class, new AddMembersFailsMock());

        Test.startTest();
        new TeamsSwarmProvisionQueueable(caseId, 'group-123', new List<String>{ 'aad-1' }, TeamsSwarmProvisionScheduler.MAX_ATTEMPTS).execute(null);
        Test.stopTest();

        Case updated = [SELECT Swarm_Status__c FROM Case WHERE Id = :caseId];
        System.assertEquals('Failed', updated.Swarm_Status__c);
    }
}
