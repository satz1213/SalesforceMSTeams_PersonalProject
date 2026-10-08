/**
 * Installs the case-swarm bot into a chat, on behalf of TeamsSwarmController.startChatSwarm.
 * Deferred to its own async transaction rather than called synchronously during startSwarm,
 * because Teams can deliver the resulting conversationUpdate/installationUpdate callback
 * (which looks up the Case by Swarm_Team_Id__c in TeamsBotMessagingResource) faster than
 * startSwarm's own transaction commits that field - Teams' delivery and this transaction's
 * commit are two independent, uncoordinated processes, so a synchronous call here raced the
 * commit and the callback's SOQL query found zero rows. Queueable execution only starts after
 * the enqueuing transaction (including saveCase) has fully committed, which closes that race.
 *
 * Installing the bot is still best-effort on top of an already-successful chat swarm, and
 * depends on manual Teams admin setup (README.md section 6) that may not be done yet - a
 * failure here is recorded on Swarm_Bot_Install_Error__c, not surfaced as a user-facing error,
 * since the chat itself (started synchronously in startChatSwarm) already succeeded.
 */
public class TeamsSwarmBotInstallQueueable implements Queueable, Database.AllowsCallouts {
    private final Id caseId;
    private final String chatId;

    public TeamsSwarmBotInstallQueueable(Id caseId, String chatId) {
        this.caseId = caseId;
        this.chatId = chatId;
    }

    public void execute(QueueableContext context) {
        Case matchingCase = new Case(Id = caseId);
        try {
            TeamsSwarmService.installBotApp(chatId, Teams_Bot_Config__mdt.getInstance('Default')?.Teams_App_Catalog_Id__c);
            matchingCase.Swarm_Bot_Install_Error__c = null;
        } catch (Exception e) {
            matchingCase.Swarm_Bot_Install_Error__c = truncate(e.getMessage(), 4096);
        }
        update matchingCase;
    }

    private static String truncate(String value, Integer maxLength) {
        return value == null || value.length() <= maxLength ? value : value.substring(0, maxLength);
    }
}
