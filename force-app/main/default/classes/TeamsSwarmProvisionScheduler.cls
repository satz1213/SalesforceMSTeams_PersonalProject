/**
 * Provides the real wall-clock delay between team-enable retry attempts.
 * Scheduled Apex cannot make callouts itself (even with Database.AllowsCallouts),
 * so this only ever enqueues a TeamsSwarmProvisionQueueable, which does the actual
 * Graph call, once the scheduled time arrives.
 */
public with sharing class TeamsSwarmProvisionScheduler implements Schedulable {
    public static final Integer MAX_ATTEMPTS = 6;
    private static final Integer RETRY_DELAY_SECONDS = 20;

    private final Id caseId;
    private final String groupId;
    private final List<String> memberAadObjectIds;
    private final Integer attemptsRemaining;

    public TeamsSwarmProvisionScheduler(Id caseId, String groupId, List<String> memberAadObjectIds, Integer attemptsRemaining) {
        this.caseId = caseId;
        this.groupId = groupId;
        this.memberAadObjectIds = memberAadObjectIds;
        this.attemptsRemaining = attemptsRemaining;
    }

    public void execute(SchedulableContext context) {
        System.enqueueJob(new TeamsSwarmProvisionQueueable(caseId, groupId, memberAadObjectIds, attemptsRemaining));
        abortSelf(context);
    }

    public static void scheduleFirstAttempt(Id caseId, String groupId, List<String> memberAadObjectIds) {
        scheduleAttempt(caseId, groupId, memberAadObjectIds, MAX_ATTEMPTS);
    }

    public static void scheduleNextAttempt(Id caseId, String groupId, List<String> memberAadObjectIds, Integer attemptsRemaining) {
        scheduleAttempt(caseId, groupId, memberAadObjectIds, attemptsRemaining);
    }

    private static void scheduleAttempt(Id caseId, String groupId, List<String> memberAadObjectIds, Integer attemptsRemaining) {
        Datetime runAt = Datetime.now().addSeconds(RETRY_DELAY_SECONDS);
        String cronExpression = runAt.format('ss mm HH dd MM \'?\' yyyy');
        String jobName = 'TeamsSwarmRetry-' + groupId + '-' + attemptsRemaining + '-' + Datetime.now().getTime();
        System.schedule(jobName, cronExpression, new TeamsSwarmProvisionScheduler(caseId, groupId, memberAadObjectIds, attemptsRemaining));
    }

    private void abortSelf(SchedulableContext context) {
        if (context == null) {
            return;
        }
        try {
            System.abortJob(context.getTriggerId());
        } catch (Exception e) {
            // Already removed - one-time crons self-clean after firing.
        }
    }
}
