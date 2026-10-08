@IsTest
private class TeamsSwarmProvisionSchedulerTest {
    @IsTest
    static void scheduleFirstAttemptRegistersACronJob() {
        Case c = new Case(Subject = 'Scheduler test case', Status = 'New', Origin = 'Web', Swarm_Status__c = 'Provisioning');
        insert c;

        // Deliberately not wrapped in Test.startTest()/stopTest(): stopTest() would drain
        // this job synchronously and attempt a real callout via the Queueable it enqueues.
        // This test only verifies the scheduling mechanism itself, not the retry logic.
        TeamsSwarmProvisionScheduler.scheduleFirstAttempt(c.Id, 'group-123', new List<String>{ 'aad-1' });

        List<CronTrigger> jobs = [SELECT Id FROM CronTrigger WHERE CronJobDetail.Name LIKE 'TeamsSwarmRetry-group-123-%'];
        System.assert(!jobs.isEmpty());
    }
}
