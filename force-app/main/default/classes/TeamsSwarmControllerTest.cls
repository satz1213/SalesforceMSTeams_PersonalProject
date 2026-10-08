@IsTest
private class TeamsSwarmControllerTest {
    @TestSetup
    static void setup() {
        Case c = new Case(Subject = 'Test swarm case', Status = 'New', Origin = 'Web');
        insert c;
    }

    private class GraphCalloutMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().endsWith('/v1.0/groups') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"group-123"}');
            } else if (req.getEndpoint().endsWith('/v1.0/chats') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"19:chat-123@thread.v2","webUrl":"https://teams.microsoft.com/l/chat/19%3Achat-123%40thread.v2/0?tenantId=tenant-1"}');
            } else if (req.getEndpoint().contains('/team')) {
                res.setStatusCode(202);
                res.setBody('{}');
            } else if (req.getEndpoint().endsWith('/v1.0/$batch')) {
                res.setStatusCode(200);
                res.setBody('{"responses":[{"id":"1","status":204}]}');
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

    @IsTest
    static void searchUsersReturnsOnlyUsersWithAadEmailId() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Test.startTest();
        List<TeamsSwarmController.UserOption> results = TeamsSwarmController.searchUsers('');
        Test.stopTest();

        Set<Id> resultIds = new Set<Id>();
        for (TeamsSwarmController.UserOption opt : results) {
            resultIds.add(opt.userId);
        }
        System.assert(resultIds.contains(UserInfo.getUserId()));
    }

    @IsTest
    static void startSwarmTeamHappyPathCreatesGroupAndSchedulesProvisioning() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new GraphCalloutMock());

        Test.startTest();
        TeamsSwarmController.StartSwarmResult result = TeamsSwarmController.startSwarm(c.Id, new List<Id>{ UserInfo.getUserId() }, 'Team');
        Test.stopTest();

        System.assertEquals('group-123', result.groupId);

        // Test.stopTest() drains the scheduled retry job itself (which just enqueues a
        // Queueable) but doesn't cascade into draining that freshly-enqueued Queueable too,
        // so the status is still Provisioning here - see TeamsSwarmProvisionQueueableTest
        // for the retry/success/failure branches tested in isolation.
        Case updated = [SELECT Swarm_Team_Id__c, Swarm_Group_Id__c, Swarm_Team_Url__c, Swarm_Status__c, Swarm_Type__c FROM Case WHERE Id = :c.Id];
        System.assertEquals('group-123', updated.Swarm_Group_Id__c);
        System.assertEquals('Provisioning', updated.Swarm_Status__c);
        System.assertEquals('Team', updated.Swarm_Type__c);
    }

    @IsTest
    static void startSwarmChatHappyPathCreatesChatAndMarksActiveImmediately() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new GraphCalloutMock());

        Test.startTest();
        TeamsSwarmController.StartSwarmResult result = TeamsSwarmController.startSwarm(c.Id, new List<Id>{ UserInfo.getUserId() }, 'Chat');
        Test.stopTest();

        System.assertEquals('19:chat-123@thread.v2', result.teamId);
        System.assertEquals(null, result.groupId);

        Case updated = [SELECT Swarm_Team_Id__c, Swarm_Group_Id__c, Swarm_Team_Url__c, Swarm_Status__c, Swarm_Type__c, Swarm_Bot_Install_Error__c FROM Case WHERE Id = :c.Id];
        System.assertEquals('19:chat-123@thread.v2', updated.Swarm_Team_Id__c);
        System.assertEquals(null, updated.Swarm_Group_Id__c);
        System.assertEquals('Active', updated.Swarm_Status__c);
        System.assertEquals(null, updated.Swarm_Bot_Install_Error__c);
        System.assertEquals('Chat', updated.Swarm_Type__c);
        System.assert(updated.Swarm_Team_Url__c.contains('chat'));
    }

    private class BotInstallFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            if (req.getEndpoint().endsWith('/v1.0/chats') && req.getMethod() == 'POST') {
                res.setStatusCode(201);
                res.setBody('{"id":"19:chat-123@thread.v2","webUrl":"https://teams.microsoft.com/l/chat/19%3Achat-123%40thread.v2/0?tenantId=tenant-1"}');
            } else if (req.getEndpoint().endsWith('/installedApps')) {
                res.setStatusCode(404);
                res.setBody('{"error":{"message":"App catalog id not found - has it been uploaded?"}}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    @IsTest
    static void startSwarmChatSucceedsEvenWhenBotInstallFailsAndRecordsWhy() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new BotInstallFailsMock());

        Test.startTest();
        TeamsSwarmController.StartSwarmResult result = TeamsSwarmController.startSwarm(c.Id, new List<Id>{ UserInfo.getUserId() }, 'Chat');
        Test.stopTest();

        // The chat itself is the primary value and must still succeed...
        System.assertEquals('19:chat-123@thread.v2', result.teamId);
        Case updated = [SELECT Swarm_Status__c, Swarm_Bot_Install_Error__c FROM Case WHERE Id = :c.Id];
        System.assertEquals('Active', updated.Swarm_Status__c);
        // ...but why the card never shows up should be visible on the record, not swallowed.
        System.assert(updated.Swarm_Bot_Install_Error__c.contains('404'));
    }

    @IsTest
    static void startSwarmInvalidTypeThrowsAuraHandledException() {
        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        try {
            TeamsSwarmController.startSwarm(c.Id, new List<Id>(), 'Bogus');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void startSwarmNoMembersWithAadEmailIdThrowsAuraHandledException() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = null;
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        try {
            TeamsSwarmController.startSwarm(c.Id, new List<Id>(), 'Team');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void startSwarmAlreadySwarmedThrowsAuraHandledException() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = 'existing-team';
        update c;

        Test.startTest();
        try {
            TeamsSwarmController.startSwarm(c.Id, new List<Id>(), 'Team');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void addMembersToSwarmTeamHappyPathSucceeds() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = 'group-123';
        c.Swarm_Group_Id__c = 'group-123';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Team';
        update c;

        Test.setMock(HttpCalloutMock.class, new GraphCalloutMock());

        Test.startTest();
        TeamsSwarmController.addMembersToSwarm(c.Id, new List<Id>{ UserInfo.getUserId() });
        Test.stopTest();
    }

    @IsTest
    static void addMembersToSwarmChatHappyPathSucceeds() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = '19:chat-123@thread.v2';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Chat';
        update c;

        Test.setMock(HttpCalloutMock.class, new GraphCalloutMock());

        Test.startTest();
        TeamsSwarmController.addMembersToSwarm(c.Id, new List<Id>{ UserInfo.getUserId() });
        Test.stopTest();
    }

    @IsTest
    static void addMembersToSwarmNoActiveSwarmThrowsAuraHandledException() {
        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        try {
            TeamsSwarmController.addMembersToSwarm(c.Id, new List<Id>{ UserInfo.getUserId() });
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void addMembersToSwarmNoAadEmailIdThrowsAuraHandledException() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = null;
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = 'group-123';
        c.Swarm_Group_Id__c = 'group-123';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Team';
        update c;

        Test.startTest();
        try {
            TeamsSwarmController.addMembersToSwarm(c.Id, new List<Id>{ UserInfo.getUserId() });
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    private class ListMembersMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setHeader('Content-Type', 'application/json');
            // DELETE first: a group member-remove URL also *contains* the group list URL,
            // so matching the list branch on endpoint alone would swallow the removal call.
            if (req.getMethod() == 'DELETE') {
                res.setStatusCode(204);
            } else if (req.getEndpoint().contains('/v1.0/groups/group-123/members')) {
                res.setStatusCode(200);
                res.setBody('{"value":[{"id":"aad-obj-1","displayName":"Ada Lovelace","mail":"ada@example.com"}]}');
            } else if (req.getEndpoint().endsWith('/v1.0/chats/19:chat-123@thread.v2/members')) {
                res.setStatusCode(200);
                res.setBody('{"value":[{"id":"membership-guest","displayName":"Ada Lovelace","email":"ada@example.com","roles":["guest"]}]}');
            } else {
                res.setStatusCode(404);
                res.setBody('{}');
            }
            return res;
        }
    }

    @IsTest
    static void getSwarmMembersTeamHappyPathReturnsMembers() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = 'group-123';
        c.Swarm_Group_Id__c = 'group-123';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Team';
        update c;

        Test.setMock(HttpCalloutMock.class, new ListMembersMock());

        Test.startTest();
        List<TeamsSwarmService.MemberInfo> members = TeamsSwarmController.getSwarmMembers(c.Id);
        Test.stopTest();

        System.assertEquals(1, members.size());
        System.assertEquals('ada@example.com', members[0].email);
    }

    @IsTest
    static void getSwarmMembersChatHappyPathReturnsMembers() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = '19:chat-123@thread.v2';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Chat';
        update c;

        Test.setMock(HttpCalloutMock.class, new ListMembersMock());

        Test.startTest();
        List<TeamsSwarmService.MemberInfo> members = TeamsSwarmController.getSwarmMembers(c.Id);
        Test.stopTest();

        System.assertEquals(1, members.size());
        System.assertEquals('membership-guest', members[0].removalId);
    }

    @IsTest
    static void getSwarmMembersNoActiveSwarmThrowsAuraHandledException() {
        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        try {
            TeamsSwarmController.getSwarmMembers(c.Id);
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void removeMemberFromSwarmTeamHappyPathSucceeds() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = 'group-123';
        c.Swarm_Group_Id__c = 'group-123';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Team';
        update c;

        Test.setMock(HttpCalloutMock.class, new ListMembersMock());

        Test.startTest();
        TeamsSwarmController.removeMemberFromSwarm(c.Id, 'aad-obj-1');
        Test.stopTest();
    }

    @IsTest
    static void removeMemberFromSwarmChatHappyPathSucceeds() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = '19:chat-123@thread.v2';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Chat';
        update c;

        Test.setMock(HttpCalloutMock.class, new ListMembersMock());

        Test.startTest();
        TeamsSwarmController.removeMemberFromSwarm(c.Id, 'membership-guest');
        Test.stopTest();
    }

    @IsTest
    static void removeMemberFromSwarmBlankRemovalIdThrowsAuraHandledException() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = 'group-123';
        c.Swarm_Group_Id__c = 'group-123';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Team';
        update c;

        Test.startTest();
        try {
            TeamsSwarmController.removeMemberFromSwarm(c.Id, null);
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void removeMemberFromSwarmNoActiveSwarmThrowsAuraHandledException() {
        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        try {
            TeamsSwarmController.removeMemberFromSwarm(c.Id, 'aad-obj-1');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void startSwarmOwnerMissingAadEmailButOtherMemberHasOneThrowsAuraHandledException() {
        List<User> otherUsers = [
            SELECT Id, Azure_AD_Email_Id__c
            FROM User
            WHERE IsActive = true AND UserType = 'Standard' AND Id != :UserInfo.getUserId()
            LIMIT 1
        ];
        if (otherUsers.isEmpty()) {
            return; // No second user available in this org to exercise this branch with.
        }

        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = null;
        update runningUser;

        User otherUser = otherUsers[0];
        otherUser.Azure_AD_Email_Id__c = 'ada@example.com';
        update otherUser;

        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        try {
            TeamsSwarmController.startSwarm(c.Id, new List<Id>{ otherUser.Id }, 'Team');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void startSwarmTeamGraphFailureThrowsAuraHandledException() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new BotInstallFailsMock());

        Test.startTest();
        try {
            TeamsSwarmController.startSwarm(c.Id, new List<Id>(), 'Team');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void startSwarmChatGraphFailureThrowsAuraHandledException() {
        User runningUser = [SELECT Id FROM User WHERE Id = :UserInfo.getUserId()];
        runningUser.Azure_AD_Email_Id__c = 'aad-current-user@example.com';
        update runningUser;

        Case c = [SELECT Id FROM Case LIMIT 1];
        Test.setMock(HttpCalloutMock.class, new GroupCreateFailsMock());

        Test.startTest();
        try {
            TeamsSwarmController.startSwarm(c.Id, new List<Id>(), 'Chat');
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    private class GroupCreateFailsMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest req) {
            HttpResponse res = new HttpResponse();
            res.setStatusCode(403);
            res.setBody('{"error":{"message":"Insufficient privileges"}}');
            return res;
        }
    }

    @IsTest
    static void resetSwarmNoSwarmThrowsAuraHandledException() {
        Case c = [SELECT Id FROM Case LIMIT 1];

        Test.startTest();
        try {
            TeamsSwarmController.resetSwarm(c.Id, null);
            System.assert(false, 'Expected AuraHandledException');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    @IsTest
    static void resetSwarmHappyPathWithNoUsageClearsCase() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = 'group-123';
        c.Swarm_Group_Id__c = 'group-123';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Team';
        update c;

        Test.startTest();
        TeamsSwarmController.resetSwarm(c.Id, null);
        Test.stopTest();

        Case updated = [SELECT Swarm_Team_Id__c, Swarm_Status__c FROM Case WHERE Id = :c.Id];
        System.assertEquals(null, updated.Swarm_Team_Id__c);
        System.assertEquals(null, updated.Swarm_Status__c);
    }

    @IsTest
    static void resetSwarmHappyPathWithUsageLogsSummary() {
        Case c = [SELECT Id FROM Case LIMIT 1];
        c.Swarm_Team_Id__c = '19:chat-123@thread.v2';
        c.Swarm_Status__c = 'Active';
        c.Swarm_Type__c = 'Chat';
        update c;

        TeamsSwarmController.UsageSummary usage = new TeamsSwarmController.UsageSummary();
        usage.historyPollCount = 5;
        usage.sendCount = 2;
        usage.rateLimitedCount = 0;
        usage.apexFallbackCount = 1;
        usage.sessionStartedAt = String.valueOf(Datetime.now());

        Test.startTest();
        TeamsSwarmController.resetSwarm(c.Id, usage);
        Test.stopTest();

        System.assertEquals(1, [SELECT COUNT() FROM Swarm_Usage_Log__c WHERE Case__c = :c.Id]);
    }
}
