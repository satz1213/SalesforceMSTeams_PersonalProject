/**
 * Posts the initial view card, on behalf of TeamsBotMessagingResource.handleBotInstalled.
 * Split into its own transaction because the Case row is already claimed (its
 * Swarm_Bot_Service_Url__c set) by the time this runs - see handleBotInstalled's header
 * comment for why the claim and the send can't happen in the same transaction (callouts are
 * blocked after any DML, and FOR UPDATE doesn't reliably hold a lock across a callout anyway).
 */
public class TeamsBotInstalledCardQueueable implements Queueable, Database.AllowsCallouts {
    private final Id caseId;
    private final String conversationId;
    private final String serviceUrl;

    public TeamsBotInstalledCardQueueable(Id caseId, String conversationId, String serviceUrl) {
        this.caseId = caseId;
        this.conversationId = conversationId;
        this.serviceUrl = serviceUrl;
    }

    public void execute(QueueableContext context) {
        Case matchingCase = [SELECT Id, CaseNumber, Subject, Description, Status, Priority, OwnerId, Owner.Name FROM Case WHERE Id = :caseId];
        TeamsBotConversationService.sendCard(serviceUrl, conversationId, TeamsAdaptiveCardBuilder.buildViewCard(TeamsBotMessagingResource.toCardData(matchingCase)));
    }
}
