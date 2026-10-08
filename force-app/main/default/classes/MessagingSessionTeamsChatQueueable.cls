/**
 * Creates a plain Teams group chat between an Omni-Channel agent and the customer they just
 * accepted a Messaging chat for - no Case, no Adaptive Card. Deferred from
 * MessagingSessionTeamsChatHandler's trigger transaction for the same reason
 * TeamsSwarmBotInstallQueueable is deferred from startChatSwarm: Apex forbids a callout after
 * DML, and the trigger's own transaction still has this record's update pending.
 *
 * Best-effort end to end, matching TeamsSwarmController.logUsage's "a logging/side-channel
 * failure should never block the primary action" pattern - the primary action here (accepting
 * the chat) already succeeded before this queueable ever runs. On any failure this writes
 * nothing and logs via System.debug(LoggingLevel.WARN, ...); the next Active transition for
 * this same MessagingSession (Teams_Chat_Id__c still blank) will simply try again.
 *
 * Bot install failure is caught separately from chat creation so it can never prevent
 * Teams_Chat_Id__c/Teams_Chat_Url__c from being written - see TeamsBotMessagingResource's
 * handleBotInstalled for the other half of the flow (posts a live SignalR notification once
 * Teams delivers the bot-install webhook for this chat).
 */
public class MessagingSessionTeamsChatQueueable implements Queueable, Database.AllowsCallouts {
    private final Id messagingSessionId;
    private final Id agentUserId;
    private final Id customerUserId;

    public MessagingSessionTeamsChatQueueable(Id messagingSessionId, Id agentUserId, Id customerUserId) {
        this.messagingSessionId = messagingSessionId;
        this.agentUserId = agentUserId;
        this.customerUserId = customerUserId;
    }

    public void execute(QueueableContext context) {
        Map<Id, User> usersById = new Map<Id, User>(
            [SELECT Id, Azure_AD_Email_Id__c FROM User WHERE Id IN (:agentUserId, :customerUserId)]
        );
        String agentEmail = usersById.get(agentUserId)?.Azure_AD_Email_Id__c;
        String customerEmail = usersById.get(customerUserId)?.Azure_AD_Email_Id__c;
        if (String.isBlank(agentEmail) || String.isBlank(customerEmail)) {
            System.debug(LoggingLevel.WARN, 'MessagingSession ' + messagingSessionId + ': agent or customer is missing Azure_AD_Email_Id__c - skipping Teams chat creation.');
            return;
        }
        // Graph rejects POST /chats with the same member listed twice ("Duplicate chat members
        // is specified in the request body") - confirmed live. Happens when the agent accepts
        // their own simulated/test chat, so the identified customer is the same Azure AD identity
        // as the agent - dedupe to a single-member chat rather than failing outright.
        List<String> memberIdentifiers = agentEmail.equalsIgnoreCase(customerEmail)
            ? new List<String>{ agentEmail }
            : new List<String>{ agentEmail, customerEmail };

        TeamsSwarmService.ChatResult result;
        try {
            result = TeamsSwarmService.createChat(
                'Messaging Chat - ' + messagingSessionId,
                agentEmail,
                memberIdentifiers
            );
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'MessagingSession ' + messagingSessionId + ': Teams chat creation failed: ' + e.getMessage());
            return;
        }

        try {
            TeamsSwarmService.installBotApp(result.chatId, Teams_Bot_Config__mdt.getInstance('Default')?.Teams_App_Catalog_Id__c);
        } catch (Exception botEx) {
            System.debug(LoggingLevel.WARN, 'MessagingSession ' + messagingSessionId + ': bot install failed: ' + botEx.getMessage());
        }

        update new MessagingSession(
            Id = messagingSessionId,
            Teams_Chat_Id__c = result.chatId,
            Teams_Chat_Url__c = result.webUrl
        );
    }
}
