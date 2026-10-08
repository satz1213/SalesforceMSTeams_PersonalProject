/**
 * Does the actual Graph callouts to finish provisioning a case swarm Team, once
 * TeamsSwarmProvisionScheduler's delay has elapsed. If the team still isn't ready,
 * hands back to the Scheduler for another delayed attempt rather than re-enqueueing
 * itself directly - immediate Queueable-to-Queueable chaining doesn't reliably wait
 * long enough for Graph to propagate the new group, and can hit Apex's stack depth limit.
 */
public with sharing class TeamsSwarmProvisionQueueable implements Queueable, Database.AllowsCallouts {
    private final Id caseId;
    private final String groupId;
    private final List<String> memberAadObjectIds;
    private final Integer attemptsRemaining;

    public TeamsSwarmProvisionQueueable(Id caseId, String groupId, List<String> memberAadObjectIds, Integer attemptsRemaining) {
        this.caseId = caseId;
        this.groupId = groupId;
        this.memberAadObjectIds = memberAadObjectIds;
        this.attemptsRemaining = attemptsRemaining;
    }

    public void execute(QueueableContext context) {
        try {
            Boolean teamReady = TeamsSwarmService.enableTeam(groupId);

            if (!teamReady) {
                if (attemptsRemaining > 1) {
                    TeamsSwarmProvisionScheduler.scheduleNextAttempt(caseId, groupId, memberAadObjectIds, attemptsRemaining - 1);
                } else {
                    updateCaseStatus('Failed');
                }
                return;
            }

            TeamsSwarmService.addMembers(groupId, memberAadObjectIds);
            updateCaseStatus('Active');
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            updateCaseStatus('Failed');
        }
    }

    private void updateCaseStatus(String status) {
        update new Case(Id = caseId, Swarm_Status__c = status);
    }
}
