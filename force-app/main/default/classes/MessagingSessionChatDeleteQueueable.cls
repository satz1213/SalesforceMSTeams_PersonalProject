/**
 * Deletes the Teams chat behind a MessagingSession's live chat, on behalf of
 * MessagingSessionTeamsChatController.endChat. Deferred to its own async transaction for the same
 * reason TeamsSwarmChatDeleteQueueable is deferred from the Case-based endChat: the transcript
 * DML has to happen first, and Apex forbids a callout after DML. The chat id is passed in rather
 * than re-read from the MessagingSession, since endChat clears Teams_Chat_Id__c in the same
 * transaction that enqueues this job.
 *
 * Graph's delete is a soft delete: the chat vanishes from every member's Teams client but a
 * tenant admin can restore it for seven days. Best-effort, matching this feature's existing
 * "debug-log only, never surfaced" convention (see MessagingSessionTeamsChatQueueable) rather than
 * a dedicated error field - the transcript is already committed and the MessagingSession's Teams
 * fields are already cleared by the time this runs, so there's nothing left for an agent to retry.
 */
public class MessagingSessionChatDeleteQueueable implements Queueable, Database.AllowsCallouts {
    private final Id messagingSessionId;
    private final String chatId;

    public MessagingSessionChatDeleteQueueable(Id messagingSessionId, String chatId) {
        this.messagingSessionId = messagingSessionId;
        this.chatId = chatId;
    }

    public void execute(QueueableContext context) {
        try {
            TeamsSwarmService.deleteChat(chatId);
        } catch (Exception e) {
            System.debug(LoggingLevel.WARN, 'MessagingSession ' + messagingSessionId + ': Teams chat delete failed: ' + e.getMessage());
        }
    }
}
